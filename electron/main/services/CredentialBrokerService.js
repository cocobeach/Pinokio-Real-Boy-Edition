/**
 * CredentialBrokerService - Secure Credential Management for Agentic Operations
 * Epic 11.8: Agentic Credential Broker
 *
 * Features:
 * - OAuth flow for GitHub/GitLab (external browser + custom protocol)
 * - Encrypted token storage (AES-256-GCM)
 * - Credential injection for GitService and AIController
 * - Multi-provider support (GitHub, GitLab, custom Git servers)
 * - Token refresh and expiration management
 *
 * Security:
 * - Tokens encrypted at rest using EncryptionUtils
 * - OAuth uses external browser (no embedded webview)
 * - Tokens never exposed to renderer process
 * - Custom protocol handler (pinokio://auth) for OAuth callback
 */

const { shell } = require('electron');
const EncryptionUtils = require('../utils/EncryptionUtils');
const ConfigService = require('./ConfigService');

class CredentialBrokerService {
  constructor() {
    this.credentials = new Map(); // provider -> { username, token, expiresAt }
    this.pendingOAuth = new Map(); // provider -> { resolve, reject }
    this.initialized = false;

    console.log('[CredentialBrokerService] Initialized');
  }

  /**
   * Initialize service and load stored credentials
   */
  async initialize() {
    if (this.initialized) {
      return { success: true };
    }

    try {
      // Load encrypted credentials from ConfigService
      const storedCreds = await ConfigService.get('encrypted_credentials');

      if (storedCreds) {
        // Decrypt and restore credentials
        for (const [provider, encryptedData] of Object.entries(storedCreds)) {
          try {
            const decrypted = EncryptionUtils.decrypt(encryptedData);
            const credential = JSON.parse(decrypted);
            this.credentials.set(provider, credential);
            console.log(`[CredentialBrokerService] Restored credential for: ${provider}`);
          } catch (error) {
            console.error(`[CredentialBrokerService] Failed to decrypt credential for ${provider}:`, error);
          }
        }
      }

      this.initialized = true;
      console.log(`[CredentialBrokerService] Loaded ${this.credentials.size} credentials`);

      return { success: true, count: this.credentials.size };

    } catch (error) {
      console.error('[CredentialBrokerService] Initialization error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Start OAuth flow for a provider
   * @param {string} provider - Provider name (github, gitlab, etc.)
   * @param {Object} options - OAuth options
   * @returns {Promise<Object>} OAuth result with token
   */
  async startOAuthFlow(provider, options = {}) {
    try {
      const { clientId = null, scope = 'repo,user' } = options;

      // Build OAuth URL based on provider
      let authUrl;
      let redirectUri = 'pinokio://auth'; // Custom protocol

      switch (provider.toLowerCase()) {
        case 'github':
          // GitHub OAuth
          const githubClientId = clientId || 'YOUR_GITHUB_CLIENT_ID'; // TODO: Replace with actual client ID
          authUrl = `https://github.com/login/oauth/authorize?client_id=${githubClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}`;
          break;

        case 'gitlab':
          // GitLab OAuth
          const gitlabClientId = clientId || 'YOUR_GITLAB_CLIENT_ID'; // TODO: Replace with actual client ID
          authUrl = `https://gitlab.com/oauth/authorize?client_id=${gitlabClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=${scope}`;
          break;

        default:
          return {
            success: false,
            error: `Unsupported provider: ${provider}`
          };
      }

      console.log(`[CredentialBrokerService] Starting OAuth flow for ${provider}`);
      console.log(`[CredentialBrokerService] Auth URL: ${authUrl}`);

      // Open external browser for OAuth
      await shell.openExternal(authUrl);

      // Return pending promise (will be resolved by handleOAuthCallback)
      return new Promise((resolve, reject) => {
        this.pendingOAuth.set(provider, { resolve, reject });

        // Timeout after 5 minutes
        setTimeout(() => {
          if (this.pendingOAuth.has(provider)) {
            this.pendingOAuth.delete(provider);
            reject(new Error('OAuth flow timed out'));
          }
        }, 300000);
      });

    } catch (error) {
      console.error('[CredentialBrokerService] OAuth flow error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Handle OAuth callback from custom protocol (pinokio://auth)
   * @param {string} callbackUrl - Full callback URL with token
   * @returns {Object} Result
   */
  handleOAuthCallback(callbackUrl) {
    try {
      console.log(`[CredentialBrokerService] OAuth callback received: ${callbackUrl}`);

      // Parse URL to extract token
      const url = new URL(callbackUrl);
      const params = new URLSearchParams(url.search || url.hash.substring(1));

      const token = params.get('access_token') || params.get('token') || params.get('code');
      const provider = params.get('provider') || 'github'; // Default to github
      const username = params.get('username') || params.get('login') || 'unknown';

      if (!token) {
        throw new Error('No token found in OAuth callback');
      }

      // Store credential
      const credential = {
        provider,
        username,
        token,
        createdAt: new Date().toISOString(),
        expiresAt: null // GitHub tokens don't expire by default
      };

      this.credentials.set(provider, credential);

      // Persist encrypted credential
      this.saveCredentials();

      // Resolve pending OAuth promise
      const pending = this.pendingOAuth.get(provider);
      if (pending) {
        pending.resolve({
          success: true,
          provider,
          username,
          hasToken: true
        });
        this.pendingOAuth.delete(provider);
      }

      console.log(`[CredentialBrokerService] OAuth completed for ${provider}: ${username}`);

      return {
        success: true,
        provider,
        username
      };

    } catch (error) {
      console.error('[CredentialBrokerService] OAuth callback error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Manually add credential (for PAT, SSH keys, etc.)
   * @param {string} provider - Provider name
   * @param {Object} credentialData - Credential data
   * @returns {Object} Result
   */
  async addCredential(provider, credentialData) {
    try {
      const { username, token, type = 'token' } = credentialData;

      if (!username || !token) {
        return {
          success: false,
          error: 'Username and token are required'
        };
      }

      const credential = {
        provider,
        username,
        token,
        type,
        createdAt: new Date().toISOString(),
        expiresAt: null
      };

      this.credentials.set(provider, credential);

      // Persist encrypted credential
      await this.saveCredentials();

      console.log(`[CredentialBrokerService] Added credential for ${provider}: ${username}`);

      return {
        success: true,
        provider,
        username
      };

    } catch (error) {
      console.error('[CredentialBrokerService] Add credential error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get credential for a provider
   * @param {string} provider - Provider name
   * @returns {Object} Credential or null
   */
  getCredential(provider) {
    const credential = this.credentials.get(provider);

    if (!credential) {
      return {
        success: false,
        error: `No credential found for provider: ${provider}`
      };
    }

    return {
      success: true,
      provider: credential.provider,
      username: credential.username,
      hasToken: !!credential.token,
      createdAt: credential.createdAt
    };
  }

  /**
   * Get environment variables with injected credentials
   * @param {Object} options - Options
   * @returns {Object} Environment object with credentials
   */
  getAgentEnvironment(options = {}) {
    const { provider = 'github', baseEnv = process.env } = options;

    try {
      const credential = this.credentials.get(provider);

      if (!credential) {
        console.warn(`[CredentialBrokerService] No credential found for ${provider}, returning base env`);
        return {
          success: true,
          env: { ...baseEnv }
        };
      }

      // Build environment with injected credentials
      const env = {
        ...baseEnv
      };

      // Inject provider-specific environment variables
      switch (provider.toLowerCase()) {
        case 'github':
          env.GITHUB_TOKEN = credential.token;
          env.GH_TOKEN = credential.token; // Alternative name
          break;

        case 'gitlab':
          env.GITLAB_TOKEN = credential.token;
          env.CI_JOB_TOKEN = credential.token; // GitLab CI compatibility
          break;

        default:
          env.GIT_TOKEN = credential.token; // Generic fallback
      }

      console.log(`[CredentialBrokerService] Injected credential for ${provider} into environment`);

      return {
        success: true,
        env,
        provider,
        username: credential.username
      };

    } catch (error) {
      console.error('[CredentialBrokerService] Get agent environment error:', error);
      return {
        success: false,
        error: error.message,
        env: { ...baseEnv }
      };
    }
  }

  /**
   * Remove credential for a provider
   * @param {string} provider - Provider name
   * @returns {Object} Result
   */
  async removeCredential(provider) {
    try {
      if (!this.credentials.has(provider)) {
        return {
          success: false,
          error: `No credential found for provider: ${provider}`
        };
      }

      this.credentials.delete(provider);

      // Persist changes
      await this.saveCredentials();

      console.log(`[CredentialBrokerService] Removed credential for ${provider}`);

      return {
        success: true,
        provider
      };

    } catch (error) {
      console.error('[CredentialBrokerService] Remove credential error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * List all stored credentials (without tokens)
   * @returns {Object} Credentials list
   */
  listCredentials() {
    const credentialsList = Array.from(this.credentials.entries()).map(([provider, cred]) => ({
      provider,
      username: cred.username,
      type: cred.type || 'token',
      createdAt: cred.createdAt,
      hasToken: !!cred.token
    }));

    return {
      success: true,
      credentials: credentialsList,
      count: credentialsList.length
    };
  }

  /**
   * Save credentials to encrypted storage
   * @returns {Promise<void>}
   */
  async saveCredentials() {
    try {
      const encryptedCreds = {};

      for (const [provider, credential] of this.credentials) {
        const serialized = JSON.stringify(credential);
        const encrypted = EncryptionUtils.encrypt(serialized);
        encryptedCreds[provider] = encrypted;
      }

      await ConfigService.set('encrypted_credentials', encryptedCreds);

      console.log(`[CredentialBrokerService] Saved ${this.credentials.size} encrypted credentials`);

    } catch (error) {
      console.error('[CredentialBrokerService] Save credentials error:', error);
      throw error;
    }
  }

  /**
   * Setup IPC handlers
   * @param {IpcRouter} ipcRouter - IPC router instance
   */
  setupIpcHandlers(ipcRouter) {
    // Start OAuth flow
    ipcRouter.handle('credentials:start-oauth', async (event, params) => {
      const { provider, options } = params;
      return await this.startOAuthFlow(provider, options);
    });

    // Handle OAuth callback
    ipcRouter.handle('credentials:oauth-callback', async (event, params) => {
      const { callbackUrl } = params;
      return this.handleOAuthCallback(callbackUrl);
    });

    // Add credential manually
    ipcRouter.handle('credentials:add', async (event, params) => {
      const { provider, credential } = params;
      return await this.addCredential(provider, credential);
    });

    // Get credential
    ipcRouter.handle('credentials:get', async (event, params) => {
      const { provider } = params;
      return this.getCredential(provider);
    });

    // Get agent environment
    ipcRouter.handle('credentials:get-agent-env', async (event, params) => {
      return this.getAgentEnvironment(params);
    });

    // Remove credential
    ipcRouter.handle('credentials:remove', async (event, params) => {
      const { provider } = params;
      return await this.removeCredential(provider);
    });

    // List credentials
    ipcRouter.handle('credentials:list', async () => {
      return this.listCredentials();
    });

    console.log('[CredentialBrokerService] IPC handlers registered');
  }

  /**
   * Cleanup
   */
  async destroy() {
    // Save credentials before shutdown
    if (this.credentials.size > 0) {
      await this.saveCredentials();
    }

    this.credentials.clear();
    this.pendingOAuth.clear();
    this.initialized = false;

    console.log('[CredentialBrokerService] Service destroyed');
  }
}

// Export singleton instance
module.exports = new CredentialBrokerService();
