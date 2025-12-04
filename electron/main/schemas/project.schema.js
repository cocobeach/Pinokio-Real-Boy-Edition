/**
 * JSON Schema for pinokio.project.json
 * Epic 11.1: The Project Manager (Project Grouping)
 *
 * This schema validates the project manifest that groups multiple repositories
 * into a single logical Project for unified orchestration.
 */

module.exports = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://pinokio.computer/schemas/project.json',
  title: 'Pinokio Project Manifest',
  description: 'Manifest for multi-repository project grouping and service orchestration',
  type: 'object',
  required: ['name', 'version', 'repositories'],

  properties: {
    /**
     * Project Metadata
     */
    name: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      pattern: '^[a-zA-Z0-9_-]+$',
      description: 'Project name (alphanumeric, hyphens, underscores only)'
    },

    displayName: {
      type: 'string',
      minLength: 1,
      maxLength: 200,
      description: 'Human-readable project name'
    },

    description: {
      type: 'string',
      maxLength: 1000,
      description: 'Project description'
    },

    version: {
      type: 'string',
      pattern: '^\\d+\\.\\d+\\.\\d+$',
      description: 'Semantic version (e.g., 1.0.0)'
    },

    author: {
      type: 'string',
      maxLength: 200,
      description: 'Project author or organization'
    },

    /**
     * Repository Configuration
     */
    repositories: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      description: 'List of repositories in this project',
      items: {
        type: 'object',
        required: ['name', 'path', 'role'],
        properties: {
          name: {
            type: 'string',
            minLength: 1,
            maxLength: 100,
            pattern: '^[a-zA-Z0-9_-]+$',
            description: 'Repository identifier'
          },

          path: {
            type: 'string',
            minLength: 1,
            description: 'Absolute or relative path to repository root'
          },

          role: {
            type: 'string',
            enum: ['application', 'infrastructure', 'library', 'config'],
            description: 'Repository role in the project'
          },

          primary: {
            type: 'boolean',
            default: false,
            description: 'Whether this is the primary application repository'
          },

          services: {
            type: 'array',
            description: 'Services defined in this repository',
            items: {
              type: 'object',
              required: ['name', 'type'],
              properties: {
                name: {
                  type: 'string',
                  minLength: 1,
                  description: 'Service name'
                },

                type: {
                  type: 'string',
                  enum: ['container', 'compose', 'script', 'process'],
                  description: 'Service type'
                },

                entrypoint: {
                  type: 'string',
                  description: 'Service entrypoint (docker-compose.yml, start.sh, etc.)'
                },

                ports: {
                  type: 'array',
                  items: {
                    type: 'integer',
                    minimum: 1,
                    maximum: 65535
                  },
                  description: 'Exposed ports'
                },

                dependencies: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Service dependencies (must start before this service)'
                },

                environment: {
                  type: 'object',
                  additionalProperties: { type: 'string' },
                  description: 'Environment variables for this service'
                },

                healthcheck: {
                  type: 'object',
                  properties: {
                    type: {
                      type: 'string',
                      enum: ['http', 'tcp', 'command'],
                      description: 'Health check type'
                    },
                    endpoint: {
                      type: 'string',
                      description: 'Health check endpoint (HTTP path or TCP port)'
                    },
                    interval: {
                      type: 'integer',
                      minimum: 1000,
                      description: 'Check interval in milliseconds'
                    },
                    timeout: {
                      type: 'integer',
                      minimum: 100,
                      description: 'Check timeout in milliseconds'
                    }
                  }
                },

                resources: {
                  type: 'object',
                  properties: {
                    gpu: {
                      type: 'boolean',
                      default: false,
                      description: 'Whether this service requires GPU'
                    },
                    gpuMemoryGB: {
                      type: 'number',
                      minimum: 0,
                      description: 'Required GPU memory in GB'
                    },
                    cpuLimit: {
                      type: 'number',
                      minimum: 0.1,
                      description: 'CPU limit (cores)'
                    },
                    memoryLimitMB: {
                      type: 'integer',
                      minimum: 64,
                      description: 'Memory limit in MB'
                    }
                  }
                }
              }
            }
          }
        }
      }
    },

    /**
     * Inter-Service Configuration (AppLinker)
     */
    links: {
      type: 'array',
      description: 'Configuration links between services (for AppLinker)',
      items: {
        type: 'object',
        required: ['source', 'target', 'mapping'],
        properties: {
          source: {
            type: 'string',
            description: 'Source service name (e.g., "katechon-infra/redis")'
          },

          target: {
            type: 'string',
            description: 'Target repository name (e.g., "katechon3")'
          },

          mapping: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Mapping from source properties to target env vars (e.g., {"port": "REDIS_PORT"})'
          }
        }
      }
    },

    /**
     * CloudSeeder Export Configuration
     */
    export: {
      type: 'object',
      description: 'CloudSeeder deployment export configuration',
      properties: {
        target: {
          type: 'string',
          enum: ['cloudseeder', 'coolify', 'raw-podman'],
          default: 'cloudseeder',
          description: 'Target deployment platform'
        },

        assets: {
          type: 'array',
          items: { type: 'string' },
          description: 'Asset paths to include in deployment artifact (e.g., model files)'
        },

        domain: {
          type: 'string',
          pattern: '^[a-zA-Z0-9.-]+$',
          description: 'Target domain for deployment'
        },

        ssl: {
          type: 'boolean',
          default: true,
          description: 'Enable SSL/HTTPS via IPv6rs'
        }
      }
    }
  }
};
