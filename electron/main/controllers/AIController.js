/**
 * AIController - The Awakened Mind
 * Epic 8: Multi-provider AI orchestration with mode-based routing
 * Manages Ollama (local), Claude CLI, and Gemini Code Assist CLI
 * Implements GAN refinement loops for quality improvement
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class AIController {
  constructor() {
    // Epic 10.4: Dual-Channel Ollama (bundled + external)
    this.ollama = null;
    this.isRunning = false;
    this.ollamaPath = null;
    this.bundledPort = 11435;  // Bundled Ollama (shipped with app)
    this.externalPort = 11434;  // External Ollama (user-installed)
    this.port = this.bundledPort;  // Default to bundled
    this.initialized = false;

    // Epic 10.4: Dual-Channel configuration
    this.ollamaChannels = {
      external: { available: false, port: this.externalPort, priority: 1 },  // Higher priority
      bundled: { available: false, port: this.bundledPort, priority: 2 }    // Fallback
    };

    // Multi-provider configuration
    this.providers = {
      ollama: { available: false, type: 'local', quota: Infinity, used: 0 },
      claude: { available: false, type: 'cli', quota: 200, used: 0, resetInterval: 5 * 60 * 60 * 1000 }, // 200 msgs / 5hrs
      gemini: { available: false, type: 'cli', quota: 1000, used: 0, resetInterval: 24 * 60 * 60 * 1000 }  // 1000 reqs / day
    };

    // Mode-based routing configuration
    this.modePreferences = {
      planning: ['gemini', 'claude', 'ollama'],    // Gemini best for high-volume planning
      developing: ['claude', 'gemini', 'ollama'],   // Claude best for precision coding
      debugging: ['ollama', 'gemini', 'claude']     // Ollama first (free), then paid
    };

    // GAN refinement settings
    this.ganSettings = {
      enabled: true,
      rounds: 2,  // 2-3 iterations recommended
      architectModel: 'claude',   // Primary model for generation
      critiqueModel: 'gemini'     // Secondary model for critique
    };

    // Quota reset timers
    this.quotaResetTimers = {};
  }

  /**
   * Initialize the AI controller
   * @param {Object} options - Initialization options
   */
  async initialize(options = {}) {
    if (this.initialized) {
      console.log('[AIController] Already initialized');
      return { success: true };
    }

    try {
      // Initialize Ollama (backward compatibility)
      await this.initializeOllama(options);

      // Detect CLI tools
      await this.detectCLIProviders();

      // Setup quota reset timers
      this.setupQuotaResetTimers();

      this.initialized = true;
      console.log('[AIController] Multi-provider initialization complete');
      console.log('[AIController] Available providers:', this.getAvailableProviders());

      return { success: true, providers: this.providers };

    } catch (error) {
      console.error('[AIController] Initialization failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Epic 10.4: Detect external Ollama instance
   * @param {number} port - Port to check
   * @returns {Promise<boolean>} True if Ollama is running on this port
   */
  async detectOllamaInstance(port) {
    try {
      const response = await fetch(`http://localhost:${port}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000)  // 2 second timeout
      });

      if (response.ok) {
        const data = await response.json();
        console.log(`[AIController] Ollama detected on port ${port} with ${data.models?.length || 0} models`);
        return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Initialize Ollama with dual-channel support
   * Epic 10.4: Detects external (11434) and bundled (11435) instances
   */
  async initializeOllama(options = {}) {
    try {
      const homedir = os.homedir();
      const binPath = options.binPath || path.join(homedir, 'pinokio', 'bin');
      this.ollamaPath = path.join(binPath, os.platform() === 'win32' ? 'ollama.exe' : 'ollama');

      console.log(`[AIController] Ollama binary path: ${this.ollamaPath}`);

      // Epic 10.4: Detect both external and bundled Ollama
      console.log('[AIController] Detecting Ollama channels...');

      const externalAvailable = await this.detectOllamaInstance(this.externalPort);
      const bundledAvailable = await this.detectOllamaInstance(this.bundledPort);

      this.ollamaChannels.external.available = externalAvailable;
      this.ollamaChannels.bundled.available = bundledAvailable;

      if (externalAvailable) {
        console.log(`[AIController] ✓ External Ollama detected on port ${this.externalPort} (priority 1)`);
        this.port = this.externalPort;  // Prioritize external
        this.isRunning = true;
      } else if (bundledAvailable) {
        console.log(`[AIController] ✓ Bundled Ollama detected on port ${this.bundledPort} (priority 2)`);
        this.port = this.bundledPort;  // Fallback to bundled
        this.isRunning = true;
      } else {
        console.warn('[AIController] No Ollama instances detected (ports 11434, 11435)');

        // Check if bundled binary exists for future startup
        const exists = fs.existsSync(this.ollamaPath);
        if (!exists) {
          console.warn('[AIController] Bundled Ollama binary not found.');
          return { success: false, reason: 'no_ollama_available' };
        }
      }

      // Mark provider as available if any channel is available
      if (externalAvailable || bundledAvailable) {
        const { Ollama } = require('electron-ollama');
        this.ollama = new Ollama();
        this.providers.ollama.available = true;
        console.log('[AIController] Ollama dual-channel initialized');
      }

      return {
        success: true,
        channels: {
          external: this.ollamaChannels.external,
          bundled: this.ollamaChannels.bundled
        }
      };

    } catch (error) {
      console.error('[AIController] Ollama initialization failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Detect available CLI providers
   */
  async detectCLIProviders() {
    // Check for Claude Code CLI
    try {
      await execAsync('claude-code --version');
      this.providers.claude.available = true;
      console.log('[AIController] Claude Code CLI detected');
    } catch (error) {
      console.log('[AIController] Claude Code CLI not available');
    }

    // Check for Gemini Code Assist CLI
    try {
      await execAsync('gemini-code --version');
      this.providers.gemini.available = true;
      console.log('[AIController] Gemini Code Assist CLI detected');
    } catch (error) {
      console.log('[AIController] Gemini Code Assist CLI not available');
    }
  }

  /**
   * Setup quota reset timers
   */
  setupQuotaResetTimers() {
    // Reset Claude quota every 5 hours
    if (this.providers.claude.available) {
      this.quotaResetTimers.claude = setInterval(() => {
        this.providers.claude.used = 0;
        console.log('[AIController] Claude quota reset');
      }, this.providers.claude.resetInterval);
    }

    // Reset Gemini quota every 24 hours
    if (this.providers.gemini.available) {
      this.quotaResetTimers.gemini = setInterval(() => {
        this.providers.gemini.used = 0;
        console.log('[AIController] Gemini quota reset');
      }, this.providers.gemini.resetInterval);
    }
  }

  /**
   * Get list of available providers
   */
  getAvailableProviders() {
    return Object.keys(this.providers).filter(p => this.providers[p].available);
  }

  /**
   * Select best provider based on mode and quota
   * @param {string} mode - 'planning', 'developing', or 'debugging'
   * @returns {string|null} Provider name
   */
  selectProvider(mode = 'developing') {
    const preferences = this.modePreferences[mode] || this.modePreferences.developing;

    for (const provider of preferences) {
      if (!this.providers[provider].available) {
        continue;
      }

      const { quota, used } = this.providers[provider];
      if (used < quota) {
        return provider;
      }
    }

    // All providers exhausted or unavailable
    console.warn('[AIController] No providers available with remaining quota');
    return null;
  }

  /**
   * Start Ollama service (backward compatibility)
   */
  async start() {
    if (!this.providers.ollama.available) {
      console.error('[AIController] Ollama not available');
      return { success: false, reason: 'ollama_not_available' };
    }

    if (this.isRunning) {
      console.log('[AIController] Ollama already running');
      return { success: true };
    }

    try {
      console.log(`[AIController] Starting Ollama service on port ${this.port}...`);

      const runningPort = await this.checkExistingInstance();
      if (runningPort) {
        console.log(`[AIController] Found existing Ollama instance on port ${runningPort}`);
        this.port = runningPort;
        this.isRunning = true;
        return { success: true, usingExisting: true, port: runningPort };
      }

      await this.ollama.start({
        port: this.port,
        binPath: path.dirname(this.ollamaPath)
      });

      this.isRunning = true;
      console.log(`[AIController] Ollama service started on port ${this.port}`);
      return { success: true, port: this.port };

    } catch (error) {
      console.error('[AIController] Failed to start Ollama:', error);
      this.isRunning = false;
      return { success: false, error: error.message };
    }
  }

  /**
   * Check for existing Ollama instance
   */
  async checkExistingInstance() {
    try {
      const portsToCheck = [11434, this.port];

      for (const port of portsToCheck) {
        try {
          const response = await fetch(`http://localhost:${port}/api/tags`);
          if (response.ok) {
            return port;
          }
        } catch (error) {
          // Port not responding
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Stop Ollama service
   */
  async stop() {
    if (!this.isRunning) {
      console.log('[AIController] Ollama not running');
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
      console.error('[AIController] Error stopping Ollama:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Epic 10.4: Select best available Ollama channel
   * @returns {Object|null} Selected channel or null if none available
   */
  selectOllamaChannel() {
    // Priority: external (user's high-performance) > bundled (convenience)
    if (this.ollamaChannels.external.available) {
      return { name: 'external', ...this.ollamaChannels.external };
    } else if (this.ollamaChannels.bundled.available) {
      return { name: 'bundled', ...this.ollamaChannels.bundled };
    }
    return null;
  }

  /**
   * Query Ollama with dual-channel support
   * Epic 10.4: Routes to external or bundled instance
   * @param {string} prompt - The prompt
   * @param {string} model - Model to use
   * @param {Object} options - Query options
   * @param {string} options.channel - Force specific channel ('external' or 'bundled')
   * @returns {Promise<Object>} Response
   */
  async queryOllama(prompt, model = 'llama2', options = {}) {
    // Epic 10.4: Channel selection with fallback
    let channel = null;

    if (options.channel && this.ollamaChannels[options.channel]?.available) {
      // Use specified channel if available
      channel = { name: options.channel, ...this.ollamaChannels[options.channel] };
    } else {
      // Auto-select best channel
      channel = this.selectOllamaChannel();
    }

    if (!channel) {
      console.warn('[AIController] No Ollama channels available');
      return { success: false, reason: 'no_ollama_channels' };
    }

    try {
      console.log(`[AIController] Querying Ollama (${channel.name} on port ${channel.port})`);

      const response = await fetch(`http://localhost:${channel.port}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          stream: false
        })
      });

      if (!response.ok) {
        // Epic 10.4: Try fallback channel if primary fails
        if (channel.name === 'external' && this.ollamaChannels.bundled.available) {
          console.warn('[AIController] External Ollama failed, falling back to bundled');
          return await this.queryOllama(prompt, model, { channel: 'bundled' });
        }
        throw new Error(`Ollama API error: ${response.status}`);
      }

      const data = await response.json();
      return {
        success: true,
        response: data.response,
        model: data.model,
        provider: 'ollama',
        channel: channel.name  // Epic 10.4: Report which channel was used
      };

    } catch (error) {
      console.error(`[AIController] Ollama (${channel.name}) query error:`, error);

      // Epic 10.4: Fallback logic
      if (channel.name === 'external' && this.ollamaChannels.bundled.available) {
        console.warn('[AIController] Retrying with bundled Ollama');
        return await this.queryOllama(prompt, model, { channel: 'bundled' });
      }

      return { success: false, error: error.message, channel: channel.name };
    }
  }

  /**
   * Epic 10.4: Query both Ollama channels in parallel (for acceleration)
   * Returns the fastest response, useful for heavy workloads
   * @param {string} prompt - The prompt
   * @param {string} model - Model to use
   * @returns {Promise<Object>} Fastest response
   */
  async queryOllamaParallel(prompt, model = 'llama2') {
    const availableChannels = [];

    if (this.ollamaChannels.external.available) {
      availableChannels.push(
        this.queryOllama(prompt, model, { channel: 'external' })
      );
    }

    if (this.ollamaChannels.bundled.available) {
      availableChannels.push(
        this.queryOllama(prompt, model, { channel: 'bundled' })
      );
    }

    if (availableChannels.length === 0) {
      return { success: false, reason: 'no_ollama_channels' };
    }

    console.log(`[AIController] Racing ${availableChannels.length} Ollama channel(s)...`);

    // Race to get the fastest response
    const result = await Promise.race(availableChannels);
    console.log(`[AIController] Winner: ${result.channel || 'unknown'} channel`);

    return result;
  }

  /**
   * Query Claude Code CLI
   * @param {string} prompt - The prompt
   * @returns {Promise<Object>} Response
   */
  async queryClaude(prompt) {
    if (!this.providers.claude.available) {
      return { success: false, reason: 'claude_not_available' };
    }

    try {
      // Execute Claude Code CLI
      // Note: This is a placeholder - actual CLI invocation depends on Claude's CLI API
      const { stdout, stderr } = await execAsync(`claude-code --prompt "${prompt.replace(/"/g, '\\"')}"`);

      if (stderr) {
        console.warn('[AIController] Claude stderr:', stderr);
      }

      this.providers.claude.used++;

      return {
        success: true,
        response: stdout.trim(),
        provider: 'claude',
        quotaRemaining: this.providers.claude.quota - this.providers.claude.used
      };

    } catch (error) {
      console.error('[AIController] Claude query error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Query Gemini Code Assist CLI
   * @param {string} prompt - The prompt
   * @returns {Promise<Object>} Response
   */
  async queryGemini(prompt) {
    if (!this.providers.gemini.available) {
      return { success: false, reason: 'gemini_not_available' };
    }

    try {
      // Execute Gemini Code Assist CLI
      // Note: This is a placeholder - actual CLI invocation depends on Gemini's CLI API
      const { stdout, stderr } = await execAsync(`gemini-code --prompt "${prompt.replace(/"/g, '\\"')}"`);

      if (stderr) {
        console.warn('[AIController] Gemini stderr:', stderr);
      }

      this.providers.gemini.used++;

      return {
        success: true,
        response: stdout.trim(),
        provider: 'gemini',
        quotaRemaining: this.providers.gemini.quota - this.providers.gemini.used
      };

    } catch (error) {
      console.error('[AIController] Gemini query error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Query AI with automatic provider selection
   * @param {string} prompt - The prompt
   * @param {Object} options - Options
   * @param {string} options.mode - 'planning', 'developing', or 'debugging'
   * @param {string} options.provider - Force specific provider
   * @param {string} options.model - Model to use (Ollama only)
   * @returns {Promise<Object>} Response
   */
  async queryAI(prompt, options = {}) {
    const { mode = 'developing', provider = null, model = 'llama2' } = options;

    // Select provider
    const selectedProvider = provider || this.selectProvider(mode);

    if (!selectedProvider) {
      return {
        success: false,
        error: 'No providers available or all quotas exhausted'
      };
    }

    console.log(`[AIController] Using provider: ${selectedProvider} (mode: ${mode})`);

    // Route to appropriate provider
    switch (selectedProvider) {
      case 'ollama':
        return await this.queryOllama(prompt, model);
      case 'claude':
        return await this.queryClaude(prompt);
      case 'gemini':
        return await this.queryGemini(prompt);
      default:
        return { success: false, error: `Unknown provider: ${selectedProvider}` };
    }
  }

  /**
   * GAN Refinement Loop - Iterative improvement
   * @param {string} initialPrompt - The task description
   * @param {Object} options - Options
   * @param {number} options.rounds - Number of refinement rounds (default: 2)
   * @param {string} options.mode - Mode for routing
   * @returns {Promise<Object>} Final refined response
   */
  async ganRefine(initialPrompt, options = {}) {
    const { rounds = this.ganSettings.rounds, mode = 'developing' } = options;

    if (!this.ganSettings.enabled) {
      console.log('[AIController] GAN refinement disabled, using single-pass');
      return await this.queryAI(initialPrompt, { mode });
    }

    console.log(`[AIController] Starting GAN refinement (${rounds} rounds)`);

    let currentOutput = null;
    let history = [];

    for (let round = 1; round <= rounds; round++) {
      console.log(`[AIController] GAN Round ${round}/${rounds}`);

      if (round === 1) {
        // Round 1: Initial generation
        const architectPrompt = `${initialPrompt}\n\nIMPORTANT: Generate production-ready code with proper error handling, validation, and robustness. Avoid "vanilla" or minimal implementations.`;

        const result = await this.queryAI(architectPrompt, {
          mode,
          provider: this.ganSettings.architectModel
        });

        if (!result.success) {
          return result;
        }

        currentOutput = result.response;
        history.push({ round: 1, role: 'architect', output: currentOutput });

      } else {
        // Round 2+: Critique and refine
        const critiquePrompt = `You are a senior code reviewer. Analyze the following code for:
1. Robustness: Does it handle edge cases?
2. Idempotency: Can it be run multiple times safely?
3. Clarity: Are error messages actionable?
4. Efficiency: Are there redundant operations?
5. Security: Are there injection risks?

Previous output:
${currentOutput}

Original task:
${initialPrompt}

Provide a critiqued and improved version of the code.`;

        const critiqueResult = await this.queryAI(critiquePrompt, {
          mode,
          provider: this.ganSettings.critiqueModel
        });

        if (!critiqueResult.success) {
          console.warn(`[AIController] GAN round ${round} failed, using previous output`);
          break;
        }

        currentOutput = critiqueResult.response;
        history.push({ round, role: 'critic', output: currentOutput });
      }
    }

    console.log('[AIController] GAN refinement complete');

    return {
      success: true,
      response: currentOutput,
      history,
      rounds: history.length,
      provider: 'gan-refined'
    };
  }

  /**
   * Agentic Code Generation - High-level interface for Epic 8
   * @param {string} task - Natural language task description
   * @param {string} mode - 'planning', 'developing', or 'debugging'
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} AI response
   */
  async agenticCode(task, mode = 'developing', options = {}) {
    const { useGAN = true, context = {} } = options;

    console.log(`[AIController] Agentic Code Request - Mode: ${mode}, GAN: ${useGAN}`);

    // Build enhanced prompt with context
    let enhancedPrompt = task;

    if (context.hardware) {
      enhancedPrompt += `\n\nSystem Hardware:\n${context.hardware}`;
    }

    if (context.files) {
      enhancedPrompt += `\n\nRelevant Files:\n${context.files}`;
    }

    if (context.error) {
      enhancedPrompt += `\n\nError Context:\n${context.error}`;
    }

    // Use GAN refinement if enabled and appropriate
    if (useGAN && mode !== 'debugging') {
      return await this.ganRefine(enhancedPrompt, { mode });
    }

    // Single-pass query
    return await this.queryAI(enhancedPrompt, { mode });
  }

  /**
   * Legacy method for backward compatibility
   * @deprecated Use queryAI() or agenticCode() instead
   */
  async askAI(prompt, context = {}, model = null) {
    console.warn('[AIController] askAI() is deprecated, use queryAI() or agenticCode()');

    // Build full prompt with context
    const fullPrompt = context && Object.keys(context).length > 0
      ? `${JSON.stringify(context)}\n\n${prompt}`
      : prompt;

    return await this.queryAI(fullPrompt, { model });
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      initialized: this.initialized,
      ollama: {
        running: this.isRunning,
        port: this.port,
        binaryPath: this.ollamaPath
      },
      providers: Object.keys(this.providers).reduce((acc, key) => {
        acc[key] = {
          available: this.providers[key].available,
          quota: this.providers[key].quota,
          used: this.providers[key].used,
          remaining: this.providers[key].quota - this.providers[key].used
        };
        return acc;
      }, {}),
      gan: this.ganSettings
    };
  }

  /**
   * Update GAN settings
   */
  updateGANSettings(settings = {}) {
    this.ganSettings = { ...this.ganSettings, ...settings };
    console.log('[AIController] GAN settings updated:', this.ganSettings);
    return { success: true, settings: this.ganSettings };
  }

  /**
   * Update mode preferences
   */
  updateModePreferences(mode, preferences) {
    if (!this.modePreferences[mode]) {
      return { success: false, error: `Invalid mode: ${mode}` };
    }

    this.modePreferences[mode] = preferences;
    console.log(`[AIController] Mode preferences updated for ${mode}:`, preferences);
    return { success: true };
  }

  /**
   * Setup IPC handlers
   */
  setupIpcHandlers(ipcRouter) {
    // Legacy handlers (backward compatibility)
    ipcRouter.handle('ai:initialize', async (event, options) => {
      return await this.initialize(options);
    });

    ipcRouter.handle('ai:start', async () => {
      return await this.start();
    });

    ipcRouter.handle('ai:stop', async () => {
      return await this.stop();
    });

    ipcRouter.handle('ai:ask', async (event, { prompt, context, model }) => {
      return await this.askAI(prompt, context, model);
    });

    ipcRouter.handle('ai:status', async () => {
      return this.getStatus();
    });

    // New Epic 8 handlers
    ipcRouter.handle('ai:query', async (event, { prompt, options }) => {
      return await this.queryAI(prompt, options);
    });

    ipcRouter.handle('ai:agentic-code', async (event, { task, mode, options }) => {
      return await this.agenticCode(task, mode, options);
    });

    ipcRouter.handle('ai:gan-refine', async (event, { prompt, options }) => {
      return await this.ganRefine(prompt, options);
    });

    ipcRouter.handle('ai:update-gan-settings', async (event, settings) => {
      return this.updateGANSettings(settings);
    });

    ipcRouter.handle('ai:update-mode-preferences', async (event, { mode, preferences }) => {
      return this.updateModePreferences(mode, preferences);
    });

    ipcRouter.handle('ai:get-providers', async () => {
      return { success: true, providers: this.getAvailableProviders() };
    });

    console.log('[AIController] IPC handlers registered (Epic 8 enhanced)');
  }

  /**
   * Cleanup on shutdown
   */
  async destroy() {
    // Stop Ollama
    if (this.isRunning) {
      await this.stop();
    }

    // Clear quota reset timers
    Object.values(this.quotaResetTimers).forEach(timer => clearInterval(timer));

    this.initialized = false;
    console.log('[AIController] Service destroyed');
  }
}

// Export singleton instance
module.exports = new AIController();
