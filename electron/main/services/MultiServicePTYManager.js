/**
 * MultiServicePTYManager - Orchestrates Multiple PTY Sessions Per Project
 * Epic 11.2: Multi-Service Terminal UX
 *
 * Integrates with:
 * - ProjectService (11.1) - Discovers services from project manifest
 * - PTYController (10.4) - Creates and manages PTY sessions
 * - ServiceLogBuffer - Aggregates and buffers logs with color coding
 *
 * Features:
 * - Auto-discovery of services from project manifest
 * - Tab management for switching between service logs
 * - Unified log aggregation with color coding
 * - Search across all services or per-service
 * - Real-time log streaming to renderer
 */

const EventEmitter = require('events');
const ServiceLogBuffer = require('./ServiceLogBuffer');
const ProjectService = require('./ProjectService');

class MultiServicePTYManager extends EventEmitter {
  constructor() {
    super();
    this.projectSessions = new Map(); // projectName -> ProjectSession
    this.activeProject = null;
    this.activeTab = null; // serviceName of active tab

    console.log('[MultiServicePTYManager] Initialized');
  }

  /**
   * Initialize PTY sessions for a project
   * @param {string} projectName - Project name from ProjectService
   * @param {Object} ptyController - Reference to PTYController
   * @returns {Promise<Object>} Initialization result
   */
  async initializeProject(projectName, ptyController) {
    try {
      // Get project from ProjectService
      const projectResult = ProjectService.getProject(projectName);
      if (!projectResult.success) {
        return {
          success: false,
          error: `Project not found: ${projectName}`
        };
      }

      const project = projectResult.project;

      // Get all services from project
      const servicesResult = ProjectService.getProjectServices(projectName);
      if (!servicesResult.success) {
        return {
          success: false,
          error: 'Failed to get project services'
        };
      }

      const services = servicesResult.services;

      // Create project session
      const projectSession = {
        projectName,
        project,
        services: new Map(), // serviceName -> ServiceSession
        logBuffers: new Map(), // serviceName -> ServiceLogBuffer
        ptyController
      };

      // Initialize service sessions
      for (const service of services) {
        const serviceName = `${service.repository}/${service.name}`;

        // Create log buffer for this service
        const logBuffer = new ServiceLogBuffer(serviceName, {
          maxLines: 10000
        });

        projectSession.logBuffers.set(serviceName, logBuffer);
        projectSession.services.set(serviceName, {
          ...service,
          ptySessionId: null, // Will be set when PTY is created
          status: 'idle'
        });

        console.log(`[MultiServicePTYManager] Registered service: ${serviceName}`);
      }

      // Store project session
      this.projectSessions.set(projectName, projectSession);
      this.activeProject = projectName;

      // Set first service as active tab
      if (services.length > 0) {
        const firstService = `${services[0].repository}/${services[0].name}`;
        this.activeTab = firstService;
      }

      console.log(`[MultiServicePTYManager] Initialized project: ${projectName} (${services.length} services)`);

      return {
        success: true,
        projectName,
        services: Array.from(projectSession.services.keys()),
        activeTab: this.activeTab
      };

    } catch (error) {
      console.error('[MultiServicePTYManager] Error initializing project:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Attach PTY session to a service
   * @param {string} projectName - Project name
   * @param {string} serviceName - Service name (repo/service format)
   * @param {string} ptySessionId - PTY session ID from PTYController
   * @returns {Object} Result
   */
  attachPTYSession(projectName, serviceName, ptySessionId) {
    try {
      const projectSession = this.projectSessions.get(projectName);
      if (!projectSession) {
        return {
          success: false,
          error: `Project session not found: ${projectName}`
        };
      }

      const service = projectSession.services.get(serviceName);
      if (!service) {
        return {
          success: false,
          error: `Service not found: ${serviceName}`
        };
      }

      // Update service with PTY session ID
      service.ptySessionId = ptySessionId;
      service.status = 'running';

      console.log(`[MultiServicePTYManager] Attached PTY session ${ptySessionId} to service: ${serviceName}`);

      return {
        success: true,
        serviceName,
        ptySessionId
      };

    } catch (error) {
      console.error('[MultiServicePTYManager] Error attaching PTY session:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Append log line to service buffer
   * @param {string} projectName - Project name
   * @param {string} serviceName - Service name
   * @param {string} data - Log data
   * @returns {Object} Log entry
   */
  appendLog(projectName, serviceName, data) {
    const projectSession = this.projectSessions.get(projectName);
    if (!projectSession) {
      console.warn(`[MultiServicePTYManager] Project session not found: ${projectName}`);
      return null;
    }

    const logBuffer = projectSession.logBuffers.get(serviceName);
    if (!logBuffer) {
      console.warn(`[MultiServicePTYManager] Log buffer not found for service: ${serviceName}`);
      return null;
    }

    const entry = logBuffer.append(data);

    // Emit log event for renderer
    this.emit('log', {
      projectName,
      serviceName,
      entry
    });

    return entry;
  }

  /**
   * Switch active tab to a different service
   * @param {string} projectName - Project name
   * @param {string} serviceName - Service name to switch to
   * @returns {Object} Tab switch result with recent logs
   */
  switchTab(projectName, serviceName) {
    try {
      const projectSession = this.projectSessions.get(projectName);
      if (!projectSession) {
        return {
          success: false,
          error: `Project session not found: ${projectName}`
        };
      }

      const service = projectSession.services.get(serviceName);
      if (!service) {
        return {
          success: false,
          error: `Service not found: ${serviceName}`
        };
      }

      // Update active tab
      this.activeProject = projectName;
      this.activeTab = serviceName;

      // Get recent logs from buffer
      const logBuffer = projectSession.logBuffers.get(serviceName);
      const recentLogs = logBuffer ? logBuffer.getRecent(500) : [];

      console.log(`[MultiServicePTYManager] Switched to tab: ${serviceName}`);

      // Emit tab switch event
      this.emit('tabSwitch', {
        projectName,
        serviceName,
        logs: recentLogs,
        service
      });

      return {
        success: true,
        serviceName,
        logs: recentLogs,
        service
      };

    } catch (error) {
      console.error('[MultiServicePTYManager] Error switching tab:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get logs for a specific service
   * @param {string} projectName - Project name
   * @param {string} serviceName - Service name
   * @param {number} limit - Number of recent lines
   * @returns {Object} Logs result
   */
  getServiceLogs(projectName, serviceName, limit = 500) {
    try {
      const projectSession = this.projectSessions.get(projectName);
      if (!projectSession) {
        return {
          success: false,
          error: `Project session not found: ${projectName}`
        };
      }

      const logBuffer = projectSession.logBuffers.get(serviceName);
      if (!logBuffer) {
        return {
          success: false,
          error: `Log buffer not found for service: ${serviceName}`
        };
      }

      const logs = logBuffer.getRecent(limit);
      const stats = logBuffer.getStats();

      return {
        success: true,
        serviceName,
        logs,
        stats
      };

    } catch (error) {
      console.error('[MultiServicePTYManager] Error getting service logs:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Search logs across all services or a specific service
   * @param {string} projectName - Project name
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Object} Search results
   */
  searchLogs(projectName, query, options = {}) {
    try {
      const projectSession = this.projectSessions.get(projectName);
      if (!projectSession) {
        return {
          success: false,
          error: `Project session not found: ${projectName}`
        };
      }

      const { serviceName = null, caseSensitive = false, limit = 100 } = options;

      let results = [];

      if (serviceName) {
        // Search specific service
        const logBuffer = projectSession.logBuffers.get(serviceName);
        if (logBuffer) {
          results = logBuffer.search(query, { caseSensitive, limit });
        }
      } else {
        // Search all services
        for (const [svcName, logBuffer] of projectSession.logBuffers) {
          const matches = logBuffer.search(query, { caseSensitive, limit: 50 });
          results.push(...matches);
        }

        // Sort by timestamp and limit
        results.sort((a, b) => b.timestamp - a.timestamp);
        results = results.slice(0, limit);
      }

      console.log(`[MultiServicePTYManager] Search "${query}" found ${results.length} matches`);

      return {
        success: true,
        query,
        results,
        count: results.length
      };

    } catch (error) {
      console.error('[MultiServicePTYManager] Error searching logs:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get all services for a project
   * @param {string} projectName - Project name
   * @returns {Object} Services list
   */
  getServices(projectName) {
    const projectSession = this.projectSessions.get(projectName);
    if (!projectSession) {
      return {
        success: false,
        error: `Project session not found: ${projectName}`
      };
    }

    const services = Array.from(projectSession.services.entries()).map(([name, service]) => ({
      name,
      ...service,
      colorCode: projectSession.logBuffers.get(name)?.serviceColor
    }));

    return {
      success: true,
      services,
      activeTab: this.activeTab
    };
  }

  /**
   * Clear logs for a service
   * @param {string} projectName - Project name
   * @param {string} serviceName - Service name
   * @returns {Object} Result
   */
  clearServiceLogs(projectName, serviceName) {
    try {
      const projectSession = this.projectSessions.get(projectName);
      if (!projectSession) {
        return {
          success: false,
          error: `Project session not found: ${projectName}`
        };
      }

      const logBuffer = projectSession.logBuffers.get(serviceName);
      if (!logBuffer) {
        return {
          success: false,
          error: `Log buffer not found for service: ${serviceName}`
        };
      }

      logBuffer.clear();

      console.log(`[MultiServicePTYManager] Cleared logs for service: ${serviceName}`);

      return {
        success: true,
        serviceName
      };

    } catch (error) {
      console.error('[MultiServicePTYManager] Error clearing service logs:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Close project session
   * @param {string} projectName - Project name
   * @returns {Object} Result
   */
  closeProject(projectName) {
    try {
      const projectSession = this.projectSessions.get(projectName);
      if (!projectSession) {
        return {
          success: false,
          error: `Project session not found: ${projectName}`
        };
      }

      // Clear all log buffers
      for (const logBuffer of projectSession.logBuffers.values()) {
        logBuffer.clear();
      }

      // Remove project session
      this.projectSessions.delete(projectName);

      // Reset active project if it was closed
      if (this.activeProject === projectName) {
        this.activeProject = null;
        this.activeTab = null;
      }

      console.log(`[MultiServicePTYManager] Closed project session: ${projectName}`);

      return {
        success: true
      };

    } catch (error) {
      console.error('[MultiServicePTYManager] Error closing project:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get current state
   * @returns {Object} Current state
   */
  getState() {
    return {
      success: true,
      activeProject: this.activeProject,
      activeTab: this.activeTab,
      projects: Array.from(this.projectSessions.keys())
    };
  }

  /**
   * Setup IPC handlers
   * @param {IpcRouter} ipcRouter - IPC router instance
   */
  setupIpcHandlers(ipcRouter) {
    // Initialize project
    ipcRouter.handle('multi-pty:init-project', async (event, params) => {
      const { projectName, ptyController } = params;
      return await this.initializeProject(projectName, ptyController);
    });

    // Switch tab
    ipcRouter.handle('multi-pty:switch-tab', async (event, params) => {
      const { projectName, serviceName } = params;
      return this.switchTab(projectName, serviceName);
    });

    // Get service logs
    ipcRouter.handle('multi-pty:get-logs', async (event, params) => {
      const { projectName, serviceName, limit } = params;
      return this.getServiceLogs(projectName, serviceName, limit);
    });

    // Search logs
    ipcRouter.handle('multi-pty:search', async (event, params) => {
      const { projectName, query, options } = params;
      return this.searchLogs(projectName, query, options);
    });

    // Get services
    ipcRouter.handle('multi-pty:get-services', async (event, params) => {
      const { projectName } = params;
      return this.getServices(projectName);
    });

    // Clear service logs
    ipcRouter.handle('multi-pty:clear-logs', async (event, params) => {
      const { projectName, serviceName } = params;
      return this.clearServiceLogs(projectName, serviceName);
    });

    // Close project
    ipcRouter.handle('multi-pty:close-project', async (event, params) => {
      const { projectName } = params;
      return this.closeProject(projectName);
    });

    // Get state
    ipcRouter.handle('multi-pty:get-state', async () => {
      return this.getState();
    });

    console.log('[MultiServicePTYManager] IPC handlers registered');
  }

  /**
   * Cleanup
   */
  destroy() {
    // Close all project sessions
    for (const projectName of this.projectSessions.keys()) {
      this.closeProject(projectName);
    }

    this.removeAllListeners();
    console.log('[MultiServicePTYManager] Service destroyed');
  }
}

// Export singleton instance
module.exports = new MultiServicePTYManager();
