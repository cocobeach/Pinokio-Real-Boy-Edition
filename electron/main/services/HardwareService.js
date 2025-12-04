/**
 * HardwareService - GPU Monitoring & System Resources
 * Epic 8: The Awakened Mind - Story 8.2
 * Monitors dual RTX A4000 GPUs via nvidia-smi parsing
 * Provides hardware context for AI decision-making
 */

const { exec } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

class HardwareService {
  constructor() {
    this.gpuCache = null;
    this.cacheTimestamp = 0;
    this.cacheLifetime = 5000; // 5 seconds cache to avoid hammering nvidia-smi
    this.hasNvidia = null; // null = unknown, true = detected, false = not available
  }

  /**
   * Check if nvidia-smi is available
   * @returns {Promise<boolean>} True if nvidia-smi exists
   */
  async checkNvidiaAvailable() {
    if (this.hasNvidia !== null) {
      return this.hasNvidia;
    }

    return new Promise((resolve) => {
      exec('nvidia-smi --version', (error) => {
        this.hasNvidia = !error;
        if (this.hasNvidia) {
          console.log('[HardwareService] NVIDIA GPU detected');
        } else {
          console.log('[HardwareService] No NVIDIA GPU detected (CPU-only mode)');
        }
        resolve(this.hasNvidia);
      });
    });
  }

  /**
   * Parse nvidia-smi XML output
   * @param {string} xml - Raw XML from nvidia-smi
   * @returns {Object[]} Array of GPU info objects
   */
  parseNvidiaSMI(xml) {
    const gpus = [];

    try {
      // Extract GPU entries (simple regex parsing, no XML library needed)
      const gpuMatches = xml.matchAll(/<gpu id="(.*?)">([\s\S]*?)<\/gpu>/g);

      for (const match of gpuMatches) {
        const gpuId = match[1];
        const gpuXml = match[2];

        // Extract key fields
        const productName = (gpuXml.match(/<product_name>(.*?)<\/product_name>/) || [])[1] || 'Unknown';
        const uuid = (gpuXml.match(/<uuid>(.*?)<\/uuid>/) || [])[1] || '';

        // Memory info
        const memoryTotal = (gpuXml.match(/<fb_memory_usage>[\s\S]*?<total>(.*?)<\/total>/) || [])[1] || '0';
        const memoryUsed = (gpuXml.match(/<fb_memory_usage>[\s\S]*?<used>(.*?)<\/used>/) || [])[1] || '0';
        const memoryFree = (gpuXml.match(/<fb_memory_usage>[\s\S]*?<free>(.*?)<\/free>/) || [])[1] || '0';

        // Utilization
        const utilizationGpu = (gpuXml.match(/<utilization>[\s\S]*?<gpu_util>(.*?)<\/gpu_util>/) || [])[1] || '0';
        const utilizationMemory = (gpuXml.match(/<utilization>[\s\S]*?<memory_util>(.*?)<\/memory_util>/) || [])[1] || '0';

        // Temperature
        const temperature = (gpuXml.match(/<temperature>[\s\S]*?<gpu_temp>(.*?)<\/gpu_temp>/) || [])[1] || '0';

        // Power
        const powerDraw = (gpuXml.match(/<power_readings>[\s\S]*?<power_draw>(.*?)<\/power_draw>/) || [])[1] || '0';
        const powerLimit = (gpuXml.match(/<power_readings>[\s\S]*?<power_limit>(.*?)<\/power_limit>/) || [])[1] || '0';

        // Driver version
        const driverVersion = (gpuXml.match(/<driver_version>(.*?)<\/driver_version>/) || [])[1] || 'Unknown';

        // Parse numeric values (remove units like "MiB", "%", "C", "W")
        const parseValue = (str) => {
          const num = parseFloat(str.replace(/[^0-9.]/g, ''));
          return isNaN(num) ? 0 : num;
        };

        gpus.push({
          id: parseInt(gpuId),
          name: productName.trim(),
          uuid: uuid.trim(),
          driver: driverVersion.trim(),
          memory: {
            total: parseValue(memoryTotal),
            used: parseValue(memoryUsed),
            free: parseValue(memoryFree),
            unit: 'MiB',
            usagePercent: Math.round((parseValue(memoryUsed) / parseValue(memoryTotal)) * 100)
          },
          utilization: {
            gpu: parseValue(utilizationGpu),
            memory: parseValue(utilizationMemory)
          },
          temperature: {
            current: parseValue(temperature),
            unit: 'C'
          },
          power: {
            draw: parseValue(powerDraw),
            limit: parseValue(powerLimit),
            unit: 'W',
            usagePercent: Math.round((parseValue(powerDraw) / parseValue(powerLimit)) * 100)
          }
        });
      }
    } catch (error) {
      console.error('[HardwareService] Error parsing nvidia-smi output:', error);
    }

    return gpus;
  }

