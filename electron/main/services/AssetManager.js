/**
 * AssetManager - Global Asset Store (GAS)
 * Content-addressable storage using symlinks for deduplication
 * Prevents massive model files from being duplicated across apps
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');

class AssetManager {
  constructor() {
    this.gasPath = null;
    this.initialized = false;
    this.canSymlink = true; // Will be tested on first use
  }

  /**
   * Initialize the Global Asset Store
   * @param {string} customPath - Custom GAS path (default: ~/pinokio/storage/gas)
   */
  initialize(customPath = null) {
    if (this.initialized) {
      console.log('[AssetManager] Already initialized');
      return;
    }

    try {
      const homedir = os.homedir();
      this.gasPath = customPath || path.join(homedir, 'pinokio', 'storage', 'gas');

      // Create GAS directory if it doesn't exist
      if (!fs.existsSync(this.gasPath)) {
        fs.mkdirSync(this.gasPath, { recursive: true });
        console.log(`[AssetManager] Created GAS directory: ${this.gasPath}`);
      }

      // Test symlink capabilities
      this.testSymlinkCapability();

      this.initialized = true;
      console.log('[AssetManager] Initialized successfully');
    } catch (error) {
      console.error('[AssetManager] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Test if the system supports symlinks
   * On Windows, this requires admin privileges or Developer Mode
   */
  testSymlinkCapability() {
    const testFile = path.join(this.gasPath, '.symlink-test-source');
    const testLink = path.join(this.gasPath, '.symlink-test-link');

    try {
      // Create test file
      fs.writeFileSync(testFile, 'test');

      // Try to create symlink
      fs.symlinkSync(testFile, testLink);

      // Cleanup
      fs.unlinkSync(testLink);
      fs.unlinkSync(testFile);

      this.canSymlink = true;
      console.log('[AssetManager] Symlink capability: AVAILABLE');
    } catch (error) {
      this.canSymlink = false;
      console.warn('[AssetManager] Symlink capability: UNAVAILABLE');
      console.warn('[AssetManager] Will fall back to copying files (Windows may require Developer Mode or Admin privileges)');

      // Cleanup on error
      try {
        if (fs.existsSync(testLink)) fs.unlinkSync(testLink);
        if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Compute content hash for a file
   * @param {string} filePath - Path to file
   * @returns {Promise<string>} SHA256 hash
   */
  async computeFileHash(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * Generate GAS path from URL
   * @param {string} url - Source URL
   * @returns {string} Path in GAS
   */
  getGasPathFromUrl(url) {
    // Parse URL to create a unique path
    // e.g., huggingface.co/user/repo/file.safetensors -> gas/huggingface.co/user/repo/file.safetensors
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      const pathname = urlObj.pathname.replace(/^\//, ''); // Remove leading slash

      return path.join(this.gasPath, hostname, pathname);
    } catch (error) {
      // If URL parsing fails, use hash-based path
      const hash = crypto.createHash('sha256').update(url).digest('hex');
      const filename = path.basename(url);
      return path.join(this.gasPath, 'hashed', hash.substring(0, 2), hash, filename);
    }
  }

  /**
   * Check if asset exists in GAS
   * @param {string} url - Source URL
   * @returns {Object} Exists status and path
   */
  assetExists(url) {
    const gasFilePath = this.getGasPathFromUrl(url);
    const exists = fs.existsSync(gasFilePath);

    return {
      exists,
      path: exists ? gasFilePath : null
    };
  }

  /**
   * Link or copy asset to target location
   * @param {string} sourcePath - Path to source file in GAS
   * @param {string} targetPath - Target path for link/copy
   * @returns {Object} Operation result
   */
  linkAsset(sourcePath, targetPath) {
    try {
      // Validate paths (security check)
      if (!this.isPathSafe(targetPath)) {
        throw new Error('Target path validation failed: attempting to link to system-critical location');
      }

      // Ensure target directory exists
      const targetDir = path.dirname(targetPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      // Remove existing file/link if present
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
      }

      if (this.canSymlink) {
        // Use symlink
        fs.symlinkSync(sourcePath, targetPath, 'file');
        console.log(`[AssetManager] Symlinked: ${sourcePath} -> ${targetPath}`);
        return { success: true, method: 'symlink' };
      } else {
        // Fall back to copy
        fs.copyFileSync(sourcePath, targetPath);
        console.warn(`[AssetManager] Copied (symlink unavailable): ${sourcePath} -> ${targetPath}`);
        return { success: true, method: 'copy', warning: 'symlink_unavailable' };
      }

    } catch (error) {
      console.error('[AssetManager] Error linking asset:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Validate that target path is safe (not a system-critical location)
   * @param {string} targetPath - Path to validate
   * @returns {boolean} True if safe
   */
  isPathSafe(targetPath) {
    const normalized = path.normalize(targetPath);

    // Block system-critical paths
    const blockedPaths = [
      '/etc',
      '/bin',
      '/sbin',
      '/usr/bin',
      '/usr/sbin',
      '/System',
      'C:\\Windows',
      'C:\\Program Files'
    ];

    for (const blocked of blockedPaths) {
      if (normalized.startsWith(blocked)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Download asset to GAS (stub - actual download handled by pinokiod)
   * This method would be called by pinokiod to register a downloaded asset
   * @param {string} url - Source URL
   * @param {string} localPath - Path where file was downloaded
   * @returns {Object} Registration result
   */
  registerAsset(url, localPath) {
    try {
      const gasFilePath = this.getGasPathFromUrl(url);

      // Ensure GAS directory exists
      const gasDir = path.dirname(gasFilePath);
      if (!fs.existsSync(gasDir)) {
        fs.mkdirSync(gasDir, { recursive: true });
      }

      // Move file to GAS if not already there
      if (localPath !== gasFilePath) {
        if (fs.existsSync(gasFilePath)) {
          // Asset already exists, remove downloaded duplicate
          fs.unlinkSync(localPath);
          console.log(`[AssetManager] Asset already in GAS: ${url}`);
        } else {
          // Move to GAS
          fs.renameSync(localPath, gasFilePath);
          console.log(`[AssetManager] Registered asset: ${url} -> ${gasFilePath}`);
        }
      }

      return {
        success: true,
        path: gasFilePath
      };

    } catch (error) {
      console.error('[AssetManager] Error registering asset:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get GAS statistics
   * @returns {Object} Statistics
   */
  getStats() {
    try {
      if (!this.initialized) {
        return { initialized: false };
      }

      // Count files in GAS (this could be expensive for large stores)
      const countFiles = (dir) => {
        let count = 0;
        let totalSize = 0;

        const walk = (currentPath) => {
          const files = fs.readdirSync(currentPath);

          for (const file of files) {
            const filePath = path.join(currentPath, file);
            const stat = fs.statSync(filePath);

            if (stat.isDirectory()) {
              walk(filePath);
            } else {
              count++;
              totalSize += stat.size;
            }
          }
        };

        walk(dir);
        return { count, totalSize };
      };

      const { count, totalSize } = countFiles(this.gasPath);

      return {
        initialized: true,
        gasPath: this.gasPath,
        canSymlink: this.canSymlink,
        fileCount: count,
        totalSize: totalSize,
        totalSizeGB: (totalSize / 1024 / 1024 / 1024).toFixed(2)
      };

    } catch (error) {
      console.error('[AssetManager] Error getting stats:', error);
      return { error: error.message };
    }
  }

  /**
   * Setup IPC handlers for asset operations
   * @param {IpcRouter} ipcRouter - IPC router instance
   */
  setupIpcHandlers(ipcRouter) {
    // Check if asset exists
    ipcRouter.handle('gas:exists', async (event, { url }) => {
      return this.assetExists(url);
    });

    // Link asset to target
    ipcRouter.handle('gas:link', async (event, { sourcePath, targetPath }) => {
      return this.linkAsset(sourcePath, targetPath);
    });

    // Register downloaded asset
    ipcRouter.handle('gas:register', async (event, { url, localPath }) => {
      return this.registerAsset(url, localPath);
    });

    // Get stats
    ipcRouter.handle('gas:stats', async () => {
      return this.getStats();
    });

    console.log('[AssetManager] IPC handlers registered');
  }

  /**
   * Cleanup on shutdown
   */
  destroy() {
    this.initialized = false;
    console.log('[AssetManager] Service destroyed');
  }
}

// Export singleton instance
module.exports = new AssetManager();
