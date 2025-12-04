/**
 * ServiceLogBuffer - Efficient Ring Buffer for Multi-Service Logs
 * Epic 11.2: Multi-Service Terminal UX
 *
 * Features:
 * - Ring buffer with configurable max size (prevents memory bloat)
 * - Service-based color coding (ANSI parsing + service colors)
 * - Timestamp tracking for each line
 * - Search/filter capabilities
 * - Efficient serialization for persistence
 *
 * Design: Each service gets its own log buffer to maintain isolation
 * and enable efficient per-service operations.
 */

class ServiceLogBuffer {
  constructor(serviceName, options = {}) {
    this.serviceName = serviceName;
    this.maxLines = options.maxLines || 10000; // 10k lines per service (anti-bloat)
    this.buffer = []; // Array of {timestamp, line, colorCode}
    this.serviceColor = this.assignServiceColor(serviceName);
    this.startTime = Date.now();
  }

  /**
   * Assign color based on service name (for renderer styling)
   * @param {string} serviceName - Service identifier
   * @returns {string} Hex color code
   */
  assignServiceColor(serviceName) {
    // Color palette for visual distinction
    const colors = {
      'katechon3': '#00ff88',          // Green - Primary app
      'katechon-api': '#00ff88',       // Green - API service
      'redis': '#ff5555',              // Red - Cache
      'postgres': '#5555ff',           // Blue - Database
      'postgresql': '#5555ff',         // Blue - Database
      'ollama': '#ffaa00',             // Orange - AI
      'nginx': '#55ff55',              // Light green - Web server
      'default': '#ffffff'             // White - Default
    };

    // Match service name to color (case-insensitive, partial match)
    const serviceKey = Object.keys(colors).find(key =>
      serviceName.toLowerCase().includes(key.toLowerCase())
    );

    return colors[serviceKey] || colors.default;
  }

  /**
   * Append log line to buffer
   * @param {string} line - Log line content
   * @returns {Object} Appended log entry
   */
  append(line) {
    const entry = {
      timestamp: Date.now(),
      line: line.toString().trim(),
      colorCode: this.serviceColor,
      service: this.serviceName
    };

    this.buffer.push(entry);

    // FIFO eviction if buffer exceeds max
    if (this.buffer.length > this.maxLines) {
      this.buffer.shift();
    }

    return entry;
  }

  /**
   * Get recent log lines
   * @param {number} limit - Number of recent lines to return
   * @returns {Array} Recent log entries
   */
  getRecent(limit = 500) {
    return this.buffer.slice(-limit);
  }

  /**
   * Get all log lines
   * @returns {Array} All log entries
   */
  getAll() {
    return [...this.buffer];
  }

  /**
   * Search logs by text query
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Array} Matching log entries
   */
  search(query, options = {}) {
    const { caseSensitive = false, limit = 100 } = options;
    const searchQuery = caseSensitive ? query : query.toLowerCase();

    const matches = this.buffer.filter(entry => {
      const line = caseSensitive ? entry.line : entry.line.toLowerCase();
      return line.includes(searchQuery);
    });

    return matches.slice(-limit);
  }

  /**
   * Filter logs by time range
   * @param {number} startTime - Start timestamp (ms)
   * @param {number} endTime - End timestamp (ms)
   * @returns {Array} Filtered log entries
   */
  filterByTime(startTime, endTime) {
    return this.buffer.filter(entry =>
      entry.timestamp >= startTime && entry.timestamp <= endTime
    );
  }

  /**
   * Get log statistics
   * @returns {Object} Buffer statistics
   */
  getStats() {
    return {
      serviceName: this.serviceName,
      totalLines: this.buffer.length,
      maxLines: this.maxLines,
      oldestTimestamp: this.buffer.length > 0 ? this.buffer[0].timestamp : null,
      newestTimestamp: this.buffer.length > 0 ? this.buffer[this.buffer.length - 1].timestamp : null,
      colorCode: this.serviceColor,
      uptimeMs: Date.now() - this.startTime
    };
  }

  /**
   * Clear buffer
   */
  clear() {
    this.buffer = [];
    console.log(`[ServiceLogBuffer] Cleared buffer for service: ${this.serviceName}`);
  }

  /**
   * Serialize buffer for persistence
   * @returns {Object} Serialized buffer data
   */
  serialize() {
    return {
      serviceName: this.serviceName,
      maxLines: this.maxLines,
      buffer: this.buffer,
      serviceColor: this.serviceColor,
      startTime: this.startTime
    };
  }

  /**
   * Restore buffer from serialized data
   * @param {Object} data - Serialized buffer data
   */
  static deserialize(data) {
    const buffer = new ServiceLogBuffer(data.serviceName, {
      maxLines: data.maxLines
    });
    buffer.buffer = data.buffer || [];
    buffer.serviceColor = data.serviceColor;
    buffer.startTime = data.startTime;
    return buffer;
  }
}

module.exports = ServiceLogBuffer;
