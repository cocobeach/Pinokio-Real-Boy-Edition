/**
 * KernelPatcher - The Deep Hook
 * Runtime monkey-patching of pinokiod's internal download mechanism
 * Forces ALL downloads through GAS, even for legacy scripts
 *
 * CRITICAL: This service intercepts kernel-level operations.
 * Failure modes MUST gracefully degrade to original behavior.
 */

const AssetManager = require('./AssetManager');
const fs = require('fs');
const path = require('path');

class KernelPatcher {
  constructor() {
    this.kernel = null;
    this.originalDownload = null;
    this.patched = false;
    this.patchAttempted = false;
    this.patchError = null;
    this.interceptedDownloads = 0;
    this.gasHits = 0;
    this.gasMisses = 0;
    this.fallbackCount = 0;
  }

  /**
   * Initialize the patcher with pinokiod kernel reference
   * @param {Object} pinokiod - Running pinokiod instance
   * @returns {Object} Initialization result
   */
  initialize(pinokiod) {
    try {
      console.log('[KernelPatcher] Initializing Deep Hook...');

      // Validate pinokiod instance
      if (!pinokiod) {
        throw new Error('Pinokiod instance is null or undefined');
      }

      if (!pinokiod.kernel) {
        throw new Error('Pinokiod.kernel is not available');
      }

      this.kernel = pinokiod.kernel;

      // Verify kernel structure before patching
      const validation = this.validateKernelStructure();
      if (!validation.valid) {
        console.warn('[KernelPatcher] Kernel structure validation failed:', validation.errors);
        console.warn('[KernelPatcher] GAS Deep Hook will NOT be applied. Legacy downloads will continue.');
        return {
          success: false,
          patched: false,
          reason: 'invalid_kernel_structure',
          errors: validation.errors,
          graceful: true // This is expected degradation, not a fatal error
        };
      }

      console.log('[KernelPatcher] Kernel structure validated successfully');
      console.log('[KernelPatcher] Target method location:', validation.methodPath);

      return {
        success: true,
        validated: true,
        methodPath: validation.methodPath
      };

    } catch (error) {
      console.error('[KernelPatcher] Initialization failed:', error);
      this.patchError = error;
      return {
        success: false,
        error: error.message,
        graceful: true
      };
    }
  }

  /**
   * Validate that the kernel has the expected structure
   * CRITICAL: We must verify the API exists before patching
   * @returns {Object} Validation result
   */
  validateKernelStructure() {
    const errors = [];

    // Check kernel.api exists
    if (!this.kernel.api) {
      errors.push('kernel.api is undefined');
      return { valid: false, errors };
    }

    // Check kernel.api.fs exists
    if (!this.kernel.api.fs) {
      errors.push('kernel.api.fs is undefined');
      return { valid: false, errors };
    }

    // Check kernel.api.fs.download exists and is a function
    if (typeof this.kernel.api.fs.download !== 'function') {
      errors.push('kernel.api.fs.download is not a function');
      return { valid: false, errors };
    }

    // Check kernel.api.fs._download exists (the internal method)
    if (typeof this.kernel.api.fs._download !== 'function') {
      errors.push('kernel.api.fs._download is not a function (internal method not found)');
      // This is a warning, not a blocker
      console.warn('[KernelPatcher] Internal _download method not found. Will patch public download method.');
    }

    return {
      valid: true,
      errors: [],
      methodPath: 'kernel.api.fs.download'
    };
  }

  /**
   * Apply the Deep Hook patch
   * Overwrites kernel.api.fs.download with GAS-aware version
   * @returns {Object} Patch result
   */
  patch() {
    if (this.patchAttempted) {
      console.warn('[KernelPatcher] Patch already attempted. Current status:', this.patched ? 'ACTIVE' : 'FAILED');
      return {
        success: this.patched,
        alreadyAttempted: true
      };
    }

    this.patchAttempted = true;

    try {
      console.log('[KernelPatcher] Applying Deep Hook patch...');

      // Save reference to original download method
      this.originalDownload = this.kernel.api.fs.download.bind(this.kernel.api.fs);
      console.log('[KernelPatcher] Original download method saved');

      // Create the interceptor wrapper
      const interceptor = this.createInterceptor();

      // Apply the patch
      this.kernel.api.fs.download = interceptor;

      this.patched = true;
      console.log('[KernelPatcher] ✅ Deep Hook ACTIVE. All downloads will use GAS.');

      return {
        success: true,
        patched: true,
        message: 'Kernel successfully patched. All fs.download calls will use GAS.'
      };

    } catch (error) {
      console.error('[KernelPatcher] Failed to apply patch:', error);
      this.patchError = error;
      this.patched = false;

      return {
        success: false,
        error: error.message,
        graceful: true
      };
    }
  }

