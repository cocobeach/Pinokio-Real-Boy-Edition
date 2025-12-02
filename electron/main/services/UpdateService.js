/**
 * UpdateService - Manages application auto-updates
 * Wraps the existing Updater class with robust error handling
 * Ensures update failures don't crash the app
 */

const Updater = require('../../../updater');

class UpdateService {
  constructor() {
    this.updater = new Updater();
    this.mainWindow = null;
    this.isEnabled = true;
  }

  /**
   * Initialize and start checking for updates
   * @param {BrowserWindow} mainWindow - Main window instance
   */
  async start(mainWindow) {
    this.mainWindow = mainWindow;

    if (!this.isEnabled) {
      console.log('[UpdateService] Updates disabled');
      return;
    }

    try {
      console.log('[UpdateService] Starting update checks...');
      this.updater.run(mainWindow);
    } catch (error) {
      // Critical: Update failures must NOT crash the app
      console.error('[UpdateService] Failed to start updater:', error);
      console.error('[UpdateService] Continuing without update functionality');
      this.isEnabled = false;
    }
  }

  /**
   * Disable auto-updates
   */
  disable() {
    this.isEnabled = false;
    console.log('[UpdateService] Updates disabled');
  }

  /**
   * Enable auto-updates
   */
  enable() {
    this.isEnabled = true;
    console.log('[UpdateService] Updates enabled');
  }

  /**
   * Get update service status
   * @returns {Object} Status information
   */
  getStatus() {
    return {
      enabled: this.isEnabled,
      hasMainWindow: !!this.mainWindow
    };
  }

  /**
   * Cleanup on shutdown
   */
  destroy() {
    this.mainWindow = null;
    console.log('[UpdateService] Service destroyed');
  }
}

// Export singleton instance
module.exports = new UpdateService();
