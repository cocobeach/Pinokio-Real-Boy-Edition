/**
 * GitService - The Agentic Version Control
 * Epic 7: Native Git operations for AI-assisted development workflow
 * Enables Fork → Edit → Commit → Push cycle from within Pinokio UI
 */

const simpleGit = require('simple-git');
const path = require('path');
const fs = require('fs');
const os = require('os');

class GitService {
  constructor() {
    this.activeRepos = new Map(); // Cache git instances by app name
  }

  /**
   * Get the absolute path to an app's repository
   * @param {string} appName - Name of the installed app
   * @returns {string} Absolute path to app directory
   */
  getRepoPath(appName) {
    const homedir = os.homedir();
    return path.join(homedir, 'pinokio', 'api', appName);
  }

  /**
   * Get or create a git instance for an app
   * @param {string} appName - Name of the installed app
   * @returns {SimpleGit} Simple-git instance
   */
  getGitInstance(appName) {
    if (!this.activeRepos.has(appName)) {
      const repoPath = this.getRepoPath(appName);
      const git = simpleGit(repoPath);
      this.activeRepos.set(appName, git);
    }
    return this.activeRepos.get(appName);
  }

  /**
   * Check if a directory is a git repository
   * @param {string} appName - Name of the installed app
   * @returns {Promise<boolean>} True if it's a git repo
   */
  async isGitRepo(appName) {
    try {
      const repoPath = this.getRepoPath(appName);
      if (!fs.existsSync(repoPath)) {
        return false;
      }

      const git = this.getGitInstance(appName);
      const isRepo = await git.checkIsRepo();
      return isRepo;
    } catch (error) {
      console.error(`[GitService] Error checking if ${appName} is a repo:`, error);
      return false;
    }
  }

  /**
   * Get the current status of the repository
   * Story 7.1: Status Polling
   * @param {string} appName - Name of the installed app
   * @returns {Promise<Object>} Git status with modified, staged, untracked files
   */
  async getStatus(appName) {
    try {
      const isRepo = await this.isGitRepo(appName);
      if (!isRepo) {
        return {
          success: false,
          error: 'Not a git repository',
          isRepo: false
        };
      }

      const git = this.getGitInstance(appName);
      const status = await git.status();

      return {
        success: true,
        isRepo: true,
        current: status.current,
        tracking: status.tracking,
        ahead: status.ahead,
        behind: status.behind,
        modified: status.modified,
        created: status.created,
        deleted: status.deleted,
        renamed: status.renamed,
        staged: status.staged,
        conflicted: status.conflicted,
        isClean: status.isClean(),
        files: status.files
      };
    } catch (error) {
      console.error(`[GitService] Error getting status for ${appName}:`, error);
      return {
        success: false,
        error: error.message,
        isRepo: true
      };
    }
  }

