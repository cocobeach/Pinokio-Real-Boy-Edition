# Pinokio: Real Boy Edition - BMAD Architecture

## Overview

This document describes the BMAD (Browser, Modular, AI, Data) architecture refactoring of Pinokio from a monolithic "fire-and-forget" script runner to a robust Local AI Operating System.

**Status:** ✅ Phase 1 Complete - Core Architecture Implemented

**Date:** December 2, 2025

---

## Architecture Goals

The BMAD architecture introduces three critical new subsystems:

1. **The Living Interface**: Interactive process management using xterm.js and node-pty
2. **The Self-Managed Intelligence**: Embedded electron-ollama for autonomous AI operations
3. **The Global Asset Store (GAS)**: Content-addressable storage with symlink-based deduplication

---

## Directory Structure

```
pinokio/
├── main.js                           # Entry point (chooses architecture)
├── full-bmad.js                      # BMAD architecture entry point
├── full.js                           # Legacy monolithic entry point
├── minimal.js                        # Minimal/background mode
├── electron/
│   ├── main/
│   │   ├── controllers/
│   │   │   ├── AppController.js      # Main orchestrator
│   │   │   ├── AIController.js       # Ollama/LLM management
│   │   │   └── PTYController.js      # Terminal/shell management
│   │   ├── services/
│   │   │   ├── ConfigService.js      # Configuration management
│   │   │   ├── WindowManager.js      # Window lifecycle
│   │   │   ├── UpdateService.js      # Auto-updater wrapper
│   │   │   ├── BrowserService.js     # Browser config (CORS, CSP, etc.)
│   │   │   └── AssetManager.js       # Global Asset Store (GAS)
│   │   └── ipc/
│   │       └── router.js             # Centralized IPC registry
│   └── renderer/
│       └── components/               # (Future: Terminal, Editor UI)
└── package.json                      # Updated with new dependencies
```

---

## Core Components

### 1. AppController (`electron/main/controllers/AppController.js`)

**Purpose:** Main application orchestrator, replaces monolithic `full.js`

**Responsibilities:**
- Initializes all services in correct order
- Manages Pinokiod lifecycle
- Coordinates IPC setup
- Handles application shutdown

**Key Methods:**
```javascript
initialize()     // Start all services
startPinokiod()  // Launch backend server
createMainWindow() // Create UI
shutdown()       // Cleanup on exit
```

---

### 2. WindowManager (`electron/main/services/WindowManager.js`)

**Purpose:** Centralized window lifecycle management

**Features:**
- Main window with persistent state (electron-window-state)
- Splash screen management
- Secondary window tracking
- Theme-aware title bar overlays
- Window pinning support

**Key Methods:**
```javascript
createMainWindow(url, options)
createSplashWindow()
createSecondaryWindow(url, options)
updateTheme(theme, colors)
```

---

### 3. BrowserService (`electron/main/services/BrowserService.js`)

**Purpose:** Browser/WebContents configuration (extracted from `attach()` function)

**Features:**
- CORS header manipulation
- CSP frame-ancestors removal
- Permission handling (media, screen capture)
- Navigation control (external link handling)
- User-Agent sanitization
- Console logging to file (when `PINOKIO_BROWSER_LOG=1`)

**Security:**
- Removes X-Frame-Options to allow iframe embedding
- Grants all permissions (required for AI app UIs)
- Opens external domains in system browser

---

### 4. PTYController (`electron/main/controllers/PTYController.js`)

**Purpose:** "The Living Interface" - Persistent shell sessions

**Features:**
- Spawns pseudo-terminals using node-pty
- Supports bash/powershell/cmd based on OS
- Sessions survive frontend reloads
- Bidirectional terminal I/O
- Resize handling

**IPC Channels:**
```
terminal:create   → Create new PTY session
terminal:write    → Send input to terminal
terminal:resize   → Resize terminal dimensions
terminal:kill     → Terminate session
terminal:list     → Get all active sessions
terminal:data     → (Event) Terminal output
terminal:exit     → (Event) Terminal closed
```

**Future Integration:**
- Frontend: xterm.js component (in `electron/renderer/components/`)
- Use case: Interactive installation wizards, debugging

---

### 5. AIController (`electron/main/controllers/AIController.js`)

