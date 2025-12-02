/**
 * InspectorService - DOM element inspection and screenshot capture
 * Handles cross-iframe inspection with screenshot relay system
 * Extracted from full.js inspector code (~1000 lines)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

class InspectorService {
  constructor() {
    this.sessions = new Map();
    this.handlersInstalled = false;
    this.logFile = path.join(os.tmpdir(), 'pinokio-inspector.log');
  }

  /**
   * Log inspector messages
   * @param {string} label - Log label
   * @param {*} payload - Log payload
   */
  log(label, payload) {
    try {
      const serialized = payload === undefined ? '' : ' ' + JSON.stringify(payload);
      const line = `[InspectorMain] ${label}${serialized}\n`;

      try {
        fs.appendFileSync(this.logFile, line);
      } catch (_) {}

      process.stdout.write(line);
    } catch (_) {
      try {
        fs.appendFileSync(this.logFile, `[InspectorMain] ${label}\n`);
      } catch (_) {}
      process.stdout.write(`[InspectorMain] ${label}\n`);
    }
  }

  /**
   * Normalize URL for comparison
   * @param {string} value - URL to normalize
   * @returns {string|null} Normalized URL
   */
  normalizeUrl(value) {
    if (!value) return null;

    try {
      return new URL(value).href;
    } catch (_) {
      return value;
    }
  }

  /**
   * Check if URLs roughly match
   * @param {string} expected - Expected URL
   * @param {string} candidate - Candidate URL
   * @returns {boolean} True if match
   */
  urlsRoughlyMatch(expected, candidate) {
    if (!expected) return true;
    if (!candidate) return false;
    if (candidate === expected) return true;

    return candidate.startsWith(expected) || expected.startsWith(candidate);
  }

  /**
   * Flatten frame tree into array
   * @param {Frame} frame - Root frame
   * @param {Array} acc - Accumulator
   * @param {number} depth - Current depth
   * @returns {Array} Flattened frames
   */
  flattenFrameTree(frame, acc = [], depth = 0) {
    if (!frame) return acc;

    let frameName = null;
    try {
      frameName = typeof frame.name === 'string' && frame.name.length ? frame.name : null;
    } catch (_) {
      frameName = null;
    }

    acc.push({
      frame,
      depth,
      url: this.normalizeUrl(frame.url || ''),
      name: frameName
    });

    const children = Array.isArray(frame.frames) ? frame.frames : [];
    for (const child of children) {
      this.flattenFrameTree(child, acc, depth + 1);
    }

    return acc;
  }

  /**
   * Find descendant frame by URL
   * @param {Frame} frame - Root frame
   * @param {string} targetUrl - Target URL
   * @returns {Frame|null} Found frame
   */
  findDescendantByUrl(frame, targetUrl) {
    if (!frame || !targetUrl) return null;

    const normalizedTarget = this.normalizeUrl(targetUrl);
    if (!normalizedTarget) return null;

    const stack = [frame];
    while (stack.length) {
      const current = stack.pop();
      try {
        const currentUrl = this.normalizeUrl(current.url || '');
        if (currentUrl && this.urlsRoughlyMatch(normalizedTarget, currentUrl)) {
          return current;
        }
      } catch (_) {}

      const children = Array.isArray(current.frames) ? current.frames : [];
      for (const child of children) {
        if (child) stack.push(child);
      }
    }

    return null;
  }

  /**
   * Select target frame for inspection
   * @param {WebContents} webContents - WebContents instance
   * @param {Object} payload - Selection criteria
   * @returns {Frame|null} Selected frame
   */
  selectTargetFrame(webContents, payload = {}) {
    if (!webContents || !webContents.mainFrame) {
      this.log('no-webcontents', {});
      return null;
    }

    const frames = this.flattenFrameTree(webContents.mainFrame, []);
    if (!frames.length) {
      this.log('no-frames', { webContentsId: webContents.id });
      return null;
    }

    this.log('incoming', {
      frameUrl: payload.frameUrl || null,
      frameName: payload.frameName || null,
      frameNodeId: payload.frameNodeId || null,
      frameCount: frames.length
    });

    const canonicalUrl = this.normalizeUrl(payload.frameUrl);
    const relativeOrdinal = typeof payload.candidateRelativeOrdinal === 'number'
      ? payload.candidateRelativeOrdinal
      : null;
    const globalOrdinal = typeof payload.frameIndex === 'number'
      ? payload.frameIndex
      : null;
    const canonicalFrameName = typeof payload.frameName === 'string' && payload.frameName.trim()
      ? payload.frameName.trim()
      : null;
    const canonicalFrameNodeId = typeof payload.frameNodeId === 'string' && payload.frameNodeId.trim()
      ? payload.frameNodeId.trim()
      : null;

    // Try identifier-based search
    if (canonicalFrameName || canonicalFrameNodeId) {
      this.log('identifier-search', {
        frameName: canonicalFrameName || null,
        frameNodeId: canonicalFrameNodeId || null,
        names: frames.map((entry) => entry.name || null).slice(0, 12)
      });

      let identifierMatch = null;

      // Try frame node ID first
      if (canonicalFrameNodeId) {
        identifierMatch = frames.find((entry) => entry && entry.name === canonicalFrameNodeId) || null;
        if (identifierMatch) {
          const normalizedUrl = this.normalizeUrl(identifierMatch.url || '');
          if (canonicalUrl && (!normalizedUrl || !this.urlsRoughlyMatch(canonicalUrl, normalizedUrl))) {
            const descendant = this.findDescendantByUrl(identifierMatch.frame, canonicalUrl);
            if (descendant) {
              this.log('identifier-match-node-descendant', {
                index: frames.indexOf(identifierMatch),
                name: identifierMatch.name || null,
                url: identifierMatch.url || null,
                descendantUrl: this.normalizeUrl(descendant.url || '')
              });
              return descendant;
            }
          }
          this.log('identifier-match-node', {
            index: frames.indexOf(identifierMatch),
            name: identifierMatch.name || null,
            url: identifierMatch.url || null
          });
          return identifierMatch.frame;
        }
      }

      // Try frame name
      if (canonicalFrameName) {
        identifierMatch = frames.find((entry) => entry && entry.name === canonicalFrameName) || null;
        if (identifierMatch) {
          const normalizedUrl = this.normalizeUrl(identifierMatch.url || '');
          if (canonicalUrl && (!normalizedUrl || !this.urlsRoughlyMatch(canonicalUrl, normalizedUrl))) {
            const descendant = this.findDescendantByUrl(identifierMatch.frame, canonicalUrl);
            if (descendant) {
              this.log('identifier-match-name-descendant', {
                index: frames.indexOf(identifierMatch),
                name: identifierMatch.name || null,
                url: identifierMatch.url || null,
                descendantUrl: this.normalizeUrl(descendant.url || '')
              });
              return descendant;
            }
          }
          this.log('identifier-match-name', {
            index: frames.indexOf(identifierMatch),
            name: identifierMatch.name || null,
            url: identifierMatch.url || null
          });
          return identifierMatch.frame;
        }
      }

      this.log('identifier-miss', {});
    }

    // URL-based search
    let matches = frames;
    if (canonicalUrl) {
      matches = frames.filter(({ url }) => this.urlsRoughlyMatch(canonicalUrl, url));
    }

    if (matches.length) {
      if (relativeOrdinal !== null) {
        const filtered = matches.slice().sort((a, b) =>
          a.depth - b.depth || frames.indexOf(a) - frames.indexOf(b)
        );
        const targetEntry = filtered[Math.min(Math.max(relativeOrdinal, 0), filtered.length - 1)];
        if (targetEntry) {
          this.log('relative-ordinal-match', {
            index: frames.indexOf(targetEntry),
            name: targetEntry.name || null,
            url: targetEntry.url || null
          });
          return targetEntry.frame;
        }
      }

      const fallbackEntry = matches[0];
      if (fallbackEntry) {
        this.log('fallback-match', {
          index: frames.indexOf(fallbackEntry),
          name: fallbackEntry.name || null,
          url: fallbackEntry.url || null
        });
        return fallbackEntry.frame;
      }
    }

    // Global ordinal
    if (globalOrdinal !== null && frames[globalOrdinal]) {
      this.log('global-ordinal-match', {
        index: globalOrdinal,
        name: frames[globalOrdinal].name || null,
        url: frames[globalOrdinal].url || null
      });
      return frames[globalOrdinal].frame;
    }

    // Default to first frame
    this.log('default-match', {
      name: frames[0]?.name || null,
      url: frames[0]?.url || null
    });

    return frames[0]?.frame || null;
  }

  /**
   * Build inspector injection script
   * @returns {string} JavaScript code to inject
   */
  buildInspectorInjection() {
    const source = function () {
      try {
        if (window.__PINOKIO_INSPECTOR__ && typeof window.__PINOKIO_INSPECTOR__.stop === 'function') {
          window.__PINOKIO_INSPECTOR__.stop();
        }

        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.pointerEvents = 'none';
        overlay.style.border = '2px solid rgba(77,163,255,0.9)';
        overlay.style.background = 'rgba(77,163,255,0.2)';
        overlay.style.boxShadow = '0 0 0 1px rgba(23,52,92,0.45)';
        overlay.style.zIndex = '2147483647';
        overlay.style.display = 'none';
        document.documentElement.appendChild(overlay);

        let active = true;

        const post = (type, payload) => {
          try {
            window.parent.postMessage(
              { pinokioInspector: { type, frameUrl: window.location.href, ...payload } },
              '*'
            );
          } catch (err) {
            // ignore
          }
        };

        const updateBox = (target) => {
          if (!active || !target) {
            overlay.style.display = 'none';
            return;
          }
          const rect = target.getBoundingClientRect();
          if (!rect || rect.width <= 0 || rect.height <= 0) {
            overlay.style.display = 'none';
            return;
          }
          overlay.style.display = 'block';
          overlay.style.left = `${rect.left}px`;
          overlay.style.top = `${rect.top}px`;
          overlay.style.width = `${rect.width}px`;
          overlay.style.height = `${rect.height}px`;
        };

        const handleMove = (event) => {
          if (!active) return;
          const target = event.target;
          updateBox(target);
          post('update', {
            nodeName: target && target.tagName ? target.tagName.toLowerCase() : ''
          });
        };

        const handleClick = async (event) => {
          if (!active) return;
          event.preventDefault();
          event.stopPropagation();

          const target = event.target;
          const html = target && target.outerHTML ? target.outerHTML : '';

          post('complete', { outerHTML: html });
          stop();
        };

        const handleKey = (event) => {
          if (!active) return;
          if (event.key === 'Escape') {
            post('cancelled', {});
            stop();
          }
        };

        const stop = () => {
          if (!active) return;
          active = false;
          document.removeEventListener('mousemove', handleMove, true);
          document.removeEventListener('click', handleClick, true);
          window.removeEventListener('keydown', handleKey, true);
          if (overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
          }
          window.__PINOKIO_INSPECTOR__ = null;
        };

        document.addEventListener('mousemove', handleMove, true);
        document.addEventListener('click', handleClick, true);
        window.addEventListener('keydown', handleKey, true);

        window.__PINOKIO_INSPECTOR__ = { stop };
        post('started', {});
      } catch (error) {
        try {
          window.parent.postMessage(
            {
              pinokioInspector: {
                type: 'error',
                frameUrl: window.location.href,
                message: error && error.message ? error.message : String(error)
              }
            },
            '*'
          );
        } catch (_) {}
      }
    };
    return `(${source.toString()})();`;
  }

  /**
   * Start inspector session
   * @param {WebContents} webContents - WebContents instance
   * @param {Object} payload - Inspector options
   * @returns {Promise<Object>} Result
   */
  async startSession(webContents, payload = {}) {
    try {
      // Stop existing session
      const existing = this.sessions.get(webContents.id);
      if (existing) {
        await this.stopSession(webContents);
      }

      // Select target frame
      const targetFrame = this.selectTargetFrame(webContents, payload);
      if (!targetFrame) {
        this.log('no-target-frame', {});
        return { success: false, error: 'No target frame found' };
      }

      // Inject inspector script
      await targetFrame.executeJavaScript(this.buildInspectorInjection(), true);

      // Store session
      this.sessions.set(webContents.id, {
        webContents,
        targetFrame,
        startedAt: new Date()
      });

      this.log('session-started', { webContentsId: webContents.id });
      return { success: true };

    } catch (error) {
      this.log('session-start-error', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Stop inspector session
   * @param {WebContents} webContents - WebContents instance
   * @returns {Promise<Object>} Result
   */
  async stopSession(webContents) {
    try {
      const session = this.sessions.get(webContents.id);
      if (!session) {
        return { success: true };
      }

      const { targetFrame } = session;

      // Stop inspector via injection
      if (targetFrame && !targetFrame.isDestroyed()) {
        await targetFrame.executeJavaScript(
          `if (window.__PINOKIO_INSPECTOR__ && typeof window.__PINOKIO_INSPECTOR__.stop === 'function') { window.__PINOKIO_INSPECTOR__.stop(); }`,
          true
        );
      }

      this.sessions.delete(webContents.id);
      this.log('session-stopped', { webContentsId: webContents.id });

      return { success: true };

    } catch (error) {
      this.log('session-stop-error', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Capture screenshot
   * @param {WebContents} webContents - WebContents instance
   * @param {Object} request - Screenshot request
   * @returns {Promise<string>} Base64 screenshot
   */
  async captureScreenshot(webContents, request) {
    try {
      const bounds = request.bounds || {};
      const dpr = request.devicePixelRatio || 1;

      // Capture using webContents.capturePage
      const image = await webContents.capturePage({
        x: Math.round(bounds.x || 0),
        y: Math.round(bounds.y || 0),
        width: Math.max(1, Math.round(bounds.width || 100)),
        height: Math.max(1, Math.round(bounds.height || 100))
      });

      // Convert to base64
      const buffer = image.toPNG();
      const base64 = `data:image/png;base64,${buffer.toString('base64')}`;

      this.log('screenshot-captured', {
        bounds,
        size: buffer.length
      });

      return base64;

    } catch (error) {
      this.log('screenshot-error', { error: error.message });
      throw error;
    }
  }

  /**
   * Setup IPC handlers
   * @param {IpcRouter} ipcRouter - IPC router instance
   */
  setupIpcHandlers(ipcRouter) {
    // Start inspector
    ipcRouter.handle('pinokio:start-inspector', async (event, payload) => {
      return await this.startSession(event.sender, payload);
    });

    // Stop inspector
    ipcRouter.handle('pinokio:stop-inspector', async (event) => {
      return await this.stopSession(event.sender);
    });

    // Capture screenshot
    ipcRouter.handle('pinokio:capture-screenshot-debug', async (event, params) => {
      try {
        const screenshot = await this.captureScreenshot(event.sender, params.screenshotRequest);
        return { success: true, screenshot };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    console.log('[InspectorService] IPC handlers registered');
  }

  /**
   * Cleanup all sessions
   */
  destroy() {
    for (const [id, session] of this.sessions) {
      try {
        this.stopSession(session.webContents);
      } catch (error) {
        this.log('cleanup-error', { error: error.message });
      }
    }
    this.sessions.clear();
    console.log('[InspectorService] All sessions destroyed');
  }
}

// Export singleton instance
module.exports = new InspectorService();
