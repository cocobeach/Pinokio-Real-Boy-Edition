/**
 * FileSystemService - Secure Filesystem Bridge
 * Epic 7: Story 7.2 - Filesystem Sidebar & Editor Wiring
 * Provides secure filesystem access for the native sidebar and Monaco Editor
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

class FileSystemService {
  constructor() {
    this.allowedBasePaths = [
      path.join(os.homedir(), 'pinokio', 'api'),       // Installed apps
      path.join(os.homedir(), 'pinokio', 'forge'),     // AI-generated scripts
      path.join(os.homedir(), 'pinokio', 'bin')        // System binaries
    ];
  }

  /**
   * Validate that a path is within allowed directories
   * Security: Prevents directory traversal attacks
   * @param {string} filePath - Path to validate
   * @returns {boolean} True if path is safe
   */
  isPathAllowed(filePath) {
    const normalizedPath = path.resolve(filePath);

    // Check if path is within any allowed base path
    for (const basePath of this.allowedBasePaths) {
      if (normalizedPath.startsWith(path.resolve(basePath))) {
        return true;
      }
    }

    console.warn(`[FileSystemService] Blocked access to unauthorized path: ${filePath}`);
    return false;
  }

  /**
   * Read directory contents
   * Story 7.2: Enables native sidebar to display file tree
   * @param {string} dirPath - Directory path to read
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Directory contents with file metadata
   */
  async readDirectory(dirPath, options = {}) {
    try {
      // Security check
      if (!this.isPathAllowed(dirPath)) {
        return {
          success: false,
          error: 'Access denied: Path is outside allowed directories'
        };
      }

      if (!fs.existsSync(dirPath)) {
        return {
          success: false,
          error: 'Directory does not exist'
        };
      }

      const stats = fs.statSync(dirPath);
      if (!stats.isDirectory()) {
        return {
          success: false,
          error: 'Path is not a directory'
        };
      }

      // Read directory
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      // Map entries to structured data
      const files = entries.map(entry => {
        const fullPath = path.join(dirPath, entry.name);
        let fileStats = null;

        try {
          fileStats = fs.statSync(fullPath);
        } catch (error) {
          console.warn(`[FileSystemService] Could not stat ${fullPath}:`, error.message);
        }

        return {
          name: entry.name,
          path: fullPath,
          isDirectory: entry.isDirectory(),
          isFile: entry.isFile(),
          size: fileStats ? fileStats.size : 0,
          modified: fileStats ? fileStats.mtime : null,
          extension: entry.isFile() ? path.extname(entry.name) : null
        };
      });

      // Sort: directories first, then files (alphabetically)
      files.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });

      // Filter hidden files if requested
      const visibleFiles = options.showHidden
        ? files
        : files.filter(f => !f.name.startsWith('.'));

      return {
        success: true,
        path: dirPath,
        files: visibleFiles
      };
    } catch (error) {
      console.error(`[FileSystemService] Error reading directory ${dirPath}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Read file contents
   * Story 7.2: Loads file content into Monaco Editor
   * @param {string} filePath - File path to read
   * @returns {Promise<Object>} File content and metadata
   */
  async readFile(filePath) {
    try {
      // Security check
      if (!this.isPathAllowed(filePath)) {
        return {
          success: false,
          error: 'Access denied: Path is outside allowed directories'
        };
      }

      if (!fs.existsSync(filePath)) {
        return {
          success: false,
          error: 'File does not exist'
        };
      }

      const stats = fs.statSync(filePath);
      if (!stats.isFile()) {
        return {
          success: false,
          error: 'Path is not a file'
        };
      }

      // Read file content
      const content = fs.readFileSync(filePath, 'utf8');

      return {
        success: true,
        path: filePath,
        content,
        size: stats.size,
        modified: stats.mtime,
        extension: path.extname(filePath)
      };
    } catch (error) {
      console.error(`[FileSystemService] Error reading file ${filePath}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Write file contents
   * Story 7.2: Saves Monaco Editor content to disk
   * @param {string} filePath - File path to write
   * @param {string} content - Content to write
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Write result
   */
  async writeFile(filePath, content, options = {}) {
    try {
      // Security check
      if (!this.isPathAllowed(filePath)) {
        return {
          success: false,
          error: 'Access denied: Path is outside allowed directories'
        };
      }

      // Ensure directory exists
      const dirPath = path.dirname(filePath);
      if (!fs.existsSync(dirPath)) {
        if (options.createDirs) {
          fs.mkdirSync(dirPath, { recursive: true });
        } else {
          return {
            success: false,
            error: 'Parent directory does not exist'
          };
        }
      }

      // Write file
      fs.writeFileSync(filePath, content, 'utf8');

      const stats = fs.statSync(filePath);

      console.log(`[FileSystemService] Wrote file: ${filePath} (${stats.size} bytes)`);

      return {
        success: true,
        path: filePath,
        size: stats.size,
        modified: stats.mtime
      };
    } catch (error) {
      console.error(`[FileSystemService] Error writing file ${filePath}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get file metadata
   * @param {string} filePath - File path
   * @returns {Promise<Object>} File metadata
   */
  async getFileMetadata(filePath) {
    try {
      // Security check
      if (!this.isPathAllowed(filePath)) {
        return {
          success: false,
          error: 'Access denied: Path is outside allowed directories'
        };
      }

      if (!fs.existsSync(filePath)) {
        return {
          success: false,
          error: 'File does not exist'
        };
      }

      const stats = fs.statSync(filePath);

      return {
        success: true,
        path: filePath,
        name: path.basename(filePath),
        extension: path.extname(filePath),
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        accessed: stats.atime
      };
    } catch (error) {
      console.error(`[FileSystemService] Error getting metadata for ${filePath}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Setup IPC handlers
   * @param {IpcRouter} ipcRouter - IPC router instance
   */
  setupIpcHandlers(ipcRouter) {
    // Read directory
    ipcRouter.handle('fs:read-directory', async (event, params) => {
      return await this.readDirectory(params.path, params.options);
    });

    // Read file
    ipcRouter.handle('file:read', async (event, params) => {
      return await this.readFile(params.path);
    });

    // Write file
    ipcRouter.handle('file:save', async (event, params) => {
      return await this.writeFile(params.path, params.content, params.options);
    });

    // Get file metadata
    ipcRouter.handle('file:metadata', async (event, params) => {
      return await this.getFileMetadata(params.path);
    });

    console.log('[FileSystemService] IPC handlers registered');
  }

  /**
   * Cleanup on shutdown
   */
  destroy() {
    console.log('[FileSystemService] Service destroyed');
  }
}

// Export singleton instance
module.exports = new FileSystemService();
