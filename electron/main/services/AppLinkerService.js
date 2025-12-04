/**
 * AppLinkerService - Dynamic Inter-Service Configuration Sync
 * Epic 11.4: AppLinker (The Configuration Bridge)
 *
 * Solves the dynamic wiring problem: Infrastructure services (Redis, Postgres, Ollama)
 * expose dynamic ports/IPs that application services (katechon3) need to discover.
 *
 * Features:
 * - Service discovery via `podman inspect` (queries ContainerService)
 * - Dynamic config injection to .env files
 * - Watch mode: auto-sync on container restart
 * - Dependency validation: ensure services are running
 * - Project Manifest integration: reads link definitions from pinokio.project.json
 *
 * Architecture:
 * - Reads link mappings from ProjectService (Epic 11.1)
 * - Queries container state from ContainerService (Epic 11.3)
 * - Writes .env files to dependent repositories
 * - Monitors container events for automatic re-sync
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ProjectService = require('./ProjectService');
const ContainerService = require('./ContainerService');

class AppLinkerService {
  constructor() {
    this.watchedProjects = new Map(); // projectName -> watchInfo
    this.syncedConfigs = new Map(); // projectName -> { target -> config }
    this.watchProcesses = new Map(); // projectName -> childProcess

    console.log('[AppLinkerService] Initialized');
  }

  /**
   * Discover services for a project
   * @param {string} projectName - Project name
   * @returns {Promise<Object>} Discovery result
   */
  async discoverServices(projectName) {
    try {
      console.log(`[AppLinkerService] Discovering services for project: ${projectName}`);

      // Get project
      const projectResult = ProjectService.getProject(projectName);
      if (!projectResult.success) {
        return {
          success: false,
          error: `Project not found: ${projectName}`
        };
      }

      const project = projectResult.project;
      const discovered = {};

      // Get all services from project
      const servicesResult = ProjectService.getProjectServices(projectName);
      if (!servicesResult.success) {
        return {
          success: false,
          error: 'Failed to get project services'
        };
      }

      const services = servicesResult.services;

      // Discover each service's runtime info
      for (const service of services) {
        const serviceName = `${service.repository}/${service.name}`;
        const containerName = `pinokio-${projectName}-${serviceName.replace(/\//g, '-')}`;

        // Query container via podman inspect
        const containerInfo = await this.inspectContainer(containerName);

        if (containerInfo.success) {
          discovered[serviceName] = {
            serviceName,
            containerName,
            host: containerInfo.host || 'localhost',
            ports: containerInfo.ports || {},
            running: containerInfo.running,
            ipAddress: containerInfo.ipAddress
          };

          console.log(`[AppLinkerService] Discovered: ${serviceName} - ${JSON.stringify(discovered[serviceName])}`);
        } else {
          console.warn(`[AppLinkerService] Service not running: ${serviceName}`);
          discovered[serviceName] = {
            serviceName,
            containerName,
            running: false
          };
        }
      }

      return {
        success: true,
        projectName,
        discovered
      };

    } catch (error) {
      console.error('[AppLinkerService] Error discovering services:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Inspect a container to get ports and IP
   * @param {string} containerName - Container name
   * @returns {Promise<Object>} Container info
   */
  async inspectContainer(containerName) {
    try {
      // Use podman inspect to get container details
      const command = ['podman', 'inspect', containerName, '--format', 'json'];

      const result = await this.executeCommand(command);

      if (!result.success) {
        return {
          success: false,
          running: false
        };
      }

      const inspectData = JSON.parse(result.stdout);
      if (!inspectData || inspectData.length === 0) {
        return {
          success: false,
          running: false
        };
      }

      const container = inspectData[0];
      const running = container.State?.Running || false;
      const ipAddress = container.NetworkSettings?.IPAddress || null;

      // Extract port mappings
      const ports = {};
      const portBindings = container.HostConfig?.PortBindings || {};

      for (const [containerPort, hostBindings] of Object.entries(portBindings)) {
        if (hostBindings && hostBindings.length > 0) {
          const hostPort = hostBindings[0].HostPort;
          const portNumber = parseInt(containerPort.split('/')[0]);
          ports[portNumber] = parseInt(hostPort);
        }
      }

      return {
        success: true,
        running,
        host: 'localhost',
        ipAddress,
        ports,
        containerName
      };

    } catch (error) {
      console.error('[AppLinkerService] Error inspecting container:', error);
      return {
        success: false,
        running: false,
        error: error.message
      };
    }
  }

  /**
   * Sync project environment
   * @param {string} projectName - Project name
   * @returns {Promise<Object>} Sync result
   */
  async syncProjectEnv(projectName) {
    try {
      console.log(`[AppLinkerService] Syncing environment for project: ${projectName}`);

      // Get project
      const projectResult = ProjectService.getProject(projectName);
      if (!projectResult.success) {
        return {
          success: false,
          error: `Project not found: ${projectName}`
        };
      }

      const project = projectResult.project;

      // Discover running services
      const discoveryResult = await this.discoverServices(projectName);
      if (!discoveryResult.success) {
        return {
          success: false,
          error: 'Service discovery failed'
        };
      }

      const discovered = discoveryResult.discovered;

      // Process link definitions from manifest
      const links = project.links || [];
      const syncResults = [];

      for (const link of links) {
        const { source, target, mapping } = link;

        // Get source service info
        const sourceService = discovered[source];
        if (!sourceService || !sourceService.running) {
          console.warn(`[AppLinkerService] Source service not running: ${source}`);
          syncResults.push({
            source,
            target,
            success: false,
            error: 'Source service not running'
          });
          continue;
        }

        // Build environment variables from mapping
        const envVars = {};
        for (const [sourceProperty, targetEnvVar] of Object.entries(mapping)) {
          let value;

          switch (sourceProperty.toLowerCase()) {
            case 'host':
              value = sourceService.host;
              break;

            case 'port':
              // Use first available port
              const portKeys = Object.keys(sourceService.ports);
              if (portKeys.length > 0) {
                value = sourceService.ports[parseInt(portKeys[0])];
              }
              break;

            case 'ip':
            case 'ipaddress':
              value = sourceService.ipAddress || sourceService.host;
              break;

            default:
              // Try to match specific port (e.g., "port:6379")
              if (sourceProperty.startsWith('port:')) {
                const portNum = parseInt(sourceProperty.split(':')[1]);
                value = sourceService.ports[portNum];
              }
          }

          if (value !== undefined && value !== null) {
            envVars[targetEnvVar] = value.toString();
          }
        }

        // Find target repository path
        const targetRepo = project.repositories.find(r => r.name === target);
        if (!targetRepo) {
          console.warn(`[AppLinkerService] Target repository not found: ${target}`);
          syncResults.push({
            source,
            target,
            success: false,
            error: 'Target repository not found'
          });
          continue;
        }

        // Write to target's .env file
        const writeResult = await this.updateEnvFile(targetRepo.path, envVars);

        syncResults.push({
          source,
          target,
          success: writeResult.success,
          envVars,
          error: writeResult.error
        });

        console.log(`[AppLinkerService] Synced ${source} → ${target}: ${JSON.stringify(envVars)}`);
      }

      // Store synced configs
      this.syncedConfigs.set(projectName, syncResults);

      return {
        success: true,
        projectName,
        syncResults
      };

    } catch (error) {
      console.error('[AppLinkerService] Error syncing project env:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Update .env file with new variables
   * @param {string} repoPath - Repository path
   * @param {Object} envVars - Environment variables to set
   * @returns {Promise<Object>} Update result
   */
  async updateEnvFile(repoPath, envVars) {
    try {
      const envFilePath = path.join(repoPath, '.env');

      // Read existing .env file
      let existingEnv = {};
      if (fs.existsSync(envFilePath)) {
        const content = fs.readFileSync(envFilePath, 'utf-8');
        existingEnv = this.parseEnvFile(content);
      }

      // Merge with new variables (new values take precedence)
      const mergedEnv = { ...existingEnv, ...envVars };

      // Write back to .env file
      const envContent = Object.entries(mergedEnv)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n') + '\n';

      fs.writeFileSync(envFilePath, envContent, 'utf-8');

      console.log(`[AppLinkerService] Updated .env file: ${envFilePath}`);

      return {
        success: true,
        envFilePath,
        updatedVars: Object.keys(envVars)
      };

    } catch (error) {
      console.error('[AppLinkerService] Error updating .env file:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Parse .env file content
   * @param {string} content - File content
   * @returns {Object} Parsed environment variables
   */
  parseEnvFile(content) {
    const env = {};
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key) {
          env[key.trim()] = valueParts.join('=').trim();
        }
      }
    }

    return env;
  }

  /**
   * Start watch mode for a project
   * @param {string} projectName - Project name
   * @returns {Promise<Object>} Watch result
   */
  async startWatch(projectName) {
    try {
      console.log(`[AppLinkerService] Starting watch mode for project: ${projectName}`);

      // Perform initial sync
      const initialSync = await this.syncProjectEnv(projectName);
      if (!initialSync.success) {
        return {
          success: false,
          error: 'Initial sync failed'
        };
      }

      // Start watching container events
      const command = ['podman', 'events', '--filter', `label=project=${projectName}`, '--format', 'json'];
      const proc = spawn(command[0], command.slice(1), {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      proc.stdout.on('data', async (data) => {
        try {
          const event = JSON.parse(data.toString());

          // Re-sync on container start/restart events
          if (event.Type === 'container' && (event.Status === 'start' || event.Status === 'restart')) {
            console.log(`[AppLinkerService] Container event detected: ${event.Status} - Re-syncing...`);
            await this.syncProjectEnv(projectName);
          }
        } catch (error) {
          console.error('[AppLinkerService] Error processing event:', error);
        }
      });

      proc.on('close', () => {
        console.log(`[AppLinkerService] Watch mode stopped for project: ${projectName}`);
        this.watchProcesses.delete(projectName);
      });

      // Store watch process
      this.watchProcesses.set(projectName, proc);
      this.watchedProjects.set(projectName, {
        startedAt: new Date().toISOString(),
        active: true
      });

      console.log(`[AppLinkerService] Watch mode started for project: ${projectName}`);

      return {
        success: true,
        projectName,
        watching: true
      };

    } catch (error) {
      console.error('[AppLinkerService] Error starting watch mode:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Stop watch mode for a project
   * @param {string} projectName - Project name
   * @returns {Object} Result
   */
  stopWatch(projectName) {
    try {
      const proc = this.watchProcesses.get(projectName);
      if (proc) {
        proc.kill();
        this.watchProcesses.delete(projectName);
        this.watchedProjects.delete(projectName);

        console.log(`[AppLinkerService] Watch mode stopped for project: ${projectName}`);

        return {
          success: true,
          projectName
        };
      } else {
        return {
          success: false,
          error: 'Watch mode not active for this project'
        };
      }

    } catch (error) {
      console.error('[AppLinkerService] Error stopping watch mode:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get watch status for a project
   * @param {string} projectName - Project name
   * @returns {Object} Status
   */
  getWatchStatus(projectName) {
    const watchInfo = this.watchedProjects.get(projectName);

    if (!watchInfo) {
      return {
        success: true,
        watching: false
      };
    }

    return {
      success: true,
      watching: true,
      ...watchInfo
    };
  }

  /**
   * Execute command
   * @param {Array} command - Command array
   * @returns {Promise<Object>} Execution result
   */
  executeCommand(command) {
    return new Promise((resolve) => {
      const proc = spawn(command[0], command.slice(1), {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({
            success: true,
            stdout: stdout.trim(),
            stderr: stderr.trim()
          });
        } else {
          resolve({
            success: false,
            error: stderr.trim() || stdout.trim(),
            code
          });
        }
      });

      proc.on('error', (error) => {
        resolve({
          success: false,
          error: error.message
        });
      });
    });
  }

  /**
   * Setup IPC handlers
   * @param {IpcRouter} ipcRouter - IPC router instance
   */
  setupIpcHandlers(ipcRouter) {
    // Discover services
    ipcRouter.handle('applinker:discover', async (event, params) => {
      const { projectName } = params;
      return await this.discoverServices(projectName);
    });

    // Sync environment
    ipcRouter.handle('applinker:sync', async (event, params) => {
      const { projectName } = params;
      return await this.syncProjectEnv(projectName);
    });

    // Start watch mode
    ipcRouter.handle('applinker:watch-start', async (event, params) => {
      const { projectName } = params;
      return await this.startWatch(projectName);
    });

    // Stop watch mode
    ipcRouter.handle('applinker:watch-stop', async (event, params) => {
      const { projectName } = params;
      return this.stopWatch(projectName);
    });

    // Get watch status
    ipcRouter.handle('applinker:watch-status', async (event, params) => {
      const { projectName } = params;
      return this.getWatchStatus(projectName);
    });

    console.log('[AppLinkerService] IPC handlers registered');
  }

  /**
   * Cleanup
   */
  async destroy() {
    // Stop all watch processes
    for (const [projectName, proc] of this.watchProcesses) {
      proc.kill();
      console.log(`[AppLinkerService] Stopped watch for project: ${projectName}`);
    }

    this.watchProcesses.clear();
    this.watchedProjects.clear();
    this.syncedConfigs.clear();

    console.log('[AppLinkerService] Service destroyed');
  }
}

// Export singleton instance
module.exports = new AppLinkerService();
