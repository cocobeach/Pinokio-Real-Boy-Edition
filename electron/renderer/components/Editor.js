/**
 * Editor Component - monaco-editor integration
 * Provides code/config file editing with syntax highlighting
 * Part of "The Living Interface"
 */

import * as monaco from 'monaco-editor';

class PinokioEditor {
  constructor(containerElement, options = {}) {
    this.container = containerElement;
    this.editor = null;
    this.currentFile = null;

    // Options
    this.options = {
      language: options.language || 'json',
      theme: options.theme || 'vs-dark',
      readOnly: options.readOnly || false,
      minimap: options.minimap !== undefined ? options.minimap : true,
      lineNumbers: options.lineNumbers || 'on',
      fontSize: options.fontSize || 14,
      automaticLayout: true
    };

    this.initialize();
  }

  /**
   * Initialize the editor
   */
  initialize() {
    // Configure Monaco environment
    if (typeof self !== 'undefined' && !self.MonacoEnvironment) {
      self.MonacoEnvironment = {
        getWorkerUrl: function (moduleId, label) {
          if (label === 'json') {
            return './monaco-editor/esm/vs/language/json/json.worker.js';
          }
          if (label === 'css' || label === 'scss' || label === 'less') {
            return './monaco-editor/esm/vs/language/css/css.worker.js';
          }
          if (label === 'html' || label === 'handlebars' || label === 'razor') {
            return './monaco-editor/esm/vs/language/html/html.worker.js';
          }
          if (label === 'typescript' || label === 'javascript') {
            return './monaco-editor/esm/vs/language/typescript/ts.worker.js';
          }
          return './monaco-editor/esm/vs/editor/editor.worker.js';
        }
      };
    }

    // Create editor instance
    this.editor = monaco.editor.create(this.container, {
      value: '',
      language: this.options.language,
      theme: this.options.theme,
      readOnly: this.options.readOnly,
      minimap: { enabled: this.options.minimap },
      lineNumbers: this.options.lineNumbers,
      fontSize: this.options.fontSize,
      automaticLayout: this.options.automaticLayout,
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      wrappingIndent: 'indent',
      tabSize: 2,
      insertSpaces: true
    });

    // Setup event handlers
    this.editor.onDidChangeModelContent(() => {
      this.onContentChange();
    });

    console.log('[PinokioEditor] Editor initialized');
  }

  /**
   * Handle content change
   */
  onContentChange() {
    // Can be overridden by user
    if (this.options.onChange) {
      this.options.onChange(this.getValue());
    }
  }

  /**
   * Load file content
   * @param {string} filePath - Path to file
   * @returns {Promise<boolean>} Success status
   */
  async loadFile(filePath) {
    try {
      // In a real implementation, this would use electron's fs module via IPC
      // For now, this is a placeholder
      console.log(`[PinokioEditor] Loading file: ${filePath}`);

      this.currentFile = filePath;

      // Detect language from file extension
      const ext = filePath.split('.').pop().toLowerCase();
      const languageMap = {
        'js': 'javascript',
        'ts': 'typescript',
        'json': 'json',
        'html': 'html',
        'css': 'css',
        'py': 'python',
        'sh': 'shell',
        'md': 'markdown',
        'yaml': 'yaml',
        'yml': 'yaml',
        'xml': 'xml'
      };

      const language = languageMap[ext] || 'plaintext';
      monaco.editor.setModelLanguage(this.editor.getModel(), language);

      console.log(`[PinokioEditor] File loaded: ${filePath}`);
      return true;

    } catch (error) {
      console.error('[PinokioEditor] Failed to load file:', error);
      return false;
    }
  }

  /**
   * Save current content
   * @returns {Promise<boolean>} Success status
   */
  async save() {
    if (!this.currentFile) {
      console.warn('[PinokioEditor] No file loaded');
      return false;
    }

    try {
      const content = this.getValue();

      // In a real implementation, this would save via IPC
      console.log(`[PinokioEditor] Saving file: ${this.currentFile}`);
      console.log(`[PinokioEditor] Content length: ${content.length} chars`);

      if (this.options.onSave) {
        await this.options.onSave(this.currentFile, content);
      }

      return true;

    } catch (error) {
      console.error('[PinokioEditor] Failed to save file:', error);
      return false;
    }
  }

  /**
   * Get editor content
   * @returns {string} Content
   */
  getValue() {
    return this.editor.getValue();
  }

  /**
   * Set editor content
   * @param {string} value - Content to set
   */
  setValue(value) {
    this.editor.setValue(value);
  }

  /**
   * Set read-only mode
   * @param {boolean} readOnly - Read-only flag
   */
  setReadOnly(readOnly) {
    this.editor.updateOptions({ readOnly });
  }

  /**
   * Set language
   * @param {string} language - Language identifier
   */
  setLanguage(language) {
    monaco.editor.setModelLanguage(this.editor.getModel(), language);
  }

  /**
   * Set theme
   * @param {string} theme - Theme name ('vs', 'vs-dark', 'hc-black')
   */
  setTheme(theme) {
    monaco.editor.setTheme(theme);
  }

  /**
   * Format document
   */
  format() {
    this.editor.getAction('editor.action.formatDocument').run();
  }

  /**
   * Find and replace
   */
  findReplace() {
    this.editor.getAction('actions.find').run();
  }

  /**
   * Focus the editor
   */
  focus() {
    this.editor.focus();
  }

  /**
   * Get current file path
   * @returns {string|null} File path
   */
  getCurrentFile() {
    return this.currentFile;
  }

  /**
   * Check if content has been modified
   * @returns {boolean} True if modified
   */
  isDirty() {
    // Would track original content vs current content
    return false; // Placeholder
  }

  /**
   * Resize the editor
   */
  resize() {
    this.editor.layout();
  }

  /**
   * Destroy the editor
   */
  destroy() {
    if (this.editor) {
      this.editor.dispose();
      this.editor = null;
    }

    console.log('[PinokioEditor] Editor destroyed');
  }

  /**
   * Get editor status
   * @returns {Object} Status information
   */
  getStatus() {
    return {
      currentFile: this.currentFile,
      language: this.editor?.getModel()?.getLanguageId(),
      lineCount: this.editor?.getModel()?.getLineCount(),
      readOnly: this.options.readOnly,
      isDirty: this.isDirty()
    };
  }
}

export default PinokioEditor;
