/**
 * Terminal Component - xterm.js integration
 * Provides interactive terminal UI connected to PTYController backend
 * Part of "The Living Interface"
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

class PinokioTerminal {
  constructor(containerElement, options = {}) {
    this.container = containerElement;
    this.sessionId = null;
    this.terminal = null;
    this.fitAddon = null;

    // Options
    this.options = {
      rows: options.rows || 30,
      cols: options.cols || 80,
      shell: options.shell || null,
      cwd: options.cwd || null,
      theme: options.theme || {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        selection: 'rgba(255, 255, 255, 0.3)',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#e5e5e5'
      }
    };

    this.initialize();
  }

  /**
   * Initialize the terminal UI
   */
  initialize() {
    // Create xterm.js instance
    this.terminal = new Terminal({
      rows: this.options.rows,
      cols: this.options.cols,
      theme: this.options.theme,
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      scrollback: 10000
    });

    // Add fit addon for responsive sizing
    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);

    // Mount terminal to container
    this.terminal.open(this.container);

    // Fit to container
    this.fitAddon.fit();

    // Handle terminal input (send to backend)
    this.terminal.onData((data) => {
      if (this.sessionId) {
        this.write(data);
      }
    });

    // Handle resize events
    window.addEventListener('resize', () => {
      this.resize();
    });

    console.log('[PinokioTerminal] Terminal UI initialized');
  }

  /**
   * Start a new terminal session
   * @param {Object} options - Session options
   * @returns {Promise<boolean>} Success status
   */
  async start(options = {}) {
    try {
      // Request new PTY session from backend
      const result = await window.electronAPI.terminal.create({
        shell: options.shell || this.options.shell,
        cwd: options.cwd || this.options.cwd,
        cols: this.terminal.cols,
        rows: this.terminal.rows,
        env: options.env || {}
      });

      if (!result.success) {
        throw new Error('Failed to create terminal session');
      }

      this.sessionId = result.sessionId;

      // Listen for data from backend
      window.electronAPI.terminal.onData((event) => {
        if (event.sessionId === this.sessionId) {
          this.terminal.write(event.data);
        }
      });

      // Listen for exit events
      window.electronAPI.terminal.onExit((event) => {
        if (event.sessionId === this.sessionId) {
          this.handleExit(event.exitCode, event.signal);
        }
      });

      // Show welcome message
      this.terminal.writeln('\x1b[1;32m╔══════════════════════════════════════╗\x1b[0m');
      this.terminal.writeln('\x1b[1;32m║   Pinokio Terminal - Real Boy Mode  ║\x1b[0m');
      this.terminal.writeln('\x1b[1;32m╚══════════════════════════════════════╝\x1b[0m');
      this.terminal.writeln('');

      console.log(`[PinokioTerminal] Session ${this.sessionId} started`);
      return true;

    } catch (error) {
      console.error('[PinokioTerminal] Failed to start session:', error);
      this.terminal.writeln('\x1b[1;31mFailed to start terminal session\x1b[0m');
      return false;
    }
  }

  /**
   * Write data to the terminal (send to backend PTY)
   * @param {string} data - Data to write
   */
  async write(data) {
    if (!this.sessionId) {
      console.warn('[PinokioTerminal] No active session');
      return;
    }

    try {
      await window.electronAPI.terminal.write({
        sessionId: this.sessionId,
        data: data
      });
    } catch (error) {
      console.error('[PinokioTerminal] Write error:', error);
    }
  }

  /**
   * Resize the terminal
   */
  resize() {
    if (!this.terminal || !this.fitAddon) return;

    try {
      this.fitAddon.fit();

      // Update backend PTY size
      if (this.sessionId) {
        window.electronAPI.terminal.resize({
          sessionId: this.sessionId,
          cols: this.terminal.cols,
          rows: this.terminal.rows
        });
      }

      console.log(`[PinokioTerminal] Resized to ${this.terminal.cols}x${this.terminal.rows}`);
    } catch (error) {
      console.error('[PinokioTerminal] Resize error:', error);
    }
  }

  /**
   * Handle terminal exit
   * @param {number} exitCode - Exit code
   * @param {number} signal - Signal number
   */
  handleExit(exitCode, signal) {
    console.log(`[PinokioTerminal] Session ${this.sessionId} exited:`, exitCode, signal);

    this.terminal.writeln('');
    this.terminal.writeln('\x1b[1;33m╔══════════════════════════════════════╗\x1b[0m');
    this.terminal.writeln(`\x1b[1;33m║  Session Terminated (code: ${exitCode})    ║\x1b[0m`);
    this.terminal.writeln('\x1b[1;33m╚══════════════════════════════════════╝\x1b[0m');

    this.sessionId = null;
  }

  /**
   * Kill the current session
   */
  async kill() {
    if (!this.sessionId) {
      console.warn('[PinokioTerminal] No active session to kill');
      return;
    }

    try {
      await window.electronAPI.terminal.kill({ sessionId: this.sessionId });
      console.log(`[PinokioTerminal] Session ${this.sessionId} killed`);
    } catch (error) {
      console.error('[PinokioTerminal] Kill error:', error);
    }
  }

  /**
   * Restart the session
   */
  async restart(options = {}) {
    if (this.sessionId) {
      await this.kill();
    }

    // Wait a bit before restarting
    await new Promise(resolve => setTimeout(resolve, 500));

    return await this.start(options);
  }

  /**
   * Clear the terminal display
   */
  clear() {
    this.terminal.clear();
  }

  /**
   * Focus the terminal
   */
  focus() {
    this.terminal.focus();
  }

  /**
   * Destroy the terminal
   */
  async destroy() {
    if (this.sessionId) {
      await this.kill();
    }

    if (this.terminal) {
      this.terminal.dispose();
    }

    console.log('[PinokioTerminal] Terminal destroyed');
  }

  /**
   * Get terminal status
   * @returns {Object} Status information
   */
  getStatus() {
    return {
      sessionId: this.sessionId,
      active: !!this.sessionId,
      cols: this.terminal?.cols,
      rows: this.terminal?.rows
    };
  }
}

export default PinokioTerminal;