  /**
   * Get GPU information from nvidia-smi
   * @param {boolean} forceRefresh - Bypass cache
   * @returns {Promise<Object>} GPU info
   */
  async getGPUInfo(forceRefresh = false) {
    try {
      // Check cache first
      const now = Date.now();
      if (!forceRefresh && this.gpuCache && (now - this.cacheTimestamp) < this.cacheLifetime) {
        return {
          success: true,
          cached: true,
          ...this.gpuCache
        };
      }

      // Check nvidia-smi availability
      const hasNvidia = await this.checkNvidiaAvailable();
      if (!hasNvidia) {
        return {
          success: true,
          hasGPU: false,
          message: 'No NVIDIA GPU detected (CPU-only mode)',
          cpuInfo: this.getCPUInfo()
        };
      }

      // Execute nvidia-smi with XML output
      return new Promise((resolve) => {
        exec('nvidia-smi -q -x', { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
          if (error) {
            console.error('[HardwareService] nvidia-smi error:', error);
            resolve({
              success: false,
              error: error.message,
              hasGPU: false
            });
            return;
          }

          // Parse XML output
          const gpus = this.parseNvidiaSMI(stdout);

          // Build result
          const result = {
            hasGPU: gpus.length > 0,
            gpuCount: gpus.length,
            gpus,
            timestamp: now
          };

          // Update cache
          this.gpuCache = result;
          this.cacheTimestamp = now;

          resolve({
            success: true,
            cached: false,
            ...result
          });
        });
      });
    } catch (error) {
      console.error('[HardwareService] Error getting GPU info:', error);
      return {
        success: false,
        error: error.message,
        hasGPU: false
      };
    }
  }

  /**
   * Get CPU information
   * @returns {Object} CPU info
   */
  getCPUInfo() {
    const cpus = os.cpus();
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();

    return {
      model: cpus[0]?.model || 'Unknown',
      cores: cpus.length,
      speed: cpus[0]?.speed || 0,
      memory: {
        total: Math.round(totalMemory / (1024 * 1024 * 1024) * 100) / 100, // GB
        free: Math.round(freeMemory / (1024 * 1024 * 1024) * 100) / 100, // GB
        used: Math.round((totalMemory - freeMemory) / (1024 * 1024 * 1024) * 100) / 100, // GB
        usagePercent: Math.round(((totalMemory - freeMemory) / totalMemory) * 100)
      },
      platform: os.platform(),
      arch: os.arch()
    };
  }

