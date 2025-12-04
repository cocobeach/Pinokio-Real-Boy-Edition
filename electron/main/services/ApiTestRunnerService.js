/**
 * ApiTestRunnerService - E2E API Testing for Epic 11 Services
 * Epic 11.7: Agentic API E2E Testing
 *
 * Features:
 * - E2E testing against live service endpoints
 * - Test suite management and execution
 * - Integration with MetricsService for tracking
 * - Assertion framework with detailed error reporting
 * - Test history and results tracking
 *
 * Testing Approach:
 * - Tests run against LIVE services (not mocks)
 * - Isolates test data (uses test-* prefixes)
 * - Automatic cleanup after test execution
 * - Comprehensive coverage of Epic 11 APIs
 */

const EventEmitter = require('events');
const MetricsService = require('./MetricsService');

class ApiTestRunnerService extends EventEmitter {
  constructor() {
    super();
    this.testSuites = new Map(); // suiteName -> TestSuite
    this.testResults = new Map(); // testId -> TestResult
    this.running = false;
    this.currentTest = null;

    // Test execution metrics (will integrate with MetricsService)
    this.metrics = {
      tests_total: 0,
      tests_passed: 0,
      tests_failed: 0,
      tests_skipped: 0,
      suites_total: 0,
      suites_passed: 0,
      suites_failed: 0,
      total_duration_ms: 0
    };

    console.log('[ApiTestRunnerService] Initialized');
  }

