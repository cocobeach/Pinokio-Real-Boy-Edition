/**
 * E2E Test: PTY Session Persistence (Epic 10.2)
 * Tests terminal session save/restore functionality
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('PTY Persistence E2E Tests', function() {
  this.timeout(15000);

  const PTYController = require('../../electron/main/controllers/PTYController');
  const ConfigService = require('../../electron/main/services/ConfigService');

  const testConfigKey = 'pty_sessions_test';
  const homedir = os.homedir();
  const testSessionData = [
    {
      id: 'test-session-1',
      cwd: '/tmp/test1',
      shell: '/bin/bash',
      createdAt: new Date().toISOString()
    },
    {
      id: 'test-session-2',
      cwd: '/tmp/test2',
      shell: '/bin/zsh',
      createdAt: new Date().toISOString()
    }
  ];

  before(async function() {
    // Clear any existing test data
    await ConfigService.set(testConfigKey, null);
  });

  after(async function() {
    // Cleanup
    await ConfigService.set(testConfigKey, null);
  });

  describe('Session State Serialization', function() {
    it('should save session state', async function() {
      // Save test session data
      await ConfigService.set(testConfigKey, testSessionData);

      // Verify saved
      const saved = await ConfigService.get(testConfigKey);
      assert.ok(Array.isArray(saved), 'Should save as array');
      assert.strictEqual(saved.length, 2, 'Should save all sessions');
      assert.strictEqual(saved[0].id, 'test-session-1');
      assert.strictEqual(saved[1].id, 'test-session-2');
    });

    it('should restore session state', async function() {
      // Save sessions
      await ConfigService.set(testConfigKey, testSessionData);

      // Restore
      const restored = await ConfigService.get(testConfigKey);

      assert.ok(restored, 'Should restore sessions');
      assert.strictEqual(restored.length, 2);
      assert.strictEqual(restored[0].cwd, '/tmp/test1');
      assert.strictEqual(restored[1].shell, '/bin/zsh');
    });

    it('should handle missing session data gracefully', async function() {
      const missing = await ConfigService.get('non_existent_key');
      assert.strictEqual(missing, null, 'Should return null for missing key');
    });
  });

  describe('Session Metadata', function() {
    it('should preserve all session metadata', async function() {
      const session = testSessionData[0];

      await ConfigService.set(testConfigKey, [session]);
      const restored = await ConfigService.get(testConfigKey);

      const restoredSession = restored[0];
      assert.strictEqual(restoredSession.id, session.id);
      assert.strictEqual(restoredSession.cwd, session.cwd);
      assert.strictEqual(restoredSession.shell, session.shell);
      assert.strictEqual(restoredSession.createdAt, session.createdAt);
    });

    it('should handle sessions with different shells', async function() {
      const sessions = [
        { id: 's1', cwd: '/tmp', shell: '/bin/bash', createdAt: new Date().toISOString() },
        { id: 's2', cwd: '/tmp', shell: '/bin/zsh', createdAt: new Date().toISOString() },
        { id: 's3', cwd: '/tmp', shell: '/bin/fish', createdAt: new Date().toISOString() }
      ];

      await ConfigService.set(testConfigKey, sessions);
      const restored = await ConfigService.get(testConfigKey);

      assert.strictEqual(restored.length, 3);
      assert.strictEqual(restored[0].shell, '/bin/bash');
      assert.strictEqual(restored[1].shell, '/bin/zsh');
      assert.strictEqual(restored[2].shell, '/bin/fish');
    });
  });

  describe('Clear Functionality', function() {
    it('should clear saved sessions', async function() {
      await ConfigService.set(testConfigKey, testSessionData);

      // Verify saved
      let saved = await ConfigService.get(testConfigKey);
      assert.ok(saved, 'Sessions should be saved');

      // Clear
      await ConfigService.set(testConfigKey, null);

      // Verify cleared
      saved = await ConfigService.get(testConfigKey);
      assert.strictEqual(saved, null, 'Sessions should be cleared');
    });
  });

  describe('Edge Cases', function() {
    it('should handle empty session array', async function() {
      await ConfigService.set(testConfigKey, []);

      const restored = await ConfigService.get(testConfigKey);
      assert.ok(Array.isArray(restored));
      assert.strictEqual(restored.length, 0);
    });

    it('should handle sessions with special characters in paths', async function() {
      const specialSession = {
        id: 'special',
        cwd: '/tmp/my folder with spaces/subfolder',
        shell: '/bin/bash',
        createdAt: new Date().toISOString()
      };

      await ConfigService.set(testConfigKey, [specialSession]);
      const restored = await ConfigService.get(testConfigKey);

      assert.strictEqual(restored[0].cwd, specialSession.cwd);
    });
  });
});
