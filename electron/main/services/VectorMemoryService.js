/**
 * VectorMemoryService - The Durable Mind's Memory
 * Epic 10.5: Vector-enabled context store for semantic search
 * Implements RAG-like retrieval to reduce prompt token usage
 *
 * Architecture:
 * - In-memory vector store with JSON persistence
 * - Simple TF-IDF embeddings for semantic similarity
 * - Cosine similarity search
 * - Category-based organization (debug, docs, todos)
 *
 * Future: Can be upgraded to SQLite + sqlite-vec for production
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

class VectorMemoryService {
  constructor() {
    this.memories = new Map();  // id -> memory object
    this.embeddings = new Map();  // id -> vector
    this.vocabulary = new Set();  // All unique terms
    this.idfScores = new Map();  // term -> IDF score
    this.initialized = false;

    // Storage path
    const homedir = os.homedir();
    this.storePath = path.join(homedir, 'pinokio', '.vector-memory.json');

    console.log('[VectorMemoryService] Initialized');
  }

  /**
   * Initialize the service and load persisted memories
   */
  async initialize() {
    if (this.initialized) {
      return { success: true };
    }

    try {
      await this.loadFromDisk();
      this.initialized = true;
      console.log(`[VectorMemoryService] Loaded ${this.memories.size} memories`);
      return { success: true, count: this.memories.size };
    } catch (error) {
      console.error('[VectorMemoryService] Initialization error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Tokenize and normalize text
   * @param {string} text - Input text
   * @returns {Array<string>} Normalized tokens
   */
  tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 2)  // Remove short tokens
      .filter(token => !this.isStopWord(token));
  }

  /**
   * Simple stop word filter
   * @param {string} word - Word to check
   * @returns {boolean} True if stop word
   */
  isStopWord(word) {
    const stopWords = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'was', 'were', 'are', 'has', 'have']);
    return stopWords.has(word);
  }

  /**
   * Calculate TF-IDF embedding for text
   * @param {string} text - Input text
   * @returns {Object} Vector representation { term: score }
   */
  createEmbedding(text) {
    const tokens = this.tokenize(text);
    const termFreq = new Map();

    // Calculate term frequency
    tokens.forEach(term => {
      termFreq.set(term, (termFreq.get(term) || 0) + 1);
      this.vocabulary.add(term);
    });

    // Create TF-IDF vector
    const vector = {};
    const docLength = tokens.length;

    termFreq.forEach((freq, term) => {
      const tf = freq / docLength;
      const idf = this.idfScores.get(term) || 1;
      vector[term] = tf * idf;
    });

    return vector;
  }

  /**
   * Update IDF scores based on all documents
   */
  updateIdfScores() {
    const totalDocs = this.memories.size;
    if (totalDocs === 0) return;

    // Count documents containing each term
    const docFreq = new Map();

    this.embeddings.forEach((vector) => {
      const terms = Object.keys(vector);
      terms.forEach(term => {
        docFreq.set(term, (docFreq.get(term) || 0) + 1);
      });
    });

    // Calculate IDF: log(N / df)
    docFreq.forEach((df, term) => {
      this.idfScores.set(term, Math.log(totalDocs / df));
    });
  }

  /**
   * Calculate cosine similarity between two vectors
   * @param {Object} vec1 - First vector
   * @param {Object} vec2 - Second vector
   * @returns {number} Similarity score (0-1)
   */
  cosineSimilarity(vec1, vec2) {
    let dotProduct = 0;
    let mag1 = 0;
    let mag2 = 0;

    // Get all unique terms
    const allTerms = new Set([...Object.keys(vec1), ...Object.keys(vec2)]);

    allTerms.forEach(term => {
      const v1 = vec1[term] || 0;
      const v2 = vec2[term] || 0;
      dotProduct += v1 * v2;
      mag1 += v1 * v1;
      mag2 += v2 * v2;
    });

    if (mag1 === 0 || mag2 === 0) return 0;
    return dotProduct / (Math.sqrt(mag1) * Math.sqrt(mag2));
  }

  /**
   * Store a memory with vector embedding
   * @param {Object} params - Memory parameters
   * @param {string} params.content - Memory content
   * @param {string} params.category - Category (debug, docs, todo, etc.)
   * @param {Object} params.metadata - Additional metadata
   * @returns {Object} Result with memory ID
   */
  async store(params) {
    const { content, category = 'general', metadata = {} } = params;

    if (!content || content.trim().length === 0) {
      return { success: false, error: 'Content is required' };
    }

    try {
      // Generate unique ID
      const id = crypto.randomBytes(16).toString('hex');

      // Create embedding
      const embedding = this.createEmbedding(content);

      // Store memory
      const memory = {
        id,
        content,
        category,
        metadata,
        timestamp: new Date().toISOString()
      };

      this.memories.set(id, memory);
      this.embeddings.set(id, embedding);

      // Update IDF scores
      this.updateIdfScores();

      // Persist to disk
      await this.saveToDisk();

      console.log(`[VectorMemoryService] Stored memory ${id} (category: ${category})`);
      return { success: true, id, memory };

    } catch (error) {
      console.error('[VectorMemoryService] Store error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Search for similar memories using semantic similarity
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @param {string} options.category - Filter by category
   * @param {number} options.limit - Max results (default: 5)
   * @param {number} options.threshold - Min similarity (default: 0.1)
   * @returns {Array} Matching memories with scores
   */
  async search(query, options = {}) {
    const { category = null, limit = 5, threshold = 0.1 } = options;

    if (!query || query.trim().length === 0) {
      return { success: false, error: 'Query is required' };
    }

    try {
      // Create query embedding
      const queryEmbedding = this.createEmbedding(query);

      // Calculate similarity with all memories
      const results = [];

      this.memories.forEach((memory, id) => {
        // Filter by category if specified
        if (category && memory.category !== category) {
          return;
        }

        const memoryEmbedding = this.embeddings.get(id);
        if (!memoryEmbedding) return;

        const similarity = this.cosineSimilarity(queryEmbedding, memoryEmbedding);

        if (similarity >= threshold) {
          results.push({
            ...memory,
            similarity
          });
        }
      });

      // Sort by similarity (descending)
      results.sort((a, b) => b.similarity - a.similarity);

      // Limit results
      const topResults = results.slice(0, limit);

      console.log(`[VectorMemoryService] Search for "${query}": found ${topResults.length} results`);

      return {
        success: true,
        results: topResults,
        count: topResults.length
      };

    } catch (error) {
      console.error('[VectorMemoryService] Search error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get relevant context for AI prompt
   * Reduces token usage by retrieving only relevant memories
   * @param {string} prompt - User's prompt
   * @param {Object} options - Context options
   * @returns {string} Concatenated relevant context
   */
  async getRelevantContext(prompt, options = {}) {
    const { maxTokens = 500, categories = ['debug', 'docs'] } = options;

    try {
      let context = '';
      let tokenCount = 0;

      // Search each category
      for (const category of categories) {
        const searchResult = await this.search(prompt, { category, limit: 3 });

        if (!searchResult.success) continue;

        for (const result of searchResult.results) {
          const snippet = `[${category.toUpperCase()}] ${result.content}\n\n`;
          const snippetTokens = Math.ceil(snippet.length / 4);  // Rough token estimate

          if (tokenCount + snippetTokens > maxTokens) {
            break;
          }

          context += snippet;
          tokenCount += snippetTokens;
        }

        if (tokenCount >= maxTokens) break;
      }

      return {
        success: true,
        context,
        tokenCount
      };

    } catch (error) {
      console.error('[VectorMemoryService] Context retrieval error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete a memory
   * @param {string} id - Memory ID
   */
  async delete(id) {
    if (!this.memories.has(id)) {
      return { success: false, error: 'Memory not found' };
    }

    this.memories.delete(id);
    this.embeddings.delete(id);

    // Update IDF scores
    this.updateIdfScores();

    await this.saveToDisk();

    return { success: true };
  }

  /**
   * Clear all memories in a category
   * @param {string} category - Category to clear
   */
  async clearCategory(category) {
    const toDelete = [];

    this.memories.forEach((memory, id) => {
      if (memory.category === category) {
        toDelete.push(id);
      }
    });

    toDelete.forEach(id => {
      this.memories.delete(id);
      this.embeddings.delete(id);
    });

    this.updateIdfScores();
    await this.saveToDisk();

    return { success: true, deleted: toDelete.length };
  }

  /**
   * Get statistics
   */
  getStats() {
    const categories = new Map();

    this.memories.forEach(memory => {
      const count = categories.get(memory.category) || 0;
      categories.set(memory.category, count + 1);
    });

    return {
      totalMemories: this.memories.size,
      vocabularySize: this.vocabulary.size,
      categories: Object.fromEntries(categories)
    };
  }

  /**
   * Save memories to disk
   */
  async saveToDisk() {
    try {
      const data = {
        memories: Array.from(this.memories.entries()),
        embeddings: Array.from(this.embeddings.entries()),
        vocabulary: Array.from(this.vocabulary),
        idfScores: Array.from(this.idfScores.entries())
      };

      const dirPath = path.dirname(this.storePath);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      fs.writeFileSync(this.storePath, JSON.stringify(data, null, 2));
      console.log('[VectorMemoryService] Saved to disk');

    } catch (error) {
      console.error('[VectorMemoryService] Save error:', error);
    }
  }

  /**
   * Load memories from disk
   */
  async loadFromDisk() {
    try {
      if (!fs.existsSync(this.storePath)) {
        console.log('[VectorMemoryService] No saved memories found');
        return;
      }

      const data = JSON.parse(fs.readFileSync(this.storePath, 'utf8'));

      this.memories = new Map(data.memories || []);
      this.embeddings = new Map(data.embeddings || []);
      this.vocabulary = new Set(data.vocabulary || []);
      this.idfScores = new Map(data.idfScores || []);

      console.log('[VectorMemoryService] Loaded from disk');

    } catch (error) {
      console.error('[VectorMemoryService] Load error:', error);
    }
  }

  /**
   * Setup IPC handlers
   */
  setupIpcHandlers(ipcRouter) {
    ipcRouter.handle('vector-memory:store', async (event, params) => {
      return await this.store(params);
    });

    ipcRouter.handle('vector-memory:search', async (event, params) => {
      return await this.search(params.query, params.options || {});
    });

    ipcRouter.handle('vector-memory:context', async (event, params) => {
      return await this.getRelevantContext(params.prompt, params.options || {});
    });

    ipcRouter.handle('vector-memory:delete', async (event, params) => {
      return await this.delete(params.id);
    });

    ipcRouter.handle('vector-memory:clear-category', async (event, params) => {
      return await this.clearCategory(params.category);
    });

    ipcRouter.handle('vector-memory:stats', async () => {
      return { success: true, stats: this.getStats() };
    });

    console.log('[VectorMemoryService] IPC handlers registered');
  }

  /**
   * Cleanup
   */
  async destroy() {
    await this.saveToDisk();
    this.memories.clear();
    this.embeddings.clear();
    this.vocabulary.clear();
    this.idfScores.clear();
    console.log('[VectorMemoryService] Destroyed');
  }
}

// Export singleton instance
module.exports = new VectorMemoryService();
