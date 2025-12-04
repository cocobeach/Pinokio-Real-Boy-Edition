/**
 * PTYController - Manages pseudo-terminal sessions
 * The Living Interface: Persistent shell sessions with xterm.js integration
 * Uses node-pty to spawn processes that survive frontend reloads
 */

const pty = require('node-pty');
const os = require('os');
const path = require('path');
const fs = require('fs');
const ConfigService = require('../services/ConfigService');

class PTYController {
  constructor() {
    this.sessions = new Map();
    this.nextId = 1;

    // CRITICAL FIX: Detect actual Pinokio installation path
    // Handles portable installs (F: drive) and standard installs (C: drive)
    this.pinokioHome = this.detectPinokioHome();
    console.log(`[PTYController] Detected Pinokio Home: ${this.pinokioHome}`);
  }

  /**
   * Detect where Pinokio is actually installed
   * Handles:
   * - Portable installations (F:\pinokio)
   * - Standard user installations (C:\Users\...\pinokio)
   * - Development environments (anywhere with /pinokio/ in path)
   * @returns {string} Absolute path to pinokio root directory
   */
  detectPinokioHome() {
    // Strategy 1: Walk up from current directory to find 'pinokio' folder with bin/api
    let current = __dirname;
    while (current !== path.parse(current).root) {
      // Check if this directory is named 'pinokio' and has bin/api subdirectories
      if (path.basename(current).toLowerCase() === 'pinokio') {
        if (fs.existsSync(path.join(current, 'bin')) || fs.existsSync(path.join(current, 'api'))) {
          console.log('[PTYController] Found Pinokio root by walking up from __dirname');
          return current;
        }
      }

      // Check if current directory has both bin and api (common in portable installs)
      if (fs.existsSync(path.join(current, 'bin')) && fs.existsSync(path.join(current, 'api'))) {
        console.log('[PTYController] Found Pinokio root by bin+api detection');
        return current;
      }

      current = path.dirname(current);
    }

    // Strategy 2: Check the drive where the executable is located (F: drive scenario)
    const appPath = process.execPath; // e.g., F:\pinokio\Pinokio.exe
    const driveRoot = path.parse(appPath).root; // F:\
    const drivePinokio = path.join(driveRoot, 'pinokio');

    if (fs.existsSync(path.join(drivePinokio, 'bin')) || fs.existsSync(path.join(drivePinokio, 'api'))) {
      console.log(`[PTYController] Found Pinokio root on same drive as executable: ${drivePinokio}`);
      return drivePinokio;
    }

    // Strategy 3: Check parent directory of executable (portable adjacent)
    const exeDir = path.dirname(appPath);
    if (fs.existsSync(path.join(exeDir, 'bin')) && fs.existsSync(path.join(exeDir, 'api'))) {
      console.log(`[PTYController] Found Pinokio root adjacent to executable: ${exeDir}`);
      return exeDir;
    }

    // Strategy 4: Fallback to standard user home directory
    const homeDirPinokio = path.join(os.homedir(), 'pinokio');
    console.log(`[PTYController] Using standard home directory: ${homeDirPinokio}`);
    return homeDirPinokio;
  }

