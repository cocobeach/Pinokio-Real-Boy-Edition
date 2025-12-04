/**
 * ContainerService - Podman CLI Orchestration with GPU Optimization
 * Epic 11.3: Container Engine Orchestrator
 *
 * Features:
 * - Podman CLI wrapper (rootless mode)
 * - GPU optimization integration (Epic 10.7 HardwareService)
 * - Project-based orchestration (Epic 11.1 ProjectService)
 * - Log streaming to MultiServicePTYManager (Epic 11.2)
 * - Container lifecycle management (start, stop, restart, remove)
 * - Health checks and status monitoring
 *
 * Architecture:
 * - Uses child_process.spawn for Podman commands
 * - Applies gpu-bench.md findings for optimal GPU allocation
 * - Integrates with existing BMAD services
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const HardwareService = require('./HardwareService');
const ProjectService = require('./ProjectService');
const MultiServicePTYManager = require('./MultiServicePTYManager');

class ContainerService {
  constructor() {
    this.containers = new Map(); // containerName -> containerInfo
    this.runningProcesses = new Map(); // containerName -> childProcess
    this.podmanCommand = 'podman'; // Can be overridden for testing

    console.log('[ContainerService] Initialized');
  }

  /**
   * Launch all services in a project
   * @param {string} projectName - Project name from ProjectService
   * @returns {Promise<Object>} Launch result
   */
  async launchProject(projectName) {
    try {
      console.log(`[ContainerService] Launching project: ${projectName}`);

      // Get project from ProjectService
      const projectResult = ProjectService.getProject(projectName);
      if (!projectResult.success) {
        return {
          success: false,
          error: `Project not found: ${projectName}`
        };
      }

      const project = projectResult.project;

      // Get all services
      const servicesResult = ProjectService.getProjectServices(projectName);
      if (!servicesResult.success) {
        return {
          success: false,
          error: 'Failed to get project services'
        };
      }

      const services = servicesResult.services;
      const results = [];

      // Launch services in dependency order
      // TODO: Implement proper dependency graph resolution
      for (const service of services) {
        const serviceName = `${service.repository}/${service.name}`;

        // Check if service requires container orchestration
        if (service.type === 'container' || service.type === 'compose') {
          const result = await this.launchService(projectName, serviceName, service);
          results.push(result);
        }
      }

      console.log(`[ContainerService] Launched ${results.length} services for project: ${projectName}`);

      return {
        success: true,
        projectName,
        results
      };

    } catch (error) {
      console.error('[ContainerService] Error launching project:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Launch a single service
   * @param {string} projectName - Project name
   * @param {string} serviceName - Service name (repo/service format)
   * @param {Object} serviceConfig - Service configuration from manifest
   * @returns {Promise<Object>} Launch result
   */
  async launchService(projectName, serviceName, serviceConfig) {
    try {
      console.log(`[ContainerService] Launching service: ${serviceName}`);

      // Build container name
      const containerName = `pinokio-${projectName}-${serviceName.replace(/\//g, '-')}`;

      // Check if container already running
      const existingStatus = await this.getContainerStatus(containerName);
      if (existingStatus && existingStatus.running) {
        console.log(`[ContainerService] Container already running: ${containerName}`);
        return {
          success: true,
          containerName,
          status: 'already_running'
        };
      }

      // Determine if service requires GPU
      const requiresGPU = serviceConfig.resources?.gpu || false;
      const gpuMemoryGB = serviceConfig.resources?.gpuMemoryGB || 7;

      // Build Podman run flags
      const flags = await this.buildRunFlags({
        containerName,
        serviceConfig,
        requiresGPU,
        gpuMemoryGB
      });

      // Build command
      const image = serviceConfig.image || `${serviceName}:latest`; // Default to service name as image
      const command = [this.podmanCommand, 'run', '-d', '--name', containerName, ...flags, image];

      console.log(`[ContainerService] Executing: ${command.join(' ')}`);

      // Launch container
      const launchResult = await this.executeCommand(command);

      if (!launchResult.success) {
        return {
          success: false,
          error: launchResult.error,
          containerName
        };
      }

      // Store container info
      this.containers.set(containerName, {
        projectName,
        serviceName,
        containerName,
        image,
        startedAt: new Date().toISOString(),
        config: serviceConfig
      });

      // Attach MultiServicePTYManager to PTYController
      // This allows MultiServicePTYManager to track PTY sessions
      const ptySessionId = `container-${containerName}`;
      MultiServicePTYManager.attachPTYSession(projectName, serviceName, ptySessionId);

      // Start log streaming
      this.startLogStreaming(projectName, serviceName, containerName);

      console.log(`[ContainerService] Successfully launched: ${containerName}`);

      return {
        success: true,
        containerName,
        serviceName,
        status: 'running'
      };

    } catch (error) {
      console.error('[ContainerService] Error launching service:', error);
      return {
        success: false,
        error: error.message,
        serviceName
      };
    }
  }

  /**
   * Build Podman run flags with GPU optimization
   * @param {Object} options - Build options
   * @returns {Promise<Array>} Flags array
   */
  async buildRunFlags(options) {
    const { serviceConfig, requiresGPU, gpuMemoryGB } = options;
    const flags = [];

    // CPU and memory limits
    const cpuLimit = serviceConfig.resources?.cpuLimit || 8;
    const memoryLimitMB = serviceConfig.resources?.memoryLimitMB || 16384;

    flags.push('--cpus', cpuLimit.toString());
    flags.push('--memory', `${memoryLimitMB}m`);

    // GPU optimization (integrate with Epic 10.7)
    if (requiresGPU) {
      const allocation = await HardwareService.calculateVRAMAllocation({
        modelSizeGB: gpuMemoryGB,
        safetyMargin: 0.8
      });

      if (allocation.success && allocation.useGPU) {
        // GPU available - apply optimized flags (from gpu-bench.md)
        flags.push('--device', `nvidia.com/gpu=${allocation.selectedGPU}`);
        flags.push('--security-opt=label=disable'); // Required for rootless Podman

        // Inject PyTorch CUDA env vars (Epic 10.7)
        const pytorchEnv = HardwareService.generatePyTorchEnv(allocation);
        if (pytorchEnv.PYTORCH_CUDA_ALLOC_CONF) {
          flags.push('-e', `PYTORCH_CUDA_ALLOC_CONF=${pytorchEnv.PYTORCH_CUDA_ALLOC_CONF}`);
        }

        console.log(`[ContainerService] GPU allocated: GPU ${allocation.selectedGPU}, VRAM: ${allocation.allocatedVRAM}MB`);

      } else {
        // CPU fallback (insufficient VRAM)
        console.warn(`[ContainerService] GPU unavailable, falling back to CPU: ${allocation.reason || allocation.error}`);
        flags.push('-e', 'CUDA_VISIBLE_DEVICES=-1'); // Force CPU-only
      }
    }

    // Port mappings
    if (serviceConfig.ports && Array.isArray(serviceConfig.ports)) {
      serviceConfig.ports.forEach(port => {
        flags.push('-p', `${port}:${port}`);
      });
    }

    // Environment variables
    if (serviceConfig.environment) {
      Object.entries(serviceConfig.environment).forEach(([key, value]) => {
        flags.push('-e', `${key}=${value}`);
      });
    }

    // Restart policy
    flags.push('--restart', 'unless-stopped');

    return flags;
  }

  /**
   * Execute Podman command
   * @param {Array} command - Command array [podman, arg1, arg2, ...]
   * @returns {Promise<Object>} Execution result
   */
  executeCommand(command) {
    return new Promise((resolve, reject) => {
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
            error: stderr.trim() || stdout.trim() || `Command exited with code ${code}`,
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
   * Start log streaming to MultiServicePTYManager
   * @param {string} projectName - Project name
   * @param {string} serviceName - Service name
   * @param {string} containerName - Container name
   */
  startLogStreaming(projectName, serviceName, containerName) {
    try {
      const command = [this.podmanCommand, 'logs', '-f', containerName];
      const proc = spawn(command[0], command.slice(1), {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      // Stream stdout to MultiServicePTYManager
      proc.stdout.on('data', (data) => {
        MultiServicePTYManager.appendLog(projectName, serviceName, data.toString());
      });

      // Stream stderr to MultiServicePTYManager
      proc.stderr.on('data', (data) => {
        MultiServicePTYManager.appendLog(projectName, serviceName, `[stderr] ${data.toString()}`);
      });

      proc.on('close', () => {
        console.log(`[ContainerService] Log streaming stopped for: ${containerName}`);
      });

      // Store process for cleanup
      this.runningProcesses.set(containerName, proc);

      console.log(`[ContainerService] Started log streaming for: ${containerName}`);

    } catch (error) {
      console.error('[ContainerService] Error starting log streaming:', error);
    }
  }

  /**
   * Stop a service
   * @param {string} containerName - Container name
   * @returns {Promise<Object>} Result
   */
  async stopService(containerName) {
    try {
      console.log(`[ContainerService] Stopping service: ${containerName}`);

      const command = [this.podmanCommand, 'stop', containerName];
      const result = await this.executeCommand(command);

      if (result.success) {
        // Stop log streaming
        const proc = this.runningProcesses.get(containerName);
        if (proc) {
          proc.kill();
          this.runningProcesses.delete(containerName);
        }
      }

      return result;

    } catch (error) {
      console.error('[ContainerService] Error stopping service:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Restart a service
   * @param {string} containerName - Container name
   * @returns {Promise<Object>} Result
   */
  async restartService(containerName) {
    try {
      console.log(`[ContainerService] Restarting service: ${containerName}`);

      const command = [this.podmanCommand, 'restart', containerName];
      return await this.executeCommand(command);

    } catch (error) {
      console.error('[ContainerService] Error restarting service:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Remove a service
   * @param {string} containerName - Container name
   * @returns {Promise<Object>} Result
   */
  async removeService(containerName) {
    try {
      console.log(`[ContainerService] Removing service: ${containerName}`);

      // Stop first
      await this.stopService(containerName);

      // Remove
      const command = [this.podmanCommand, 'rm', containerName];
      const result = await this.executeCommand(command);

      if (result.success) {
        this.containers.delete(containerName);
      }

      return result;

    } catch (error) {
      console.error('[ContainerService] Error removing service:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get container status
   * @param {string} containerName - Container name
   * @returns {Promise<Object>} Status object
   */
  async getContainerStatus(containerName) {
    try {
      const command = [this.podmanCommand, 'inspect', containerName, '--format', '{{.State.Running}}'];
      const result = await this.executeCommand(command);

      if (!result.success) {
        return {
          exists: false,
          running: false
        };
      }

      const running = result.stdout.trim() === 'true';

      return {
        exists: true,
        running,
        containerName
      };

    } catch (error) {
      console.error('[ContainerService] Error getting container status:', error);
      return {
        exists: false,
        running: false,
        error: error.message
      };
    }
  }

  /**
   * Get logs for a container
   * @param {string} containerName - Container name
   * @param {Object} options - Log options
   * @returns {Promise<Object>} Logs result
   */
  async getLogs(containerName, options = {}) {
    try {
      const { tail = 500 } = options;

      const command = [this.podmanCommand, 'logs', '--tail', tail.toString(), containerName];
      const result = await this.executeCommand(command);

      if (!result.success) {
        return {
          success: false,
          error: result.error
        };
      }

      return {
        success: true,
        logs: result.stdout.split('\n'),
        containerName
      };

    } catch (error) {
      console.error('[ContainerService] Error getting logs:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * List all containers
   * @returns {Promise<Object>} Container list
   */
  async listContainers() {
    try {
      const command = [this.podmanCommand, 'ps', '-a', '--format', 'json'];
      const result = await this.executeCommand(command);

      if (!result.success) {
        return {
          success: false,
          error: result.error
        };
      }

      const containers = JSON.parse(result.stdout || '[]');

      return {
        success: true,
        containers
      };

    } catch (error) {
      console.error('[ContainerService] Error listing containers:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Setup IPC handlers
   * @param {IpcRouter} ipcRouter - IPC router instance
   */
  setupIpcHandlers(ipcRouter) {
    // Launch project
    ipcRouter.handle('container:launch-project', async (event, params) => {
      const { projectName } = params;
      return await this.launchProject(projectName);
    });

    // Launch service
    ipcRouter.handle('container:launch-service', async (event, params) => {
      const { projectName, serviceName, serviceConfig } = params;
      return await this.launchService(projectName, serviceName, serviceConfig);
    });

    // Stop service
    ipcRouter.handle('container:stop', async (event, params) => {
      const { containerName } = params;
      return await this.stopService(containerName);
    });

    // Restart service
    ipcRouter.handle('container:restart', async (event, params) => {
      const { containerName } = params;
      return await this.restartService(containerName);
    });

    // Remove service
    ipcRouter.handle('container:remove', async (event, params) => {
      const { containerName } = params;
      return await this.removeService(containerName);
    });

    // Get status
    ipcRouter.handle('container:status', async (event, params) => {
      const { containerName } = params;
      return await this.getContainerStatus(containerName);
    });

    // Get logs
    ipcRouter.handle('container:logs', async (event, params) => {
      const { containerName, options } = params;
      return await this.getLogs(containerName, options);
    });

    // List containers
    ipcRouter.handle('container:list', async () => {
      return await this.listContainers();
    });

    console.log('[ContainerService] IPC handlers registered');
  }

  /**
   * Cleanup
   */
  async destroy() {
    // Stop all log streaming processes
    for (const proc of this.runningProcesses.values()) {
      proc.kill();
    }

    this.runningProcesses.clear();
    this.containers.clear();

    console.log('[ContainerService] Service destroyed');
  }
}

// Export singleton instance
module.exports = new ContainerService();
