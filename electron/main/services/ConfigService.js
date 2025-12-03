/**
 * ConfigService - Centralized configuration management
 * Provides access to app configuration and persistent storage
 */

const Store = require('electron-store');
const path = require('path');

class ConfigService {
  constructor() {
    // Initialize electron-store
    this.store = new Store();

    // Load package.json for version info
    const packageJson = require(path.join(__dirname, '../../../package.json'));

    // Configuration object
    this.config = {
      // URLs
      newsfeed: (gitRemote) => {
        return `https://pinokiocomputer.github.io/home/item?uri=${gitRemote}&display=feed`;
      },
      profile: (gitRemote) => {
        return `https://pinokiocomputer.github.io/home/item?uri=${gitRemote}&display=profile`;
      },
      site: "https://pinokiocomputer.github.io/home",
      discover_dark: "https://pinokiocomputer.github.io/home/app?theme=dark",
      discover_light: "https://pinokiocomputer.github.io/home/app",
      portal: "https://pinokiocomputer.github.io/home/portal",
      docs: "https://pinokiocomputer.github.io/program.pinokio.computer",
      install: "https://pinokiocomputer.github.io/program.pinokio.computer/#/?id=install",

      // App metadata
      agent: "electron",
      version: packageJson.version,

      // Store instance
      store: this.store
    };
  }

  /**
   * Get configuration value
   * @param {string} key - Configuration key
   * @returns {*} Configuration value
   */
  get(key) {
    return this.config[key];
  }

  /**
   * Get all configuration
   * @returns {Object} Complete configuration object
   */
  getAll() {
    return this.config;
  }

  /**
   * Get persistent store value
   * @param {string} key - Store key
   * @param {*} defaultValue - Default value if key doesn't exist
   * @returns {*} Stored value
   */
  getStoreValue(key, defaultValue) {
    return this.store.get(key, defaultValue);
  }

  /**
   * Set persistent store value
   * @param {string} key - Store key
   * @param {*} value - Value to store
   */
  setStoreValue(key, value) {
    this.store.set(key, value);
  }

  /**
   * Delete persistent store value
   * @param {string} key - Store key
   */
  deleteStoreValue(key) {
    this.store.delete(key);
  }

  /**
   * Clear all stored values
   */
  clearStore() {
    this.store.clear();
  }

  /**
   * Get the electron-store instance (for backward compatibility)
   * @returns {Store} electron-store instance
   */
  getStore() {
    return this.store;
  }

  // =========================================================================
  // Epic 8: The Awakened Mind - AI Provider & Mode Configuration
  // =========================================================================

  /**
   * Get AI provider preferences
   * @returns {Object} Provider preferences
   */
  getAIProviderPreferences() {
    return this.store.get('ai.providers', {
      ollama: {
        enabled: true,
        quota: Infinity,
        priority: 3  // Lower number = higher priority for debugging
      },
      claude: {
        enabled: true,
        quota: 200,
        resetInterval: 5 * 60 * 60 * 1000,  // 5 hours
        priority: 1  // Highest priority for developing
      },
      gemini: {
        enabled: true,
        quota: 1000,
        resetInterval: 24 * 60 * 60 * 1000,  // 24 hours
        priority: 2  // High priority for planning
      }
    });
  }

  /**
   * Set AI provider preferences
   * @param {Object} preferences - Provider preferences
   */
  setAIProviderPreferences(preferences) {
    this.store.set('ai.providers', preferences);
    console.log('[ConfigService] AI provider preferences updated');
  }

  /**
   * Update single provider preference
   * @param {string} provider - Provider name (ollama, claude, gemini)
   * @param {Object} settings - Settings to update
   */
  updateProviderSettings(provider, settings) {
    const current = this.getAIProviderPreferences();
    current[provider] = { ...current[provider], ...settings };
    this.setAIProviderPreferences(current);
  }

  /**
   * Get mode-based routing preferences
   * @returns {Object} Mode preferences
   */
  getModePreferences() {
    return this.store.get('ai.modes', {
      planning: {
        providers: ['gemini', 'claude', 'ollama'],
        description: 'High-volume planning tasks'
      },
      developing: {
        providers: ['claude', 'gemini', 'ollama'],
        description: 'Precision code generation'
      },
      debugging: {
        providers: ['ollama', 'gemini', 'claude'],
        description: 'Error analysis (prefer free/local)'
      }
    });
  }

  /**
   * Set mode preferences
   * @param {Object} preferences - Mode preferences
   */
  setModePreferences(preferences) {
    this.store.set('ai.modes', preferences);
    console.log('[ConfigService] Mode preferences updated');
  }

  /**
   * Update single mode preference
   * @param {string} mode - Mode name (planning, developing, debugging)
   * @param {string[]} providers - Ordered list of providers
   */
  updateModePreference(mode, providers) {
    const current = this.getModePreferences();
    if (current[mode]) {
      current[mode].providers = providers;
      this.setModePreferences(current);
    }
  }

  /**
   * Get GAN refinement settings
   * @returns {Object} GAN settings
   */
  getGANSettings() {
    return this.store.get('ai.gan', {
      enabled: true,
      rounds: 2,  // 2-3 iterations recommended
      architectModel: 'claude',
      critiqueModel: 'gemini',
      skipForDebug: true  // Don't use GAN for debugging (speed)
    });
  }

  /**
   * Set GAN refinement settings
   * @param {Object} settings - GAN settings
   */
  setGANSettings(settings) {
    this.store.set('ai.gan', settings);
    console.log('[ConfigService] GAN settings updated');
  }

  /**
   * Get quota thresholds and alerts
   * @returns {Object} Quota settings
   */
  getQuotaSettings() {
    return this.store.get('ai.quota', {
      warnThreshold: 0.8,  // Warn at 80% usage
      trackingEnabled: true,
      notifyOnReset: false  // Don't spam notifications
    });
  }

  /**
   * Set quota settings
   * @param {Object} settings - Quota settings
   */
  setQuotaSettings(settings) {
    this.store.set('ai.quota', settings);
    console.log('[ConfigService] Quota settings updated');
  }

  /**
   * Get hardware monitoring preferences
   * @returns {Object} Hardware settings
   */
  getHardwareSettings() {
    return this.store.get('hardware', {
      cacheLifetime: 5000,  // 5 seconds cache for nvidia-smi
      autoDetect: true,
      showGPUStats: true
    });
  }

  /**
   * Set hardware monitoring preferences
   * @param {Object} settings - Hardware settings
   */
  setHardwareSettings(settings) {
    this.store.set('hardware', settings);
    console.log('[ConfigService] Hardware settings updated');
  }

  /**
   * Get Epic 8 complete configuration
   * @returns {Object} All Epic 8 settings
   */
  getEpic8Config() {
    return {
      providers: this.getAIProviderPreferences(),
      modes: this.getModePreferences(),
      gan: this.getGANSettings(),
      quota: this.getQuotaSettings(),
      hardware: this.getHardwareSettings()
    };
  }

  /**
   * Reset Epic 8 configuration to defaults
   */
  resetEpic8Config() {
    this.store.delete('ai.providers');
    this.store.delete('ai.modes');
    this.store.delete('ai.gan');
    this.store.delete('ai.quota');
    this.store.delete('hardware');
    console.log('[ConfigService] Epic 8 configuration reset to defaults');
  }
}

// Export singleton instance
module.exports = new ConfigService();
