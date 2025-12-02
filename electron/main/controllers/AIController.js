/**
 * AIController - Self-Managed Intelligence Layer
 * Manages the lifecycle of the local LLM using electron-ollama
 * Provides AI capabilities without external dependencies
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

class AIController {
  constructor() {
    this.ollama = null;
    this.isRunning = false;
    this.ollamaPath = null;
    this.port = 11435; // Non-standard port to avoid conflicts
    this.initialized = false;
  }

  /**
   * Initialize the AI controller
   * @param {Object} options - Initialization options
   * @param {string} options.binPath - Custom binary path (default: ~/pinokio/bin)
   * @param {number} options.port - Custom port (default: 11435)
   */
  async initialize(options = {}) {
    if (this.initialized) {
      console.log('[AIController] Already initialized');
      return { success: true };
    }

    try {
      // Set custom port if provided
      if (options.port) {
        this.port = options.port;
      }

      // Determine ollama binary path
      const homedir = os.homedir();
      const binPath = options.binPath || path.join(homedir, 'pinokio', 'bin');
      this.ollamaPath = path.join(binPath, os.platform() === 'win32' ? 'ollama.exe' : 'ollama');

      console.log(`[AIController] Ollama binary path: ${this.ollamaPath}`);

      // Check if ollama binary exists
      const exists = fs.existsSync(this.ollamaPath);
      if (!exists) {
        console.warn('[AIController] Ollama binary not found. AI features will be unavailable.');
        console.warn('[AIController] Expected location:', this.ollamaPath);
        return { success: false, reason: 'binary_not_found' };
      }

      // Lazy load electron-ollama only if binary exists
      try {
        const { Ollama } = require('electron-ollama');
        this.ollama = new Ollama();
        this.initialized = true;
        console.log('[AIController] Initialized successfully');
        return { success: true };
      } catch (error) {
        console.error('[AIController] Failed to load electron-ollama:', error);
        return { success: false, reason: 'module_load_error', error: error.message };
      }

    } catch (error) {
      console.error('[AIController] Initialization failed:', error);
      return { success: false, reason: 'initialization_error', error: error.message };
    }
  }

  /**
   * Start the Ollama service
   * @returns {Promise<Object>} Status of the operation
   */
  async start() {
    if (!this.initialized) {
      console.error('[AIController] Not initialized. Call initialize() first.');
      return { success: false, reason: 'not_initialized' };
    }

    if (this.isRunning) {
      console.log('[AIController] Already running');
      return { success: true };
    }

    try {
      console.log(`[AIController] Starting Ollama service on port ${this.port}...`);

      // Check if ollama is already running system-wide
      const runningPort = await this.checkExistingInstance();
      if (runningPort) {
        console.log(`[AIController] Found existing Ollama instance on port ${runningPort}`);
        this.port = runningPort;
        this.isRunning = true;
        return { success: true, usingExisting: true, port: runningPort };
      }

      // Start our own instance
      await this.ollama.start({
        port: this.port,
        binPath: path.dirname(this.ollamaPath)
      });

      this.isRunning = true;
      console.log(`[AIController] Ollama service started on port ${this.port}`);
      return { success: true, port: this.port };

    } catch (error) {
      console.error('[AIController] Failed to start:', error);
      this.isRunning = false;
      return { success: false, reason: 'start_error', error: error.message };
    }
  }

  /**
   * Check for existing Ollama instance
   * @returns {Promise<number|null>} Port if found, null otherwise
   */
  async checkExistingInstance() {
    try {
      // Try common ports: default 11434, our custom 11435
      const portsToCheck = [11434, this.port];

      for (const port of portsToCheck) {
        try {
          const response = await fetch(`http://localhost:${port}/api/tags`);
          if (response.ok) {
            return port;
          }
        } catch (error) {
          // Port not responding, continue checking
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Stop the Ollama service
   * @returns {Promise<Object>} Status of the operation
   */
  async stop() {
    if (!this.isRunning) {
      console.log('[AIController] Not running');
      return { success: true };
    }

    try {
      console.log('[AIController] Stopping Ollama service...');

      if (this.ollama && this.ollama.stop) {
        await this.ollama.stop();
      }

      this.isRunning = false;
      console.log('[AIController] Ollama service stopped');
      return { success: true };

    } catch (error) {
      console.error('[AIController] Error stopping:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Ask the AI a question
   * @param {string} prompt - The question/prompt
   * @param {Object} context - Optional context information
   * @param {string} model - Model to use (default: system default)
   * @returns {Promise<Object>} AI response
   */
  async askAI(prompt, context = {}, model = null) {
    if (!this.isRunning) {
      return { success: false, reason: 'service_not_running' };
    }

    try {
      // Build the full prompt with context
      const fullPrompt = context ? `${JSON.stringify(context)}\n\n${prompt}` : prompt;

      // Make API call to Ollama
      const response = await fetch(`http://localhost:${this.port}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model || 'llama2', // Default model
          prompt: fullPrompt,
          stream: false
        })
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      return {
        success: true,
        response: data.response,
        model: data.model
      };

    } catch (error) {
      console.error('[AIController] Error querying AI:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get service status
   * @returns {Object} Current status
   */
  getStatus() {
    return {
      initialized: this.initialized,
      running: this.isRunning,
      port: this.port,
      binaryPath: this.ollamaPath
    };
  }

  /**
   * Setup IPC handlers for AI operations
   * @param {IpcRouter} ipcRouter - IPC router instance
   */
  setupIpcHandlers(ipcRouter) {
    // Initialize AI
    ipcRouter.handle('ai:initialize', async (event, options) => {
      return await this.initialize(options);
    });

    // Start AI service
    ipcRouter.handle('ai:start', async () => {
      return await this.start();
    });

    // Stop AI service
    ipcRouter.handle('ai:stop', async () => {
      return await this.stop();
    });

    // Query AI
    ipcRouter.handle('ai:ask', async (event, { prompt, context, model }) => {
      return await this.askAI(prompt, context, model);
    });

    // Get status
    ipcRouter.handle('ai:status', async () => {
      return this.getStatus();
    });

    console.log('[AIController] IPC handlers registered');
  }

  /**
   * Cleanup on shutdown
   */
  async destroy() {
    if (this.isRunning) {
      await this.stop();
    }
    this.initialized = false;
    console.log('[AIController] Service destroyed');
  }
}

// Export singleton instance
module.exports = new AIController();