**Purpose:** "The Self-Spinning Brain" - Local LLM management

**Features:**
- Manages electron-ollama lifecycle
- Auto-detects existing Ollama instances
- Runs on non-standard port (11435) to avoid conflicts
- Graceful degradation if binary missing

**Workflow:**
```
1. initialize() - Check for ~/pinokio/bin/ollama
2. start()      - Launch service (or detect existing)
3. askAI()      - Query the LLM with context
4. stop()       - Shutdown on app exit
```

**IPC Channels:**
```
ai:initialize  → Setup AI controller
ai:start       → Start Ollama service
ai:stop        → Stop service
ai:ask         → Query AI with prompt + context
ai:status      → Get service status
```

**Future Use Cases:**
- Error recovery: AI analyzes install failures, suggests fixes
- Smart installs: AI generates install scripts from GitHub repos
- Natural language shell: "Install Stable Diffusion" → AI writes script

---

### 6. AssetManager (`electron/main/services/AssetManager.js`)

**Purpose:** "Global Asset Store" - Deduplication for model files

**Concepts:**
- **GAS Path:** `~/pinokio/storage/gas/`
- **Content-Addressable:** Files stored by URL (e.g., `gas/huggingface.co/user/repo/model.safetensors`)
- **Copy-on-Write:** Apps use symlinks to GAS (or hard copies if symlinks unavailable)

**Workflow:**
```
1. Download model to temporary location
2. registerAsset(url, tempPath) → Move to GAS
3. linkAsset(gasPath, appPath) → Symlink (or copy) to app folder
```

**IPC Channels:**
```
gas:exists   → Check if asset in GAS
gas:link     → Create symlink to asset
gas:register → Register downloaded asset
gas:stats    → Get storage statistics
```

**Platform Notes:**
- Linux/macOS: Symlinks work by default
- Windows: Requires Developer Mode or Admin privileges
- Fallback: Copies file if symlink fails (logs warning)

---

### 7. IpcRouter (`electron/main/ipc/router.js`)

**Purpose:** Centralized IPC management to prevent memory leaks

**Problem Solved:**
- Old code: `ipcMain.handle()` called multiple times → duplicate handlers
- Solution: Registry pattern, auto-cleanup on re-registration

**API:**
```javascript
IpcRouter.on(channel, handler)        // Standard IPC
IpcRouter.handle(channel, asyncHandler) // Async IPC
IpcRouter.off(channel)                 // Remove handler
IpcRouter.removeAll()                  // Cleanup all
```

---

### 8. ConfigService (`electron/main/services/ConfigService.js`)

**Purpose:** Centralized configuration and persistent storage

**Features:**
- Wraps electron-store
- Provides app metadata (version, URLs)
- Singleton pattern for global access

**Migration from `config.js`:**
```javascript
// Old
const config = require('./config')
config.version

// New
const ConfigService = require('./electron/main/services/ConfigService')
ConfigService.get('version')
ConfigService.getStoreValue('mode')
```

---

### 9. UpdateService (`electron/main/services/UpdateService.js`)

**Purpose:** Auto-update wrapper with robust error handling

**Critical Design:**
- **Update failures MUST NOT crash the app**
- Wraps existing `updater.js` with try/catch
- Disables updates on error, app continues running

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     Electron Renderer (UI)                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │ App UI   │  │ Xterm.js │  │ Monaco   │                  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                  │
└───────┼────────────┼─────────────┼─────────────────────────┘
        │            │              │
        └────────────┴──────────────┘
                     │ IPC
┌────────────────────┼─────────────────────────────────────────┐
│        Electron Main Process                                 │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                   IPC Router                         │   │
│  └──────┬───────────┬───────────┬───────────┬──────────┘   │
│         │           │           │           │              │
│   ┌─────▼─────┐ ┌──▼────┐ ┌────▼────┐ ┌────▼─────┐        │
│   │WindowMgr │ │PTYCtrl│ │AICtrl  │ │AssetMgr │        │
│   └───────────┘ └───┬───┘ └───┬────┘ └──────────┘        │
│                     │         │                           │
└─────────────────────┼─────────┼────────────────────────────┘
                      │         │
              ┌───────▼─────┐  ┌▼────────┐
              │ Shell PTY   │  │ Ollama  │
              │ (node-pty)  │  │ Service │
              └─────────────┘  └─────────┘
                      │
              ┌───────▼─────────────────────┐
              │   Pinokiod Backend Server   │
              │   (File system, Scripts)    │
              └─────────────────────────────┘
