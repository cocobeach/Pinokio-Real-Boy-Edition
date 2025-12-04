/**
 * ProjectService - Multi-Repository Project Management
 * Epic 11.1: The Project Manager (Project Grouping)
 *
 * Groups multiple repositories into a single logical Project for unified orchestration.
 * Validates project manifests, manages project state, and provides the foundation
 * for inter-service configuration (AppLinker) and deployment (CloudSeeder export).
 *
 * Architecture:
 * - Projects are defined by pinokio.project.json manifest
 * - Each project contains multiple repositories (application, infrastructure, etc.)
 * - Services within repositories can declare dependencies and resource requirements
 * - ProjectService validates manifests using JSON Schema (ajv)
 */

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const projectSchema = require('../schemas/project.schema');

class ProjectService {
  constructor() {
    this.projects = new Map(); // projectName -> projectData
    this.currentProject = null; // Currently active project
    this.ajv = new Ajv({ allErrors: true, strict: false });
    this.validateProjectSchema = this.ajv.compile(projectSchema);

    console.log('[ProjectService] Initialized');
  }

  /**
   * Create a new project
   * @param {Object} projectData - Project configuration
   * @returns {Object} Result with project details
   */
  async createProject(projectData) {
    try {
      // Validate against schema
      const valid = this.validateProjectSchema(projectData);
      if (!valid) {
        return {
          success: false,
          error: 'Invalid project manifest',
          validationErrors: this.validateProjectSchema.errors
        };
      }

      // Check for duplicate project name
      if (this.projects.has(projectData.name)) {
        return {
          success: false,
          error: `Project '${projectData.name}' already exists`
        };
      }

      // Add metadata
      projectData.createdAt = new Date().toISOString();
      projectData.updatedAt = new Date().toISOString();

      // Store project
      this.projects.set(projectData.name, projectData);

      console.log(`[ProjectService] Created project: ${projectData.name}`);

      return {
        success: true,
        project: projectData
      };

    } catch (error) {
      console.error('[ProjectService] Error creating project:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Load project from pinokio.project.json file
   * @param {string} manifestPath - Path to project manifest
   * @returns {Object} Result with project details
   */
  async loadProject(manifestPath) {
    try {
      // Read manifest file
      if (!fs.existsSync(manifestPath)) {
        return {
          success: false,
          error: `Manifest not found: ${manifestPath}`
        };
      }

      const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
      const projectData = JSON.parse(manifestContent);

      // Validate against schema
      const valid = this.validateProjectSchema(projectData);
      if (!valid) {
        return {
          success: false,
          error: 'Invalid project manifest',
          validationErrors: this.validateProjectSchema.errors,
          manifestPath
        };
      }

      // Resolve repository paths relative to manifest location
      const manifestDir = path.dirname(manifestPath);
      projectData.repositories.forEach(repo => {
        if (!path.isAbsolute(repo.path)) {
          repo.path = path.resolve(manifestDir, repo.path);
        }
      });

      // Verify repositories exist
      const missingRepos = [];
      projectData.repositories.forEach(repo => {
        if (!fs.existsSync(repo.path)) {
          missingRepos.push(repo.path);
        }
      });

      if (missingRepos.length > 0) {
        return {
          success: false,
          error: `Missing repositories: ${missingRepos.join(', ')}`,
          missingRepos
        };
      }

      // Add metadata
      projectData.manifestPath = manifestPath;
      projectData.loadedAt = new Date().toISOString();

      // Store project
      this.projects.set(projectData.name, projectData);

      console.log(`[ProjectService] Loaded project: ${projectData.name} (${projectData.repositories.length} repos)`);

      return {
        success: true,
        project: projectData
      };

    } catch (error) {
      console.error('[ProjectService] Error loading project:', error);
      return {
        success: false,
        error: error.message,
        manifestPath
      };
    }
  }

  /**
   * Save project to pinokio.project.json file
   * @param {string} projectName - Project name
   * @param {string} manifestPath - Path to save manifest (optional)
   * @returns {Object} Result
   */
  async saveProject(projectName, manifestPath = null) {
    try {
      const project = this.projects.get(projectName);
      if (!project) {
        return {
          success: false,
          error: `Project not found: ${projectName}`
        };
      }

      // Use existing manifest path or provided path
      const savePath = manifestPath || project.manifestPath;
      if (!savePath) {
        return {
          success: false,
          error: 'No manifest path specified'
        };
      }

      // Update timestamp
      project.updatedAt = new Date().toISOString();

      // Write to disk
      const manifestContent = JSON.stringify(project, null, 2);
      fs.writeFileSync(savePath, manifestContent, 'utf-8');

      console.log(`[ProjectService] Saved project: ${projectName} to ${savePath}`);

      return {
        success: true,
        manifestPath: savePath
      };

    } catch (error) {
      console.error('[ProjectService] Error saving project:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Set the current active project
   * @param {string} projectName - Project name
   * @returns {Object} Result
   */
  setCurrentProject(projectName) {
    const project = this.projects.get(projectName);
    if (!project) {
      return {
        success: false,
        error: `Project not found: ${projectName}`
      };
    }

    this.currentProject = projectName;
    console.log(`[ProjectService] Active project set to: ${projectName}`);

    return {
      success: true,
      project
    };
  }

  /**
   * Get the current active project
   * @returns {Object} Current project or null
   */
  getCurrentProject() {
    if (!this.currentProject) {
      return {
        success: true,
        project: null
      };
    }

    const project = this.projects.get(this.currentProject);
    return {
      success: true,
      project
    };
  }

  /**
   * Get all loaded projects
   * @returns {Object} All projects
   */
  getAllProjects() {
    const projectList = Array.from(this.projects.values());
    return {
      success: true,
      projects: projectList,
      count: projectList.length
    };
  }

  /**
   * Get project by name
   * @param {string} projectName - Project name
   * @returns {Object} Project data
   */
  getProject(projectName) {
    const project = this.projects.get(projectName);
    if (!project) {
      return {
        success: false,
        error: `Project not found: ${projectName}`
      };
    }

    return {
      success: true,
      project
    };
  }

  /**
   * Add repository to project
   * @param {string} projectName - Project name
   * @param {Object} repoData - Repository configuration
   * @returns {Object} Result
   */
  async addRepository(projectName, repoData) {
    try {
      const project = this.projects.get(projectName);
      if (!project) {
        return {
          success: false,
          error: `Project not found: ${projectName}`
        };
      }

      // Check for duplicate repo name
      const exists = project.repositories.find(r => r.name === repoData.name);
      if (exists) {
        return {
          success: false,
          error: `Repository '${repoData.name}' already exists in project`
        };
      }

      // Verify repository path exists
      if (!fs.existsSync(repoData.path)) {
        return {
          success: false,
          error: `Repository path does not exist: ${repoData.path}`
        };
      }

      // Add repository
      project.repositories.push(repoData);
      project.updatedAt = new Date().toISOString();

      console.log(`[ProjectService] Added repository '${repoData.name}' to project '${projectName}'`);

      return {
        success: true,
        project
      };

    } catch (error) {
      console.error('[ProjectService] Error adding repository:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Remove repository from project
   * @param {string} projectName - Project name
   * @param {string} repoName - Repository name
   * @returns {Object} Result
   */
  async removeRepository(projectName, repoName) {
    try {
      const project = this.projects.get(projectName);
      if (!project) {
        return {
          success: false,
          error: `Project not found: ${projectName}`
        };
      }

      const repoIndex = project.repositories.findIndex(r => r.name === repoName);
      if (repoIndex === -1) {
        return {
          success: false,
          error: `Repository '${repoName}' not found in project`
        };
      }

      // Remove repository
      project.repositories.splice(repoIndex, 1);
      project.updatedAt = new Date().toISOString();

      console.log(`[ProjectService] Removed repository '${repoName}' from project '${projectName}'`);

      return {
        success: true,
        project
      };

    } catch (error) {
      console.error('[ProjectService] Error removing repository:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get all services across all repositories in a project
   * @param {string} projectName - Project name
   * @returns {Object} Flattened service list
   */
  getProjectServices(projectName) {
    const project = this.projects.get(projectName);
    if (!project) {
      return {
        success: false,
        error: `Project not found: ${projectName}`
      };
    }

    const services = [];
    project.repositories.forEach(repo => {
      if (repo.services) {
        repo.services.forEach(service => {
          services.push({
            ...service,
            repository: repo.name,
            repositoryPath: repo.path,
            repositoryRole: repo.role
          });
        });
      }
    });

    return {
      success: true,
      services,
      count: services.length
    };
  }

  /**
   * Delete project
   * @param {string} projectName - Project name
   * @returns {Object} Result
   */
  async deleteProject(projectName) {
    try {
      if (!this.projects.has(projectName)) {
        return {
          success: false,
          error: `Project not found: ${projectName}`
        };
      }

      // Clear current project if deleting active one
      if (this.currentProject === projectName) {
        this.currentProject = null;
      }

      // Remove from memory
      this.projects.delete(projectName);

      console.log(`[ProjectService] Deleted project: ${projectName}`);

      return {
        success: true
      };

    } catch (error) {
      console.error('[ProjectService] Error deleting project:', error);
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
    // Create project
    ipcRouter.handle('project:create', async (event, params) => {
      return await this.createProject(params);
    });

    // Load project from manifest
    ipcRouter.handle('project:load', async (event, params) => {
      const { manifestPath } = params;
      return await this.loadProject(manifestPath);
    });

    // Save project
    ipcRouter.handle('project:save', async (event, params) => {
      const { projectName, manifestPath } = params;
      return await this.saveProject(projectName, manifestPath);
    });

    // Set current project
    ipcRouter.handle('project:set-current', async (event, params) => {
      const { projectName } = params;
      return this.setCurrentProject(projectName);
    });

    // Get current project
    ipcRouter.handle('project:get-current', async () => {
      return this.getCurrentProject();
    });

    // Get all projects
    ipcRouter.handle('project:get-all', async () => {
      return this.getAllProjects();
    });

    // Get project by name
    ipcRouter.handle('project:get', async (event, params) => {
      const { projectName } = params;
      return this.getProject(projectName);
    });

    // Add repository
    ipcRouter.handle('project:add-repo', async (event, params) => {
      const { projectName, repository } = params;
      return await this.addRepository(projectName, repository);
    });

    // Remove repository
    ipcRouter.handle('project:remove-repo', async (event, params) => {
      const { projectName, repoName } = params;
      return await this.removeRepository(projectName, repoName);
    });

    // Get project services
    ipcRouter.handle('project:get-services', async (event, params) => {
      const { projectName } = params;
      return this.getProjectServices(projectName);
    });

    // Delete project
    ipcRouter.handle('project:delete', async (event, params) => {
      const { projectName } = params;
      return await this.deleteProject(projectName);
    });

    console.log('[ProjectService] IPC handlers registered');
  }

  /**
   * Cleanup
   */
  destroy() {
    this.projects.clear();
    this.currentProject = null;
    console.log('[ProjectService] Service destroyed');
  }
}

// Export singleton instance
module.exports = new ProjectService();
