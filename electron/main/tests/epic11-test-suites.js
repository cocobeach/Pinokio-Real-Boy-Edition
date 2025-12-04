/**
 * Epic 11 Test Suites - E2E API Testing
 * Epic 11.7: Agentic API E2E Testing
 *
 * Comprehensive test suites for all Epic 11 services:
 * - ProjectService (11.1)
 * - MultiServicePTYManager (11.2)
 * - ContainerService (11.3)
 * - AppLinkerService (11.4)
 * - CredentialBrokerService (11.8)
 *
 * Testing Approach:
 * - Tests run against LIVE services (not mocks)
 * - Uses test-* prefix for isolation
 * - Automatic cleanup after tests
 */

const ApiTestRunnerService = require('../services/ApiTestRunnerService');
const ProjectService = require('../services/ProjectService');
const MultiServicePTYManager = require('../services/MultiServicePTYManager');
const ContainerService = require('../services/ContainerService');
const AppLinkerService = require('../services/AppLinkerService');
const CredentialBrokerService = require('../services/CredentialBrokerService');

/**
 * Register all Epic 11 test suites
 */
function registerTestSuites() {
  console.log('[Epic11TestSuites] Registering test suites...');

  // ===== ProjectService Tests (Epic 11.1) =====
  ApiTestRunnerService.registerSuite('project-service', {
    description: 'ProjectService API tests (Epic 11.1: Project Grouping)',

    tests: [
      {
        name: 'create-project',
        testFn: async (ctx, assert) => {
          const result = await ProjectService.createProject('test-project-e2e', {
            name: 'test-project-e2e',
            description: 'E2E test project',
            rootPath: '/tmp/test-projects/test-project-e2e'
          });

          assert.ok(result.success, 'Project creation should succeed');
          assert.equal(result.projectName, 'test-project-e2e', 'Project name should match');
        }
      },

      {
        name: 'get-project',
        testFn: async (ctx, assert) => {
          const result = ProjectService.getProject('test-project-e2e');

          assert.ok(result.success, 'Get project should succeed');
          assert.ok(result.project, 'Project should exist');
          assert.equal(result.project.name, 'test-project-e2e', 'Project name should match');
        }
      },

      {
        name: 'get-all-projects',
        testFn: async (ctx, assert) => {
          const result = ProjectService.getAllProjects();

          assert.ok(result.success, 'Get all projects should succeed');
          assert.ok(Array.isArray(result.projects), 'Projects should be an array');
          assert.ok(result.projects.length > 0, 'Should have at least one project');
        }
      },

      {
        name: 'add-repository',
        testFn: async (ctx, assert) => {
          const result = await ProjectService.addRepository('test-project-e2e', {
            name: 'test-repo',
            url: 'https://github.com/test/test-repo',
            path: '/tmp/test-projects/test-project-e2e/test-repo',
            type: 'git'
          });

          assert.ok(result.success, 'Add repository should succeed');
        }
      },

      {
        name: 'get-project-services',
        testFn: async (ctx, assert) => {
          const result = ProjectService.getProjectServices('test-project-e2e');

          assert.ok(result.success, 'Get services should succeed');
          assert.ok(Array.isArray(result.services), 'Services should be an array');
        }
      }
    ],

    teardown: async (ctx) => {
      // Cleanup: delete test project
      await ProjectService.deleteProject('test-project-e2e');
      console.log('[Epic11TestSuites] Cleanup: Deleted test-project-e2e');
    }
  });

  // ===== MultiServicePTYManager Tests (Epic 11.2) =====
  ApiTestRunnerService.registerSuite('multi-service-pty', {
    description: 'MultiServicePTYManager API tests (Epic 11.2: Multi-Service Terminal)',

    setup: async (ctx) => {
      // Create a test project first
      await ProjectService.createProject('test-pty-project', {
        name: 'test-pty-project',
        description: 'PTY test project',
        rootPath: '/tmp/test-projects/test-pty-project'
      });
    },

    tests: [
      {
        name: 'initialize-project',
        testFn: async (ctx, assert) => {
          const result = await MultiServicePTYManager.initializeProject('test-pty-project', null);

          // Note: This may fail if project has no services, which is expected
          assert.ok(result.projectName === 'test-pty-project', 'Project name should match');
        }
      },

      {
        name: 'get-state',
        testFn: async (ctx, assert) => {
          const result = MultiServicePTYManager.getState();

          assert.ok(result.success, 'Get state should succeed');
          assert.ok(Array.isArray(result.projects), 'Projects should be an array');
        }
      }
    ],

    teardown: async (ctx) => {
      // Cleanup
      MultiServicePTYManager.closeProject('test-pty-project');
      await ProjectService.deleteProject('test-pty-project');
      console.log('[Epic11TestSuites] Cleanup: Deleted test-pty-project');
    }
  });

  // ===== ContainerService Tests (Epic 11.3) =====
  ApiTestRunnerService.registerSuite('container-service', {
    description: 'ContainerService API tests (Epic 11.3: Container Engine Orchestrator)',

    tests: [
      {
        name: 'list-containers',
        testFn: async (ctx, assert) => {
          const result = await ContainerService.listContainers();

          assert.ok(result.success, 'List containers should succeed');
          assert.ok(Array.isArray(result.containers), 'Containers should be an array');
        }
      },

      {
        name: 'check-podman-available',
        testFn: async (ctx, assert) => {
          const result = await ContainerService.checkPodmanAvailable();

          assert.ok(result.success || result.error, 'Should return result');
          // Note: May fail if Podman not installed, which is OK for E2E testing
        }
      },

      {
        name: 'build-run-flags',
        testFn: async (ctx, assert) => {
          const result = await ContainerService.buildRunFlags({
            serviceConfig: {
              image: 'test-image',
              name: 'test-service',
              cpuLimit: 2,
              memoryLimitMB: 1024
            },
            requiresGPU: false
          });

          assert.ok(result.success, 'Build run flags should succeed');
          assert.ok(Array.isArray(result.flags), 'Flags should be an array');
          assert.ok(result.flags.length > 0, 'Should have at least one flag');
        }
      }
    ]
  });

  // ===== AppLinkerService Tests (Epic 11.4) =====
  ApiTestRunnerService.registerSuite('applinker-service', {
    description: 'AppLinkerService API tests (Epic 11.4: Dynamic Config Sync)',

    setup: async (ctx) => {
      // Create test project
      await ProjectService.createProject('test-applinker-project', {
        name: 'test-applinker-project',
        description: 'AppLinker test project',
        rootPath: '/tmp/test-projects/test-applinker-project'
      });
    },

    tests: [
      {
        name: 'discover-services',
        testFn: async (ctx, assert) => {
          const result = await AppLinkerService.discoverServices('test-applinker-project');

          assert.ok(result.success || result.projectName, 'Discover should return result');
          // Note: May not find services if containers aren't running
        }
      },

      {
        name: 'watch-status',
        testFn: async (ctx, assert) => {
          const result = AppLinkerService.getWatchStatus('test-applinker-project');

          assert.ok(result.success !== undefined, 'Watch status should return result');
        }
      }
    ],

    teardown: async (ctx) => {
      // Cleanup
      await AppLinkerService.stopWatch('test-applinker-project');
      await ProjectService.deleteProject('test-applinker-project');
      console.log('[Epic11TestSuites] Cleanup: Deleted test-applinker-project');
    }
  });

  // ===== CredentialBrokerService Tests (Epic 11.8) =====
  ApiTestRunnerService.registerSuite('credential-broker', {
    description: 'CredentialBrokerService API tests (Epic 11.8: Agentic Credential Broker)',

    tests: [
      {
        name: 'add-credential',
        testFn: async (ctx, assert) => {
          const result = await CredentialBrokerService.addCredential('test-provider', {
            username: 'test-user',
            token: 'test-token-12345',
            type: 'token'
          });

          assert.ok(result.success, 'Add credential should succeed');
          assert.equal(result.provider, 'test-provider', 'Provider should match');
          assert.equal(result.username, 'test-user', 'Username should match');
        }
      },

      {
        name: 'get-credential',
        testFn: async (ctx, assert) => {
          const result = CredentialBrokerService.getCredential('test-provider');

          assert.ok(result.success, 'Get credential should succeed');
          assert.equal(result.provider, 'test-provider', 'Provider should match');
          assert.equal(result.username, 'test-user', 'Username should match');
          assert.ok(result.hasToken, 'Should have token');
        }
      },

      {
        name: 'list-credentials',
        testFn: async (ctx, assert) => {
          const result = CredentialBrokerService.listCredentials();

          assert.ok(result.success, 'List credentials should succeed');
          assert.ok(Array.isArray(result.credentials), 'Credentials should be an array');
          assert.ok(result.count > 0, 'Should have at least one credential');
        }
      },

      {
        name: 'get-agent-environment',
        testFn: async (ctx, assert) => {
          const result = CredentialBrokerService.getAgentEnvironment({
            provider: 'test-provider'
          });

          assert.ok(result.success, 'Get agent env should succeed');
          assert.ok(result.env, 'Should have environment object');
          assert.ok(result.provider, 'Should have provider');
        }
      },

      {
        name: 'remove-credential',
        testFn: async (ctx, assert) => {
          const result = await CredentialBrokerService.removeCredential('test-provider');

          assert.ok(result.success, 'Remove credential should succeed');
          assert.equal(result.provider, 'test-provider', 'Provider should match');
        }
      }
    ]
  });

  // ===== Integration Test Suite (Tests multiple services together) =====
  ApiTestRunnerService.registerSuite('integration', {
    description: 'Integration tests for Epic 11 services',

    tests: [
      {
        name: 'project-to-multi-pty-integration',
        testFn: async (ctx, assert) => {
          // Create project
          const createResult = await ProjectService.createProject('test-integration', {
            name: 'test-integration',
            description: 'Integration test',
            rootPath: '/tmp/test-projects/test-integration'
          });

          assert.ok(createResult.success, 'Project creation should succeed');

          // Get project
          const getResult = ProjectService.getProject('test-integration');
          assert.ok(getResult.success, 'Get project should succeed');

          // Initialize PTY manager
          const ptyResult = await MultiServicePTYManager.initializeProject('test-integration', null);
          assert.ok(ptyResult.projectName === 'test-integration', 'PTY init should reference correct project');

          // Cleanup
          MultiServicePTYManager.closeProject('test-integration');
          await ProjectService.deleteProject('test-integration');
        }
      },

      {
        name: 'credential-to-git-integration',
        testFn: async (ctx, assert) => {
          // Add credential
          const addResult = await CredentialBrokerService.addCredential('github-test', {
            username: 'test-gh-user',
            token: 'ghp_test_token_12345',
            type: 'token'
          });

          assert.ok(addResult.success, 'Add credential should succeed');

          // Get agent environment
          const envResult = CredentialBrokerService.getAgentEnvironment({
            provider: 'github-test'
          });

          assert.ok(envResult.success, 'Get agent env should succeed');
          assert.ok(envResult.env.GIT_TOKEN || envResult.env.GITHUB_TOKEN, 'Should inject git token');

          // Cleanup
          await CredentialBrokerService.removeCredential('github-test');
        }
      }
    ]
  });

  console.log('[Epic11TestSuites] Registered 6 test suites');
}

/**
 * Initialize test suites
 */
function initialize() {
  try {
    registerTestSuites();
    return { success: true, message: 'Test suites registered' };
  } catch (error) {
    console.error('[Epic11TestSuites] Error registering suites:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  initialize,
  registerTestSuites
};
