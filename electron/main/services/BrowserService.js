/**
 * BrowserService - Browser/WebContents Configuration
 * Handles CORS, CSP, permissions, navigation, and logging
 * Extracted from the attach() function in full.js
 */

const { shell, desktopCapturer, session } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

class BrowserService {
  constructor() {
    this.rootUrl = null;
    this.colors = null;
    this.preloadPath = null;

    // Browser console logging
    this.enableBrowserLog = process.env.PINOKIO_BROWSER_LOG === '1';
    this.attachedConsoleListeners = new WeakSet();
    this.browserConsoleState = new WeakMap();
    this.browserLogBuffer = [];
    this.browserLogWritePromise = Promise.resolve();
    this.browserLogFile = null;
  }

  /**
   * Initialize the browser service
   * @param {Object} options - Configuration options
   * @param {string} options.rootUrl - Root URL of the application
   * @param {Object} options.colors - Theme colors
   * @param {string} options.preloadPath - Path to preload script
   */
  initialize(options) {
    this.rootUrl = options.rootUrl;
    this.colors = options.colors;
    this.preloadPath = options.preloadPath || path.join(__dirname, '../../../preload.js');

    if (this.enableBrowserLog) {
      this.ensureBrowserLogFile();
    }

    console.log('[BrowserService] Initialized');
  }

  /**
   * Ensure browser log file exists
   * @returns {string|null} Log file path
   */
  ensureBrowserLogFile() {
    if (this.browserLogFile) {
      return this.browserLogFile;
    }

    try {
      const homedir = os.homedir();
      const logDir = path.join(homedir, '.pinokio', 'logs');

      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      this.browserLogFile = path.join(logDir, 'browser.log');
      return this.browserLogFile;
    } catch (error) {
      console.error('[BrowserService] Failed to create log file:', error);
      return null;
    }
  }

  /**
   * Attach browser configuration to a webContents
   * @param {WebContents} webContents - Electron webContents to configure
   */
  attach(webContents) {
    // Setup console logging if enabled
    if (this.enableBrowserLog && !this.attachedConsoleListeners.has(webContents)) {
      this.attachConsoleLogging(webContents);
    }

    // Setup permissions
    this.setupPermissions(webContents);

    // Setup navigation handling
    this.setupNavigation(webContents);

    // Setup header manipulation
    this.setupHeaderManipulation(webContents);

    // Setup window open handler
    this.setupWindowOpenHandler(webContents);

    // Handle navigation events for title bar updates
    this.setupNavigationEvents(webContents);

    console.log('[BrowserService] Attached to webContents');
  }

  /**
   * Attach console logging to webContents
   * @param {WebContents} webContents - WebContents instance
   */
  attachConsoleLogging(webContents) {
    this.attachedConsoleListeners.add(webContents);

    webContents.on('console-message', (event, level, message, line, sourceId) => {
      if (!this.rootUrl) return;

      const state = this.browserConsoleState.get(webContents);
      let pageUrl = state && state.url ? state.url : '';

      if (!pageUrl) {
        try {
          pageUrl = webContents.getURL();
        } catch (err) {
          pageUrl = '';
        }
      }

      if (!pageUrl || !pageUrl.startsWith(this.rootUrl)) {
        return;
      }

      const targetFile = this.ensureBrowserLogFile();
      if (!targetFile) return;

      const timestamp = new Date().toISOString();
      const levelLabels = ['log', 'warn', 'error'];
      const levelLabel = levelLabels[level] || 'log';

      let location = '';
      if (sourceId) {
        location = ` (${sourceId}${line ? `:${line}` : ''})`;
      } else if (line) {
        location = ` (:${line})`;
      }

      const entry = `[${timestamp}]\t${pageUrl}\t[${levelLabel}] ${message}${location}\n`;
      this.browserLogBuffer.push(entry);

      if (this.browserLogBuffer.length > 100) {
        this.browserLogBuffer.shift();
      }

      this.browserLogWritePromise = this.browserLogWritePromise
        .then(() => fs.promises.writeFile(targetFile, this.browserLogBuffer.join('')))
        .catch((err) => console.error('[BrowserService] Failed to write log:', err));
    });

    webContents.once('destroyed', () => {
      this.browserConsoleState.delete(webContents);
    });
  }

