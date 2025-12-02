/**
 * IpcRouter - Centralized IPC channel management
 * Prevents memory leaks from duplicate event bindings
 * Provides a clean API for registering handlers
 */

const { ipcMain } = require('electron');

class IpcRouter {
  constructor() {
    this.handlers = new Map();
    this.invokeHandlers = new Map();
  }

  /**
   * Register an IPC handler (ipcMain.on)
   * @param {string} channel - IPC channel name
   * @param {Function} handler - Handler function
   */
  on(channel, handler) {
    if (this.handlers.has(channel)) {
      console.warn(`[IpcRouter] Handler for channel "${channel}" already registered. Replacing.`);
      this.off(channel);
    }

    this.handlers.set(channel, handler);
    ipcMain.on(channel, handler);
    console.log(`[IpcRouter] Registered handler for: ${channel}`);
  }

  /**
   * Register an async IPC handler (ipcMain.handle)
   * @param {string} channel - IPC channel name
   * @param {Function} handler - Async handler function
   */
  handle(channel, handler) {
    if (this.invokeHandlers.has(channel)) {
      console.warn(`[IpcRouter] Handler for channel "${channel}" already registered. Replacing.`);
      this.removeHandler(channel);
    }

    this.invokeHandlers.set(channel, handler);
    ipcMain.handle(channel, handler);
    console.log(`[IpcRouter] Registered async handler for: ${channel}`);
  }

  /**
   * Remove an IPC handler
   * @param {string} channel - IPC channel name
   */
  off(channel) {
    const handler = this.handlers.get(channel);
    if (handler) {
      ipcMain.off(channel, handler);
      this.handlers.delete(channel);
      console.log(`[IpcRouter] Removed handler for: ${channel}`);
    }
  }

  /**
   * Remove an async IPC handler
   * @param {string} channel - IPC channel name
   */
  removeHandler(channel) {
    if (this.invokeHandlers.has(channel)) {
      ipcMain.removeHandler(channel);
      this.invokeHandlers.delete(channel);
      console.log(`[IpcRouter] Removed async handler for: ${channel}`);
    }
  }

  /**
   * Remove all registered handlers
   */
  removeAll() {
    // Remove standard handlers
    for (const [channel, handler] of this.handlers) {
      ipcMain.off(channel, handler);
    }
    this.handlers.clear();

    // Remove async handlers
    for (const channel of this.invokeHandlers.keys()) {
      ipcMain.removeHandler(channel);
    }
    this.invokeHandlers.clear();

    console.log('[IpcRouter] All handlers removed');
  }

  /**
   * Get list of registered channels
   * @returns {Array<string>} List of channel names
   */
  getChannels() {
    return {
      standard: Array.from(this.handlers.keys()),
      async: Array.from(this.invokeHandlers.keys())
    };
  }

  /**
   * Check if a channel has a handler registered
   * @param {string} channel - IPC channel name
   * @returns {boolean} True if handler exists
   */
  hasHandler(channel) {
    return this.handlers.has(channel) || this.invokeHandlers.has(channel);
  }

  /**
   * Cleanup on shutdown
   */
  destroy() {
    this.removeAll();
    console.log('[IpcRouter] Router destroyed');
  }
}

// Export singleton instance
module.exports = new IpcRouter();
