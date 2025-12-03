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
const InspectorService = require('../services/InspectorService');
const ForgeService = require('../services/ForgeService');
const KernelPatcher = require('../services/KernelPatcher'); // Phase 5: The Deep Hook
const GitService = require('../services/GitService'); // Epic 7: Agentic IDE - Git
const FileSystemService = require('../services/FileSystemService'); // Epic 7: Agentic IDE - Filesystem
const HardwareService = require('../services/HardwareService'); // Epic 8: The Awakened Mind - Hardware Monitoring
const PlanExecutor = require('../services/PlanExecutor'); // Epic 9: The Synergistic Forge - Plan Automation

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

      // CRITICAL: Check System Environment Health
      // Verify that system binaries (Conda, Git, Node) are installed or being installed
      await this.checkSystemHealth();

      // Phase 5: Apply Deep Hook to intercept all downloads
      // NOTE: Deep Hook now bypasses system binaries (pinokio/bin, pinokio/cache)
      // This ensures Conda/Git/Node installers are handled natively by pinokiod
      await this.applyKernelPatch();

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
   * Check system environment health
   * Verifies that system binaries (Conda, Git, Node) exist or are being installed
   * Critical for first-run scenarios where pinokiod auto-installs dependencies
   */
  async checkSystemHealth() {
    const path = require('path');
    const fs = require('fs');
    const os = require('os');

    console.log('[AppController] === System Environment Health Check ===');

    const homedir = os.homedir();
    const binPath = path.join(homedir, 'pinokio', 'bin');
    const condaPath = path.join(binPath, 'miniconda');
    const gitPath = path.join(binPath, 'git');
    const nodePath = path.join(binPath, 'nodejs');

    // Check each system component
    const condaExists = fs.existsSync(condaPath);
    const gitExists = fs.existsSync(gitPath);
    const nodeExists = fs.existsSync(nodePath);

    console.log('[AppController] System Binary Status:');
    console.log(`  - Miniconda: ${condaExists ? '✅ Installed' : '⚠️  Missing (will auto-install)'}`);
    console.log(`  - Git: ${gitExists ? '✅ Installed' : '⚠️  Missing (will auto-install)'}`);
    console.log(`  - Node.js: ${nodeExists ? '✅ Installed' : '⚠️  Missing (will auto-install)'}`);

    if (!condaExists || !gitExists || !nodeExists) {
      console.log('[AppController] ⚠️  System environment incomplete.');
      console.log('[AppController] Pinokiod will trigger auto-installation on first run.');
      console.log('[AppController] IMPORTANT: KernelPatcher bypasses bin/ and cache/ to allow native installation.');
      console.log('[AppController] This is NORMAL for first-run scenarios.');
    } else {
      console.log('[AppController] ✅ System environment complete.');
    }

    console.log('[AppController] === Health Check Complete ===');
  }

  /**
   * Apply kernel patch for GAS Deep Hook
   * Intercepts all fs.download calls to use Global Asset Store
   * Phase 5: The Deep Hook
   */
  async applyKernelPatch() {
    console.log('[AppController] Applying Phase 5: The Deep Hook...');

    try {
      // Initialize KernelPatcher with pinokiod reference
      const initResult = KernelPatcher.initialize(this.pinokiod);

      if (!initResult.success) {
        console.warn('[AppController] KernelPatcher initialization failed:', initResult.reason);
        console.warn('[AppController] Graceful degradation: Downloads will NOT use GAS automatically');
        console.warn('[AppController] Errors:', initResult.errors);
        return {
          success: false,
          graceful: true,
          reason: initResult.reason
        };
      }

      console.log('[AppController] KernelPatcher initialized successfully');

      // Apply the patch
      const patchResult = KernelPatcher.patch();

      if (!patchResult.success) {
        console.error('[AppController] Failed to apply Deep Hook:', patchResult.error);
        console.warn('[AppController] Graceful degradation: Downloads will use legacy behavior');
        return {
          success: false,
          graceful: true,
          error: patchResult.error
        };
      }

      console.log('[AppController] ✅ Deep Hook ACTIVE');
      console.log('[AppController] All fs.download calls will automatically use GAS');
      console.log('[AppController] Legacy scripts from 2 years ago will now benefit from deduplication');

      return {
        success: true,
        patched: true
      };

    } catch (error) {
      console.error('[AppController] CRITICAL: Kernel patch threw exception:', error);
      console.error('[AppController] Continuing with legacy download behavior');
      return {
        success: false,
        graceful: true,
        error: error.message
      };
    }
  }

  /**
   * Create main application window
   * Epic 6: Loads local Command Center shell instead of remote web app directly
   */
  async createMainWindow() {
    const path = require('path');

    // EPIC 6: Load local Command Center shell HTML
    // The shell contains the webview that will load the actual Pinokio web app
    const localShellPath = path.join(__dirname, '..', '..', 'renderer', 'index.html');

    // Pass rootUrl as query parameter so the shell knows where to load the web app
    const shellUrl = `file://${localShellPath}?rootUrl=${encodeURIComponent(this.rootUrl)}`;

    console.log('[AppController] Loading Command Center shell:', shellUrl);

    const mainWindow = WindowManager.createMainWindow(shellUrl, {
      colors: this.pinokiod.colors
    });

    // Attach browser configuration to main window
    BrowserService.attach(mainWindow.webContents);

    // Setup window event handlers
    // CRITICAL: Webview inside the shell will also need BrowserService attached
    mainWindow.webContents.on('did-attach-webview', (event, webContents) => {
      console.log('[AppController] Webview attached, applying BrowserService configuration');
      BrowserService.attach(webContents);
    });

    console.log('[AppController] Command Center shell loaded');
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

    // Inspector handlers
    InspectorService.setupIpcHandlers(IpcRouter);

    // Forge handlers (AI-powered installation generation)
    ForgeService.setupIpcHandlers(IpcRouter);

    // KernelPatcher stats handler (Phase 5: The Deep Hook)
    IpcRouter.handle('kernel-patcher:stats', async () => {
      return KernelPatcher.getStats();
    });

    // Git Service handlers (Epic 7: The Agentic IDE)
    GitService.setupIpcHandlers(IpcRouter);

    // FileSystem Service handlers (Epic 7: The Agentic IDE)
    FileSystemService.setupIpcHandlers(IpcRouter);

    // Hardware Service handlers (Epic 8: The Awakened Mind)
    HardwareService.setupIpcHandlers(IpcRouter);

    // ConfigService handlers (Epic 8: Configuration Management)
    IpcRouter.handle('config:get-provider-preferences', async () => {
      return { success: true, preferences: ConfigService.getAIProviderPreferences() };
    });
    IpcRouter.handle('config:set-provider-preferences', async (event, prefs) => {
      ConfigService.setAIProviderPreferences(prefs);
      return { success: true };
    });
    IpcRouter.handle('config:get-mode-preferences', async () => {
      return { success: true, preferences: ConfigService.getModePreferences() };
    });
    IpcRouter.handle('config:set-mode-preferences', async (event, prefs) => {
      ConfigService.setModePreferences(prefs);
      return { success: true };
    });
    IpcRouter.handle('config:get-gan-settings', async () => {
      return { success: true, settings: ConfigService.getGANSettings() };
    });
    IpcRouter.handle('config:set-gan-settings', async (event, settings) => {
      ConfigService.setGANSettings(settings);
      return { success: true };
    });
    IpcRouter.handle('config:get-quota-settings', async () => {
      return { success: true, settings: ConfigService.getQuotaSettings() };
    });
    IpcRouter.handle('config:set-quota-settings', async (event, settings) => {
      ConfigService.setQuotaSettings(settings);
      return { success: true };
    });
    IpcRouter.handle('config:get-hardware-settings', async () => {
      return { success: true, settings: ConfigService.getHardwareSettings() };
    });
    IpcRouter.handle('config:set-hardware-settings', async (event, settings) => {
      ConfigService.setHardwareSettings(settings);
      return { success: true };
    });
    IpcRouter.handle('config:get-epic8-config', async () => {
      return { success: true, config: ConfigService.getEpic8Config() };
    });
    IpcRouter.handle('config:reset-epic8-config', async () => {
      ConfigService.resetEpic8Config();
      return { success: true };
    });

    // Plan Executor handlers (Epic 9: The Synergistic Forge)
    PlanExecutor.setupIpcHandlers(IpcRouter);

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
      ForgeService.destroy();
      InspectorService.destroy();
      await AIController.destroy();
      KernelPatcher.destroy(); // Phase 5: Log stats before shutdown
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
        update: UpdateService.getStatus(),
        kernelPatcher: KernelPatcher.getStats() // Phase 5 stats
      }
    };
  }
}

// Export singleton instance
module.exports = new AppController();
