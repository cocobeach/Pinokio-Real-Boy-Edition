/**
 * ForgeService - The AI Forge (Natural Language → Installation Scripts)
 * Uses AIController to analyze repositories and generate InstallManifests
 * "The Architect" - Pinokio's autonomous installation intelligence
 */

const InstallManifest = require('../models/InstallManifest');
const AIController = require('../controllers/AIController');

class ForgeService {
  constructor() {
    this.activeForges = new Map(); // Track ongoing forge operations
    this.forgeHistory = []; // History of generated manifests
  }

  /**
   * Analyze a repository and generate an installation manifest
   * @param {Object} params - Forge parameters
   * @param {string} params.input - Natural language input or GitHub URL
   * @param {string} params.model - LLM model to use (optional)
   * @param {Function} params.onProgress - Progress callback (optional)
   * @returns {Promise<InstallManifest>} Generated manifest
   */
  async forge(params) {
    const { input, model, onProgress } = params;
    const forgeId = Date.now().toString();

    try {
      // Mark forge as active
      this.activeForges.set(forgeId, {
        input,
        startedAt: new Date(),
        status: 'analyzing'
      });

      onProgress?.({ stage: 'analyzing', message: 'Analyzing repository...' });

      // Check if AI is available
      const aiStatus = AIController.getStatus();
      if (!aiStatus.running) {
        throw new Error('AI service not running. Please start Ollama first.');
      }

      // Build the prompt for the AI
      const prompt = this.buildForgePrompt(input);

      onProgress?.({ stage: 'querying_ai', message: 'Querying AI architect...' });

      // Query the AI
      const aiResponse = await AIController.askAI(prompt, {
        task: 'installation_analysis',
        input: input
      }, model);

      if (!aiResponse.success) {
        throw new Error(`AI query failed: ${aiResponse.error}`);
      }

      onProgress?.({ stage: 'parsing', message: 'Parsing AI response...' });

      // Parse the AI response into a manifest
      const manifest = this.parseAIResponse(aiResponse.response, input);

      onProgress?.({ stage: 'validating', message: 'Validating manifest...' });

      // Validate the manifest
      const validation = manifest.validate();
      if (!validation.valid) {
        throw new Error(`Invalid manifest: ${validation.errors.join(', ')}`);
      }

      // Safety check
      const safety = manifest.checkSafety();
      if (!safety.safe) {
        onProgress?.({
          stage: 'warning',
          message: 'Safety warnings detected',
          warnings: safety.warnings
        });
      }

      // Store in history
      this.forgeHistory.push({
        forgeId,
        input,
        manifest,
        createdAt: new Date(),
        safetyWarnings: safety.warnings
      });

      // Mark as complete
      this.activeForges.delete(forgeId);

      onProgress?.({ stage: 'complete', message: 'Manifest generated successfully!' });

      return manifest;

    } catch (error) {
      this.activeForges.delete(forgeId);
      onProgress?.({ stage: 'error', message: error.message });
      throw error;
    }
  }

  /**
   * Build the AI prompt for forge operation
   * @param {string} input - User input (natural language or URL)
   * @returns {string} Formatted prompt
   */
  buildForgePrompt(input) {
    return `You are the Pinokio AI Forge, an expert at analyzing software repositories and generating installation instructions.

Task: Analyze the following and generate a structured installation manifest.

Input: ${input}

Instructions:
1. If this is a GitHub URL, analyze the repository structure
2. Detect the project type (python, node, rust, docker)
3. Identify required dependencies and installation steps
4. Generate install commands in the correct order
5. Identify any model files that need to be downloaded (IMPORTANT: these will use GAS - Global Asset Store for deduplication)
6. Determine the command to run the application

Output Format (JSON):
{
  "appName": "string (name of the app)",
  "sourceUrl": "string (GitHub clone URL)",
  "detectedType": "python|node|rust|docker",
  "requirements": ["array", "of", "dependencies"],
  "installCommands": [
    "command 1",
    "command 2"
  ],
  "runCommand": "command to start the app",
  "envVars": {
    "KEY": "value"
  },
  "models": [
    {
      "url": "https://...",
      "path": "relative/path/in/app",
      "description": "Optional description of what this model does"
    }
  ]
}

Important:
- Use ONLY safe, standard installation commands
- For Python projects, assume conda/venv will be handled automatically
- For model downloads, provide full URLs (these will be handled by GAS for deduplication)
- Models will be downloaded to Global Asset Store and symlinked to prevent duplication
- Keep commands simple and idiomatic for the detected type
- Do NOT include 'cd' commands (path will be handled automatically)
- Identify ALL model files (.safetensors, .ckpt, .pth, .bin files) from the repository

Generate the manifest now:`;
  }

