/**
 * PTYController - Manages pseudo-terminal sessions
 * The Living Interface: Persistent shell sessions with xterm.js integration
 * Uses node-pty to spawn processes that survive frontend reloads
 */

const pty = require('node-pty');
const os = require('os');

class PTYController {
  constructor() {
    this.sessions = new Map();
    this.nextId = 1;
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

    // Create PTY
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: options.cols || 80,
      rows: options.rows || 30,
      cwd: options.cwd || process.env.HOME || process.cwd(),
      env: { ...process.env, ...options.env }
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

    console.log('[PTYController] IPC handlers registered');
  }

  /**
   * Cleanup all sessions
   */
  destroy() {
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
