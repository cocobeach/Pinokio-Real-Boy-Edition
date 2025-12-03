/**
 * PlanExecutor - The Synergistic Forge
 * Epic 9: Autonomous IDE Loop (Plan → Code → Debug → Commit)
 * Translates YAML project plans into executable Git workflows
 */

const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml'); // Note: May need to install or use alternative parser
const GitService = require('./GitService');
const AIController = require('../controllers/AIController');
const ForgeService = require('./ForgeService');
const FileSystemService = require('./FileSystemService');
const PTYController = require('../controllers/PTYController');

class PlanExecutor {
  constructor() {
    this.activePlans = new Map(); // planId -> execution state
    this.planHistory = []; // Completed plans
    this.maxRetries = 3; // Max retries per task
  }

  /**
   * Parse YAML plan file
   * @param {string} planPath - Path to YAML plan file
   * @returns {Promise<Object>} Parsed plan
   */
  async parsePlan(planPath) {
    try {
      const content = await fs.readFile(planPath, 'utf8');

      // Try YAML parsing first
      let plan;
      try {
        plan = yaml.load(content);
      } catch (yamlError) {
        // Fallback: Simple line-based parser for basic YAML
        plan = this.parseYAMLFallback(content);
      }

      // Validate plan structure
      if (!plan.epic || !plan.tasks || !Array.isArray(plan.tasks)) {
        throw new Error('Invalid plan structure: must have "epic" and "tasks" array');
      }

      // Add metadata
      plan.id = Date.now().toString();
      plan.sourcePath = planPath;
      plan.createdAt = new Date().toISOString();

      console.log(`[PlanExecutor] Parsed plan: ${plan.epic} (${plan.tasks.length} tasks)`);
      return plan;

    } catch (error) {
      console.error('[PlanExecutor] Failed to parse plan:', error);
      throw new Error(`Plan parsing failed: ${error.message}`);
    }
  }

