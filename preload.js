// put this preload for main-window to give it prompt()
const { ipcRenderer, } = require('electron')
window.prompt = function(title, val){
  return ipcRenderer.sendSync('prompt', {title, val})
}
const sendPinokio = (action) => {
  console.log("window.parent == window.top?", window.parent === window.top, action, location.href)
  if (window.parent === window.top) {
    window.parent.postMessage({
      action
    }, "*")
  }
}


// ONLY WHEN IN CHILD FRAME
if (window.parent === window.top) {
  if (window.location !== window.parent.location) {
    let prevUrl = document.location.href
    sendPinokio({
      type: "location",
      url: prevUrl
    })
    setInterval(() => {
      const currUrl = document.location.href;
  //    console.log({ currUrl, prevUrl })
      if (currUrl != prevUrl) {
        // URL changed
        prevUrl = currUrl;
        console.log(`URL changed to : ${currUrl}`);
        sendPinokio({
          type: "location",
          url: currUrl
        })
      }
    }, 100);
    window.addEventListener("message", (event) => {
      if (event.data) {
        if (event.data.action === "back") {
          history.back()
        } else if (event.data.action === "forward") {
          history.forward()
        } else if (event.data.action === "refresh") {
          location.reload()
        }
      }
    })
  }
}


//document.addEventListener("DOMContentLoaded", (e) => {
//  if (window.parent === window.top) {
//    window.parent.postMessage({
//      action: {
//        type: "title",
//        text: document.title
//      }
//    }, "*")
//  }
//})
window.electronAPI = {
  send: (type, msg) => {
    ipcRenderer.send(type, msg)
  },
  startInspector: (payload) => ipcRenderer.invoke('pinokio:start-inspector', payload || {}),
  stopInspector: () => ipcRenderer.invoke('pinokio:stop-inspector'),
  captureScreenshot: (screenshotRequest) => {
    return ipcRenderer.invoke('pinokio:capture-screenshot-debug', { screenshotRequest })
  },

  // Terminal APIs (BMAD Architecture)
  terminal: {
    create: (options) => ipcRenderer.invoke('terminal:create', options),
    write: (params) => ipcRenderer.invoke('terminal:write', params),
    resize: (params) => ipcRenderer.invoke('terminal:resize', params),
    kill: (params) => ipcRenderer.invoke('terminal:kill', params),
    list: () => ipcRenderer.invoke('terminal:list'),
    onData: (callback) => ipcRenderer.on('terminal:data', (event, data) => callback(data)),
    onExit: (callback) => ipcRenderer.on('terminal:exit', (event, data) => callback(data)),

    // Epic 10.2: Session Persistence
    hasSavedState: () => ipcRenderer.invoke('terminal:has-saved-state'),
    restoreSessions: () => ipcRenderer.invoke('terminal:restore-sessions'),
    clearSavedState: () => ipcRenderer.invoke('terminal:clear-saved-state'),
  },

  // AI APIs (BMAD Architecture - Enhanced for Epic 8)
  ai: {
    // Legacy APIs (backward compatibility)
    initialize: (options) => ipcRenderer.invoke('ai:initialize', options),
    start: () => ipcRenderer.invoke('ai:start'),
    stop: () => ipcRenderer.invoke('ai:stop'),
    ask: (params) => ipcRenderer.invoke('ai:ask', params),
    status: () => ipcRenderer.invoke('ai:status'),

    // Epic 8: The Awakened Mind - Multi-provider AI
    query: (params) => ipcRenderer.invoke('ai:query', params),
    agenticCode: (params) => ipcRenderer.invoke('ai:agentic-code', params),
    ganRefine: (params) => ipcRenderer.invoke('ai:gan-refine', params),
    updateGANSettings: (settings) => ipcRenderer.invoke('ai:update-gan-settings', settings),
    updateModePreferences: (params) => ipcRenderer.invoke('ai:update-mode-preferences', params),
    getProviders: () => ipcRenderer.invoke('ai:get-providers'),
  },

  // Hardware APIs (Epic 8: The Awakened Mind + Epic 10.7: VRAM Optimization)
  hardware: {
    getGPU: (params) => ipcRenderer.invoke('hardware:gpu', params),
    getCPU: () => ipcRenderer.invoke('hardware:cpu'),
    getSystem: () => ipcRenderer.invoke('hardware:system'),
    checkCompatibility: (params) => ipcRenderer.invoke('hardware:check-compatibility', params),
    getSummary: () => ipcRenderer.invoke('hardware:summary'),
    // Epic 10.7: VRAM optimization
    calculateVRAM: (params) => ipcRenderer.invoke('hardware:calculate-vram', params),
    getOptimizedEnv: (params) => ipcRenderer.invoke('hardware:optimized-env', params),
  },

  // Config APIs (Epic 8: Configuration Management)
  config: {
    getProviderPreferences: () => ipcRenderer.invoke('config:get-provider-preferences'),
    setProviderPreferences: (prefs) => ipcRenderer.invoke('config:set-provider-preferences', prefs),
    getModePreferences: () => ipcRenderer.invoke('config:get-mode-preferences'),
    setModePreferences: (prefs) => ipcRenderer.invoke('config:set-mode-preferences', prefs),
    getGANSettings: () => ipcRenderer.invoke('config:get-gan-settings'),
    setGANSettings: (settings) => ipcRenderer.invoke('config:set-gan-settings', settings),
    getQuotaSettings: () => ipcRenderer.invoke('config:get-quota-settings'),
    setQuotaSettings: (settings) => ipcRenderer.invoke('config:set-quota-settings', settings),
    getHardwareSettings: () => ipcRenderer.invoke('config:get-hardware-settings'),
    setHardwareSettings: (settings) => ipcRenderer.invoke('config:set-hardware-settings', settings),
    getEpic8Config: () => ipcRenderer.invoke('config:get-epic8-config'),
    resetEpic8Config: () => ipcRenderer.invoke('config:reset-epic8-config'),
  },

  // Global Asset Store APIs (BMAD Architecture)
  gas: {
    exists: (params) => ipcRenderer.invoke('gas:exists', params),
    link: (params) => ipcRenderer.invoke('gas:link', params),
    register: (params) => ipcRenderer.invoke('gas:register', params),
    getDownloadPlan: (params) => ipcRenderer.invoke('gas:get-download-plan', params),
    findDuplicates: (params) => ipcRenderer.invoke('gas:find-duplicates', params),
    stats: () => ipcRenderer.invoke('gas:stats'),

    // Epic 10.6: Download Resume & Integrity Checks
    downloadWithResume: (params) => ipcRenderer.invoke('gas:download-with-resume', params),
    checkResume: (params) => ipcRenderer.invoke('gas:check-resume', params),
    clearDownloadMetadata: (params) => ipcRenderer.invoke('gas:clear-download-metadata', params),
    onDownloadProgress: (callback) => ipcRenderer.on('gas:download-progress', (event, data) => callback(data)),
  },

  // AI Forge APIs (BMAD Architecture - Phase 3 & 4)
  forge: {
    create: (params) => ipcRenderer.invoke('forge:create', params),
    analyzeError: (params) => ipcRenderer.invoke('forge:analyze-error', params),
    tutorDebug: (params) => ipcRenderer.invoke('forge:tutor-debug', params), // Epic 9: Story 9.5
    history: (params) => ipcRenderer.invoke('forge:history', params),
    active: () => ipcRenderer.invoke('forge:active'),
    executeInTerminal: (params) => ipcRenderer.invoke('forge:execute-in-terminal', params),
    saveManifest: (params) => ipcRenderer.invoke('forge:save-manifest', params),
    onProgress: (callback) => ipcRenderer.on('forge:progress', (event, data) => callback(data)),
    onExecutionProgress: (callback) => ipcRenderer.on('forge:execution-progress', (event, data) => callback(data)),
  },

  // Kernel Patcher APIs (BMAD Architecture - Phase 5: The Deep Hook)
  kernelPatcher: {
    stats: () => ipcRenderer.invoke('kernel-patcher:stats'),
  },

  // Command Center APIs (BMAD Architecture - Epic 6: The Command Center)
  onCommandCenter: (channel, callback) => {
    const validChannels = ['attach-terminal'];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(`command-center:${channel}`, (event, data) => callback(data));
    } else {
      console.error(`[preload] Invalid command-center channel: ${channel}`);
    }
  },

  // Git APIs (BMAD Architecture - Epic 7: The Agentic IDE)
  git: {
    isRepo: (params) => ipcRenderer.invoke('git:is-repo', params),
    status: (params) => ipcRenderer.invoke('git:status', params),
    diff: (params) => ipcRenderer.invoke('git:diff', params),
    stage: (params) => ipcRenderer.invoke('git:stage', params),
    commit: (params) => ipcRenderer.invoke('git:commit', params),
    aiCommitMessage: (params) => ipcRenderer.invoke('git:ai-commit-message', params),
    log: (params) => ipcRenderer.invoke('git:log', params),
    push: (params) => ipcRenderer.invoke('git:push', params),
  },

  // Filesystem APIs (BMAD Architecture - Epic 7: The Agentic IDE)
  filesystem: {
    readDirectory: (params) => ipcRenderer.invoke('fs:read-directory', params),
    readFile: (params) => ipcRenderer.invoke('file:read', params),
    saveFile: (params) => ipcRenderer.invoke('file:save', params),
    getMetadata: (params) => ipcRenderer.invoke('file:metadata', params),
  },

  // Plan Executor APIs (BMAD Architecture - Epic 9: The Synergistic Forge)
  planExecutor: {
    execute: (params) => ipcRenderer.invoke('plan-executor:execute', params),
    status: (params) => ipcRenderer.invoke('plan-executor:status', params),
    cancel: (params) => ipcRenderer.invoke('plan-executor:cancel', params),
    history: () => ipcRenderer.invoke('plan-executor:history'),
    onProgress: (callback) => ipcRenderer.on('plan-executor:progress', (event, data) => callback(data)),
  },

  // Window Control APIs (BMAD Architecture - Epic 10.1: The Durable Mind)
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  },

  // Vector Memory APIs (BMAD Architecture - Epic 10.5: The Durable Mind)
  vectorMemory: {
    store: (params) => ipcRenderer.invoke('vector-memory:store', params),
    search: (params) => ipcRenderer.invoke('vector-memory:search', params),
    getContext: (params) => ipcRenderer.invoke('vector-memory:context', params),
    delete: (params) => ipcRenderer.invoke('vector-memory:delete', params),
    clearCategory: (params) => ipcRenderer.invoke('vector-memory:clear-category', params),
    getStats: () => ipcRenderer.invoke('vector-memory:stats'),
  },
}