```

---

## Switching Architectures

**Use BMAD (default):**
```bash
npm start
```

**Use Legacy (fallback):**
```bash
PINOKIO_LEGACY=1 npm start
```

**Enable browser console logging:**
```bash
PINOKIO_BROWSER_LOG=1 npm start
# Logs to ~/.pinokio/logs/browser.log
```

---

## Dependencies Added

```json
{
  "electron-ollama": "^0.1.25",    // Local LLM management
  "node-pty": "^1.0.0",            // Pseudo-terminal for shell
  "@xterm/xterm": "^5.5.0",        // Terminal UI (frontend)
  "@xterm/addon-fit": "^0.10.0",   // Terminal auto-resize
  "monaco-editor": "^0.52.0"       // Code editor (future)
}
```

---

## Migration Status

### ✅ Completed (Phase 1) - December 2, 2025

- [x] Directory structure created
- [x] Dependencies installed
- [x] ConfigService implemented
- [x] UpdateService implemented
- [x] IpcRouter implemented
- [x] PTYController implemented (backend ready)
- [x] AIController implemented (backend ready)
- [x] AssetManager (GAS) implemented
- [x] WindowManager implemented
- [x] BrowserService implemented
- [x] AppController orchestrator implemented
- [x] Entry point (full-bmad.js) created
- [x] main.js updated with architecture switching

### ✅ Completed (Phase 2) - December 2, 2025

- [x] **InspectorService** - Migrated from full.js (~600 lines)
  - Frame tree traversal and selection
  - Cross-iframe inspection with postMessage
  - Element highlighting overlay
  - Screenshot capture integration
  - IPC handlers (start-inspector, stop-inspector, capture-screenshot)

- [x] **Terminal UI Component** - Living Interface (xterm.js)
  - Full xterm.js integration with FitAddon
  - Connects to PTYController backend via IPC
  - Bidirectional terminal I/O
  - Resize handling
  - Session lifecycle management
  - Terminal test page (`electron/renderer/terminal-test.html`)

- [x] **Editor UI Component** - Code/Config Editor (monaco-editor)
  - Multi-language syntax highlighting
  - Theme support (vs-dark, vs, hc-black)
  - Format document action
  - Read-only mode support
  - File type detection

- [x] **Preload.js APIs** - Complete IPC bridge
  - Terminal APIs (`window.electronAPI.terminal.*`)
  - AI APIs (`window.electronAPI.ai.*`)
  - GAS APIs (`window.electronAPI.gas.*`)
  - Inspector APIs (existing, preserved)

- [x] **System Tray Integration** - Background mode
  - Show/hide main window
  - Quick access from system tray
  - Context menu (Show, Hide, Quit)
  - Tray icon with tooltip

### ⏳ Pending (Phase 3 - Future)

- [ ] AI Forge wizard UI (natural language installs)
- [ ] GAS integration with pinokiod download instructions
- [ ] Minimal mode refactoring
- [ ] File system IPC for Editor (save/load via main process)
- [ ] Terminal session persistence across app restarts
- [ ] Monaco editor file tree integration

### 📝 Not Migrated (Preserved in full.js for now)

- Screenshot relay system (complex cross-iframe postMessage relay)
- Some advanced inspector debugging features
- Browser console logging file writer (low priority)

---

## Testing Checklist

### Basic Functionality
- [ ] App boots without errors
- [ ] Pinokiod server starts
- [ ] Main window appears
- [ ] Can navigate to localhost:<PORT>
- [ ] Theme colors apply correctly
- [ ] Splash screen shows and disappears

### Service Tests
- [ ] Terminal: Create PTY session, send input, receive output
- [ ] AI: Initialize controller, detect Ollama, query LLM
- [ ] GAS: Register asset, create symlink, check stats
- [ ] Updates: Check for updates (if available)
- [ ] Windows: Create secondary window, pin/unpin

### IPC Tests
- [ ] All terminal IPC channels work
- [ ] All AI IPC channels work
- [ ] All GAS IPC channels work
- [ ] No duplicate handler warnings in logs

### Error Handling
- [ ] App survives updater failure
- [ ] App survives AI service failure (missing Ollama binary)
- [ ] App survives GAS symlink failure (Windows permissions)
- [ ] Graceful shutdown on quit

---

## Known Limitations

1. **Windows Symlinks:** Require Developer Mode or Admin privileges
   - **Mitigation:** AssetManager falls back to copying files
   - **Warning:** Logs "symlink_unavailable" in response

2. **Ollama Binary:** Not bundled, must be pre-installed or downloaded
   - **Mitigation:** AI features gracefully disabled if missing
   - **Future:** Auto-download via electron-ollama

3. **Inspector System:** Not yet migrated to service
   - **Status:** Still in monolithic full.js
   - **Impact:** Low (rarely used feature)

4. **Minimal Mode:** Not refactored
   - **Status:** Uses original minimal.js
   - **Impact:** None (separate code path)

---

## Architectural Patterns

### 1. Service-Oriented Main Process
Each service is a singleton class with clear responsibilities. Failures in one service (e.g., Updater) don't crash others.

### 2. Pseudo-Terminal Bridge
node-pty spawns real shell processes, xterm.js provides the UI. This allows:
- Ctrl+C interrupts
- Raw keyboard input
- Persistent sessions (survive frontend reloads)

### 3. Content-Addressable Storage
GAS uses URL-based paths, avoiding hash computation overhead:
```
URL:  https://huggingface.co/runwayml/stable-diffusion-v1-5/model.safetensors
Path: ~/pinokio/storage/gas/huggingface.co/runwayml/stable-diffusion-v1-5/model.safetensors
```

### 4. Grafted Architecture
Instead of forking VS Code, we "graft" its libraries:
- xterm.js for terminals
- monaco-editor for code editing
- Lightweight Electron runtime

---

## Security Considerations

### CORS/CSP Modifications
**Risk:** Disabling web security allows embedding arbitrary iframes
**Justification:** Required for AI app UIs (Gradio, Streamlit, etc.)
**Mitigation:**
- Only applies to webContents with Pinokio session
- External links open in system browser
- File system access still sandboxed via Pinokiod

### Symlink Validation
**Risk:** Malicious GAS path could link to system files
**Mitigation:** `isPathSafe()` blocks /etc, /bin, C:\Windows, etc.

### Permission Grants
**Risk:** Granting all permissions (media, display-capture)
**Justification:** AI apps need camera/screen access
**Mitigation:** User installed apps (not arbitrary web pages)

---

## Performance Optimizations

1. **Lazy Service Initialization:**
   - AI Controller only loads electron-ollama if binary exists
   - GAS only scans on-demand (not at startup)

2. **WeakMap for WebContents State:**
   - BrowserService uses WeakMap → auto-GC when webContents destroyed

3. **IPC Handler Registry:**
   - Prevents memory leaks from duplicate bindings

---

## Future Enhancements

### Phase 2: UI Components
1. Terminal drawer (xterm.js) in renderer
2. Monaco editor for config files
3. AI Forge wizard UI

### Phase 3: Intelligence
1. Error recovery: AI analyzes failed installs
2. Natural language installs: "Install ComfyUI" → script generation
3. Smart model recommendations

### Phase 4: Storage
1. Integrate GAS with pinokiod download instructions
2. Shared model cache across all apps
3. Storage usage dashboard

---

## Rollback Plan

If critical issues found in BMAD:

```bash
# Temporary (this session)
PINOKIO_LEGACY=1 npm start

# Permanent (revert main.js)
git checkout main.js
```

Legacy `full.js` remains untouched and fully functional.

---

## Credits

**Architecture Design:** BMAD Team (Fred - Architect)

**Implementation:** Phase 1 Complete (December 2, 2025)

**Philosophy:** "From Puppet to Real Boy" - Pinokio gains autonomy through embedded intelligence and persistent processes.

---

## Questions & Support

For architecture questions, see:
- This document (ARCHITECTURE_BMAD.md)
- Code comments in electron/main/**/*.js
- Original design doc (provided by BMAD Team)

**Legacy Comparison:**
- Old: 2,263 lines in full.js
- New: ~12 modular files, ~2,500 lines total (more maintainable)

---

**Status: Ready for Testing** 🚀