  /**
   * Parse AI response into InstallManifest
   * @param {string} response - AI response text
   * @param {string} fallbackUrl - Fallback source URL
   * @returns {InstallManifest} Parsed manifest
   */
  parseAIResponse(response, fallbackUrl = '') {
    try {
      // Try to extract JSON from the response
      // AI might wrap it in markdown code blocks
      let jsonStr = response;

      // Remove markdown code blocks if present
      const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/) ||
                       response.match(/```\s*([\s\S]*?)\s*```/) ||
                       response.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        jsonStr = jsonMatch[1] || jsonMatch[0];
      }

      // Parse JSON
      const data = JSON.parse(jsonStr);

      // Create manifest
      const manifest = new InstallManifest(data);

      // Fallback: if sourceUrl is missing, use the input as fallback
      if (!manifest.sourceUrl && fallbackUrl) {
        manifest.sourceUrl = fallbackUrl;
      }

      return manifest;

    } catch (error) {
      throw new Error(`Failed to parse AI response: ${error.message}`);
    }
  }

  /**
   * Analyze error logs and suggest fixes
   * @param {Object} params - Analysis parameters
   * @param {string} params.errorLog - Error log text
   * @param {InstallManifest} params.originalManifest - Original manifest
   * @param {string} params.model - LLM model (optional)
   * @returns {Promise<Object>} Suggested fixes
   */
  async analyzeError(params) {
    const { errorLog, originalManifest, model } = params;

    try {
      const prompt = `You are the Pinokio AI Error Analyst.

Original Installation Manifest:
${originalManifest.toJSON(true)}

Installation Error Log:
${errorLog}

Task:
1. Analyze what went wrong
2. Suggest specific fixes to the installation commands
3. Identify if dependencies are missing
4. Propose an updated manifest

Output Format (JSON):
{
  "diagnosis": "string (what went wrong)",
  "fixes": [
    "suggested fix 1",
    "suggested fix 2"
  ],
  "updatedCommands": [
    "corrected command 1",
    "corrected command 2"
  ],
  "additionalDependencies": ["dep1", "dep2"]
}

Analyze and respond with JSON:`;

      const aiResponse = await AIController.askAI(prompt, {
        task: 'error_analysis',
        errorLog: errorLog.slice(0, 2000) // Limit log size
      }, model);

      if (!aiResponse.success) {
        throw new Error(`AI error analysis failed: ${aiResponse.error}`);
      }

      // Parse response
      let jsonStr = aiResponse.response;
      const jsonMatch = aiResponse.response.match(/```json\s*([\s\S]*?)\s*```/) ||
                       aiResponse.response.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        jsonStr = jsonMatch[1] || jsonMatch[0];
      }

      const analysis = JSON.parse(jsonStr);

      return {
        success: true,
        diagnosis: analysis.diagnosis,
        fixes: analysis.fixes || [],
        updatedCommands: analysis.updatedCommands || [],
        additionalDependencies: analysis.additionalDependencies || []
      };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get forge history
   * @param {number} limit - Max number of entries (default: 10)
   * @returns {Array} History entries
   */
  getHistory(limit = 10) {
    return this.forgeHistory.slice(-limit).reverse();
  }

  /**
   * Get active forges
   * @returns {Array} Active forge operations
   */
  getActiveForges() {
    return Array.from(this.activeForges.values());
  }

  /**
   * Setup IPC handlers
   * @param {IpcRouter} ipcRouter - IPC router instance
   */
  setupIpcHandlers(ipcRouter) {
    // Forge operation
    ipcRouter.handle('forge:create', async (event, params) => {
      try {
        const manifest = await this.forge({
          ...params,
          onProgress: (progress) => {
            event.sender.send('forge:progress', progress);
          }
        });

        return {
          success: true,
          manifest: JSON.parse(manifest.toJSON()),
          pinokioScript: manifest.toPinokioScript()
        };

      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
    });

    // Error analysis
    ipcRouter.handle('forge:analyze-error', async (event, params) => {
      const manifest = new InstallManifest(params.originalManifest);
      return await this.analyzeError({
        errorLog: params.errorLog,
        originalManifest: manifest,
        model: params.model
      });
    });

    // Get history
    ipcRouter.handle('forge:history', async (event, params) => {
      return {
        success: true,
        history: this.getHistory(params?.limit)
      };
    });

    // Get active forges
    ipcRouter.handle('forge:active', async () => {
      return {
        success: true,
        active: this.getActiveForges()
      };
    });

    // Execute in terminal
    ipcRouter.handle('forge:execute-in-terminal', async (event, params) => {
      const manifest = new InstallManifest(params.manifest);
      return await this.executeInTerminal(manifest, {
        sessionId: params.sessionId,
        onProgress: (progress) => {
          event.sender.send('forge:execution-progress', progress);
        }
      });
    });

    // Save manifest
    ipcRouter.handle('forge:save-manifest', async (event, params) => {
      const manifest = new InstallManifest(params.manifest);
      return this.saveManifest(manifest, params.name);
    });

    console.log('[ForgeService] IPC handlers registered');
  }

  /**
   * Execute a generated manifest in a terminal
   * This creates the Forge → Terminal pipeline
   * @param {InstallManifest} manifest - The manifest to execute
   * @param {Object} options - Execution options
   * @param {Function} options.onProgress - Progress callback
   * @param {string} options.sessionId - Terminal session ID (optional, will create new if not provided)
   * @returns {Promise<Object>} Execution result
   */
  async executeInTerminal(manifest, options = {}) {
    const { onProgress, sessionId } = options;
    const PTYController = require('../controllers/PTYController');
    const fs = require('fs');
    const path = require('path');
    const os = require('os');

    try {
      onProgress?.({ stage: 'preparing', message: 'Preparing installation script...' });

      // Convert manifest to Pinokio script
      const script = manifest.toPinokioScript();

      // Save script to temporary location
      const homedir = os.homedir();
      const scriptDir = path.join(homedir, 'pinokio', 'forge', 'generated');
      if (!fs.existsSync(scriptDir)) {
        fs.mkdirSync(scriptDir, { recursive: true });
      }

      const timestamp = Date.now();
      const scriptPath = path.join(scriptDir, `${manifest.appName}_${timestamp}.json`);
      fs.writeFileSync(scriptPath, JSON.stringify(script, null, 2));

      onProgress?.({ stage: 'saved', message: `Script saved to: ${scriptPath}` });

      // Create or use existing terminal session
      let terminalSessionId = sessionId;
      if (!terminalSessionId) {
        onProgress?.({ stage: 'terminal', message: 'Creating terminal session...' });
        const session = PTYController.createSession({
          cwd: path.join(homedir, 'pinokio', 'api'),
          cols: 120,
          rows: 30
        });
        terminalSessionId = session.id;
      }

      onProgress?.({ stage: 'executing', message: 'Executing installation script...' });

      // Note: Actual execution would require pinokiod CLI integration
      // For now, we provide the script path and terminal session
      return {
        success: true,
        scriptPath,
        terminalSessionId,
        message: 'Script ready for execution. Use pinokiod to run the script in the terminal session.'
      };

    } catch (error) {
      onProgress?.({ stage: 'error', message: error.message });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Save a manifest for later use
   * @param {InstallManifest} manifest - The manifest to save
   * @param {string} name - Custom name (optional)
   * @returns {Object} Save result
   */
  saveManifest(manifest, name = null) {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');

    try {
      const homedir = os.homedir();
      const saveDir = path.join(homedir, 'pinokio', 'forge', 'manifests');
      if (!fs.existsSync(saveDir)) {
        fs.mkdirSync(saveDir, { recursive: true });
      }

      const filename = name || `${manifest.appName}_${Date.now()}.json`;
      const savePath = path.join(saveDir, filename);

      fs.writeFileSync(savePath, manifest.toJSON(true));

      return {
        success: true,
        path: savePath
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Cleanup on shutdown
   */
  destroy() {
    this.activeForges.clear();
    console.log('[ForgeService] Service destroyed');
  }
}

// Export singleton instance
module.exports = new ForgeService();