;(function initInspector() {
  if (typeof document === 'undefined') {
    return
  }

  const log = (message) => {
    try {
      console.log(`[Inspector] ${message}`)
    } catch (_) {
      // ignore
    }
  }

  const state = {
    active: false,
    button: null,
    lastFrameOrdinal: null,
    lastRelativeOrdinal: null,
    lastUrl: null,
    lastDomPath: null,
    displayUrl: null,
    overlay: null,
    instructionsVisible: false,
    closing: false,
  }

  const normalizeUrl = (value) => {
    if (!value) {
      return null
    }
    try {
      return new URL(value, window.location.href).toString()
    } catch (err) {
      return value
    }
  }

  const findIframeCandidates = () => {
    const list = Array.from(document.querySelectorAll('iframe')).map((iframe, index) => {
      const style = window.getComputedStyle ? window.getComputedStyle(iframe) : null
      const rect = iframe.getBoundingClientRect()
      const area = rect ? Math.max(rect.width, 0) * Math.max(rect.height, 0) : 0
      const visible = Boolean(
        rect &&
        rect.width > 2 &&
        rect.height > 2 &&
        !iframe.classList.contains('hidden') &&
        !iframe.hasAttribute('hidden') &&
        (!style || (style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || '1') > 0))
      )
      return {
        element: iframe,
        index,
        rect,
        area,
        visible,
        src: normalizeUrl(iframe.getAttribute('src') || iframe.src || ''),
      }
    })
    return list
  }

  const selectVisibleIframe = () => {
    const candidates = findIframeCandidates()
    if (!candidates.length) {
      log('no iframe candidates discovered')
      return null
    }
    candidates.slice(0, 3).forEach((candidate) => {
      const rect = candidate.rect || { width: 0, height: 0 }
      log(`candidate[${candidate.index}] src=${candidate.src || '<empty>'} visible=${candidate.visible ? 'yes' : 'no'} size=${Math.round(rect.width)}x${Math.round(rect.height)}`)
    })
    const visible = candidates.filter((candidate) => candidate.visible)
    const ranked = (visible.length ? visible : candidates).slice().sort((a, b) => {
      if (b.area === a.area) {
        return (b.rect ? b.rect.width : 0) - (a.rect ? a.rect.width : 0)
      }
      return b.area - a.area
    })
    const chosen = ranked[0]
    if (!chosen) {
      log('no suitable iframe found after ranking')
      return null
    }
    log(`selected iframe src=${chosen.src || '<empty>'} visible=${chosen.visible ? 'yes' : 'no'} size=${Math.round(chosen.rect?.width || 0)}x${Math.round(chosen.rect?.height || 0)}`)
    const siblingsWithSameUrl = candidates.filter((candidate) => candidate.src === chosen.src)
    const relativeOrdinal = siblingsWithSameUrl.indexOf(chosen)
    return {
      element: chosen.element,
      index: chosen.index,
      relativeOrdinal: relativeOrdinal >= 0 ? relativeOrdinal : null,
      url: chosen.src,
    }
  }

  const ensureOverlay = () => {
    if (state.overlay && state.overlay.container && document.body.contains(state.overlay.container)) {
      return state.overlay
    }

    // Remove stale overlays left over from previous script executions
    const orphaned = Array.from(document.querySelectorAll('.pinokio-inspector-overlay'))
    for (const node of orphaned) {
      if (!state.overlay || node !== state.overlay.container) {
        node.remove()
      }
    }

    const container = document.createElement('div')
    container.className = 'pinokio-inspector-overlay'
    Object.assign(container.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      maxWidth: 'min(420px, 92vw)',
      maxHeight: '70vh',
      padding: '12px 14px',
      borderRadius: '10px',
      border: '1px solid rgba(255, 255, 255, 0.12)',
      background: 'rgba(9, 12, 20, 0.92)',
      color: '#fefefe',
      boxShadow: '0 20px 42px rgba(0,0,0,0.45)',
      display: 'none',
      flexDirection: 'column',
      gap: '8px',
      zIndex: '2147483646',
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontSize: '12px',
    })

    const header = document.createElement('div')
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px',
    })

    const title = document.createElement('strong')
    title.textContent = 'Inspect Mode'
    Object.assign(title.style, {
      fontSize: '12px',
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
    })

    const closeButton = document.createElement('button')
    closeButton.type = 'button'
    closeButton.textContent = '×'
    closeButton.dataset.role = 'close'
    Object.assign(closeButton.style, {
      background: 'transparent',
      border: 'none',
      color: '#fefefe',
      fontSize: '18px',
      lineHeight: '1',
      cursor: 'pointer',
    })

    header.append(title, closeButton)

    const status = document.createElement('div')
    status.dataset.role = 'status'
    status.style.color = '#ccd5ff'

    const urlRow = document.createElement('div')
    urlRow.dataset.role = 'url'
    Object.assign(urlRow.style, {
      color: '#9aa7c2',
      fontSize: '11px',
      wordBreak: 'break-all',
    })

    const htmlSection = document.createElement('div')
    htmlSection.dataset.role = 'html-container'
    Object.assign(htmlSection.style, {
      display: 'none',
      margin: '8px 0',
      padding: '8px',
      borderRadius: '8px',
      background: 'rgba(255,255,255,0.06)',
      border: '1px solid rgba(255,255,255,0.12)',
    })

    const htmlHeader = document.createElement('div')
    Object.assign(htmlHeader.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px',
      marginBottom: '6px',
    })

    const htmlLabel = document.createElement('div')
    htmlLabel.textContent = 'Element Snippet'
    Object.assign(htmlLabel.style, {
      fontSize: '11px',
      color: '#9aa7c2',
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
    })

    const buttonBaseStyle = {
      display: 'none',
      background: 'rgba(77,163,255,0.2)',
      border: '1px solid rgba(77,163,255,0.4)',
      borderRadius: '6px',
      padding: '4px 12px',
      fontSize: '11px',
      cursor: 'pointer',
      color: '#ccd5ff',
      fontWeight: '600',
    }

    const copyButton = document.createElement('button')
    copyButton.dataset.role = 'copy'
    copyButton.type = 'button'
    copyButton.textContent = 'Copy snippet'
    Object.assign(copyButton.style, buttonBaseStyle)

    htmlHeader.append(htmlLabel, copyButton)

    const htmlBlock = document.createElement('textarea')
    htmlBlock.dataset.role = 'html'
    Object.assign(htmlBlock.style, {
      margin: '0',
      padding: '10px',
      maxHeight: '28vh',
      overflow: 'auto',
      borderRadius: '8px',
      background: 'rgba(255,255,255,0.08)',
      display: 'none',
      fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
      fontSize: '11px',
      border: '1px solid rgba(255,255,255,0.18)',
      color: '#fefefe',
      resize: 'vertical',
      minHeight: '140px',
      width: '100%',
      boxSizing: 'border-box',
    })
    htmlBlock.spellcheck = false

    htmlSection.append(htmlHeader, htmlBlock)

    const screenshotBlock = document.createElement('div')
    screenshotBlock.dataset.role = 'screenshot-container'
    Object.assign(screenshotBlock.style, {
      margin: '8px 0',
      padding: '8px',
      borderRadius: '8px',
      background: 'rgba(255,255,255,0.06)',
      border: '1px solid rgba(255,255,255,0.12)',
      display: 'none',
      textAlign: 'center',
    })

    const screenshotHeader = document.createElement('div')
    Object.assign(screenshotHeader.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px',
      marginBottom: '8px',
    })

    const screenshotImg = document.createElement('img')
    screenshotImg.dataset.role = 'screenshot'
    Object.assign(screenshotImg.style, {
      maxWidth: '100%',
      maxHeight: '200px',
      borderRadius: '4px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    })

    const screenshotLabel = document.createElement('div')
    screenshotLabel.textContent = 'Element Screenshot'
    Object.assign(screenshotLabel.style, {
      fontSize: '11px',
      color: '#9aa7c2',
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
    })

    const copyScreenshotButton = document.createElement('button')
    copyScreenshotButton.dataset.role = 'copy-screenshot'
    copyScreenshotButton.type = 'button'
    copyScreenshotButton.textContent = 'Copy screenshot'
    Object.assign(copyScreenshotButton.style, buttonBaseStyle)

    screenshotHeader.append(screenshotLabel, copyScreenshotButton)
    screenshotBlock.append(screenshotHeader, screenshotImg)

    container.append(header, status, urlRow, htmlSection, screenshotBlock)
    document.body.appendChild(container)

    const overlay = {
      container,
      status,
      urlRow,
      htmlSection,
      htmlBlock,
      screenshotBlock,
      screenshotImg,
      copyButton,
      copyScreenshotButton,
      closeButton,
    }

    closeButton.addEventListener('click', () => {
      stopInspector()
    })

    copyButton.addEventListener('click', async () => {
      const text = overlay.htmlBlock.value || ''
      if (!text) {
        return
      }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text)
        } else {
          const textarea = document.createElement('textarea')
          textarea.value = text
          textarea.setAttribute('readonly', '')
          textarea.style.position = 'absolute'
          textarea.style.left = '-9999px'
          document.body.appendChild(textarea)
          textarea.select()
          document.execCommand('copy')
          document.body.removeChild(textarea)
        }
        overlay.copyButton.textContent = 'Copied'
        setTimeout(() => {
          overlay.copyButton.textContent = 'Copy snippet'
        }, 1500)
      } catch (err) {
        overlay.copyButton.textContent = 'Copy failed'
        setTimeout(() => {
          overlay.copyButton.textContent = 'Copy snippet'
        }, 1500)
      }
    })

    copyScreenshotButton.addEventListener('click', async () => {
      const img = overlay.screenshotImg
      if (!img.src) {
        return
      }
      try {
        // Convert data URL to blob
        const response = await fetch(img.src)
        const blob = await response.blob()
        
        if (navigator.clipboard && navigator.clipboard.write) {
          const clipboardItem = new ClipboardItem({ 'image/png': blob })
          await navigator.clipboard.write([clipboardItem])
        } else {
          throw new Error('Clipboard API not available')
        }
        
        overlay.copyScreenshotButton.textContent = 'Copied'
        setTimeout(() => {
          overlay.copyScreenshotButton.textContent = 'Copy screenshot'
        }, 1500)
      } catch (err) {
        console.warn('Screenshot copy failed:', err)
        overlay.copyScreenshotButton.textContent = 'Copy failed'
        setTimeout(() => {
          overlay.copyScreenshotButton.textContent = 'Copy screenshot'
        }, 1500)
      }
    })

    state.overlay = overlay
    return overlay
  }

  const showOverlay = (message, frameUrl, html, screenshot) => {
    const overlay = ensureOverlay()
    if (overlay.container.parentNode) {
      overlay.container.parentNode.appendChild(overlay.container)
    }
    for (const node of document.querySelectorAll('.pinokio-inspector-overlay')) {
      if (node !== overlay.container) {
        node.style.display = 'none'
      }
    }
    overlay.container.style.display = 'flex'
    overlay.status.textContent = message || ''
    overlay.urlRow.textContent = frameUrl ? `Page: ${frameUrl}` : ''
    state.displayUrl = frameUrl || null
    
    // Handle HTML content
    if (html) {
      const pageUrl = frameUrl || state.displayUrl || state.lastUrl || ''
      const domPath = state.lastDomPath || ''
      const lines = []
      if (pageUrl) {
        lines.push(`Page: ${pageUrl}`)
      }
      if (domPath) {
        lines.push(`DOM: ${domPath}`)
      }
      lines.push(`HTML: ${html}`)
      overlay.htmlSection.style.display = 'block'
      overlay.htmlBlock.style.display = 'block'
      overlay.htmlBlock.value = lines.join('\n')
      overlay.copyButton.style.display = 'inline-flex'
      overlay.copyButton.textContent = 'Copy snippet'
    } else {
      overlay.htmlSection.style.display = 'none'
      overlay.htmlBlock.style.display = 'none'
      overlay.htmlBlock.value = ''
      overlay.copyButton.style.display = 'none'
    }
    
    // Handle screenshot content
    if (screenshot) {
      overlay.screenshotImg.src = screenshot
      overlay.screenshotBlock.style.display = 'block'
      overlay.copyScreenshotButton.style.display = 'inline-flex'
      overlay.copyScreenshotButton.textContent = 'Copy screenshot'
    } else {
      overlay.screenshotImg.src = ''
      overlay.screenshotBlock.style.display = 'none'
      overlay.copyScreenshotButton.style.display = 'none'
    }
  }

  const hideOverlay = () => {
    const overlay = state.overlay
    if (overlay && overlay.container) {
      overlay.container.style.display = 'none'
      overlay.status.textContent = ''
      overlay.urlRow.textContent = ''
      overlay.htmlBlock.value = ''
      overlay.htmlSection.style.display = 'none'
      overlay.htmlBlock.style.display = 'none'
      overlay.copyButton.style.display = 'none'
      overlay.screenshotImg.src = ''
      overlay.screenshotBlock.style.display = 'none'
      overlay.copyScreenshotButton.style.display = 'none'
    }
    state.instructionsVisible = false
    state.closing = false
    state.displayUrl = null
  }

  const startInspector = async (button) => {
    if (state.active) {
      log('inspector already active')
      return
    }
    const target = selectVisibleIframe()
    if (!target) {
      showOverlay('No visible iframe found to inspect.', '', null)
      log('startInspector aborted: no target iframe')
      return
    }

    hideOverlay()

    state.active = true
    state.button = button || null
    state.lastFrameOrdinal = target.index
    state.lastRelativeOrdinal = target.relativeOrdinal
    state.lastUrl = target.url
    state.lastDomPath = null

    if (state.button) {
      state.button.classList.add('inspector-active')
      state.button.setAttribute('aria-pressed', 'true')
    }

    showOverlay('Inspect mode enabled – hover items and click to capture.', target.url || '', null)

    try {
      await window.electronAPI.startInspector({
        frameIndex: target.index,
        frameUrl: target.url,
        candidateOrdinal: target.index,
        candidateRelativeOrdinal: target.relativeOrdinal,
      })
      log('startInspector IPC resolved')
    } catch (error) {
      const message = error && error.message ? error.message : 'Unable to start inspect mode.'
      showOverlay(message, target.url || '', null)
      log(`startInspector IPC error: ${message}`)
      resetState()
    }
  }

  const stopInspector = () => {
    if (!state.active) {
      hideOverlay()
      return
    }
    window.electronAPI.stopInspector().catch(() => {})
    resetState()
    hideOverlay()
  }

  const resetState = () => {
    state.active = false
    state.lastFrameOrdinal = null
    state.lastRelativeOrdinal = null
    state.lastUrl = null
    state.lastDomPath = null
    if (state.button) {
      state.button.classList.remove('inspector-active')
      state.button.removeAttribute('aria-pressed')
      state.button = null
    }
  }

  const handleToggleClick = (event) => {
    const button = event.target.closest('button')
    if (!button) {
      return
    }
    const isTrigger = (
      button.id === 'inspector' ||
      button.hasAttribute('data-pinokio-inspector') ||
      button.classList.contains('pinokio-inspector-button') ||
      (button.dataset && button.dataset.tippyContent === 'Switch to inspect mode')
    )
    if (!isTrigger) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (state.active) {
      stopInspector()
    } else {
      startInspector(button)
    }
  }

  const handleInspectorMessage = (event) => {
    const data = event && event.data && event.data.pinokioInspector
    if (!data) {
      return
    }

    const frameUrl = typeof data.frameUrl === 'string' ? data.frameUrl : state.lastUrl

    if (data.type === 'started') {
      showOverlay('Inspect mode enabled – hover items and click to capture.', frameUrl || '', null)
      return
    }

    if (data.type === 'update') {
      const label = data.nodeName ? `<${String(data.nodeName).toLowerCase()}>` : ''
      if (Array.isArray(data.pathKeys) && data.pathKeys.length) {
        state.lastDomPath = data.pathKeys.join(' > ')
      }
      showOverlay(label ? `Hovering ${label}` : 'Inspect mode enabled – hover items and click to capture.', frameUrl || '', null)
      return
    }

    if (data.type === 'complete') {
      const html = typeof data.outerHTML === 'string' ? data.outerHTML : ''
      const screenshot = typeof data.screenshot === 'string' ? data.screenshot : null
      if (Array.isArray(data.pathKeys) && data.pathKeys.length) {
        state.lastDomPath = data.pathKeys.join(' > ')
      }
      showOverlay('Element captured. Inspect again or close.', frameUrl || '', html, screenshot)
      state.closing = true
      window.electronAPI.stopInspector().catch(() => {}).finally(() => {
        state.closing = false
      })
      resetState()
      return
    }

    if (data.type === 'cancelled') {
      window.electronAPI.stopInspector().catch(() => {})
      resetState()
      hideOverlay()
      return
    }

    if (data.type === 'error') {
      const message = data.message || 'Failed to inspect element.'
      if (Array.isArray(data.pathKeys) && data.pathKeys.length) {
        state.lastDomPath = data.pathKeys.join(' > ')
      }
      showOverlay(message, frameUrl || '', null)
      window.electronAPI.stopInspector().catch(() => {})
      resetState()
      return
    }
  }

  ipcRenderer.on('pinokio:inspector-cancelled', () => {
    if (state.closing) {
      state.closing = false
      return
    }
    resetState()
    hideOverlay()
  })

  ipcRenderer.on('pinokio:inspector-error', (_event, payload) => {
    const message = payload && payload.message ? payload.message : 'Inspect mode ended.'
    hideOverlay()
    showOverlay(message, payload && payload.frameUrl ? payload.frameUrl : '', null)
    resetState()
  })

  ipcRenderer.on('pinokio:inspector-started', (_event, payload) => {
    const url = payload && payload.frameUrl ? payload.frameUrl : state.lastUrl
    showOverlay('Inspect mode enabled – hover items and click to capture.', url || '', null)
  })

  ipcRenderer.on('pinokio:capture-debug-log', (_event, payload) => {
    try {
      const serialized = JSON.stringify(payload)
      console.log('[Pinokio Capture]', serialized)
    } catch (error) {
      console.log('[Pinokio Capture]', payload)
    }
  })

  const logCaptureEvent = (label, payload) => {
    try {
      console.log('[Pinokio Capture]', JSON.stringify({ label, payload }))
    } catch (error) {
      console.log('[Pinokio Capture]', label)
    }
  }

  const processScreenshotRequest = async (screenshotRequest, messageId, source) => {
    logCaptureEvent('renderer-process-start', {
      messageId,
      relayStage: screenshotRequest && screenshotRequest.__pinokioRelayStage,
      relayComplete: screenshotRequest && screenshotRequest.__pinokioRelayComplete,
      adjustedFlag: screenshotRequest && screenshotRequest.__pinokioAdjusted,
      bounds: screenshotRequest && screenshotRequest.bounds ? screenshotRequest.bounds : null
    })
    try {
      const screenshot = await window.electronAPI.captureScreenshot(screenshotRequest)

      source.postMessage({
        pinokioScreenshotResponse: true,
        messageId: messageId,
        success: true,
        screenshot: screenshot
      }, '*')
    } catch (error) {
      console.error('Screenshot capture failed:', error)

      source.postMessage({
        pinokioScreenshotResponse: true,
        messageId,
        success: false,
        error: error.message || 'Screenshot failed'
      }, '*')
    }
  }

  // Handle screenshot requests from iframes  
  const handleScreenshotMessage = async (event) => {
    if (event.data && event.data.pinokioScreenshotRequest) {
      if (window !== window.top) {
        logCaptureEvent('renderer-ignored-non-top', {
          currentHref: window.location.href
        })
        return
      }
      const screenshotRequest = event.data.pinokioScreenshotRequest
      const messageId = event.data.messageId
      const source = event.source

      logCaptureEvent('renderer-message-received', {
        messageId,
        relayStage: screenshotRequest.__pinokioRelayStage,
        relayComplete: screenshotRequest.__pinokioRelayComplete,
        adjustedFlag: screenshotRequest.__pinokioAdjusted,
        bounds: screenshotRequest && screenshotRequest.bounds ? screenshotRequest.bounds : null
      })
      logCaptureEvent('renderer-skip-delegated', {
        messageId
      })
      return
    }
  }

  window.addEventListener('message', handleInspectorMessage)
  window.addEventListener('message', handleScreenshotMessage)
  window.addEventListener('message', (event) => {
    if (!event || !event.data || event.source === window) {
      return
    }
    if (event.data.e !== 'pinokio-start-inspector') {
      return
    }

    try {
      console.log('[Inspector] start-request ' + JSON.stringify({
        url: event.data.frameUrl || null,
        name: event.data.frameName || null,
        nodeId: event.data.frameNodeId || null,
        active: state.active,
      }))
    } catch (_) {}

    const payload = {}
    if (typeof event.data.frameUrl === 'string' && event.data.frameUrl.trim()) {
      payload.frameUrl = event.data.frameUrl.trim()
    }
    if (typeof event.data.frameName === 'string' && event.data.frameName.trim()) {
      payload.frameName = event.data.frameName.trim()
    }
    if (typeof event.data.frameNodeId === 'string' && event.data.frameNodeId.trim()) {
      payload.frameNodeId = event.data.frameNodeId.trim()
    }

    if (!payload.frameUrl && !payload.frameName && !payload.frameNodeId) {
      return
    }

    if (state.active) {
      try {
        console.log('[Inspector] stopping-current-before-start')
      } catch (_) {}
      stopInspector()
    }

    hideOverlay()

    state.active = true
    state.button = null
    state.lastFrameOrdinal = null
    state.lastRelativeOrdinal = null
    state.lastUrl = payload.frameUrl || null
    state.lastDomPath = null

    showOverlay('Inspect mode enabled – hover items and click to capture.', payload.frameUrl || '', null)

    window.electronAPI.startInspector(payload).then(() => {
      try {
        console.log('[Inspector] ipc-start-success ' + JSON.stringify(payload))
      } catch (_) {}
    }).catch((error) => {
      const message = error && error.message ? error.message : 'Unable to start inspect mode.'
      showOverlay(message, payload.frameUrl || '', null)
      try {
        console.log('[Inspector] ipc-start-error ' + JSON.stringify({ message }))
      } catch (_) {}
      resetState()
    })
  })
  document.addEventListener('click', handleToggleClick, true)
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.active) {
      stopInspector()
    }
  })
})()
