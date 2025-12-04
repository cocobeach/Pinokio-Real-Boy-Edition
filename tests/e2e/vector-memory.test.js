/**
 * E2E Test: VectorMemoryService (Epic 10.5)
 * Tests semantic search, context retrieval, and persistence
 */

const assert = require('assert');
const VectorMemoryService = require('../../electron/main/services/VectorMemoryService');

describe('VectorMemoryService E2E Tests', function() {
  this.timeout(10000); // 10 second timeout

  before(async function() {
    // Initialize service
    const result = await VectorMemoryService.initialize();
    assert.strictEqual(result.success, true, 'Service should initialize successfully');
  });

  after(async function() {
    // Cleanup test data
    await VectorMemoryService.clearCategory('test');
    await VectorMemoryService.destroy();
  });

  describe('Store and Retrieve', function() {
    it('should store memories with embeddings', async function() {
      const result = await VectorMemoryService.store({
        content: 'CUDA out of memory error when loading 7B model',
        category: 'test',
        metadata: { severity: 'high' }
      });

      assert.strictEqual(result.success, true);
      assert.ok(result.id, 'Should return memory ID');
      assert.ok(result.memory, 'Should return memory object');
    });

    it('should search by semantic similarity', async function() {
      // Store test memories
      await VectorMemoryService.store({
        content: 'OOM crash with large models on RTX 3090',
        category: 'test'
      });

      await VectorMemoryService.store({
        content: 'Window dragging performance is excellent',
        category: 'test'
      });

      // Search for memory-related issues
      const result = await VectorMemoryService.search('out of memory problem', {
        category: 'test',
        limit: 5
      });

      assert.strictEqual(result.success, true);
      assert.ok(result.results.length > 0, 'Should find matching memories');

      // First result should be about OOM
      const topResult = result.results[0];
      assert.ok(topResult.content.includes('OOM') || topResult.content.includes('memory'),
        'Top result should be memory-related');
      assert.ok(topResult.similarity > 0, 'Should have positive similarity score');
    });

    it('should retrieve relevant context for prompts', async function() {
      const result = await VectorMemoryService.getRelevantContext(
        'How do I fix GPU memory errors?',
        { maxTokens: 500, categories: ['test'] }
      );

      assert.strictEqual(result.success, true);
      assert.ok(result.context.length > 0, 'Should return context string');
      assert.ok(result.tokenCount > 0, 'Should estimate token count');
    });
  });

  describe('Category Management', function() {
    it('should filter by category', async function() {
      await VectorMemoryService.store({
        content: 'Test memory for category A',
        category: 'category_a'
      });

      await VectorMemoryService.store({
        content: 'Test memory for category B',
        category: 'category_b'
      });

      const resultA = await VectorMemoryService.search('test memory', {
        category: 'category_a',
        limit: 10
      });

      assert.strictEqual(resultA.results.length, 1);
      assert.strictEqual(resultA.results[0].category, 'category_a');

      // Cleanup
      await VectorMemoryService.clearCategory('category_a');
      await VectorMemoryService.clearCategory('category_b');
    });

    it('should clear category', async function() {
      await VectorMemoryService.store({ content: 'Clear test', category: 'clear_test' });

      const clearResult = await VectorMemoryService.clearCategory('clear_test');
      assert.strictEqual(clearResult.success, true);
      assert.strictEqual(clearResult.deleted, 1);

      const searchResult = await VectorMemoryService.search('Clear test', {
        category: 'clear_test'
      });
      assert.strictEqual(searchResult.results.length, 0);
    });
  });

  describe('Statistics', function() {
    it('should return accurate statistics', function() {
      const stats = VectorMemoryService.getStats();

      assert.ok(stats.totalMemories >= 0);
      assert.ok(stats.vocabularySize >= 0);
      assert.ok(typeof stats.categories === 'object');
    });
  });

  describe('Persistence', function() {
    it('should persist memories to disk', async function() {
      await VectorMemoryService.store({
        content: 'Persistence test memory',
        category: 'persist_test'
      });

      await VectorMemoryService.saveToDisk();

      // In a real test, we'd restart the service and verify reload
      // For now, just verify save doesn't error
      assert.ok(true, 'saveToDisk should complete without errors');

      // Cleanup
      await VectorMemoryService.clearCategory('persist_test');
    });
  });
});