  /**
   * Setup permission handlers
   * @param {WebContents} webContents - WebContents instance
   */
  setupPermissions(webContents) {
    // Grant all permissions
    webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
      callback(true);
    });

    webContents.session.setPermissionCheckHandler((webContents, permission) => {
      return true;
    });

    // Handle display media requests (screen capture)
    webContents.session.setDisplayMediaRequestHandler((request, callback) => {
      console.log('[BrowserService] Display media request received');
      desktopCapturer.getSources({ types: ['screen', 'window'] })
        .then((sources) => {
          console.log('[BrowserService] Available sources:', sources.length);
          if (sources.length > 0) {
            callback({ video: sources[0], audio: 'loopback' });
          } else {
            callback({});
          }
        })
        .catch(err => {
          console.error('[BrowserService] Error getting sources:', err);
          callback({});
        });
    });
  }

  /**
   * Setup navigation handling
   * @param {WebContents} webContents - WebContents instance
   */
  setupNavigation(webContents) {
    webContents.on('will-navigate', (event, url) => {
      if (!webContents.opened) {
        webContents.opened = true;
      } else {
        const host = new URL(url).host;
        const localhost = new URL(this.rootUrl).host;

        if (host !== localhost) {
          event.preventDefault();
          shell.openExternal(url);
        }
      }
    });
  }

  /**
   * Setup header manipulation (CORS, CSP, etc.)
   * @param {WebContents} webContents - WebContents instance
   */
  setupHeaderManipulation(webContents) {
    // Modify response headers
    webContents.session.webRequest.onHeadersReceived((details, callback) => {
      // Remove X-Frame-Options
      if (details.responseHeaders["X-Frame-Options"]) {
        delete details.responseHeaders["X-Frame-Options"];
      } else if (details.responseHeaders["x-frame-options"]) {
        delete details.responseHeaders["x-frame-options"];
      }

      // Remove cross-origin-opener-policy-report-only
      if (details.responseHeaders["cross-origin-opener-policy-report-only"]) {
        delete details.responseHeaders["cross-origin-opener-policy-report-only"];
      } else if (details.responseHeaders["Cross-Origin-Opener-Policy-Report-Only"]) {
        delete details.responseHeaders["Cross-Origin-Opener-Policy-Report-Only"];
      }

      // Remove frame-ancestors from CSP
      let csp;
      let cspType;

      if (details.responseHeaders["Content-Security-Policy"]) {
        csp = details.responseHeaders["Content-Security-Policy"];
        cspType = 0;
      } else if (details.responseHeaders['content-security-policy']) {
        csp = details.responseHeaders["content-security-policy"];
        cspType = 1;
      }

      if (csp) {
        const newCsp = csp.map((c) => {
          return c.replaceAll(/frame-ancestors[^;]+;?/gi, "");
        });

        const result = {
          responseHeaders: details.responseHeaders
        };

        if (cspType === 0) {
          result.responseHeaders["Content-Security-Policy"] = newCsp;
        } else if (cspType === 1) {
          result.responseHeaders["content-security-policy"] = newCsp;
        }

        callback(result);
      } else {
        callback({
          responseHeaders: details.responseHeaders
        });
      }
    });

    // Modify request headers (User Agent cleanup)
    webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
      let ua = details.requestHeaders['User-Agent'];

      if (ua) {
        // Remove Pinokio and Electron identifiers from User-Agent
        ua = ua.replace(/ pinokio\/[0-9.]+/i, '');
        ua = ua.replace(/Electron\/.+ /i, '');
        details.requestHeaders['User-Agent'] = ua;
      }

      callback({ cancel: false, requestHeaders: details.requestHeaders });
    });
  }

  /**
   * Setup window open handler
   * @param {WebContents} webContents - WebContents instance
   */
  setupWindowOpenHandler(webContents) {
    webContents.setWindowOpenHandler((config) => {
      const url = config.url;
      const features = config.features;
      const params = new URLSearchParams(features.split(",").join("&"));
      const win = webContents.getOwnerBrowserWindow();
      const [width, height] = win.getSize();
      const [x, y] = win.getPosition();
      const origin = new URL(url).origin;

      console.log('[BrowserService] Window open request:', { url, features, origin });

      // Open in external browser
      if (features === "browser") {
        shell.openExternal(url);
        return { action: 'deny' };
      }

      // Open in Pinokio if same origin
      if (origin === this.rootUrl) {
        return {
          action: 'allow',
          outlivesOpener: true,
          overrideBrowserWindowOptions: {
            width: params.get("width") ? parseInt(params.get("width")) : width,
            height: params.get("height") ? parseInt(params.get("height")) : height,
            x: x + 30,
            y: y + 30,
            parent: null,
            titleBarStyle: "hidden",
            titleBarOverlay: this.getTitleBarOverlay(),
            webPreferences: {
              session: session.fromPartition('temp-window-' + Date.now()),
              webSecurity: false,
              nativeWindowOpen: true,
              contextIsolation: false,
              nodeIntegrationInSubFrames: true,
              preload: this.preloadPath
            }
          }
        };
      }

      // Handle features-based logic
      if (features) {
        if (features.startsWith("app") || features.startsWith("self")) {
          return {
            action: 'allow',
            outlivesOpener: true,
            overrideBrowserWindowOptions: {
              width: params.get("width") ? parseInt(params.get("width")) : width,
              height: params.get("height") ? parseInt(params.get("height")) : height,
              x: x + 30,
              y: y + 30,
              parent: null,
              titleBarStyle: "hidden",
              titleBarOverlay: this.getTitleBarOverlay(),
              webPreferences: {
                session: session.fromPartition('temp-window-' + Date.now()),
                webSecurity: false,
                nativeWindowOpen: true,
                contextIsolation: false,
                nodeIntegrationInSubFrames: true,
                preload: this.preloadPath
              }
            }
          };
        } else if (features.startsWith("file")) {
          const filePath = features.replace("file://", "");
          shell.showItemInFolder(filePath);
          return { action: 'deny' };
        } else {
          shell.openExternal(url);
          return { action: 'deny' };
        }
      } else {
        shell.openExternal(url);
        return { action: 'deny' };
      }
    });
  }

  /**
   * Setup navigation event handlers
   * @param {WebContents} webContents - WebContents instance
   */
  setupNavigationEvents(webContents) {
    webContents.on('did-navigate', (event, url) => {
      this.updateBrowserConsoleTarget(webContents, url);
    });

    webContents.on('did-navigate-in-page', (event, url) => {
      this.updateBrowserConsoleTarget(webContents, url);
    });
  }

  /**
   * Update browser console target URL
   * @param {WebContents} webContents - WebContents instance
   * @param {string} url - New URL
   */
  updateBrowserConsoleTarget(webContents, url) {
    if (this.enableBrowserLog) {
      this.browserConsoleState.set(webContents, { url });
    }
  }

  /**
   * Get title bar overlay configuration
   * @returns {Object} Title bar overlay config
   */
  getTitleBarOverlay() {
    if (!this.colors) {
      return {
        color: 'rgba(0,0,0,0)',
        symbolColor: '#74b1be',
        height: 40
      };
    }

    return {
      color: this.colors.primary,
      symbolColor: this.colors.primarytext,
      height: 40
    };
  }

  /**
   * Update theme colors
   * @param {Object} colors - New color palette
   */
  updateColors(colors) {
    this.colors = colors;
  }

  /**
   * Cleanup on shutdown
   */
  destroy() {
    this.attachedConsoleListeners = new WeakSet();
    this.browserConsoleState = new WeakMap();
    this.browserLogBuffer = [];
    console.log('[BrowserService] Service destroyed');
  }
}

// Export singleton instance
module.exports = new BrowserService();