  /**
   * Get augmented environment variables with Pinokio system paths
   * Ensures terminals can access Conda, Git, Node after they're installed
   * Uses dynamically detected pinokioHome (not hardcoded to C: drive)
   * @param {Object} baseEnv - Base environment variables (defaults to process.env)
   * @returns {Object} Augmented environment with system paths
   */
  getAugmentedEnv(baseEnv = process.env) {
    const platform = os.platform();
    const binPath = path.join(this.pinokioHome, 'bin');

    // Build comprehensive list of all possible binary paths
    // CRITICAL: We add ALL conda subdirectories because conda needs them all
    const pathsToAdd = [
      binPath,
      path.join(binPath, 'miniconda'),
      path.join(binPath, 'miniconda', 'Scripts'),          // Windows conda executables
      path.join(binPath, 'miniconda', 'Library', 'bin'),   // Windows conda DLLs
      path.join(binPath, 'miniconda', 'bin'),              // Unix-style (also used in some Win installs)
      path.join(binPath, 'miniconda', 'condabin'),         // Conda activation scripts
      path.join(binPath, 'git', 'cmd'),                    // Windows git
      path.join(binPath, 'git', 'bin'),                    // Unix git
      path.join(binPath, 'nodejs'),                        // Node.js
      path.join(binPath, 'node'),                          // Alternative node path
      path.join(binPath, 'python')                         // Standalone python
    ];

    // Filter only paths that actually exist to keep PATH clean
    const validPaths = pathsToAdd.filter(p => fs.existsSync(p));

    if (validPaths.length > 0) {
      console.log(`[PTYController] Found ${validPaths.length} system binary paths:`);
      validPaths.forEach(p => console.log(`  - ${p}`));
    } else {
      console.warn(`[PTYController] No system binaries found in ${binPath}`);
      console.warn('[PTYController] This is normal for first-run before environment installation');
    }

    // Clone base environment
    const augmentedEnv = { ...baseEnv };

    // Handle Windows PATH case-insensitivity
    // Windows can have Path, PATH, or path - we need to find the right one
    const pathKey = platform === 'win32' ? 'Path' : 'PATH';
    const existingPathKey = Object.keys(augmentedEnv).find(k => k.toUpperCase() === 'PATH') || pathKey;

    // CRITICAL: Put our paths FIRST so conda/git/node are found before system versions
    if (validPaths.length > 0) {
      const existingPath = augmentedEnv[existingPathKey] || '';
      augmentedEnv[existingPathKey] = validPaths.join(path.delimiter) + path.delimiter + existingPath;
      console.log(`[PTYController] Injected ${validPaths.length} paths into ${existingPathKey}`);
    }

    return augmentedEnv;
  }

  /**
   * Create a new PTY session
   * @param {Object} options - PTY options
   * @param {string} options.shell - Shell to spawn (default: system shell)
   * @param {string} options.cwd - Working directory
   * @param {Object} options.env - Environment variables
   * @param {number} options.cols - Terminal columns
   * @param {number} options.rows - Terminal rows
   * @returns {Object} Session info with id and pty instance
   */
  createSession(options = {}) {
    const sessionId = this.nextId++;

    // Determine shell
    const shell = options.shell || (os.platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash');

    // Get augmented environment with Pinokio system paths
    const augmentedEnv = this.getAugmentedEnv({ ...process.env, ...options.env });

    // Create PTY
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: options.cols || 80,
      rows: options.rows || 30,
      cwd: options.cwd || process.env.HOME || process.cwd(),
      env: augmentedEnv
    });

    // Store session
    this.sessions.set(sessionId, {
      id: sessionId,
      pty: ptyProcess,
      shell,
      cwd: options.cwd,
      createdAt: new Date()
    });

    console.log(`[PTYController] Created session ${sessionId} with shell: ${shell}`);

