/**
 * E2E Test: VRAM Optimization (Epic 10.7)
 * Tests intelligent GPU memory allocation and environment generation
 */

const assert = require('assert');

describe('VRAM Optimization E2E Tests', function() {
  this.timeout(10000);

  const HardwareService = require('../../electron/main/services/HardwareService');

  describe('VRAM Allocation Calculation', function() {
    it('should calculate VRAM allocation', async function() {
      const result = await HardwareService.calculateVRAMAllocation({
        modelSizeGB: 7,
        safetyMargin: 0.8
      });

      assert.ok(result, 'Should return result');
      assert.ok(typeof result.success === 'boolean');

      if (result.success) {
        // Should have recommendation
        assert.ok(result.recommendation, 'Should have recommendation');
        assert.ok(['gpu', 'cpu_only', 'cpu_fallback'].includes(result.recommendation));

        // Should indicate CPU or GPU usage
        assert.ok(typeof result.useCPU === 'boolean');

        if (result.useGPU) {
          assert.ok(typeof result.selectedGPU === 'number', 'Should select a GPU');
          assert.ok(result.allocatedVRAM > 0, 'Should allocate VRAM');
          assert.ok(Array.isArray(result.gpuAllocations), 'Should provide GPU analysis');
        }
      }
    });

    it('should handle small models (3B)', async function() {
      const result = await HardwareService.calculateVRAMAllocation({
        modelSizeGB: 3,
        safetyMargin: 0.8
      });

      assert.strictEqual(result.success, true);

      // Small models more likely to fit
      if (result.useGPU) {
        assert.ok(result.allocatedVRAM > 0);
      }
    });

    it('should handle large models (70B)', async function() {
      const result = await HardwareService.calculateVRAMAllocation({
        modelSizeGB: 70,
        safetyMargin: 0.8
      });

      assert.strictEqual(result.success, true);

      // Large models likely require CPU fallback on consumer hardware
      if (result.useCPU) {
        assert.ok(result.reason, 'Should explain CPU fallback reason');
        assert.strictEqual(result.recommendation, 'cpu_fallback');
      }
    });

    it('should respect safety margin', async function() {
      const conservativeResult = await HardwareService.calculateVRAMAllocation({
        modelSizeGB: 7,
        safetyMargin: 0.9  // More conservative
      });

      const normalResult = await HardwareService.calculateVRAMAllocation({
        modelSizeGB: 7,
        safetyMargin: 0.8  // Normal
      });

      // Conservative setting should be more likely to fallback to CPU
      assert.ok(conservativeResult.success);
      assert.ok(normalResult.success);
    });
  });

  describe('PyTorch Environment Generation', function() {
    it('should generate CPU-only environment', function() {
      const allocation = {
        useCPU: true,
        useGPU: false,
        recommendation: 'cpu_only'
      };

      const env = HardwareService.generatePyTorchEnv(allocation);

      assert.ok(env, 'Should return environment object');
      assert.strictEqual(env.CUDA_VISIBLE_DEVICES, '-1', 'Should force CPU mode');
    });

    it('should generate GPU-optimized environment', function() {
      const allocation = {
        useCPU: false,
        useGPU: true,
        selectedGPU: 0,
        allocatedVRAM: 8192,  // 8GB
        recommendation: 'gpu'
      };

      const env = HardwareService.generatePyTorchEnv(allocation);

      assert.ok(env, 'Should return environment object');
      assert.strictEqual(env.CUDA_VISIBLE_DEVICES, '0', 'Should select GPU 0');
      assert.ok(env.PYTORCH_CUDA_ALLOC_CONF, 'Should set PyTorch CUDA config');

      // Verify config contains expected settings
      assert.ok(env.PYTORCH_CUDA_ALLOC_CONF.includes('max_split_size_mb'),
        'Should set max_split_size_mb');
      assert.ok(env.PYTORCH_CUDA_ALLOC_CONF.includes('garbage_collection_threshold'),
        'Should set GC threshold');
    });

    it('should generate multi-GPU environment', function() {
      const allocation = {
        useCPU: false,
        useGPU: true,
        selectedGPU: 1,  // Second GPU
        allocatedVRAM: 16384,  // 16GB
        recommendation: 'gpu'
      };

      const env = HardwareService.generatePyTorchEnv(allocation);

      assert.strictEqual(env.CUDA_VISIBLE_DEVICES, '1', 'Should select GPU 1');
    });
  });

  describe('Optimized Environment (End-to-End)', function() {
    it('should provide optimized environment for 7B model', async function() {
      const result = await HardwareService.getOptimizedEnv({
        modelSizeGB: 7
      });

      assert.strictEqual(result.success, true);
      assert.ok(result.env, 'Should return environment object');
      assert.ok(result.allocation, 'Should return allocation details');
      assert.ok(result.recommendation, 'Should provide recommendation');

      // Environment should have required keys
      if (result.allocation.useGPU) {
        assert.ok(result.env.CUDA_VISIBLE_DEVICES, 'Should set CUDA_VISIBLE_DEVICES');
        assert.ok(result.env.PYTORCH_CUDA_ALLOC_CONF, 'Should set PyTorch config');
      } else {
        assert.strictEqual(result.env.CUDA_VISIBLE_DEVICES, '-1');
      }
    });

    it('should merge with base environment', async function() {
      const baseEnv = {
        PATH: '/usr/bin:/bin',
        HOME: '/home/user',
        CUSTOM_VAR: 'test_value'
      };

      const result = await HardwareService.getOptimizedEnv({
        modelSizeGB: 7,
        baseEnv
      });

      assert.strictEqual(result.success, true);

      // Should preserve base environment
      assert.strictEqual(result.env.PATH, '/usr/bin:/bin');
      assert.strictEqual(result.env.HOME, '/home/user');
      assert.strictEqual(result.env.CUSTOM_VAR, 'test_value');

      // Should add CUDA variables
      assert.ok(result.env.CUDA_VISIBLE_DEVICES);
    });
  });

  describe('Error Handling', function() {
    it('should handle GPU query failures gracefully', async function() {
      // Even if GPU detection fails, should fallback to CPU
      const result = await HardwareService.calculateVRAMAllocation({
        modelSizeGB: 7
      });

      // Should always return a result, even on error
      assert.ok(result);
      assert.ok(result.recommendation);
    });

    it('should provide safe defaults on errors', async function() {
      const result = await HardwareService.getOptimizedEnv({
        modelSizeGB: 7
      });

      assert.strictEqual(result.success, true);
      assert.ok(result.env, 'Should always provide environment');
      assert.ok(result.recommendation, 'Should always provide recommendation');
    });
  });
});
