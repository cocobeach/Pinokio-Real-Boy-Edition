/**
 * MetricsService - Prometheus-compatible metrics collection
 * Epic 10.8: Integration Testing & Metrics
 *
 * Collects and exposes application metrics for monitoring:
 * - AI audit latency
 * - Download resume success rate
 * - VRAM allocation decisions
 * - Vector memory usage
 * - PTY session counts
 */

const http = require('http');

class MetricsService {
  constructor() {
    this.metrics = {
      // AI Audit metrics
      audit_total: 0,
      audit_latency_sum: 0,
      audit_latency_count: 0,
      audit_risk_high: 0,
      audit_risk_medium: 0,
      audit_risk_low: 0,

      // Download metrics
      download_total: 0,
      download_resumed: 0,
      download_failed: 0,
      download_bytes_total: 0,
      checksum_validation_total: 0,
      checksum_validation_failed: 0,

      // VRAM optimization metrics
      vram_calculation_total: 0,
      vram_gpu_selected: 0,
      vram_cpu_fallback: 0,

      // Vector memory metrics
      vector_store_total: 0,
      vector_search_total: 0,
      vector_search_latency_sum: 0,
      vector_search_latency_count: 0,

      // PTY session metrics
      pty_session_total: 0,
      pty_session_restored: 0,

      // System uptime
      start_time: Date.now()
    };

    this.server = null;
    this.port = 9090; // Standard Prometheus port
    this.initialized = false;

    console.log('[MetricsService] Initialized');
  }

  /**
   * Initialize the metrics HTTP server
   */
  async initialize(port = 9090) {
    if (this.initialized) {
      return { success: true };
    }

    this.port = port;

    try {
      this.server = http.createServer((req, res) => {
        if (req.url === '/metrics' && req.method === 'GET') {
          this.handleMetricsRequest(req, res);
        } else if (req.url === '/health' && req.method === 'GET') {
          this.handleHealthRequest(req, res);
        } else {
          res.writeHead(404);
          res.end('Not Found');
        }
      });

      this.server.listen(this.port, () => {
        console.log(`[MetricsService] HTTP server listening on port ${this.port}`);
        console.log(`[MetricsService] Metrics available at http://localhost:${this.port}/metrics`);
      });

      this.initialized = true;
      return { success: true, port: this.port };

    } catch (error) {
      console.error('[MetricsService] Failed to initialize:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle /metrics request (Prometheus format)
   */
  handleMetricsRequest(req, res) {
    const metrics = this.generatePrometheusMetrics();
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
    res.end(metrics);
  }

  /**
   * Handle /health request
   */
  handleHealthRequest(req, res) {
    const uptime = (Date.now() - this.metrics.start_time) / 1000;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      uptime_seconds: uptime,
      metrics_count: Object.keys(this.metrics).length
    }));
  }

  /**
   * Generate Prometheus-compatible metrics format
   */
  generatePrometheusMetrics() {
    const lines = [];

    // AI Audit metrics
    lines.push('# HELP pinokio_audit_total Total number of security audits performed');
    lines.push('# TYPE pinokio_audit_total counter');
    lines.push(`pinokio_audit_total ${this.metrics.audit_total}`);

    if (this.metrics.audit_latency_count > 0) {
      const avgLatency = this.metrics.audit_latency_sum / this.metrics.audit_latency_count;
      lines.push('# HELP pinokio_audit_latency_avg Average audit latency in milliseconds');
      lines.push('# TYPE pinokio_audit_latency_avg gauge');
      lines.push(`pinokio_audit_latency_avg ${avgLatency.toFixed(2)}`);
    }

    lines.push('# HELP pinokio_audit_risk_total Audits by risk level');
    lines.push('# TYPE pinokio_audit_risk_total counter');
    lines.push(`pinokio_audit_risk_total{level="high"} ${this.metrics.audit_risk_high}`);
    lines.push(`pinokio_audit_risk_total{level="medium"} ${this.metrics.audit_risk_medium}`);
    lines.push(`pinokio_audit_risk_total{level="low"} ${this.metrics.audit_risk_low}`);

    // Download metrics
    lines.push('# HELP pinokio_download_total Total number of downloads');
    lines.push('# TYPE pinokio_download_total counter');
    lines.push(`pinokio_download_total ${this.metrics.download_total}`);

    lines.push('# HELP pinokio_download_resumed Number of resumed downloads');
    lines.push('# TYPE pinokio_download_resumed counter');
    lines.push(`pinokio_download_resumed ${this.metrics.download_resumed}`);

    lines.push('# HELP pinokio_download_failed Number of failed downloads');
    lines.push('# TYPE pinokio_download_failed counter');
    lines.push(`pinokio_download_failed ${this.metrics.download_failed}`);

    lines.push('# HELP pinokio_download_bytes_total Total bytes downloaded');
    lines.push('# TYPE pinokio_download_bytes_total counter');
    lines.push(`pinokio_download_bytes_total ${this.metrics.download_bytes_total}`);

    lines.push('# HELP pinokio_checksum_validation_total Checksum validations performed');
    lines.push('# TYPE pinokio_checksum_validation_total counter');
    lines.push(`pinokio_checksum_validation_total ${this.metrics.checksum_validation_total}`);

    lines.push('# HELP pinokio_checksum_validation_failed Failed checksum validations');
    lines.push('# TYPE pinokio_checksum_validation_failed counter');
    lines.push(`pinokio_checksum_validation_failed ${this.metrics.checksum_validation_failed}`);

    // VRAM metrics
    lines.push('# HELP pinokio_vram_calculation_total VRAM allocation calculations');
    lines.push('# TYPE pinokio_vram_calculation_total counter');
    lines.push(`pinokio_vram_calculation_total ${this.metrics.vram_calculation_total}`);

    lines.push('# HELP pinokio_vram_decision_total VRAM allocation decisions');
    lines.push('# TYPE pinokio_vram_decision_total counter');
    lines.push(`pinokio_vram_decision_total{decision="gpu"} ${this.metrics.vram_gpu_selected}`);
    lines.push(`pinokio_vram_decision_total{decision="cpu_fallback"} ${this.metrics.vram_cpu_fallback}`);

    // Vector memory metrics
    lines.push('# HELP pinokio_vector_store_total Memories stored in vector database');
    lines.push('# TYPE pinokio_vector_store_total counter');
    lines.push(`pinokio_vector_store_total ${this.metrics.vector_store_total}`);

    lines.push('# HELP pinokio_vector_search_total Vector similarity searches performed');
    lines.push('# TYPE pinokio_vector_search_total counter');
    lines.push(`pinokio_vector_search_total ${this.metrics.vector_search_total}`);

    if (this.metrics.vector_search_latency_count > 0) {
      const avgSearchLatency = this.metrics.vector_search_latency_sum / this.metrics.vector_search_latency_count;
      lines.push('# HELP pinokio_vector_search_latency_avg Average search latency in milliseconds');
      lines.push('# TYPE pinokio_vector_search_latency_avg gauge');
      lines.push(`pinokio_vector_search_latency_avg ${avgSearchLatency.toFixed(2)}`);
    }

    // PTY metrics
    lines.push('# HELP pinokio_pty_session_total Total PTY sessions created');
    lines.push('# TYPE pinokio_pty_session_total counter');
    lines.push(`pinokio_pty_session_total ${this.metrics.pty_session_total}`);

    lines.push('# HELP pinokio_pty_session_restored PTY sessions restored from disk');
    lines.push('# TYPE pinokio_pty_session_restored counter');
    lines.push(`pinokio_pty_session_restored ${this.metrics.pty_session_restored}`);

    // System uptime
    const uptime = (Date.now() - this.metrics.start_time) / 1000;
    lines.push('# HELP pinokio_uptime_seconds Application uptime in seconds');
    lines.push('# TYPE pinokio_uptime_seconds gauge');
    lines.push(`pinokio_uptime_seconds ${uptime.toFixed(0)}`);

    return lines.join('\n') + '\n';
  }

