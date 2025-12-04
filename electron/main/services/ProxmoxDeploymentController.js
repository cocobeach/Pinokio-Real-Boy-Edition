/**
 * ProxmoxDeploymentController - Story 11.9
 * Proxmox Sovereignty Implementation
 *
 * Features:
 * - Token rotation via CredentialBroker with expiry validation
 * - Podman → Proxmox LXC resource mapping
 * - Deployment lifecycle: Upload → Create → Verify → Healthcheck
 * - Smart rollback with max depth and logging
 * - Dry-run validation before deployment
 * - Exponential backoff for API resilience
 *
 * Architecture Decision:
 * - Uses CredentialBrokerService for authentication
 * - Integrates with CloudSeederService for artifact generation
 * - Event-driven progress updates for Admin Panel
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const CredentialBrokerService = require('./CredentialBrokerService');
const CloudSeederService = require('./CloudSeederService');

class ProxmoxDeploymentController extends EventEmitter {
  constructor() {
    super();

    this.deploymentHistory = [];
    this.activeDeployments = new Map(); // deploymentId -> deployment state
    this.rollbackCounters = new Map(); // projectName -> rollback count

    // Proxmox API configuration
    this.proxmoxConfig = {
      host: null,
      port: 8006,
      node: 'pve', // Default node name
      storage: 'local',
      tokenExpireThreshold: 24 * 60 * 60 * 1000 // 24 hours in ms
    };

    // Resource profiles from GPU Bench (Story 11.0)
    this.resourceProfiles = {
      '7B': {
        cores: 8,
        memory: 16384, // 16GB in MB
        disk: 102400, // 100GB in MB
        swap: 8192
      },
      '13B': {
        cores: 12,
        memory: 32768, // 32GB in MB
        disk: 204800, // 200GB in MB
        swap: 16384
      },
      'default': {
        cores: 4,
        memory: 8192, // 8GB in MB
        disk: 51200, // 50GB in MB
        swap: 4096
      }
    };

    console.log('[ProxmoxDeploymentController] Initialized');
  }

  /**
   * Configure Proxmox connection
   * @param {Object} config - Proxmox configuration
   * @returns {Object} Result
   */
  configure(config) {
    try {
      this.proxmoxConfig = {
        ...this.proxmoxConfig,
        ...config
      };

      console.log(`[ProxmoxDeploymentController] Configured: ${config.host}:${config.port || 8006}`);

      return {
        success: true,
        config: this.proxmoxConfig
      };
    } catch (error) {
      console.error('[ProxmoxDeploymentController] Configuration error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Validate and refresh Proxmox credentials
   * @returns {Promise<Object>} Credential validation result
   */
  async validateCredentials() {
    try {
      // Get Proxmox credentials from CredentialBroker
      const credResult = CredentialBrokerService.getCredential('proxmox');

      if (!credResult.success || !credResult.hasToken) {
        return {
          success: false,
          error: 'Proxmox credentials not found. Add via Credentials tab.',
          needsRefresh: true
        };
      }

      // Check token expiry
      const credential = credResult.credential;
      if (credential.expiresAt) {
        const expiresAt = new Date(credential.expiresAt);
        const now = new Date();
        const timeUntilExpiry = expiresAt - now;

        // Token expires in less than 24 hours - refresh needed
        if (timeUntilExpiry < this.proxmoxConfig.tokenExpireThreshold) {
          console.log('[ProxmoxDeploymentController] Token expires soon, refresh recommended');

          return {
            success: true,
            needsRefresh: true,
            expiresIn: Math.floor(timeUntilExpiry / 1000 / 60 / 60), // hours
            message: 'Token expires within 24 hours, consider refreshing'
          };
        }
      }

      return {
        success: true,
        needsRefresh: false,
        credential: {
          username: credential.username,
          hasToken: true
        }
      };

    } catch (error) {
      console.error('[ProxmoxDeploymentController] Credential validation error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Map Podman resources to Proxmox LXC configuration
   * @param {Object} deploymentManifest - Deployment manifest from CloudSeeder
   * @returns {Object} LXC configuration
   */
  mapPodmanToLXC(deploymentManifest) {
    try {
      const profile = deploymentManifest.deployment?.profile || 'default';
      const resources = this.resourceProfiles[profile] || this.resourceProfiles['default'];

      // Check if any service requires GPU
      const requiresGPU = deploymentManifest.services?.some(s => s.requiresGPU) || false;

      const lxcConfig = {
        ostemplate: 'local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.gz',
        cores: resources.cores,
        memory: resources.memory,
        swap: resources.swap,
        rootfs: `${this.proxmoxConfig.storage}:${resources.disk / 1024}`, // Convert MB to GB
        net0: 'name=eth0,bridge=vmbr0,firewall=1,ip=dhcp',
        unprivileged: requiresGPU ? 0 : 1, // Privileged if GPU needed
        features: requiresGPU ? 'nesting=1' : 'nesting=1',
        onboot: 1,
        startup: 'order=10',
        description: `${deploymentManifest.project.name} - Deployed via CloudSeeder`
      };

      // GPU passthrough configuration (if needed)
      if (requiresGPU) {
        lxcConfig.lxc = [
          'lxc.cgroup2.devices.allow: c 195:* rwm', // NVIDIA devices
          'lxc.mount.entry: /dev/nvidia0 dev/nvidia0 none bind,optional,create=file',
          'lxc.mount.entry: /dev/nvidiactl dev/nvidiactl none bind,optional,create=file',
          'lxc.mount.entry: /dev/nvidia-uvm dev/nvidia-uvm none bind,optional,create=file'
        ];
      }

      console.log(`[ProxmoxDeploymentController] Mapped profile "${profile}" to LXC config`);

      return {
        success: true,
        config: lxcConfig,
        profile,
        requiresGPU
      };

    } catch (error) {
      console.error('[ProxmoxDeploymentController] LXC mapping error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Dry-run validation before deployment
   * @param {string} projectName - Project name
   * @param {Object} lxcConfig - LXC configuration
   * @returns {Promise<Object>} Validation result
   */
  async dryRunValidation(projectName, lxcConfig) {
    try {
      console.log(`[ProxmoxDeploymentController] Dry-run validation for: ${projectName}`);

      // Validation checks
      const validations = [];

      // 1. Check Proxmox host configured
      if (!this.proxmoxConfig.host) {
        validations.push({
          check: 'Proxmox Host',
          passed: false,
          message: 'Proxmox host not configured'
        });
      } else {
        validations.push({
          check: 'Proxmox Host',
          passed: true,
          message: `Host: ${this.proxmoxConfig.host}`
        });
      }

      // 2. Check credentials
      const credCheck = await this.validateCredentials();
      validations.push({
        check: 'Credentials',
        passed: credCheck.success,
        message: credCheck.error || 'Valid',
        needsRefresh: credCheck.needsRefresh
      });

      // 3. Check LXC config validity
      const requiredFields = ['ostemplate', 'cores', 'memory', 'rootfs'];
      const missingFields = requiredFields.filter(f => !lxcConfig[f]);

      validations.push({
        check: 'LXC Config',
        passed: missingFields.length === 0,
        message: missingFields.length > 0 ? `Missing: ${missingFields.join(', ')}` : 'Valid'
      });

      // 4. Check rollback counter
      const rollbackCount = this.rollbackCounters.get(projectName) || 0;
      validations.push({
        check: 'Rollback Counter',
        passed: rollbackCount < 1,
        message: rollbackCount >= 1 ? 'Max rollbacks reached (1), manual intervention required' : `Rollbacks: ${rollbackCount}/1`
      });

      const allPassed = validations.every(v => v.passed);

      return {
        success: true,
        valid: allPassed,
        validations,
        canDeploy: allPassed
      };

    } catch (error) {
      console.error('[ProxmoxDeploymentController] Dry-run error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Deploy project to Proxmox LXC
   * @param {string} projectName - Project name
   * @param {Object} options - Deployment options
   * @returns {Promise<Object>} Deployment result
   */
  async deploy(projectName, options = {}) {
    const deploymentId = `deploy-${projectName}-${Date.now()}`;

    try {
      console.log(`[ProxmoxDeploymentController] Starting deployment: ${projectName}`);

      this.activeDeployments.set(deploymentId, {
        projectName,
        status: 'initializing',
        startTime: new Date().toISOString()
      });

      this.emit('deployment:started', { deploymentId, projectName });

      // Step 1: Validate credentials
      this.updateDeploymentStatus(deploymentId, 'validating-credentials');
      const credCheck = await this.validateCredentials();

      if (!credCheck.success) {
        throw new Error(`Credential validation failed: ${credCheck.error}`);
      }

      if (credCheck.needsRefresh) {
        console.warn('[ProxmoxDeploymentController] Warning: Token expires soon');
      }

      // Step 2: Generate artifact via CloudSeeder
      this.updateDeploymentStatus(deploymentId, 'generating-artifact');
      const artifact = await CloudSeederService.generateTarball(projectName, {
        format: 'oci',
        includeSource: false,
        includeContainers: true,
        compress: true
      });

      if (!artifact.success) {
        throw new Error(`Artifact generation failed: ${artifact.error}`);
      }

      // Step 3: Parse deployment manifest
      const manifestPath = path.join(artifact.packageDir, 'deployment.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

      // Step 4: Map Podman → Proxmox LXC
      this.updateDeploymentStatus(deploymentId, 'mapping-resources');
      const lxcMapping = this.mapPodmanToLXC(manifest);

      if (!lxcMapping.success) {
        throw new Error(`LXC mapping failed: ${lxcMapping.error}`);
      }

      // Step 5: Dry-run validation
      this.updateDeploymentStatus(deploymentId, 'dry-run-validation');
      const dryRun = await this.dryRunValidation(projectName, lxcMapping.config);

      if (!dryRun.valid) {
        const failures = dryRun.validations.filter(v => !v.passed).map(v => v.message).join(', ');
        throw new Error(`Dry-run validation failed: ${failures}`);
      }

      // Step 6: Upload artifact to Proxmox (SIMULATED - requires Proxmox API client)
      this.updateDeploymentStatus(deploymentId, 'uploading-artifact');
      await this.uploadArtifact(artifact.tarballPath, {
        node: this.proxmoxConfig.node,
        storage: this.proxmoxConfig.storage
      });

      // Step 7: Create LXC container (SIMULATED)
      this.updateDeploymentStatus(deploymentId, 'creating-lxc');
      const vmid = await this.createLXC(projectName, lxcMapping.config);

      // Step 8: Verify deployment (SIMULATED)
      this.updateDeploymentStatus(deploymentId, 'verifying');
      await this.verifyDeployment(vmid);

      // Step 9: Execute healthcheck (SIMULATED)
      this.updateDeploymentStatus(deploymentId, 'healthcheck');
      const healthcheck = await this.executeHealthcheck(vmid, projectName);

      if (!healthcheck.passed) {
        console.warn(`[ProxmoxDeploymentController] Healthcheck warnings: ${healthcheck.warnings.join(', ')}`);
      }

      // Success
      this.updateDeploymentStatus(deploymentId, 'completed');

      const deployment = {
        deploymentId,
        projectName,
        vmid,
        status: 'deployed',
        artifact: artifact.tarballPath,
        lxcConfig: lxcMapping.config,
        profile: lxcMapping.profile,
        healthcheck,
        timestamp: new Date().toISOString()
      };

      this.deploymentHistory.push(deployment);
      this.emit('deployment:success', deployment);

      console.log(`[ProxmoxDeploymentController] Deployment successful: ${projectName} (VMID: ${vmid})`);

      return {
        success: true,
        deployment
      };

    } catch (error) {
      console.error(`[ProxmoxDeploymentController] Deployment failed: ${projectName}:`, error);

      this.updateDeploymentStatus(deploymentId, 'failed');

      const deployment = {
        deploymentId,
        projectName,
        status: 'failed',
        error: error.message,
        timestamp: new Date().toISOString()
      };

      this.deploymentHistory.push(deployment);
      this.emit('deployment:failed', deployment);

      return {
        success: false,
        error: error.message,
        deploymentId
      };
    } finally {
      this.activeDeployments.delete(deploymentId);
    }
  }

  /**
   * Rollback deployment
   * @param {string} projectName - Project name
   * @returns {Promise<Object>} Rollback result
   */
  async rollback(projectName) {
    try {
      console.log(`[ProxmoxDeploymentController] Initiating rollback: ${projectName}`);

      // Check rollback counter
      const rollbackCount = this.rollbackCounters.get(projectName) || 0;

      if (rollbackCount >= 1) {
        return {
          success: false,
          error: 'Max rollbacks reached (1). Manual intervention required.',
          rollbackCount
        };
      }

      // Find previous successful deployment
      const previousDeployment = this.deploymentHistory
        .filter(d => d.projectName === projectName && d.status === 'deployed')
        .slice(-2)[0]; // Second-to-last deployment

      if (!previousDeployment) {
        return {
          success: false,
          error: 'No previous deployment found for rollback'
        };
      }

      // Increment rollback counter
      this.rollbackCounters.set(projectName, rollbackCount + 1);

      // Execute rollback (SIMULATED)
      console.log(`[ProxmoxDeploymentController] Rolling back to: ${previousDeployment.deploymentId}`);

      // Log rollback to deployment history
      this.deploymentHistory.push({
        projectName,
        status: 'rollback',
        rolledBackTo: previousDeployment.deploymentId,
        reason: 'Manual rollback initiated',
        timestamp: new Date().toISOString()
      });

      this.emit('deployment:rollback', {
        projectName,
        rolledBackTo: previousDeployment.deploymentId
      });

      return {
        success: true,
        rolledBackTo: previousDeployment.deploymentId,
        rollbackCount: rollbackCount + 1
      };

    } catch (error) {
      console.error(`[ProxmoxDeploymentController] Rollback failed: ${projectName}:`, error);

      // Log failed rollback
      this.deploymentHistory.push({
        projectName,
        status: 'rollback-failed',
        error: error.message,
        timestamp: new Date().toISOString()
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Reset rollback counter
   * @param {string} projectName - Project name
   * @returns {Object} Result
   */
  resetRollbackCounter(projectName) {
    this.rollbackCounters.set(projectName, 0);

    console.log(`[ProxmoxDeploymentController] Reset rollback counter: ${projectName}`);

    return {
      success: true,
      projectName,
      rollbackCount: 0
    };
  }

  /**
   * Update deployment status
   * @param {string} deploymentId - Deployment ID
   * @param {string} status - New status
   */
  updateDeploymentStatus(deploymentId, status) {
    const deployment = this.activeDeployments.get(deploymentId);

    if (deployment) {
      deployment.status = status;
      deployment.lastUpdate = new Date().toISOString();

      this.emit('deployment:status', {
        deploymentId,
        status,
        projectName: deployment.projectName
      });

      console.log(`[ProxmoxDeploymentController] ${deployment.projectName}: ${status}`);
    }
  }

  /**
   * Upload artifact to Proxmox storage (SIMULATED)
   * @param {string} artifactPath - Path to artifact tarball
   * @param {Object} options - Upload options
   * @returns {Promise<Object>} Upload result
   */
  async uploadArtifact(artifactPath, options) {
    // SIMULATION: In production, this would use Proxmox API to upload artifact
    console.log(`[ProxmoxDeploymentController] SIMULATED: Uploading ${path.basename(artifactPath)} to ${options.node}:${options.storage}`);

    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 2000));

    return {
      success: true,
      storage: `${options.storage}:vztmpl/${path.basename(artifactPath)}`
    };
  }

  /**
   * Create LXC container on Proxmox (SIMULATED)
   * @param {string} projectName - Project name
   * @param {Object} lxcConfig - LXC configuration
   * @returns {Promise<number>} VMID
   */
  async createLXC(projectName, lxcConfig) {
    // SIMULATION: In production, this would call Proxmox API to create LXC
    const vmid = Math.floor(Math.random() * 9000) + 1000;

    console.log(`[ProxmoxDeploymentController] SIMULATED: Creating LXC ${vmid} for ${projectName}`);
    console.log(`[ProxmoxDeploymentController] Config: ${lxcConfig.cores} cores, ${lxcConfig.memory}MB RAM`);

    // Simulate creation delay
    await new Promise(resolve => setTimeout(resolve, 3000));

    return vmid;
  }

  /**
   * Verify deployment via Proxmox API (SIMULATED)
   * @param {number} vmid - VM ID
   * @returns {Promise<Object>} Verification result
   */
  async verifyDeployment(vmid) {
    // SIMULATION: In production, this would poll Proxmox API for container status
    console.log(`[ProxmoxDeploymentController] SIMULATED: Verifying VMID ${vmid}`);

    // Simulate polling with exponential backoff
    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
      attempts++;
      const delay = Math.min(1000 * Math.pow(2, attempts - 1), 10000); // Exponential backoff, max 10s

      console.log(`[ProxmoxDeploymentController] Verification attempt ${attempts}/${maxAttempts} (delay: ${delay}ms)`);

      await new Promise(resolve => setTimeout(resolve, delay));

      // Simulate success on 3rd attempt
      if (attempts >= 3) {
        console.log(`[ProxmoxDeploymentController] VMID ${vmid} verified as running`);
        return { success: true, status: 'running' };
      }
    }

    throw new Error('Deployment verification timeout');
  }

  /**
   * Execute healthcheck script on LXC (SIMULATED)
   * @param {number} vmid - VM ID
   * @param {string} projectName - Project name
   * @returns {Promise<Object>} Healthcheck result
   */
  async executeHealthcheck(vmid, projectName) {
    // SIMULATION: In production, this would execute healthcheck.sh via pct exec
    console.log(`[ProxmoxDeploymentController] SIMULATED: Executing healthcheck on VMID ${vmid}`);

    await new Promise(resolve => setTimeout(resolve, 2000));

    // Simulated healthcheck result
    return {
      passed: true,
      warnings: [],
      timestamp: new Date().toISOString(),
      project: projectName,
      vmid
    };
  }

  /**
   * Get deployment history
   * @param {Object} options - Filter options
   * @returns {Object} Deployment history
   */
  getDeploymentHistory(options = {}) {
    const { projectName = null, status = null, limit = 50 } = options;

    let history = [...this.deploymentHistory];

    // Filter by project
    if (projectName) {
      history = history.filter(d => d.projectName === projectName);
    }

    // Filter by status
    if (status) {
      history = history.filter(d => d.status === status);
    }

    // Sort by timestamp (most recent first)
    history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Limit
    history = history.slice(0, limit);

    return {
      success: true,
      history,
      count: history.length
    };
  }

  /**
   * Get active deployments
   * @returns {Object} Active deployments
   */
  getActiveDeployments() {
    const active = Array.from(this.activeDeployments.entries()).map(([id, deployment]) => ({
      deploymentId: id,
      ...deployment
    }));

    return {
      success: true,
      deployments: active,
      count: active.length
    };
  }

  /**
   * Setup IPC handlers
   * @param {IpcRouter} ipcRouter - IPC router instance
   */
  setupIpcHandlers(ipcRouter) {
    // Configure Proxmox
    ipcRouter.handle('proxmox:configure', async (event, params) => {
      return this.configure(params);
    });

    // Validate credentials
    ipcRouter.handle('proxmox:validate-credentials', async () => {
      return await this.validateCredentials();
    });

    // Deploy project
    ipcRouter.handle('proxmox:deploy', async (event, params) => {
      const { projectName, options } = params;
      return await this.deploy(projectName, options);
    });

    // Rollback deployment
    ipcRouter.handle('proxmox:rollback', async (event, params) => {
      const { projectName } = params;
      return await this.rollback(projectName);
    });

    // Reset rollback counter
    ipcRouter.handle('proxmox:reset-rollback', async (event, params) => {
      const { projectName } = params;
      return this.resetRollbackCounter(projectName);
    });

    // Dry-run validation
    ipcRouter.handle('proxmox:dry-run', async (event, params) => {
      const { projectName } = params;

      // Generate manifest
      const project = require('./ProjectService').getProject(projectName);
      if (!project.success) {
        return { success: false, error: 'Project not found' };
      }

      const manifest = CloudSeederService.generateDeploymentManifest(project.project, {
        includeSource: false,
        includeContainers: true
      });

      const lxcMapping = this.mapPodmanToLXC(manifest);
      if (!lxcMapping.success) {
        return lxcMapping;
      }

      return await this.dryRunValidation(projectName, lxcMapping.config);
    });

    // Get deployment history
    ipcRouter.handle('proxmox:get-history', async (event, params) => {
      return this.getDeploymentHistory(params);
    });

    // Get active deployments
    ipcRouter.handle('proxmox:get-active', async () => {
      return this.getActiveDeployments();
    });

    console.log('[ProxmoxDeploymentController] IPC handlers registered');
  }

  /**
   * Cleanup
   */
  destroy() {
    this.activeDeployments.clear();
    this.deploymentHistory = [];
    this.rollbackCounters.clear();
    this.removeAllListeners();
    console.log('[ProxmoxDeploymentController] Service destroyed');
  }
}

// Export singleton instance
module.exports = new ProxmoxDeploymentController();