  /**
   * Create the interceptor function that wraps the original download
   * This is the core of the Deep Hook
   * @returns {Function} Interceptor function
   */
  createInterceptor() {
    const self = this;

    // FIX: Renamed 3rd arg to 'kernelArg' and added fallback logic
    return async function kernelDownloadInterceptor(req, ondata, kernelArg) {
      // CRITICAL FIX: Fallback to captured kernel if argument is missing
      // Pinokiod internal calls often omit the 3rd argument, which would cause
      // kernel.api.filePath() to crash with "Cannot read property 'api' of undefined"
      const kernel = kernelArg || self.kernel;

      self.interceptedDownloads++;

      try {
        // Extract download parameters
        const params = req.params || {};
        const url = params.url || params.uri;

        if (!url) {
          console.warn('[KernelPatcher] Download request missing URL. Falling back to original.');
          self.fallbackCount++;
          return await self.originalDownload(req, ondata, kernel);
        }

        // Determine target path
        let targetPath;
        if (params.path) {
          // Now this line won't crash because 'kernel' is guaranteed to be defined
          targetPath = kernel.api.filePath(params.path, req.cwd);
        } else if (params.dir) {
          // If only dir is specified, we can't predict the filename yet
          // Fall back to original download which will determine filename from Content-Disposition
          console.log('[KernelPatcher] Download uses dir parameter. Using original download for filename detection.');
          self.fallbackCount++;
          return await self.originalDownload(req, ondata, kernel);
        } else {
          console.warn('[KernelPatcher] Download request missing path/dir. Falling back to original.');
          self.fallbackCount++;
          return await self.originalDownload(req, ondata, kernel);
        }

        console.log(`[KernelPatcher] 🎯 Intercepted download: ${url}`);
        console.log(`[KernelPatcher] Target path: ${targetPath}`);

        // BYPASS: System Binaries & Installers
        // System files (Conda, Git, Node installers) must be handled natively by pinokiod
        // Installing them via GAS breaks the installation logic (symlinks/moves break .exe/.sh execution)
        // Normalize path for cross-platform comparison (handles C:\, F:\, /home, etc.)
        const normalizedPath = targetPath.toLowerCase().replace(/\\/g, '/');

        // Check if path contains system directories
        // Works for: C:\Users\...\pinokio\bin, F:\pinokio\bin, /home/user/pinokio/bin, etc.
        const isSystemFile = normalizedPath.includes('/pinokio/bin/') ||
                            normalizedPath.includes('/pinokio/cache/') ||
                            normalizedPath.includes('/.pinokio/bin/') ||
                            normalizedPath.includes('/.pinokio/cache/');

        if (isSystemFile) {
          console.log(`[KernelPatcher] 🛡️  SYSTEM DOWNLOAD detected (${path.basename(targetPath)}). Bypassing GAS.`);
          console.log(`[KernelPatcher] Path: ${targetPath}`);
          console.log('[KernelPatcher] Reason: System binaries must be installed natively by pinokiod.');
          self.fallbackCount++;
          return await self.originalDownload(req, ondata, kernel);
        }

        // Get GAS download plan
        const plan = AssetManager.getDownloadPlan(url, targetPath);
        console.log(`[KernelPatcher] GAS Plan: ${plan.action} (${plan.reason})`);

        // Execute based on plan
        switch (plan.action) {
          case 'skip':
            // File already exists at target, skip entirely
            console.log('[KernelPatcher] ⚡ File exists at target. Skipping download.');
            self.gasHits++;

            if (ondata) {
              ondata({ raw: '\r\n[GAS] File already exists at target. Skipping download.\r\n' });
            }

            return { success: true, skipped: true, reason: 'file_exists' };

          case 'link':
            // File exists in GAS, create symlink
            console.log('[KernelPatcher] ⚡ GAS HIT! Linking from GAS instead of downloading.');
            self.gasHits++;

            if (ondata) {
              ondata({ raw: '\r\n[GAS] Model found in Global Asset Store! Creating symlink...\r\n' });
            }

            const linkResult = AssetManager.linkAsset(plan.gasPath, plan.targetPath);

            if (!linkResult.success) {
              console.error('[KernelPatcher] Link failed:', linkResult.error);
              console.log('[KernelPatcher] Falling back to original download');
              self.fallbackCount++;
              return await self.originalDownload(req, ondata, kernel);
            }

            if (ondata) {
              const method = linkResult.method === 'symlink' ? 'Symlink' : 'Copy';
              ondata({ raw: `\r\n[GAS] ${method} created successfully. Download skipped!\r\n` });
            }

            console.log(`[KernelPatcher] ✅ Link created (${linkResult.method}). Saved bandwidth!`);
            return { success: true, linked: true, method: linkResult.method };

          case 'download':
            // Need to download to GAS
            console.log('[KernelPatcher] ⬇️  GAS MISS. Downloading to GAS...');
            self.gasMisses++;

            if (ondata) {
              ondata({ raw: '\r\n[GAS] Downloading to Global Asset Store for future reuse...\r\n' });
            }

            // Download to GAS using AssetManager
            const downloadResult = await self.downloadToGasWithProgress(
              url,
              plan.downloadPath,
              targetPath,
              ondata,
              req,
              kernel
            );

            if (!downloadResult.success) {
              console.error('[KernelPatcher] GAS download failed:', downloadResult.error);
              console.log('[KernelPatcher] Falling back to original download');
              self.fallbackCount++;
              return await self.originalDownload(req, ondata, kernel);
            }

            console.log('[KernelPatcher] ✅ Downloaded to GAS and linked to target');
            return downloadResult;

          default:
            console.warn('[KernelPatcher] Unknown plan action:', plan.action);
            self.fallbackCount++;
            return await self.originalDownload(req, ondata, kernel);
        }

      } catch (error) {
        console.error('[KernelPatcher] Interceptor error:', error);
        console.log('[KernelPatcher] CRITICAL: Falling back to original download to prevent script failure');
        self.fallbackCount++;

        // CRITICAL: Always fall back to original on error
        try {
          return await self.originalDownload(req, ondata, kernel);
        } catch (fallbackError) {
          console.error('[KernelPatcher] FATAL: Original download also failed:', fallbackError);
          throw fallbackError;
        }
      }
    };
  }