  /**
   * Record an audit event
   */
  recordAudit(latencyMs, riskLevel) {
    this.metrics.audit_total++;
    this.metrics.audit_latency_sum += latencyMs;
    this.metrics.audit_latency_count++;

    if (riskLevel === 'high') this.metrics.audit_risk_high++;
    else if (riskLevel === 'medium') this.metrics.audit_risk_medium++;
    else if (riskLevel === 'low') this.metrics.audit_risk_low++;
  }

  /**
   * Record a download event
   */
  recordDownload(wasResumed, bytesDownloaded, success = true) {
    this.metrics.download_total++;
    if (wasResumed) this.metrics.download_resumed++;
    if (!success) this.metrics.download_failed++;
    this.metrics.download_bytes_total += bytesDownloaded;
  }

  /**
   * Record checksum validation
   */
  recordChecksumValidation(success) {
    this.metrics.checksum_validation_total++;
    if (!success) this.metrics.checksum_validation_failed++;
  }

  /**
   * Record VRAM allocation
   */
  recordVRAMAllocation(decision) {
    this.metrics.vram_calculation_total++;
    if (decision === 'gpu') this.metrics.vram_gpu_selected++;
    else if (decision === 'cpu_fallback' || decision === 'cpu_only') {
      this.metrics.vram_cpu_fallback++;
    }
  }

  /**
   * Record vector memory operation
   */
  recordVectorStore() {
    this.metrics.vector_store_total++;
  }

  recordVectorSearch(latencyMs) {
    this.metrics.vector_search_total++;
    this.metrics.vector_search_latency_sum += latencyMs;
    this.metrics.vector_search_latency_count++;
  }

  /**
   * Record PTY session
   */
  recordPTYSession(wasRestored = false) {
    this.metrics.pty_session_total++;
    if (wasRestored) this.metrics.pty_session_restored++;
  }

  /**
   * Get current metrics as JSON
   */
  getMetrics() {
    return {
      success: true,
      metrics: { ...this.metrics }
    };
  }

  /**
   * Reset all metrics (for testing)
   */
  resetMetrics() {
    Object.keys(this.metrics).forEach(key => {
      if (key !== 'start_time') {
        this.metrics[key] = 0;
      }
    });
    console.log('[MetricsService] Metrics reset');
  }

  /**
   * Setup IPC handlers
   */
  setupIpcHandlers(ipcRouter) {
    ipcRouter.handle('metrics:get', async () => {
      return this.getMetrics();
    });

    ipcRouter.handle('metrics:reset', async () => {
      this.resetMetrics();
      return { success: true };
    });

    console.log('[MetricsService] IPC handlers registered');
  }

  /**
   * Cleanup
   */
  async destroy() {
    if (this.server) {
      this.server.close();
      console.log('[MetricsService] HTTP server closed');
    }
    this.initialized = false;
  }
}

// Export singleton instance
module.exports = new MetricsService();