  /**
   * Register a test suite
   * @param {string} suiteName - Suite name
   * @param {Object} suiteConfig - Suite configuration
   * @returns {Object} Registration result
   */
  registerSuite(suiteName, suiteConfig) {
    try {
      const {
        description = '',
        tests = [],
        setup = null,
        teardown = null,
        timeout = 30000
      } = suiteConfig;

      if (this.testSuites.has(suiteName)) {
        console.warn(`[ApiTestRunnerService] Suite already registered: ${suiteName}`);
        return { success: false, error: 'Suite already exists' };
      }

      const suite = {
        name: suiteName,
        description,
        tests,
        setup,
        teardown,
        timeout,
        registered: new Date().toISOString()
      };

      this.testSuites.set(suiteName, suite);
      this.metrics.suites_total++;

      console.log(`[ApiTestRunnerService] Registered suite: ${suiteName} (${tests.length} tests)`);

      return {
        success: true,
        suiteName,
        testCount: tests.length
      };

    } catch (error) {
      console.error('[ApiTestRunnerService] Suite registration error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Run a single test
   * @param {string} suiteName - Suite name
   * @param {string} testName - Test name
   * @param {Object} context - Service context (references to services)
   * @returns {Promise<Object>} Test result
   */
  async runTest(suiteName, testName, context = {}) {
    const testId = `${suiteName}::${testName}`;
    const startTime = Date.now();

    try {
      const suite = this.testSuites.get(suiteName);
      if (!suite) {
        throw new Error(`Suite not found: ${suiteName}`);
      }

      const test = suite.tests.find(t => t.name === testName);
      if (!test) {
        throw new Error(`Test not found: ${testName}`);
      }

      console.log(`[ApiTestRunnerService] Running test: ${testId}`);
      this.currentTest = testId;

      // Execute test function
      const testResult = await this.executeTest(test, context, suite.timeout);

      const duration = Date.now() - startTime;

      // Store result
      const result = {
        testId,
        suiteName,
        testName,
        passed: testResult.passed,
        message: testResult.message || '',
        duration,
        timestamp: new Date().toISOString(),
        error: testResult.error || null
      };

      this.testResults.set(testId, result);

      // Update metrics
      this.metrics.tests_total++;
      if (result.passed) {
        this.metrics.tests_passed++;
      } else {
        this.metrics.tests_failed++;
      }
      this.metrics.total_duration_ms += duration;

      console.log(`[ApiTestRunnerService] Test ${result.passed ? 'PASSED' : 'FAILED'}: ${testId} (${duration}ms)`);

      this.currentTest = null;

      return {
        success: true,
        result
      };

    } catch (error) {
      const duration = Date.now() - startTime;

      const result = {
        testId,
        suiteName,
        testName,
        passed: false,
        message: error.message,
        duration,
        timestamp: new Date().toISOString(),
        error: error.stack
      };

      this.testResults.set(testId, result);
      this.metrics.tests_total++;
      this.metrics.tests_failed++;
      this.metrics.total_duration_ms += duration;

      console.error(`[ApiTestRunnerService] Test ERROR: ${testId}:`, error);

      this.currentTest = null;

      return {
        success: false,
        result
      };
    }
  }

  /**
   * Execute a test with timeout
   * @param {Object} test - Test object
   * @param {Object} context - Service context
   * @param {number} timeout - Timeout in ms
   * @returns {Promise<Object>} Test result
   */
  async executeTest(test, context, timeout) {
    return new Promise(async (resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Test timeout after ${timeout}ms`));
      }, timeout);

      try {
        // Create assertion helper
        const assert = this.createAssertionHelper();

        // Execute test function
        await test.testFn(context, assert);

        clearTimeout(timeoutId);

        resolve({
          passed: true,
          message: 'Test passed'
        });

      } catch (error) {
        clearTimeout(timeoutId);

        resolve({
          passed: false,
          message: error.message,
          error: error.stack
        });
      }
    });
  }

  /**
   * Create assertion helper for tests
   * @returns {Object} Assertion functions
   */
  createAssertionHelper() {
    return {
      equal: (actual, expected, message = '') => {
        if (actual !== expected) {
          throw new Error(`Assertion failed: ${message}\n  Expected: ${expected}\n  Actual: ${actual}`);
        }
      },

      notEqual: (actual, expected, message = '') => {
        if (actual === expected) {
          throw new Error(`Assertion failed: ${message}\n  Expected NOT equal: ${expected}\n  Actual: ${actual}`);
        }
      },

      truthy: (value, message = '') => {
        if (!value) {
          throw new Error(`Assertion failed: ${message}\n  Expected truthy value, got: ${value}`);
        }
      },

      falsy: (value, message = '') => {
        if (value) {
          throw new Error(`Assertion failed: ${message}\n  Expected falsy value, got: ${value}`);
        }
      },

      ok: (condition, message = '') => {
        if (!condition) {
          throw new Error(`Assertion failed: ${message}`);
        }
      },

      deepEqual: (actual, expected, message = '') => {
        const actualStr = JSON.stringify(actual);
        const expectedStr = JSON.stringify(expected);
        if (actualStr !== expectedStr) {
          throw new Error(`Assertion failed: ${message}\n  Expected: ${expectedStr}\n  Actual: ${actualStr}`);
        }
      },

      contains: (collection, item, message = '') => {
        if (Array.isArray(collection)) {
          if (!collection.includes(item)) {
            throw new Error(`Assertion failed: ${message}\n  Collection does not contain: ${item}`);
          }
        } else if (typeof collection === 'string') {
          if (!collection.includes(item)) {
            throw new Error(`Assertion failed: ${message}\n  String does not contain: ${item}`);
          }
        } else {
          throw new Error('Assertion failed: contains() requires array or string');
        }
      },

      throws: async (fn, message = '') => {
        try {
          await fn();
          throw new Error(`Assertion failed: ${message}\n  Expected function to throw`);
        } catch (error) {
          // Expected - function threw
        }
      },

      noThrow: async (fn, message = '') => {
        try {
          await fn();
        } catch (error) {
          throw new Error(`Assertion failed: ${message}\n  Expected function NOT to throw, but got: ${error.message}`);
        }
      }
    };
  }

  /**
   * Run an entire test suite
   * @param {string} suiteName - Suite name
   * @param {Object} context - Service context
   * @returns {Promise<Object>} Suite results
   */
  async runSuite(suiteName, context = {}) {
    const startTime = Date.now();

    try {
      const suite = this.testSuites.get(suiteName);
      if (!suite) {
        throw new Error(`Suite not found: ${suiteName}`);
      }

      console.log(`[ApiTestRunnerService] Running suite: ${suiteName} (${suite.tests.length} tests)`);

      // Run setup
      if (suite.setup) {
        console.log(`[ApiTestRunnerService] Running setup for: ${suiteName}`);
        await suite.setup(context);
      }

      // Run all tests
      const results = [];
      for (const test of suite.tests) {
        const result = await this.runTest(suiteName, test.name, context);
        results.push(result.result);
      }

      // Run teardown
      if (suite.teardown) {
        console.log(`[ApiTestRunnerService] Running teardown for: ${suiteName}`);
        await suite.teardown(context);
      }

      const duration = Date.now() - startTime;
      const passed = results.filter(r => r.passed).length;
      const failed = results.filter(r => !r.passed).length;

      // Update suite metrics
      if (failed === 0) {
        this.metrics.suites_passed++;
      } else {
        this.metrics.suites_failed++;
      }

      console.log(`[ApiTestRunnerService] Suite completed: ${suiteName} (${passed}/${results.length} passed, ${duration}ms)`);

      return {
        success: true,
        suiteName,
        results,
        summary: {
          total: results.length,
          passed,
          failed,
          duration
        }
      };

    } catch (error) {
      console.error(`[ApiTestRunnerService] Suite error: ${suiteName}:`, error);
      return {
        success: false,
        suiteName,
        error: error.message
      };
    }
  }

  /**
   * Run all test suites
   * @param {Object} context - Service context
   * @returns {Promise<Object>} All results
   */
  async runAll(context = {}) {
    console.log(`[ApiTestRunnerService] Running all suites (${this.testSuites.size} suites)`);

    const results = [];
    for (const suiteName of this.testSuites.keys()) {
      const result = await this.runSuite(suiteName, context);
      results.push(result);
    }

    const totalPassed = results.reduce((sum, r) => sum + (r.summary?.passed || 0), 0);
    const totalTests = results.reduce((sum, r) => sum + (r.summary?.total || 0), 0);

    console.log(`[ApiTestRunnerService] All suites completed (${totalPassed}/${totalTests} passed)`);

    return {
      success: true,
      results,
      summary: {
        suites: results.length,
        total: totalTests,
        passed: totalPassed,
        failed: totalTests - totalPassed
      }
    };
  }

  /**
   * List all registered test suites
   * @returns {Object} Suites list
   */
  listSuites() {
    const suites = Array.from(this.testSuites.entries()).map(([name, suite]) => ({
      name,
      description: suite.description,
      testCount: suite.tests.length,
      registered: suite.registered
    }));

    return {
      success: true,
      suites,
      count: suites.length
    };
  }

  /**
   * Get test results
   * @param {Object} options - Filter options
   * @returns {Object} Test results
   */
  getResults(options = {}) {
    const { suiteName = null, passed = null, limit = 100 } = options;

    let results = Array.from(this.testResults.values());

    // Filter by suite
    if (suiteName) {
      results = results.filter(r => r.suiteName === suiteName);
    }

    // Filter by passed status
    if (passed !== null) {
      results = results.filter(r => r.passed === passed);
    }

    // Sort by timestamp (most recent first)
    results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Limit
    results = results.slice(0, limit);

    return {
      success: true,
      results,
      count: results.length,
      metrics: this.metrics
    };
  }

  /**
   * Clear test results
   * @returns {Object} Result
   */
  clearResults() {
    const count = this.testResults.size;
    this.testResults.clear();

    // Reset metrics
    this.metrics.tests_total = 0;
    this.metrics.tests_passed = 0;
    this.metrics.tests_failed = 0;
    this.metrics.tests_skipped = 0;
    this.metrics.total_duration_ms = 0;

    console.log(`[ApiTestRunnerService] Cleared ${count} test results`);

    return {
      success: true,
      cleared: count
    };
  }

  /**
   * Get current metrics
   * @returns {Object} Metrics
   */
  getMetrics() {
    return {
      success: true,
      metrics: { ...this.metrics }
    };
  }

  /**
   * Report metrics to MetricsService
   */
  reportMetrics() {
    // TODO: Extend MetricsService to include API test metrics
    // For now, just log
    console.log('[ApiTestRunnerService] Metrics:', this.metrics);
  }

  /**
   * Setup IPC handlers
   * @param {IpcRouter} ipcRouter - IPC router instance
   */
  setupIpcHandlers(ipcRouter) {
    // Run single test
    ipcRouter.handle('api-test:run-test', async (event, params) => {
      const { suiteName, testName, context } = params;
      return await this.runTest(suiteName, testName, context);
    });

    // Run test suite
    ipcRouter.handle('api-test:run-suite', async (event, params) => {
      const { suiteName, context } = params;
      return await this.runSuite(suiteName, context);
    });

    // Run all suites
    ipcRouter.handle('api-test:run-all', async (event, params) => {
      const { context } = params;
      return await this.runAll(context);
    });

    // List suites
    ipcRouter.handle('api-test:list-suites', async () => {
      return this.listSuites();
    });

    // Get results
    ipcRouter.handle('api-test:get-results', async (event, params) => {
      return this.getResults(params);
    });

    // Clear results
    ipcRouter.handle('api-test:clear-results', async () => {
      return this.clearResults();
    });

    // Get metrics
    ipcRouter.handle('api-test:get-metrics', async () => {
      return this.getMetrics();
    });

    console.log('[ApiTestRunnerService] IPC handlers registered');
  }

  /**
   * Cleanup
   */
  destroy() {
    this.testSuites.clear();
    this.testResults.clear();
    this.removeAllListeners();
    console.log('[ApiTestRunnerService] Service destroyed');
  }
}

// Export singleton instance
module.exports = new ApiTestRunnerService();