    return {
      id: sessionId,
      pty: ptyProcess
    };
  }

  /**
   * Get a session by ID
   * @param {number} sessionId - Session ID
   * @returns {Object|null} Session object or null if not found
   */
  getSession(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * Write data to a PTY session
   * @param {number} sessionId - Session ID
   * @param {string} data - Data to write
   * @returns {boolean} True if successful
   */
  write(sessionId, data) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.error(`[PTYController] Session ${sessionId} not found`);
      return false;
    }

    try {
      session.pty.write(data);
      return true;
    } catch (error) {
      console.error(`[PTYController] Error writing to session ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Resize a PTY session
   * @param {number} sessionId - Session ID
   * @param {number} cols - New column count
   * @param {number} rows - New row count
   * @returns {boolean} True if successful
   */
  resize(sessionId, cols, rows) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.error(`[PTYController] Session ${sessionId} not found`);
      return false;
    }

    try {
      session.pty.resize(cols, rows);
      console.log(`[PTYController] Resized session ${sessionId} to ${cols}x${rows}`);
      return true;
    } catch (error) {
      console.error(`[PTYController] Error resizing session ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Kill a PTY session
   * @param {number} sessionId - Session ID
   * @returns {boolean} True if successful
   */
  killSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.error(`[PTYController] Session ${sessionId} not found`);
      return false;
    }

    try {
      session.pty.kill();
      this.sessions.delete(sessionId);
      console.log(`[PTYController] Killed session ${sessionId}`);
      return true;
    } catch (error) {
      console.error(`[PTYController] Error killing session ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Get all active sessions
   * @returns {Array<Object>} List of session info (without pty instances)
   */
  getAllSessions() {
    return Array.from(this.sessions.values()).map(session => ({
      id: session.id,
      shell: session.shell,
      cwd: session.cwd,
      createdAt: session.createdAt
    }));
  }

  /**
   * Setup IPC handlers for terminal operations
   * @param {IpcRouter} ipcRouter - IPC router instance
   */
  setupIpcHandlers(ipcRouter) {
    // Create new terminal session
    ipcRouter.handle('terminal:create', async (event, options) => {
      try {
        const session = this.createSession(options);

        // Forward PTY output to renderer
        session.pty.onData((data) => {
          event.sender.send('terminal:data', { sessionId: session.id, data });
        });

        // Handle PTY exit
        session.pty.onExit(({ exitCode, signal }) => {
          console.log(`[PTYController] Session ${session.id} exited with code ${exitCode}`);
          event.sender.send('terminal:exit', { sessionId: session.id, exitCode, signal });
          this.sessions.delete(session.id);
        });

        return { success: true, sessionId: session.id };
      } catch (error) {
        console.error('[PTYController] Error creating session:', error);
        return { success: false, error: error.message };
      }
    });

    // Write to terminal
    ipcRouter.handle('terminal:write', async (event, { sessionId, data }) => {
      const success = this.write(sessionId, data);
      return { success };
    });

    // Resize terminal
    ipcRouter.handle('terminal:resize', async (event, { sessionId, cols, rows }) => {
      const success = this.resize(sessionId, cols, rows);
      return { success };
    });

    // Kill terminal session
    ipcRouter.handle('terminal:kill', async (event, { sessionId }) => {
      const success = this.killSession(sessionId);
      return { success };
    });

    // Get all sessions
    ipcRouter.handle('terminal:list', async () => {
      return { sessions: this.getAllSessions() };
    });

    // Check for saved session state (Epic 10.2)
    ipcRouter.handle('terminal:has-saved-state', async () => {
      const savedState = this.loadSessionState();
      return {
        success: true,
        hasSavedState: savedState !== null,
        sessionCount: savedState ? savedState.sessions.length : 0
      };
    });

    // Restore saved sessions (Epic 10.2)
    ipcRouter.handle('terminal:restore-sessions', async (event) => {
      try {
        const restoredIds = this.restoreSessions({ eventSender: event.sender });
        return {
          success: true,
          restoredSessions: restoredIds,
          count: restoredIds.length
        };
      } catch (error) {
        console.error('[PTYController] Error restoring sessions:', error);
        return { success: false, error: error.message };
      }
    });

    // Clear saved session state without restoring (Epic 10.2)
    ipcRouter.handle('terminal:clear-saved-state', async () => {
      try {
        ConfigService.set('ptySessionState', null);
        return { success: true };
      } catch (error) {
        console.error('[PTYController] Error clearing saved state:', error);
        return { success: false, error: error.message };
      }
    });

    console.log('[PTYController] IPC handlers registered');
  }

  /**
   * Save current session state to ConfigService
   * Epic 10.2: The Durable Mind - PTY Session Persistence
   */
  saveSessionState() {
    const sessionState = {
      nextId: this.nextId,
      sessions: Array.from(this.sessions.values()).map(session => ({
        id: session.id,
        shell: session.shell,
        cwd: session.cwd,
        createdAt: session.createdAt
      }))
    };

    ConfigService.set('ptySessionState', sessionState);
    console.log(`[PTYController] Saved ${sessionState.sessions.length} session(s) to config`);
    return sessionState;
  }

  /**
   * Load session state from ConfigService
   * Epic 10.2: The Durable Mind - PTY Session Persistence
   */
  loadSessionState() {
    const savedState = ConfigService.get('ptySessionState');
    if (!savedState || !savedState.sessions || savedState.sessions.length === 0) {
      console.log('[PTYController] No saved session state found');
      return null;
    }

    console.log(`[PTYController] Found ${savedState.sessions.length} saved session(s)`);
    return savedState;
  }

  /**
   * Restore sessions from saved state
   * Epic 10.2: The Durable Mind - PTY Session Persistence
   * @param {Object} options - Options for restoration
   * @param {Object} options.eventSender - Event sender for forwarding PTY output
   * @returns {Array} List of restored session IDs
   */
  restoreSessions(options = {}) {
    const savedState = this.loadSessionState();
    if (!savedState) {
      return [];
    }

    const restoredSessions = [];

    // Restore nextId to avoid conflicts
    this.nextId = savedState.nextId || this.nextId;

    // Restore each session
    for (const savedSession of savedState.sessions) {
      try {
        console.log(`[PTYController] Restoring session ${savedSession.id} with cwd: ${savedSession.cwd}`);

        // Create new PTY with saved configuration
        const shell = savedSession.shell || (os.platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash');
        const augmentedEnv = this.getAugmentedEnv(process.env);

        const ptyProcess = pty.spawn(shell, [], {
          name: 'xterm-256color',
          cols: 80,
          rows: 30,
          cwd: savedSession.cwd || process.env.HOME || process.cwd(),
          env: augmentedEnv
        });

        // Store restored session
        this.sessions.set(savedSession.id, {
          id: savedSession.id,
          pty: ptyProcess,
          shell: shell,
          cwd: savedSession.cwd,
          createdAt: savedSession.createdAt,
          restored: true
        });

        // Setup event forwarding if eventSender provided
        if (options.eventSender) {
          ptyProcess.onData((data) => {
            options.eventSender.send('terminal:data', { sessionId: savedSession.id, data });
          });

          ptyProcess.onExit(({ exitCode, signal }) => {
            console.log(`[PTYController] Restored session ${savedSession.id} exited with code ${exitCode}`);
            options.eventSender.send('terminal:exit', { sessionId: savedSession.id, exitCode, signal });
            this.sessions.delete(savedSession.id);
          });
        }

        restoredSessions.push(savedSession.id);
        console.log(`[PTYController] Successfully restored session ${savedSession.id}`);

      } catch (error) {
        console.error(`[PTYController] Failed to restore session ${savedSession.id}:`, error);
      }
    }

    // Clear saved state after successful restoration
    if (restoredSessions.length > 0) {
      ConfigService.set('ptySessionState', null);
      console.log(`[PTYController] Restored ${restoredSessions.length} session(s)`);
    }

    return restoredSessions;
  }

  /**
   * Cleanup all sessions
   * Epic 10.2: Save session state before destroying
   */
  destroy() {
    // Save session state before destroying
    this.saveSessionState();

    for (const [sessionId, session] of this.sessions) {
      try {
        session.pty.kill();
      } catch (error) {
        console.error(`[PTYController] Error killing session ${sessionId}:`, error);
      }
    }
    this.sessions.clear();
    console.log('[PTYController] All sessions destroyed');
  }
}

// Export singleton instance
module.exports = new PTYController();
