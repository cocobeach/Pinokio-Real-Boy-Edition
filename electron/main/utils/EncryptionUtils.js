/**
 * Encryption Utilities for Credential Broker
 * Epic 11.8: Agentic Credential Broker
 *
 * Provides AES-256-GCM encryption for secure token storage.
 * Uses machine-specific key derivation for defense-in-depth.
 *
 * Security Model:
 * - AES-256-GCM for authenticated encryption
 * - Machine ID + app secret for key derivation
 * - Random IV per encryption operation
 * - Base64 encoding for storage compatibility
 */

const crypto = require('crypto');
const os = require('os');

class EncryptionUtils {
  constructor() {
    // App secret (in production, this should be environment-specific)
    this.APP_SECRET = 'pinokio-credential-broker-v1-secret-key';
    this.ALGORITHM = 'aes-256-gcm';
    this.KEY_LENGTH = 32; // 256 bits
    this.IV_LENGTH = 16; // 128 bits
    this.AUTH_TAG_LENGTH = 16; // 128 bits

    // Derive encryption key from machine ID + app secret
    this.masterKey = this.deriveMasterKey();
  }

  /**
   * Derive master encryption key from machine-specific data
   * @returns {Buffer} Master key
   */
  deriveMasterKey() {
    // Get machine-specific identifier (hostname + platform + arch)
    const machineId = `${os.hostname()}-${os.platform()}-${os.arch()}`;

    // Derive key using PBKDF2 (Password-Based Key Derivation Function 2)
    const key = crypto.pbkdf2Sync(
      this.APP_SECRET,
      machineId,
      100000, // iterations
      this.KEY_LENGTH,
      'sha256'
    );

    return key;
  }

  /**
   * Encrypt plaintext data
   * @param {string} plaintext - Data to encrypt
   * @returns {string} Encrypted data (base64-encoded)
   */
  encrypt(plaintext) {
    try {
      // Generate random IV
      const iv = crypto.randomBytes(this.IV_LENGTH);

      // Create cipher
      const cipher = crypto.createCipheriv(this.ALGORITHM, this.masterKey, iv);

      // Encrypt data
      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      // Get authentication tag
      const authTag = cipher.getAuthTag();

      // Combine IV + authTag + encrypted data
      const combined = Buffer.concat([
        iv,
        authTag,
        Buffer.from(encrypted, 'hex')
      ]);

      // Return as base64 for storage
      return combined.toString('base64');

    } catch (error) {
      console.error('[EncryptionUtils] Encryption error:', error);
      throw new Error('Encryption failed');
    }
  }

  /**
   * Decrypt encrypted data
   * @param {string} encryptedData - Base64-encoded encrypted data
   * @returns {string} Decrypted plaintext
   */
  decrypt(encryptedData) {
    try {
      // Decode from base64
      const combined = Buffer.from(encryptedData, 'base64');

      // Extract IV, authTag, and encrypted data
      const iv = combined.slice(0, this.IV_LENGTH);
      const authTag = combined.slice(this.IV_LENGTH, this.IV_LENGTH + this.AUTH_TAG_LENGTH);
      const encrypted = combined.slice(this.IV_LENGTH + this.AUTH_TAG_LENGTH);

      // Create decipher
      const decipher = crypto.createDecipheriv(this.ALGORITHM, this.masterKey, iv);
      decipher.setAuthTag(authTag);

      // Decrypt data
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;

    } catch (error) {
      console.error('[EncryptionUtils] Decryption error:', error);
      throw new Error('Decryption failed (data may be corrupted or tampered)');
    }
  }

  /**
   * Hash data using SHA-256
   * @param {string} data - Data to hash
   * @returns {string} Hex-encoded hash
   */
  hash(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Generate random token
   * @param {number} length - Token length in bytes
   * @returns {string} Hex-encoded random token
   */
  generateToken(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }
}

// Export singleton instance
module.exports = new EncryptionUtils();
