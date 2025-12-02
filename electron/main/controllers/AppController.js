/**
 * AppController - Main application orchestrator
 * Entry point replacement for full.js
 * Coordinates all services and manages application lifecycle
 */

const { app } = require('electron');
const Pinokiod = require('pinokiod');

// Services
const ConfigService = require('../services/ConfigService');
const WindowManager = require('../services/WindowManager');
const UpdateService = require('../services/UpdateService');
const BrowserService = require('../services/BrowserService');
const AssetManager = require('../services/AssetManager');

// Controllers
const PTYController = require('./PTYController');
const AIController = require('./AIController');

// IPC
const IpcRouter = require('../ipc/router');

class AppController {
  constructor() {
    this.pinokiod = null;
    this.port = null;
    this.rootUrl = null;
    this.launched = false;
  }

  /**
   * Initialize the application
   * Sets up all services and controllers
   */
  async initialize() {
    try {
      console.log('[AppController] Starting initialization...');

      // Initialize ConfigService (already a singleton, just get reference)
      const config = ConfigService.getAll();
      console.log('[AppController] Config loaded, version:', config.version);

      // Initialize Pinokiod (the backend server)
      this.pinokiod = new Pinokiod(config);
      console.log('[AppController] Pinokiod initialized');

      // Start Pinokiod server
      await this.startPinokiod();

      // Show splash screen
      WindowManager.createSplashWindow();

      // Initialize Browser Service
      BrowserService.initialize({
        rootUrl: this.rootUrl,
        colors: this.pinokiod.colors,
        preloadPath: require('path').join(__dirname, '../../../preload.js')
      });

      // Initialize Global Asset Store
      AssetManager.initialize();

      // Initialize AI Controller
      await AIController.initialize();

      // Setup IPC handlers
      this.setupIpcHandlers();

      // Create main window
      await this.createMainWindow();

      // Close splash screen
      setTimeout(() => {
        WindowManager.closeSplashWindow();
      }, 2000);

      // Start update service
      const mainWindow = WindowManager.getMainWindow();
      if (mainWindow) {
        await UpdateService.start(mainWindow);
      }

      console.log('[AppController] Initialization complete');

      return { success: true };

    } catch (error) {
      console.error('[AppController] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Start Pinokiod server
   */
  async startPinokiod() {
    console.log('[AppController] Starting Pinokiod server...');

    await this.pinokiod.start({
      onquit: () => {
        console.log('[AppController] Pinokiod requested app quit');
        app.quit();
      },
      onrestart: () => {
        console.log('[AppController] Pinokiod requested app restart');
        app.relaunch();
        app.exit();
      },
      onrefresh: (payload) => {
        console.log('[AppController] Theme refresh requested');
        this.updateThemeColors(payload);
      },
      browser: {
        clearCache: async () => {
          console.log('[AppController] Clearing cache for all sessions');
          const windows = WindowManager.getAllWindows();
          for (const win of windows) {
            if (!win.isDestroyed()) {
              await win.webContents.session.clearCache();
            }
          }
        }
      }
    });

    this.port = this.pinokiod.port;
    this.rootUrl = `http://localhost:${this.port}`;

    console.log(`[AppController] Pinokiod server started on port ${this.port}`);
  }

  /**
   * Create main application window
   */
  async createMainWindow() {
    const mainWindow = WindowManager.createMainWindow(this.rootUrl, {
      colors: this.pinokiod.colors
    });

    // Attach browser configuration to main window
    BrowserService.attach(mainWindow.webContents);

    // Setup window event handlers
    mainWindow.webContents.on('did-attach-webview', (event, webContents) => {
      BrowserService.attach(webContents);
    });

    console.log('[AppController] Main window created');
  }

  /**
   * Update theme colors across the application
   * @param {Object} payload - Theme data
   */
  updateThemeColors(payload) {
    const colors = payload.colors || this.pinokiod.colors;
    const theme = payload.theme || this.pinokiod.theme;

    // Update WindowManager theme
    WindowManager.updateTheme(theme, colors);

    // Update BrowserService colors
    BrowserService.updateColors(colors);

    console.log('[AppController] Theme colors updated');
  }

  /**
   * Setup IPC handlers for all services
   */
  setupIpcHandlers() {
    console.log('[AppController] Setting up IPC handlers...');

    // Terminal (PTY) handlers
    PTYController.setupIpcHandlers(IpcRouter);

    // AI handlers
    AIController.setupIpcHandlers(IpcRouter);

    // Asset Manager (GAS) handlers
    AssetManager.setupIpcHandlers(IpcRouter);

    // Custom prompt handler (from original full.js)
    IpcRouter.on('prompt', (eventRet, arg) => {
      const mainWindow = WindowManager.getMainWindow();
      if (!mainWindow) return;

      const promptWindow = require('electron').BrowserWindow.getAllWindows()
        .find(w => w.getURL().includes('prompt.html'));

      if (!promptWindow) {
        const { BrowserWindow } = require('electron');
        const promptWin = new BrowserWindow({
          width: 400,
          height: 200,
          parent: mainWindow,
          modal: true,
          show: false,
          webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
          }
        });

        promptWin.loadFile(require('path').join(__dirname, '../../../prompt.html'));

        promptWin.once('ready-to-show', () => {
          promptWin.webContents.send('prompt-data', arg);
          promptWin.show();
        });

        // Store response handler
        const responseHandler = (event, response) => {
          eventRet.returnValue = response;
          promptWin.close();
          IpcRouter.off('prompt-response');
        };

        IpcRouter.on('prompt-response', responseHandler);
      }
    });

    console.log('[AppController] IPC handlers configured');
  }

  /**
   * Shutdown the application
   * Cleanup all services and close connections
   */
  async shutdown() {
    console.log('[AppController] Starting shutdown...');

    try {
      // Destroy services in reverse order
      WindowManager.destroy();
      await AIController.destroy();
      AssetManager.destroy();
      PTYController.destroy();
      BrowserService.destroy();
      UpdateService.destroy();
      IpcRouter.destroy();

      // Kill Pinokiod
      if (this.pinokiod && this.pinokiod.kernel) {
        await this.pinokiod.kernel.kill();
      }

      console.log('[AppController] Shutdown complete');
    } catch (error) {
      console.error('[AppController] Error during shutdown:', error);
    }
  }

  /**
   * Get application status
   * @returns {Object} Status information
   */
  getStatus() {
    return {
      launched: this.launched,
      port: this.port,
      rootUrl: this.rootUrl,
      services: {
        pinokiod: !!this.pinokiod,
        window: !!WindowManager.getMainWindow(),
        ai: AIController.getStatus(),
        update: UpdateService.getStatus()
      }
    };
  }
}

// Export singleton instance
module.exports = new AppController();
