/**
 * Pinokio - BMAD Architecture Entry Point
 * Full desktop mode using modular service architecture
 * Replaces monolithic full.js
 */

const { app, protocol } = require('electron');
const path = require('path');

// Import AppController
const AppController = require('./electron/main/controllers/AppController');
const ConfigService = require('./electron/main/services/ConfigService');

// Ensure single instance
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('[Pinokio] Another instance is already running. Exiting.');
  app.quit();
} else {
  // Handle second instance attempt
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    console.log('[Pinokio] Second instance detected, focusing main window');

    const WindowManager = require('./electron/main/services/WindowManager');
    WindowManager.focusMainWindow();

    // Handle deep links (pinokio:// protocol)
    const url = commandLine.find(arg => arg.startsWith('pinokio://'));
    if (url) {
      console.log('[Pinokio] Deep link received:', url);
      handleDeepLink(url);
    }
  });

  // Register pinokio:// protocol
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('pinokio', process.execPath, [path.resolve(process.argv[1])]);
    }
  } else {
    app.setAsDefaultProtocolClient('pinokio');
  }

  // macOS deep link handler
  app.on('open-url', (event, url) => {
    event.preventDefault();
    console.log('[Pinokio] Deep link (macOS):', url);
    handleDeepLink(url);
  });

  // Windows/Linux deep link handler (via second-instance)
  // Already handled in second-instance event above

  // App ready event
  app.whenReady().then(async () => {
    try {
      console.log('[Pinokio] App ready, initializing...');

      // Initialize the application
      await AppController.initialize();

      console.log('[Pinokio] Application initialized successfully');

    } catch (error) {
      console.error('[Pinokio] Failed to initialize:', error);
      app.quit();
    }
  });

  // App activation (macOS)
  app.on('activate', () => {
    const WindowManager = require('./electron/main/services/WindowManager');
    const mainWindow = WindowManager.getMainWindow();

    if (!mainWindow) {
      // Re-create window if closed
      AppController.createMainWindow();
    } else {
      WindowManager.showMainWindow();
    }
  });

  // Window all closed
  app.on('window-all-closed', () => {
    // On macOS, apps typically stay open even when all windows are closed
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  // Before quit
  app.on('before-quit', async (event) => {
    console.log('[Pinokio] App quitting...');

    // Prevent default quit to allow cleanup
    event.preventDefault();

    // Shutdown services
    await AppController.shutdown();

    // Now actually quit
    app.exit(0);
  });

  // Handle deep links
  function handleDeepLink(url) {
    try {
      const WindowManager = require('./electron/main/services/WindowManager');
      const mainWindow = WindowManager.getMainWindow();

      if (!mainWindow) {
        console.warn('[Pinokio] Cannot handle deep link: no main window');
        return;
      }

      // Parse pinokio:// URL
      if (url.startsWith('pinokio://')) {
        const path = url.replace('pinokio://', '');
        const targetUrl = `${AppController.rootUrl}/${path}`;

        console.log('[Pinokio] Navigating to:', targetUrl);
        mainWindow.loadURL(targetUrl);
        WindowManager.focusMainWindow();
      }

    } catch (error) {
      console.error('[Pinokio] Error handling deep link:', error);
    }
  }
}

// Unhandled errors
process.on('uncaughtException', (error) => {
  console.error('[Pinokio] Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Pinokio] Unhandled rejection at:', promise, 'reason:', reason);
});

console.log('[Pinokio] BMAD Architecture loaded');