  /**
   * Fallback YAML parser for basic plans
   * @param {string} content - YAML content
   * @returns {Object} Parsed plan
   */
  parseYAMLFallback(content) {
    const lines = content.split('\n');
    const plan = { tasks: [] };
    let currentTask = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Epic
      if (trimmed.startsWith('epic:')) {
        plan.epic = trimmed.substring(5).trim().replace(/['"]/g, '');
      }
      // Goal
      else if (trimmed.startsWith('goal:')) {
        plan.goal = trimmed.substring(5).trim().replace(/['"]/g, '');
      }
      // Branch
      else if (trimmed.startsWith('branch:')) {
        plan.branch = trimmed.substring(7).trim().replace(/['"]/g, '');
      }
      // Tasks array start
      else if (trimmed === 'tasks:') {
        // Start of tasks
      }
      // New task
      else if (trimmed.startsWith('- id:') || trimmed.startsWith('- task:')) {
        if (currentTask) {
          plan.tasks.push(currentTask);
        }
        currentTask = {
          id: trimmed.includes('id:') ? trimmed.split('id:')[1].trim() : plan.tasks.length + 1
        };
      }
      // Task properties
      else if (currentTask) {
        if (trimmed.startsWith('description:')) {
          currentTask.description = trimmed.substring(12).trim().replace(/['"]/g, '');
        } else if (trimmed.startsWith('mode:')) {
          currentTask.mode = trimmed.substring(5).trim().replace(/['"]/g, '');
        } else if (trimmed.startsWith('files:')) {
          currentTask.files = [];
        } else if (trimmed.startsWith('- ') && currentTask.files) {
          currentTask.files.push(trimmed.substring(2).trim().replace(/['"]/g, ''));
        }
      }
    }

    if (currentTask) {
      plan.tasks.push(currentTask);
    }

    return plan;
  }

  /**
   * Execute a plan
   * @param {Object} params - Execution parameters
   * @param {string} params.planPath - Path to plan file
   * @param {string} params.workingDir - Repository working directory
   * @param {Function} params.onProgress - Progress callback
   * @param {boolean} params.autoCommit - Auto-commit after each task (default: true)
   * @param {boolean} params.useGAN - Use GAN refinement (default: true)
   * @returns {Promise<Object>} Execution result
   */
  async executePlan(params) {
    const {
      planPath,
      workingDir,
      onProgress,
      autoCommit = true,
      useGAN = true
    } = params;

    try {
      // Parse plan
      onProgress?.({ stage: 'parsing', message: 'Parsing project plan...' });
      const plan = await this.parsePlan(planPath);

      // Initialize execution state
      const executionState = {
        planId: plan.id,
        plan,
        workingDir,
        currentTaskIndex: 0,
        completedTasks: [],
        failedTasks: [],
        startedAt: new Date().toISOString(),
        status: 'running'
      };

      this.activePlans.set(plan.id, executionState);

      // Check if we're in a git repo
      const isRepo = await GitService.isRepository({ path: workingDir });
      if (!isRepo.success || !isRepo.isRepository) {
        throw new Error('Working directory is not a Git repository');
      }

      // Create feature branch if specified
      if (plan.branch) {
        onProgress?.({ stage: 'git', message: `Creating branch: ${plan.branch}` });

        const branchResult = await GitService.checkoutBranch({
          path: workingDir,
          branch: plan.branch,
          create: true
        });

        if (!branchResult.success) {
          console.warn('[PlanExecutor] Branch creation failed, continuing on current branch');
        } else {
          console.log(`[PlanExecutor] Created and switched to branch: ${plan.branch}`);
        }
      }

      // Execute tasks sequentially
      for (let i = 0; i < plan.tasks.length; i++) {
        const task = plan.tasks[i];
        executionState.currentTaskIndex = i;

        onProgress?.({
          stage: 'task',
          taskIndex: i,
          totalTasks: plan.tasks.length,
          task,
          message: `Task ${i + 1}/${plan.tasks.length}: ${task.description}`
        });

        try {
          const taskResult = await this.executeTask({
            task,
            workingDir,
            mode: task.mode || 'developing',
            useGAN,
            onProgress
          });

          executionState.completedTasks.push({
            taskId: task.id,
            result: taskResult,
            completedAt: new Date().toISOString()
          });

          // Auto-commit if enabled
          if (autoCommit && taskResult.filesModified && taskResult.filesModified.length > 0) {
            onProgress?.({ stage: 'committing', message: 'Creating commit...' });

            const commitMessage = `feat: ${task.description}\n\nTask ${task.id}: ${plan.epic}${taskResult.details ? '\n\n' + taskResult.details : ''}`;

            const commitResult = await GitService.commit({
              path: workingDir,
              message: commitMessage,
              files: taskResult.filesModified
            });

            if (commitResult.success) {
              console.log(`[PlanExecutor] Committed: ${task.description}`);
            } else {
              console.warn('[PlanExecutor] Commit failed:', commitResult.error);
            }
          }

        } catch (error) {
          console.error(`[PlanExecutor] Task ${task.id} failed:`, error);

          // Attempt debugging with AI
          const debugResult = await this.handleTaskFailure({
            task,
            error,
            workingDir,
            onProgress
          });

          if (debugResult.recovered) {
            executionState.completedTasks.push({
              taskId: task.id,
              result: debugResult.result,
              recoveredFromError: true,
              completedAt: new Date().toISOString()
            });
          } else {
            executionState.failedTasks.push({
              taskId: task.id,
              error: error.message,
              debugAnalysis: debugResult.analysis,
              failedAt: new Date().toISOString()
            });

            // Ask user if they want to continue
            const shouldContinue = await this.promptUserToContinue({
              task,
              error,
              debugAnalysis: debugResult.analysis,
              onProgress
            });

            if (!shouldContinue) {
              console.log('[PlanExecutor] User aborted plan execution');
              break;
            }
          }
        }
      }

      // Mark plan as completed
      executionState.status = executionState.failedTasks.length === 0 ? 'completed' : 'completed_with_errors';
      executionState.completedAt = new Date().toISOString();

      this.activePlans.delete(plan.id);
      this.planHistory.push(executionState);

      onProgress?.({
        stage: 'complete',
        message: 'Plan execution complete',
        completedTasks: executionState.completedTasks.length,
        failedTasks: executionState.failedTasks.length
      });

      return {
        success: true,
        planId: plan.id,
        completedTasks: executionState.completedTasks.length,
        failedTasks: executionState.failedTasks.length,
        executionState
      };

    } catch (error) {
      console.error('[PlanExecutor] Plan execution failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Execute a single task
   * @param {Object} params - Task parameters
   * @returns {Promise<Object>} Task result
   */
  async executeTask(params) {
    const { task, workingDir, mode, useGAN, onProgress } = params;

    console.log(`[PlanExecutor] Executing task: ${task.description}`);

    // Build context for AI
    const context = {
      task: task.description,
      mode: mode || 'developing',
      files: task.files || [],
      workingDir
    };

    // Read existing files if specified
    if (task.files && task.files.length > 0) {
      onProgress?.({ stage: 'reading', message: 'Reading existing files...' });

      context.existingCode = {};
      for (const filePath of task.files) {
        const fullPath = path.join(workingDir, filePath);
        try {
          const fileContent = await fs.readFile(fullPath, 'utf8');
          context.existingCode[filePath] = fileContent;
        } catch (error) {
          // File doesn't exist yet, will be created
          console.log(`[PlanExecutor] File doesn't exist yet: ${filePath}`);
        }
      }
    }

    // Generate code with AI
    onProgress?.({ stage: 'generating', message: 'AI is generating code...' });

    const prompt = this.buildTaskPrompt(task, context);

    const aiResult = await AIController.agenticCode(
      prompt,
      mode,
      {
        useGAN,
        context: {
          files: JSON.stringify(context.existingCode, null, 2)
        }
      }
    );

    if (!aiResult.success) {
      throw new Error(`AI code generation failed: ${aiResult.error}`);
    }

    // Parse AI response and apply changes
    onProgress?.({ stage: 'applying', message: 'Applying changes...' });

    const changes = this.parseAIChanges(aiResult.response, task.files);
    const modifiedFiles = await this.applyChanges(changes, workingDir);

    // Run validation if specified
    if (task.validate) {
      onProgress?.({ stage: 'validating', message: 'Running validation...' });
      await this.runValidation(task.validate, workingDir);
    }

    console.log(`[PlanExecutor] Task completed: ${task.description}`);

    return {
      success: true,
      filesModified: modifiedFiles,
      details: aiResult.provider ? `Generated by: ${aiResult.provider}` : null
    };
  }

  /**
   * Build AI prompt for task
   * @param {Object} task - Task object
   * @param {Object} context - Task context
   * @returns {string} Prompt
   */
  buildTaskPrompt(task, context) {
    let prompt = `Task: ${task.description}\n\n`;

    if (task.goal) {
      prompt += `Goal: ${task.goal}\n\n`;
    }

    if (context.existingCode && Object.keys(context.existingCode).length > 0) {
      prompt += `Existing Files:\n`;
      for (const [filePath, content] of Object.entries(context.existingCode)) {
        prompt += `\n--- ${filePath} ---\n${content}\n`;
      }
      prompt += `\n`;
    }

    if (task.files && task.files.length > 0) {
      prompt += `Target Files: ${task.files.join(', ')}\n\n`;
    }

    if (task.acceptance) {
      prompt += `Acceptance Criteria: ${task.acceptance}\n\n`;
    }

    prompt += `Please provide the complete, production-ready code for the files listed above. `;
    prompt += `Format your response with clear file markers:\n`;
    prompt += `--- FILE: path/to/file.js ---\n`;
    prompt += `[file content]\n`;
    prompt += `--- END FILE ---\n`;

    return prompt;
  }

  /**
   * Parse AI response to extract file changes
   * @param {string} response - AI response
   * @param {string[]} expectedFiles - Expected file paths
   * @returns {Array} Changes array
   */
  parseAIChanges(response, expectedFiles = []) {
    const changes = [];

    // Look for file markers
    const fileRegex = /---\s*FILE:\s*(.*?)\s*---\n([\s\S]*?)(?=---\s*(?:END FILE|FILE:)|$)/gi;
    let match;

    while ((match = fileRegex.exec(response)) !== null) {
      const filePath = match[1].trim();
      let content = match[2].trim();

      // Remove markdown code block markers if present
      content = content.replace(/^```[a-z]*\n/, '').replace(/\n```$/, '');

      changes.push({
        filePath,
        content,
        operation: 'write'
      });
    }

    // If no file markers found, try to extract code blocks for expected files
    if (changes.length === 0 && expectedFiles.length > 0) {
      const codeBlockRegex = /```[a-z]*\n([\s\S]*?)\n```/g;
      const blocks = [];

      while ((match = codeBlockRegex.exec(response)) !== null) {
        blocks.push(match[1]);
      }

      // Map code blocks to expected files
      expectedFiles.forEach((filePath, index) => {
        if (blocks[index]) {
          changes.push({
            filePath,
            content: blocks[index],
            operation: 'write'
          });
        }
      });
    }

    return changes;
  }

  /**
   * Apply changes to filesystem
   * @param {Array} changes - Changes to apply
   * @param {string} workingDir - Working directory
   * @returns {Promise<string[]>} Modified file paths
   */
  async applyChanges(changes, workingDir) {
    const modifiedFiles = [];

    for (const change of changes) {
      const fullPath = path.join(workingDir, change.filePath);

      try {
        // Ensure directory exists
        await fs.mkdir(path.dirname(fullPath), { recursive: true });

        // Write file
        await fs.writeFile(fullPath, change.content, 'utf8');

        modifiedFiles.push(change.filePath);
        console.log(`[PlanExecutor] Applied changes to: ${change.filePath}`);

      } catch (error) {
        console.error(`[PlanExecutor] Failed to apply changes to ${change.filePath}:`, error);
        throw error;
      }
    }

    return modifiedFiles;
  }

  /**
   * Run validation command
   * @param {string|Object} validate - Validation config
   * @param {string} workingDir - Working directory
   * @returns {Promise<void>}
   */
  async runValidation(validate, workingDir) {
    const command = typeof validate === 'string' ? validate : validate.command;

    if (!command) {
      return;
    }

    console.log(`[PlanExecutor] Running validation: ${command}`);

    // Use PTYController to execute command
    const session = await PTYController.create({
      cwd: workingDir,
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash'
    });

    return new Promise((resolve, reject) => {
      let output = '';

      PTYController.onData(session.id, (data) => {
        output += data;
      });

      PTYController.onExit(session.id, (exitCode) => {
        if (exitCode === 0) {
          console.log('[PlanExecutor] Validation passed');
          resolve();
        } else {
          reject(new Error(`Validation failed with exit code ${exitCode}\n${output}`));
        }
      });

      PTYController.write({ sessionId: session.id, data: `${command}\n` });
    });
  }

  /**
   * Handle task failure with AI debugging
   * @param {Object} params - Failure parameters
   * @returns {Promise<Object>} Debug result
   */
  async handleTaskFailure(params) {
    const { task, error, workingDir, onProgress } = params;

    console.log(`[PlanExecutor] Handling task failure for: ${task.description}`);

    onProgress?.({ stage: 'debugging', message: 'AI is analyzing the error...' });

    try {
      // Use ForgeService to analyze error
      const analysis = await ForgeService.analyzeError({
        errorLog: error.stack || error.message,
        originalManifest: {
          toJSON: () => JSON.stringify({ task }, null, 2)
        }
      });

      if (analysis.success && analysis.updatedCommands && analysis.updatedCommands.length > 0) {
        // Attempt automatic recovery
        console.log('[PlanExecutor] Attempting automatic recovery with AI fixes');

        // Apply fixes (simplified - real implementation would be more complex)
        return {
          recovered: false, // Conservative: require user approval
          analysis
        };
      }

      return {
        recovered: false,
        analysis
      };

    } catch (debugError) {
      console.error('[PlanExecutor] Debugging failed:', debugError);
      return {
        recovered: false,
        analysis: {
          diagnosis: 'Automated debugging failed',
          error: debugError.message
        }
      };
    }
  }

  /**
   * Prompt user to continue after task failure
   * @param {Object} params - Prompt parameters
   * @returns {Promise<boolean>} User decision
   */
  async promptUserToContinue(params) {
    const { task, error, debugAnalysis, onProgress } = params;

    onProgress?.({
      stage: 'error',
      message: `Task failed: ${task.description}`,
      error: error.message,
      debugAnalysis,
      requiresUserInput: true
    });

    // In a real implementation, this would wait for user input via IPC
    // For now, we'll continue by default
    console.warn('[PlanExecutor] User approval required - continuing by default');
    return true;
  }

  /**
   * Get active plan status
   * @param {string} planId - Plan ID
   * @returns {Object} Plan status
   */
  getPlanStatus(planId) {
    const state = this.activePlans.get(planId);
    if (!state) {
      return { success: false, error: 'Plan not found' };
    }

    return {
      success: true,
      planId,
      status: state.status,
      currentTask: state.plan.tasks[state.currentTaskIndex],
      progress: {
        completed: state.completedTasks.length,
        failed: state.failedTasks.length,
        total: state.plan.tasks.length
      }
    };
  }

  /**
   * Cancel plan execution
   * @param {string} planId - Plan ID
   * @returns {Object} Result
   */
  async cancelPlan(planId) {
    const state = this.activePlans.get(planId);
    if (!state) {
      return { success: false, error: 'Plan not found' };
    }

    state.status = 'cancelled';
    this.activePlans.delete(planId);

    console.log(`[PlanExecutor] Plan cancelled: ${planId}`);

    return { success: true };
  }

  /**
   * Setup IPC handlers
   * @param {IpcRouter} ipcRouter - IPC router instance
   */
  setupIpcHandlers(ipcRouter) {
    // Execute plan
    ipcRouter.handle('plan-executor:execute', async (event, params) => {
      return await this.executePlan({
        ...params,
        onProgress: (progress) => {
          event.sender.send('plan-executor:progress', progress);
        }
      });
    });

    // Get plan status
    ipcRouter.handle('plan-executor:status', async (event, params) => {
      return this.getPlanStatus(params.planId);
    });

    // Cancel plan
    ipcRouter.handle('plan-executor:cancel', async (event, params) => {
      return await this.cancelPlan(params.planId);
    });

    // Get history
    ipcRouter.handle('plan-executor:history', async () => {
      return {
        success: true,
        history: this.planHistory.slice(-10).reverse()
      };
    });

    console.log('[PlanExecutor] IPC handlers registered');
  }
}

// Export singleton instance
module.exports = new PlanExecutor();
