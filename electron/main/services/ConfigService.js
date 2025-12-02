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
}

// Export singleton instance
module.exports = new ConfigService();