  /**
   * Get comprehensive system info
   * @returns {Promise<Object>} System info
   */
  async getSystemInfo() {
    try {
      const gpuInfo = await this.getGPUInfo();
      const cpuInfo = this.getCPUInfo();

      return {
        success: true,
        cpu: cpuInfo,
        gpu: gpuInfo.hasGPU ? {
          available: true,
          count: gpuInfo.gpuCount,
          devices: gpuInfo.gpus
        } : {
          available: false,
          message: 'No NVIDIA GPU detected'
        },
        os: {
          type: os.type(),
          platform: os.platform(),
          release: os.release(),
          arch: os.arch(),
          hostname: os.hostname()
        },
        uptime: os.uptime()
      };
    } catch (error) {
      console.error('[HardwareService] Error getting system info:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Check if system meets requirements for a given task
   * @param {Object} requirements - Hardware requirements
   * @returns {Promise<Object>} Compatibility check result
   */
  async checkCompatibility(requirements = {}) {
    try {
      const systemInfo = await this.getSystemInfo();

      if (!systemInfo.success) {
        return {
          success: false,
          error: 'Could not determine system capabilities'
        };
      }

      const results = {
        compatible: true,
        warnings: [],
        blockers: []
      };

      // Check GPU requirements
      if (requirements.gpu) {
        if (requirements.gpu.required && !systemInfo.gpu.available) {
          results.compatible = false;
          results.blockers.push('GPU required but not available');
        }

        if (systemInfo.gpu.available && requirements.gpu.vramMin) {
          const totalVRAM = systemInfo.gpu.devices.reduce((sum, gpu) => sum + gpu.memory.total, 0);
          if (totalVRAM < requirements.gpu.vramMin) {
            results.compatible = false;
            results.blockers.push(`Minimum ${requirements.gpu.vramMin}MB VRAM required, only ${totalVRAM}MB available`);
          }
        }

        if (systemInfo.gpu.available && requirements.gpu.vramRecommended) {
          const totalVRAM = systemInfo.gpu.devices.reduce((sum, gpu) => sum + gpu.memory.total, 0);
          if (totalVRAM < requirements.gpu.vramRecommended) {
            results.warnings.push(`Recommended ${requirements.gpu.vramRecommended}MB VRAM, only ${totalVRAM}MB available (may run slowly)`);
          }
        }
      }

      // Check RAM requirements
      if (requirements.ramMin) {
        if (systemInfo.cpu.memory.total < requirements.ramMin) {
          results.compatible = false;
          results.blockers.push(`Minimum ${requirements.ramMin}GB RAM required, only ${systemInfo.cpu.memory.total}GB available`);
        }
      }

      if (requirements.ramRecommended) {
        if (systemInfo.cpu.memory.total < requirements.ramRecommended) {
          results.warnings.push(`Recommended ${requirements.ramRecommended}GB RAM, only ${systemInfo.cpu.memory.total}GB available`);
        }
      }

      // Check CPU requirements
      if (requirements.cpuCores) {
        if (systemInfo.cpu.cores < requirements.cpuCores) {
          results.warnings.push(`Recommended ${requirements.cpuCores} CPU cores, only ${systemInfo.cpu.cores} available`);
        }
      }

      // Check disk space (if path provided)
      if (requirements.diskSpace && requirements.diskPath) {
        const diskInfo = await this.getDiskSpace(requirements.diskPath);
        if (diskInfo.success && diskInfo.free < requirements.diskSpace) {
          results.compatible = false;
          results.blockers.push(`Minimum ${requirements.diskSpace}GB disk space required, only ${diskInfo.free}GB available`);
        }
      }

      return {
        success: true,
        compatible: results.compatible,
        warnings: results.warnings,
        blockers: results.blockers,
        system: systemInfo
      };
    } catch (error) {
      console.error('[HardwareService] Error checking compatibility:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get disk space for a given path
   * @param {string} targetPath - Path to check
   * @returns {Promise<Object>} Disk space info
   */
  async getDiskSpace(targetPath) {
    return new Promise((resolve) => {
      // Use df on Unix-like systems
      if (os.platform() !== 'win32') {
        exec(`df -BG "${targetPath}" | tail -1 | awk '{print $2, $3, $4}'`, (error, stdout) => {
          if (error) {
            resolve({ success: false, error: error.message });
            return;
          }

          const [total, used, free] = stdout.trim().split(/\s+/).map(s => parseInt(s.replace('G', '')));
          resolve({
            success: true,
            total,
            used,
            free,
            unit: 'GB'
          });
        });
      } else {
        // Windows: use wmic
        const drive = path.parse(targetPath).root;
        exec(`wmic logicaldisk where "DeviceID='${drive.replace('\\', '')}'" get Size,FreeSpace /value`, (error, stdout) => {
          if (error) {
            resolve({ success: false, error: error.message });
            return;
          }

          const sizeMatch = stdout.match(/Size=(\d+)/);
          const freeMatch = stdout.match(/FreeSpace=(\d+)/);

          if (sizeMatch && freeMatch) {
            const total = Math.round(parseInt(sizeMatch[1]) / (1024 * 1024 * 1024));
            const free = Math.round(parseInt(freeMatch[1]) / (1024 * 1024 * 1024));
            const used = total - free;

            resolve({
              success: true,
              total,
              used,
              free,
              unit: 'GB'
            });
          } else {
            resolve({ success: false, error: 'Could not parse disk space' });
          }
        });
      }
    });
  }

  /**
   * Get AI-friendly hardware summary
   * Used by AIController when generating install manifests
   * @returns {Promise<string>} Human-readable hardware summary
   */
  async getHardwareSummary() {
    try {
      const systemInfo = await this.getSystemInfo();

      if (!systemInfo.success) {
        return 'Hardware info unavailable';
      }

      let summary = `System: ${systemInfo.cpu.cores}-core ${systemInfo.cpu.model}, ${systemInfo.cpu.memory.total}GB RAM`;

      if (systemInfo.gpu.available) {
        summary += `\nGPUs: ${systemInfo.gpu.count}x detected`;
        systemInfo.gpu.devices.forEach((gpu, i) => {
          summary += `\n  GPU ${i}: ${gpu.name} (${gpu.memory.total}MB VRAM, ${gpu.memory.usagePercent}% used)`;
        });
      } else {
        summary += '\nGPU: None (CPU-only mode)';
      }

      summary += `\nOS: ${systemInfo.os.type} ${systemInfo.os.release} (${systemInfo.os.arch})`;

      return summary;
    } catch (error) {
      console.error('[HardwareService] Error generating summary:', error);
      return 'Hardware info unavailable';
    }
  }

  /**
   * Epic 10.7: Calculate optimal VRAM allocation for AI models
   * @param {Object} options - Optimization options
   * @param {number} options.modelSizeGB - Estimated model size in GB
   * @param {number} options.safetyMargin - Safety margin (default: 0.8 = 80%)
   * @returns {Promise<Object>} VRAM allocation recommendations
   */
  async calculateVRAMAllocation(options = {}) {
    const { modelSizeGB = 7, safetyMargin = 0.8 } = options;

    try {
      const gpuInfo = await this.getGPUInfo();

      if (!gpuInfo.hasGPU) {
        return {
          success: true,
          useCPU: true,
          reason: 'No GPU available',
          recommendation: 'cpu_only'
        };
      }

      // Calculate available VRAM per GPU
      const gpuAllocations = gpuInfo.gpus.map((gpu, index) => {
        const totalVRAM = gpu.memory.total; // MiB
        const usedVRAM = gpu.memory.used;
        const freeVRAM = gpu.memory.free;

        // Apply safety margin to avoid OOM
        const safeAvailable = freeVRAM * safetyMargin;
        const safeAvailableGB = safeAvailable / 1024;

        const canFitModel = safeAvailableGB >= modelSizeGB;

        return {
          gpuId: index,
          name: gpu.name,
          totalVRAM,
          usedVRAM,
          freeVRAM,
          safeAvailableGB,
          canFitModel,
          recommendedAllocation: canFitModel ? Math.floor(safeAvailable) : 0
        };
      });

      // Find best GPU
      const bestGPU = gpuAllocations
        .filter(g => g.canFitModel)
        .sort((a, b) => b.safeAvailableGB - a.safeAvailableGB)[0];

      if (bestGPU) {
        return {
          success: true,
          useCPU: false,
          useGPU: true,
          selectedGPU: bestGPU.gpuId,
          allocatedVRAM: bestGPU.recommendedAllocation,
          recommendation: 'gpu',
          gpuAllocations
        };
      } else {
        // No GPU can fit the model
        const totalFreeVRAM = gpuAllocations.reduce((sum, g) => sum + g.freeVRAM, 0) / 1024;

        return {
          success: true,
          useCPU: true,
          useGPU: false,
          reason: `Model size (${modelSizeGB}GB) exceeds available VRAM (${totalFreeVRAM.toFixed(1)}GB)`,
          recommendation: 'cpu_fallback',
          gpuAllocations
        };
      }

    } catch (error) {
      console.error('[HardwareService] Error calculating VRAM allocation:', error);
      return {
        success: false,
        error: error.message,
        useCPU: true,
        recommendation: 'cpu_fallback'
      };
    }
  }

  /**
   * Epic 10.7: Generate PyTorch CUDA environment variables
   * @param {Object} allocation - VRAM allocation from calculateVRAMAllocation
   * @returns {Object} Environment variables to set
   */
  generatePyTorchEnv(allocation) {
    const env = {};

    if (allocation.useCPU) {
      // CPU-only mode
      env.CUDA_VISIBLE_DEVICES = '-1';
      console.log('[HardwareService] Forcing CPU-only mode (no GPU available or insufficient VRAM)');
    } else if (allocation.useGPU) {
      // GPU mode with optimization
      env.CUDA_VISIBLE_DEVICES = allocation.selectedGPU.toString();

      // PyTorch CUDA allocator config for better memory management
      // - max_split_size_mb: Prevents fragmentation by limiting split size
      // - garbage_collection_threshold: More aggressive GC to free memory
      const maxSplitSize = Math.floor(allocation.allocatedVRAM / 4); // 1/4 of available VRAM
      env.PYTORCH_CUDA_ALLOC_CONF = `max_split_size_mb:${maxSplitSize},garbage_collection_threshold:0.6`;

      console.log(`[HardwareService] Optimized for GPU ${allocation.selectedGPU}`);
      console.log(`[HardwareService] PYTORCH_CUDA_ALLOC_CONF=${env.PYTORCH_CUDA_ALLOC_CONF}`);
    }

    return env;
  }

  /**
   * Epic 10.7: Get optimized environment for AI model execution
   * @param {Object} options - Model options
   * @param {number} options.modelSizeGB - Model size in GB
   * @param {Object} options.baseEnv - Base environment variables
   * @returns {Promise<Object>} Optimized environment with CUDA settings
   */
  async getOptimizedEnv(options = {}) {
    const { modelSizeGB = 7, baseEnv = process.env } = options;

    try {
      // Calculate VRAM allocation
      const allocation = await this.calculateVRAMAllocation({ modelSizeGB });

      // Generate PyTorch environment variables
      const pytorchEnv = this.generatePyTorchEnv(allocation);

      // Merge with base environment
      const optimizedEnv = {
        ...baseEnv,
        ...pytorchEnv
      };

      return {
        success: true,
        env: optimizedEnv,
        allocation,
        recommendation: allocation.recommendation
      };

    } catch (error) {
      console.error('[HardwareService] Error generating optimized environment:', error);
      return {
        success: false,
        error: error.message,
        env: baseEnv,
        recommendation: 'cpu_fallback'
      };
    }
  }

  /**
   * Setup IPC handlers
   * @param {IpcRouter} ipcRouter - IPC router instance
   */
  setupIpcHandlers(ipcRouter) {
    // Get GPU info
    ipcRouter.handle('hardware:gpu', async (event, params) => {
      return await this.getGPUInfo(params?.forceRefresh);
    });

    // Get CPU info
    ipcRouter.handle('hardware:cpu', async () => {
      return {
        success: true,
        cpu: this.getCPUInfo()
      };
    });

    // Get system info
    ipcRouter.handle('hardware:system', async () => {
      return await this.getSystemInfo();
    });

    // Check compatibility
    ipcRouter.handle('hardware:check-compatibility', async (event, params) => {
      return await this.checkCompatibility(params.requirements);
    });

    // Get hardware summary for AI
    ipcRouter.handle('hardware:summary', async () => {
      const summary = await this.getHardwareSummary();
      return { success: true, summary };
    });

    // Epic 10.7: VRAM optimization
    ipcRouter.handle('hardware:calculate-vram', async (event, params) => {
      return await this.calculateVRAMAllocation(params || {});
    });

    ipcRouter.handle('hardware:optimized-env', async (event, params) => {
      return await this.getOptimizedEnv(params || {});
    });

    console.log('[HardwareService] IPC handlers registered');
  }

  /**
   * Cleanup on shutdown
   */
  destroy() {
    this.gpuCache = null;
    console.log('[HardwareService] Service destroyed');
  }
}

// Export singleton instance
module.exports = new HardwareService();