  /**
   * Download file to GAS with progress relay
   * @param {string} url - Source URL
   * @param {string} gasPath - GAS destination path
   * @param {string} targetPath - Final target path
   * @param {Function} ondata - Progress callback from kernel
   * @param {Object} req - Original request object
   * @param {Object} kernel - Kernel instance
   * @returns {Promise<Object>} Download result
   */
  async downloadToGasWithProgress(url, gasPath, targetPath, ondata, req, kernel) {
    try {
      // Ensure GAS directory exists
      const gasDir = path.dirname(gasPath);
      if (!fs.existsSync(gasDir)) {
        fs.mkdirSync(gasDir, { recursive: true });
      }

      // Use the original download but redirect to GAS path
      const modifiedReq = {
        ...req,
        params: {
          ...req.params,
          path: gasPath // Download to GAS instead of original target
        }
      };

      // Call original download to GAS location
      await this.originalDownload(modifiedReq, ondata, kernel);

      // Verify download succeeded
      if (!fs.existsSync(gasPath)) {
        throw new Error('Download completed but file not found at GAS path');
      }

      if (ondata) {
        ondata({ raw: '\r\n[GAS] Download complete. Creating symlink to app folder...\r\n' });
      }

      // Create symlink from GAS to target
      const linkResult = AssetManager.linkAsset(gasPath, targetPath);

      if (!linkResult.success) {
        throw new Error(`Failed to create link: ${linkResult.error}`);
      }

      if (ondata) {
        const method = linkResult.method === 'symlink' ? 'Symlink' : 'Copy';
        ondata({ raw: `\r\n[GAS] ${method} created. Asset stored in GAS for future reuse!\r\n` });
      }

      return {
        success: true,
        downloaded: true,
        linked: true,
        gasPath,
        targetPath,
        method: linkResult.method
      };

    } catch (error) {
      console.error('[KernelPatcher] downloadToGasWithProgress failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Unpatch the kernel (restore original behavior)
   * Used for testing or graceful degradation
   * @returns {Object} Unpatch result
   */
  unpatch() {
    if (!this.patched) {
      return {
        success: false,
        reason: 'not_patched'
      };
    }

    try {
      if (!this.originalDownload) {
        throw new Error('Original download method not saved');
      }

      // Restore original method
      this.kernel.api.fs.download = this.originalDownload;
      this.patched = false;

      console.log('[KernelPatcher] Deep Hook removed. Restored original download behavior.');

      return {
        success: true,
        unpatched: true
      };

    } catch (error) {
      console.error('[KernelPatcher] Failed to unpatch:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get statistics about intercepted downloads
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      patched: this.patched,
      patchAttempted: this.patchAttempted,
      patchError: this.patchError ? this.patchError.message : null,
      interceptedDownloads: this.interceptedDownloads,
      gasHits: this.gasHits,
      gasMisses: this.gasMisses,
      fallbackCount: this.fallbackCount,
      hitRate: this.interceptedDownloads > 0
        ? ((this.gasHits / this.interceptedDownloads) * 100).toFixed(2) + '%'
        : '0%',
      bandwidthSaved: this.gasHits > 0
        ? `${this.gasHits} downloads skipped via GAS`
        : 'No savings yet'
    };
  }

  /**
   * Cleanup on shutdown
   */
  destroy() {
    if (this.patched) {
      console.log('[KernelPatcher] Cleaning up...');
      const stats = this.getStats();
      console.log('[KernelPatcher] Session stats:', JSON.stringify(stats, null, 2));

      // Optionally unpatch on shutdown
      // this.unpatch();
    }
    console.log('[KernelPatcher] Service destroyed');
  }
}

// Export singleton instance
module.exports = new KernelPatcher();