  /**
   * Get the diff for current changes
   * @param {string} appName - Name of the installed app
   * @param {string} file - Optional specific file to diff
   * @returns {Promise<Object>} Diff result
   */
  async getDiff(appName, file = null) {
    try {
      const isRepo = await this.isGitRepo(appName);
      if (!isRepo) {
        return {
          success: false,
          error: 'Not a git repository'
        };
      }

      const git = this.getGitInstance(appName);
      const diff = file ? await git.diff([file]) : await git.diff();

      return {
        success: true,
        diff
      };
    } catch (error) {
      console.error(`[GitService] Error getting diff for ${appName}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Stage files for commit
   * @param {string} appName - Name of the installed app
   * @param {string[]} files - Array of file paths to stage (or ['.'] for all)
   * @returns {Promise<Object>} Stage result
   */
  async stageFiles(appName, files = ['.']) {
    try {
      const isRepo = await this.isGitRepo(appName);
      if (!isRepo) {
        return {
          success: false,
          error: 'Not a git repository'
        };
      }

      const git = this.getGitInstance(appName);
      await git.add(files);

      console.log(`[GitService] Staged ${files.length} file(s) in ${appName}`);

      return {
        success: true,
        staged: files
      };
    } catch (error) {
      console.error(`[GitService] Error staging files in ${appName}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Commit staged changes
   * Story 7.3: The Agentic Commit Workflow
   * @param {string} appName - Name of the installed app
   * @param {string} message - Commit message
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Commit result
   */
  async commitChanges(appName, message, options = {}) {
    try {
      const isRepo = await this.isGitRepo(appName);
      if (!isRepo) {
        return {
          success: false,
          error: 'Not a git repository'
        };
      }

      const git = this.getGitInstance(appName);

      // Get status before commit
      const statusBefore = await git.status();
      if (statusBefore.isClean()) {
        return {
          success: false,
          error: 'No changes to commit',
          isClean: true
        };
      }

      // Stage all changes if requested
      if (options.stageAll) {
        await git.add('.');
      }

      // Commit
      const result = await git.commit(message);

      console.log(`[GitService] Committed changes in ${appName}:`, result.commit);

      return {
        success: true,
        commit: result.commit,
        summary: result.summary,
        branch: result.branch,
        message
      };
    } catch (error) {
      console.error(`[GitService] Error committing changes in ${appName}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * AI-assisted commit message generation
   * Story 7.3: Uses AIController to draft semantic commit messages
   * @param {string} appName - Name of the installed app
   * @param {Array} changedFiles - List of changed files from status
   * @returns {Promise<string>} AI-generated commit message
   */
  async promptAIForCommit(appName, changedFiles) {
    try {
      const AIController = require('../controllers/AIController');

      // Check if AI is available
      const aiStatus = AIController.getStatus();
      if (!aiStatus.running) {
        console.warn('[GitService] AI not available for commit message generation');
        return 'Update files'; // Fallback generic message
      }

      // Get diff for context
      const diffResult = await this.getDiff(appName);
      const diff = diffResult.success ? diffResult.diff : '';

      // Build AI prompt for commit message generation
      const prompt = `You are a Git commit message expert. Analyze the following changes and generate a concise, conventional commit message.

Changed Files:
${changedFiles.map(f => `- ${f}`).join('\n')}

Diff Preview (first 2000 chars):
${diff.slice(0, 2000)}

Guidelines:
1. Use conventional commits format: <type>(<scope>): <description>
2. Types: feat, fix, docs, style, refactor, test, chore
3. Keep description under 50 characters
4. Focus on WHAT changed and WHY (not HOW)
5. Use imperative mood ("add" not "added")

Examples:
- feat(auth): add OAuth2 login support
- fix(api): resolve null pointer in user endpoint
- refactor(ui): extract button component
- docs(readme): update installation instructions

Generate ONE commit message (just the message, no explanation):`;

      const aiResponse = await AIController.askAI(prompt, {
        task: 'commit_message',
        appName
      });

      if (!aiResponse.success) {
        console.error('[GitService] AI commit message generation failed:', aiResponse.error);
        return 'Update files'; // Fallback
      }

      // Clean up AI response (remove quotes, newlines, etc.)
      let message = aiResponse.response.trim();
      message = message.replace(/^["']|["']$/g, ''); // Remove quotes
      message = message.split('\n')[0]; // Take first line only
      message = message.trim();

      console.log('[GitService] AI-generated commit message:', message);

      return message;
    } catch (error) {
      console.error('[GitService] Error generating AI commit message:', error);
      return 'Update files'; // Fallback
    }
  }

  /**
   * Get commit history
   * @param {string} appName - Name of the installed app
   * @param {number} maxCount - Maximum number of commits to retrieve
   * @returns {Promise<Object>} Commit history
   */
  async getLog(appName, maxCount = 10) {
    try {
      const isRepo = await this.isGitRepo(appName);
      if (!isRepo) {
        return {
          success: false,
          error: 'Not a git repository'
        };
      }

      const git = this.getGitInstance(appName);
      const log = await git.log({ maxCount });

      return {
        success: true,
        commits: log.all.map(commit => ({
          hash: commit.hash,
          date: commit.date,
          message: commit.message,
          author: commit.author_name
        }))
      };
    } catch (error) {
      console.error(`[GitService] Error getting log for ${appName}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Push changes to remote
   * @param {string} appName - Name of the installed app
   * @param {string} remote - Remote name (default: 'origin')
   * @param {string} branch - Branch name (default: current branch)
   * @returns {Promise<Object>} Push result
   */
  async push(appName, remote = 'origin', branch = null) {
    try {
      const isRepo = await this.isGitRepo(appName);
      if (!isRepo) {
        return {
          success: false,
          error: 'Not a git repository'
        };
      }

      const git = this.getGitInstance(appName);

      // Get current branch if not specified
      if (!branch) {
        const status = await git.status();
        branch = status.current;
      }

      const result = await git.push(remote, branch);

      console.log(`[GitService] Pushed ${appName} to ${remote}/${branch}`);

      return {
        success: true,
        remote,
        branch,
        result
      };
    } catch (error) {
      console.error(`[GitService] Error pushing ${appName}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Setup IPC handlers
   * @param {IpcRouter} ipcRouter - IPC router instance
   */
  setupIpcHandlers(ipcRouter) {
    // Git status
    ipcRouter.handle('git:status', async (event, params) => {
      // Support direct path or default to api root if no appName
      if (params.path || !params.appName) {
        const targetPath = params.path || path.join(os.homedir(), 'pinokio', 'api');

        try {
          // Check if path exists
          if (!fs.existsSync(targetPath)) {
            return { success: false, error: 'Path not found' };
          }

          // Check if it's a git repository
          const git = simpleGit(targetPath);
          const isRepo = await git.checkIsRepo();

          if (!isRepo) {
            return { success: false, error: 'Not a git repository' };
          }

          // Get git status
          const status = await git.status();

          return {
            success: true,
            isRepo: true,
            status: {
              branch: status.current,
              staged: status.staged,
              modified: status.modified,
              untracked: status.not_added,
              isClean: status.isClean()
            }
          };
        } catch (error) {
          console.error('[GitService] Error getting status for path:', error);
          return { success: false, error: error.message };
        }
      }

      // Original behavior: use appName
      return await this.getStatus(params.appName);
    });

    // Git diff
    ipcRouter.handle('git:diff', async (event, params) => {
      return await this.getDiff(params.appName, params.file);
    });

    // Stage files
    ipcRouter.handle('git:stage', async (event, params) => {
      return await this.stageFiles(params.appName, params.files);
    });

    // Commit changes
    ipcRouter.handle('git:commit', async (event, params) => {
      return await this.commitChanges(params.appName, params.message, params.options);
    });

    // AI commit message generation
    ipcRouter.handle('git:ai-commit-message', async (event, params) => {
      const message = await this.promptAIForCommit(params.appName, params.changedFiles);
      return { success: true, message };
    });

    // Get commit log
    ipcRouter.handle('git:log', async (event, params) => {
      return await this.getLog(params.appName, params.maxCount);
    });

    // Push to remote
    ipcRouter.handle('git:push', async (event, params) => {
      return await this.push(params.appName, params.remote, params.branch);
    });

    // Check if git repo
    ipcRouter.handle('git:is-repo', async (event, params) => {
      const isRepo = await this.isGitRepo(params.appName);
      return { success: true, isRepo };
    });

    console.log('[GitService] IPC handlers registered');
  }

  /**
   * Cleanup on shutdown
   */
  destroy() {
    this.activeRepos.clear();
    console.log('[GitService] Service destroyed');
  }
}

// Export singleton instance
module.exports = new GitService();
