/**
 * WindowManager - Centralized window lifecycle management
 * Handles creation, state persistence, and destruction of browser windows
 */

const { BrowserWindow, session } = require('electron');
const windowStateKeeper = require('electron-window-state');
const path = require('path');

class WindowManager {
  constructor() {
    this.mainWindow = null;
    this.splashWindow = null;
    this.windows = new Map(); // Track all secondary windows
    this.pinned = {}; // Pinned windows state
    this.theme = null;
    this.colors = null;
  }

  /**
   * Create splash screen
   * @returns {BrowserWindow} Splash window instance
   */
  createSplashWindow() {
    if (this.splashWindow) {
      return this.splashWindow;
    }

    this.splashWindow = new BrowserWindow({
      width: 400,
      height: 400,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      webPreferences: {
        contextIsolation: false,
        nodeIntegration: true
      }
    });

    const splashPath = path.join(__dirname, '../../../splash.html');
    this.splashWindow.loadFile(splashPath);

    this.splashWindow.on('closed', () => {
      this.splashWindow = null;
    });

    console.log('[WindowManager] Splash window created');
    return this.splashWindow;
  }

  /**
   * Close splash screen
   */
  closeSplashWindow() {
    if (this.splashWindow && !this.splashWindow.isDestroyed()) {
      this.splashWindow.close();
      this.splashWindow = null;
      console.log('[WindowManager] Splash window closed');
    }
  }

  /**
   * Generate title bar overlay configuration
   * @param {Object} colors - Theme colors
   * @returns {Object} Title bar overlay config
   */
  getTitleBarOverlay(colors) {
    if (!colors) {
      return {
        color: 'rgba(0,0,0,0)',
        symbolColor: '#74b1be',
        height: 40
      };
    }

    return {
      color: colors.primary,
      symbolColor: colors.primarytext,
      height: 40
    };
  }

  /**
   * Create main application window
   * @param {string} url - Initial URL to load
   * @param {Object} options - Window options
   * @param {Object} options.colors - Theme colors
   * @param {string} options.preloadPath - Path to preload script
   * @returns {BrowserWindow} Main window instance
   */
  createMainWindow(url, options = {}) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      console.log('[WindowManager] Main window already exists');
      return this.mainWindow;
    }

    // Store theme colors
    if (options.colors) {
      this.colors = options.colors;
    }

    // Use electron-window-state to remember window size/position
    const mainWindowState = windowStateKeeper({
      defaultWidth: 1200,
      defaultHeight: 800
    });

    const preloadPath = options.preloadPath || path.join(__dirname, '../../../preload.js');

    this.mainWindow = new BrowserWindow({
      x: mainWindowState.x,
      y: mainWindowState.y,
      width: mainWindowState.width,
      height: mainWindowState.height,
      titleBarStyle: 'hidden',
      titleBarOverlay: this.getTitleBarOverlay(this.colors),
      webPreferences: {
        webSecurity: false,
        nativeWindowOpen: true,
        contextIsolation: false,
        nodeIntegrationInSubFrames: true,
        preload: preloadPath
      }
    });

    // Track window state
    mainWindowState.manage(this.mainWindow);

    // Load URL
    this.mainWindow.loadURL(url);

    // Handle window close
    this.mainWindow.on('closed', () => {
      console.log('[WindowManager] Main window closed');
      this.mainWindow = null;
    });

    console.log('[WindowManager] Main window created');
    return this.mainWindow;
  }

  /**
   * Create a secondary window (popup/new window)
   * @param {string} url - URL to load
   * @param {Object} options - Window options
   * @returns {BrowserWindow} Window instance
   */
  createSecondaryWindow(url, options = {}) {
    const windowId = `window_${Date.now()}`;
    const preloadPath = options.preloadPath || path.join(__dirname, '../../../preload.js');

    const win = new BrowserWindow({
      width: options.width || 1024,
      height: options.height || 768,
      titleBarStyle: 'hidden',
      titleBarOverlay: this.getTitleBarOverlay(this.colors),
      webPreferences: {
        session: session.fromPartition(`temp-window-${windowId}`),
        webSecurity: false,
        nativeWindowOpen: true,
        contextIsolation: false,
        nodeIntegrationInSubFrames: true,
        preload: preloadPath
      }
    });

    win.loadURL(url);

    // Track window
    this.windows.set(windowId, win);

    // Cleanup on close
    win.on('closed', () => {
      this.windows.delete(windowId);
      console.log(`[WindowManager] Secondary window ${windowId} closed`);
    });

    console.log(`[WindowManager] Secondary window ${windowId} created`);
    return win;
  }

  /**
   * Update theme colors
   * @param {Object} theme - Theme data
   * @param {Object} colors - Color palette
   */
  updateTheme(theme, colors) {
    this.theme = theme;
    this.colors = colors;

    // Update title bar overlay for all windows
    const titleBarOverlay = this.getTitleBarOverlay(colors);

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.setTitleBarOverlay(titleBarOverlay);
    }

    for (const [id, win] of this.windows) {
      if (!win.isDestroyed()) {
        win.setTitleBarOverlay(titleBarOverlay);
      }
    }

    console.log('[WindowManager] Theme updated');
  }

  /**
   * Get main window
   * @returns {BrowserWindow|null} Main window instance
   */
  getMainWindow() {
    return this.mainWindow;
  }

  /**
   * Get all windows
   * @returns {Array<BrowserWindow>} All window instances
   */
  getAllWindows() {
    const windows = [];

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      windows.push(this.mainWindow);
    }

    for (const [id, win] of this.windows) {
      if (!win.isDestroyed()) {
        windows.push(win);
      }
    }

    return windows;
  }

  /**
   * Focus main window
   */
  focusMainWindow() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore();
      }
      this.mainWindow.focus();
    }
  }

  /**
   * Show main window
   */
  showMainWindow() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.show();
      this.focusMainWindow();
    }
  }

  /**
   * Hide main window
   */
  hideMainWindow() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.hide();
    }
  }

  /**
   * Set pinned state for a window
   * @param {string} url - URL of the window
   * @param {boolean} isPinned - Pinned state
   */
  setPinned(url, isPinned) {
    this.pinned[url] = isPinned;
  }

  /**
   * Check if URL is pinned
   * @param {string} url - URL to check
   * @returns {boolean} True if pinned
   */
  isPinned(url) {
    return !!this.pinned[url];
  }

  /**
   * Cleanup all windows
   */
  destroy() {
    // Close splash
    this.closeSplashWindow();

    // Close all secondary windows
    for (const [id, win] of this.windows) {
      if (!win.isDestroyed()) {
        win.close();
      }
    }
    this.windows.clear();

    // Close main window
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.close();
      this.mainWindow = null;
    }

    console.log('[WindowManager] All windows destroyed');
  }
}

// Export singleton instance
module.exports = new WindowManager();
