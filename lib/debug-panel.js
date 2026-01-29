/**
 * DebugPanel - Unified debug panel component for sketches
 * 
 * Features:
 * - Draggable panel with position persistence
 * - Automatic iframe detection (hides in grid view)
 * - Keyboard toggle (D key)
 * - Integrates with DebugControls for schema-based controls
 * - Optional audio panel integration
 * - Dev tools section (copy config, reload, live reload)
 * 
 * Usage:
 * ```js
 * import { DebugPanel } from '/lib/debug-panel.js';
 * 
 * const panel = new DebugPanel({
 *   title: 'My Sketch',
 *   storageKey: 'mySketchSettings',
 *   // Control schema - same format as DebugControls
 *   schema: {
 *     bloom: { type: 'number', label: 'Bloom', min: 0, max: 100, default: 50, group: 'Visual' },
 *     showStars: { type: 'boolean', label: 'Stars', default: true, group: 'Effects' },
 *   },
 *   // Optional sections with custom content
 *   sections: [
 *     { title: 'Actions', content: (container) => {
 *       const btn = document.createElement('button');
 *       btn.textContent = 'Regenerate';
 *       btn.onclick = () => regenerate();
 *       container.appendChild(btn);
 *     }}
 *   ],
 *   // Optional audio signals integration
 *   audioSignals: myAudioSignals,
 *   // Callback when any control changes
 *   onChange: (name, value, allValues) => {
 *     // Update your visualization
 *   }
 * });
 * 
 * // In animation loop:
 * const values = panel.getValues(currentTime);
 * panel.update(currentTime); // Updates bound control UI
 * ```
 */

import { DebugControls } from './debug-controls.js';

export class DebugPanel {
  constructor(options = {}) {
    this.options = {
      title: options.title || 'Debug Panel',
      storageKey: options.storageKey || 'debugPanelSettings',
      schema: options.schema || {},
      sections: options.sections || [],
      audioSignals: options.audioSignals || null,
      onChange: options.onChange || null,
      toggleKey: options.toggleKey ?? 'KeyD',
      showAudioPanel: options.showAudioPanel ?? false,
      showDevTools: options.showDevTools ?? true,
      defaultOpen: options.defaultOpen ?? false,
      // Function to get current config for "Copy Config" button
      getConfig: options.getConfig || null,
    };
    
    // Check if we're in an iframe (grid view)
    this.isInIframe = window.self !== window.top;
    
    // Don't render anything in iframe mode
    if (this.isInIframe) {
      this.controls = null;
      this.panel = null;
      // Create a minimal controls object that just returns defaults
      this._defaultValues = {};
      for (const [name, config] of Object.entries(this.options.schema)) {
        this._defaultValues[name] = config.default;
      }
      return;
    }
    
    // Create DebugControls instance for schema-based controls
    this.controls = new DebugControls(this.options.schema, {
      storageKey: this.options.storageKey + '_controls',
      audioSignals: this.options.audioSignals,
      onChange: (name, value) => {
        if (this.options.onChange) {
          this.options.onChange(name, value, this.getValues());
        }
      }
    });
    
    // Panel state
    this.isVisible = false;
    this.isDragging = false;
    this.dragStart = { x: 0, y: 0 };
    this.panelStart = { x: 0, y: 0 };
    this.liveReloadInterval = null;
    
    // Create the panel
    this.createPanel();
    this.loadPanelState();
    this.setupKeyboardToggle();
    this.injectStyles();
  }
  
  /**
   * Create the panel DOM structure
   */
  createPanel() {
    // Main panel container
    this.panel = document.createElement('div');
    this.panel.className = 'debug-panel';
    this.panel.id = 'debugPanel';
    
    // Header (draggable)
    this.header = document.createElement('h3');
    this.header.className = 'debug-panel-header';
    this.header.textContent = this.options.title;
    this.panel.appendChild(this.header);
    
    // Content container
    this.content = document.createElement('div');
    this.content.className = 'debug-panel-content';
    this.panel.appendChild(this.content);
    
    // Render custom sections first
    for (const section of this.options.sections) {
      this.addSection(section.title, section.content);
    }
    
    // Render schema-based controls grouped by their 'group' property
    if (Object.keys(this.options.schema).length > 0) {
      const groups = this.groupSchemaByGroup();
      for (const [groupName, controls] of Object.entries(groups)) {
        const sectionEl = this.createSectionElement(groupName === 'default' ? 'Controls' : groupName);
        const controlsContainer = document.createElement('div');
        controlsContainer.className = 'debug-controls-container';
        
        // Create a subset schema for this group
        const groupSchema = {};
        for (const { name, config } of controls) {
          groupSchema[name] = config;
        }
        
        // Render controls for this group
        const groupControls = new DebugControls(groupSchema, {
          storageKey: this.options.storageKey + '_' + groupName,
          audioSignals: this.options.audioSignals,
          onChange: (name, value) => {
            // Sync to main controls
            this.controls.values[name] = value;
            if (this.options.onChange) {
              this.options.onChange(name, value, this.getValues());
            }
          }
        });
        // Copy loaded values from main controls
        for (const name of Object.keys(groupSchema)) {
          groupControls.values[name] = this.controls.values[name];
        }
        groupControls.render(controlsContainer);
        
        // Store reference for updates
        if (!this._groupControls) this._groupControls = {};
        this._groupControls[groupName] = groupControls;
        
        sectionEl.appendChild(controlsContainer);
        this.content.appendChild(sectionEl);
      }
    }
    
    // Dev tools section
    if (this.options.showDevTools) {
      this.addDevToolsSection();
    }
    
    // Setup drag behavior
    this.setupDrag();
    
    // Add to document
    document.body.appendChild(this.panel);
    
    // Show if default open
    if (this.options.defaultOpen) {
      this.show();
    }
  }
  
  /**
   * Group schema controls by their 'group' property
   */
  groupSchemaByGroup() {
    const groups = {};
    for (const [name, config] of Object.entries(this.options.schema)) {
      const groupName = config.group || 'default';
      if (!groups[groupName]) groups[groupName] = [];
      groups[groupName].push({ name, config });
    }
    return groups;
  }
  
  /**
   * Create a section element
   */
  createSectionElement(title) {
    const section = document.createElement('div');
    section.className = 'debug-panel-section';
    
    if (title) {
      const titleEl = document.createElement('div');
      titleEl.className = 'debug-panel-section-title';
      titleEl.textContent = title;
      section.appendChild(titleEl);
    }
    
    return section;
  }
  
  /**
   * Add a custom section to the panel
   */
  addSection(title, contentFn) {
    const section = this.createSectionElement(title);
    const contentContainer = document.createElement('div');
    contentContainer.className = 'debug-panel-section-content';
    
    if (typeof contentFn === 'function') {
      contentFn(contentContainer, this);
    }
    
    section.appendChild(contentContainer);
    this.content.appendChild(section);
    return section;
  }
  
  /**
   * Add the dev tools section
   */
  addDevToolsSection() {
    this.addSection('Dev Tools', (container) => {
      // Copy Config button
      if (this.options.getConfig) {
        const btnCopy = document.createElement('button');
        btnCopy.className = 'debug-panel-button';
        btnCopy.textContent = 'Copy Config to Clipboard';
        btnCopy.onclick = async () => {
          const config = this.options.getConfig();
          const configStr = `const DEFAULT_CONFIG = ${JSON.stringify(config, null, 2)};`;
          try {
            await navigator.clipboard.writeText(configStr);
            btnCopy.textContent = 'Copied!';
            setTimeout(() => btnCopy.textContent = 'Copy Config to Clipboard', 1500);
          } catch (e) {
            console.log('Copy this to DEFAULT_CONFIG:\n', configStr);
            btnCopy.textContent = 'Check Console';
            setTimeout(() => btnCopy.textContent = 'Copy Config to Clipboard', 1500);
          }
        };
        container.appendChild(btnCopy);
      }
      
      // Reload button
      const btnReload = document.createElement('button');
      btnReload.className = 'debug-panel-button';
      btnReload.textContent = 'Reload Page';
      btnReload.onclick = () => location.reload();
      container.appendChild(btnReload);
      
      // Live reload checkbox
      const liveReloadLabel = document.createElement('label');
      liveReloadLabel.className = 'debug-panel-checkbox-label';
      const liveReloadCheck = document.createElement('input');
      liveReloadCheck.type = 'checkbox';
      liveReloadCheck.onchange = () => this.toggleLiveReload(liveReloadCheck.checked);
      liveReloadLabel.appendChild(liveReloadCheck);
      liveReloadLabel.appendChild(document.createTextNode(' Live Reload (2s)'));
      container.appendChild(liveReloadLabel);
    });
  }
  
  /**
   * Toggle live reload polling
   */
  toggleLiveReload(enabled) {
    if (enabled) {
      let lastModified = null;
      this.liveReloadInterval = setInterval(async () => {
        try {
          const response = await fetch(location.href, { method: 'HEAD' });
          const modified = response.headers.get('last-modified');
          if (lastModified && modified !== lastModified) {
            location.reload();
          }
          lastModified = modified;
        } catch (e) {
          // Ignore fetch errors
        }
      }, 2000);
    } else {
      if (this.liveReloadInterval) {
        clearInterval(this.liveReloadInterval);
        this.liveReloadInterval = null;
      }
    }
  }
  
  /**
   * Setup drag behavior for the panel
   */
  setupDrag() {
    this.header.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.panel.classList.add('dragging');
      this.dragStart = { x: e.clientX, y: e.clientY };
      const rect = this.panel.getBoundingClientRect();
      this.panelStart = { x: rect.left, y: rect.top };
      e.preventDefault();
    });
    
    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.dragStart.x;
      const dy = e.clientY - this.dragStart.y;
      let newX = this.panelStart.x + dx;
      let newY = this.panelStart.y + dy;
      
      // Keep panel on screen
      const rect = this.panel.getBoundingClientRect();
      newX = Math.max(0, Math.min(window.innerWidth - rect.width, newX));
      newY = Math.max(0, Math.min(window.innerHeight - rect.height, newY));
      
      this.panel.style.left = newX + 'px';
      this.panel.style.top = newY + 'px';
      this.panel.style.right = 'auto';
    });
    
    window.addEventListener('mouseup', () => {
      if (this.isDragging) {
        this.isDragging = false;
        this.panel.classList.remove('dragging');
        this.savePanelState();
      }
    });
  }
  
  /**
   * Setup keyboard toggle
   */
  setupKeyboardToggle() {
    window.addEventListener('keydown', (e) => {
      if (e.code === this.options.toggleKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Don't toggle if typing in an input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        this.toggle();
      }
    });
  }
  
  /**
   * Show the panel
   */
  show() {
    if (this.isInIframe || !this.panel) return;
    this.isVisible = true;
    this.panel.classList.add('visible');
    this.savePanelState();
  }
  
  /**
   * Hide the panel
   */
  hide() {
    if (!this.panel) return;
    this.isVisible = false;
    this.panel.classList.remove('visible');
    this.savePanelState();
  }
  
  /**
   * Toggle panel visibility
   */
  toggle() {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }
  
  /**
   * Save panel state (position, visibility) to localStorage
   */
  savePanelState() {
    if (!this.panel) return;
    try {
      const rect = this.panel.getBoundingClientRect();
      const state = {
        visible: this.isVisible,
        x: this.panel.style.left ? rect.left : null,
        y: this.panel.style.top ? rect.top : null,
      };
      localStorage.setItem(this.options.storageKey + '_panel', JSON.stringify(state));
    } catch (e) {
      // Ignore storage errors
    }
  }
  
  /**
   * Load panel state from localStorage
   */
  loadPanelState() {
    if (!this.panel) return;
    try {
      const saved = localStorage.getItem(this.options.storageKey + '_panel');
      if (saved) {
        const state = JSON.parse(saved);
        if (state.visible) {
          this.show();
        }
        if (state.x !== null && state.y !== null) {
          this.panel.style.left = state.x + 'px';
          this.panel.style.top = state.y + 'px';
          this.panel.style.right = 'auto';
        }
      }
    } catch (e) {
      // Ignore storage errors
    }
  }
  
  /**
   * Get current value for a control
   * @param {string} name - Control name
   * @param {number} time - Current time (for signal binding)
   */
  get(name, time = 0) {
    if (this.isInIframe) {
      return this._defaultValues[name];
    }
    return this.controls?.get(name, time) ?? this._defaultValues?.[name];
  }
  
  /**
   * Get all current values
   * @param {number} time - Current time (for signal binding)
   */
  getValues(time = 0) {
    if (this.isInIframe) {
      return { ...this._defaultValues };
    }
    
    // Collect values from all group controls
    const values = {};
    if (this._groupControls) {
      for (const groupControls of Object.values(this._groupControls)) {
        for (const [name, value] of Object.entries(groupControls.values)) {
          values[name] = groupControls.get(name, time);
        }
      }
    }
    return values;
  }
  
  /**
   * Set a control value programmatically
   */
  set(name, value) {
    if (this.isInIframe) return;
    
    // Find which group control has this name
    if (this._groupControls) {
      for (const groupControls of Object.values(this._groupControls)) {
        if (name in groupControls.schema) {
          groupControls.set(name, value);
          break;
        }
      }
    }
    
    if (this.controls) {
      this.controls.values[name] = value;
    }
  }
  
  /**
   * Set track data for audio signal binding
   */
  setTrackData(trackData) {
    if (this._groupControls) {
      for (const groupControls of Object.values(this._groupControls)) {
        groupControls.setTrackData(trackData);
      }
    }
    if (this.controls) {
      this.controls.setTrackData(trackData);
    }
  }
  
  /**
   * Update the UI (call in animation loop to update bound controls)
   */
  update(time = 0) {
    if (this.isInIframe || !this.isVisible) return;
    
    if (this._groupControls) {
      for (const groupControls of Object.values(this._groupControls)) {
        groupControls.updateUI(time);
      }
    }
  }
  
  /**
   * Add a button to a section
   */
  addButton(sectionTitle, label, onClick) {
    // Find or create section
    let section = Array.from(this.content.querySelectorAll('.debug-panel-section')).find(
      s => s.querySelector('.debug-panel-section-title')?.textContent === sectionTitle
    );
    
    if (!section) {
      section = this.createSectionElement(sectionTitle);
      const contentContainer = document.createElement('div');
      contentContainer.className = 'debug-panel-section-content';
      section.appendChild(contentContainer);
      // Insert before dev tools if present
      const devToolsSection = Array.from(this.content.querySelectorAll('.debug-panel-section')).find(
        s => s.querySelector('.debug-panel-section-title')?.textContent === 'Dev Tools'
      );
      if (devToolsSection) {
        this.content.insertBefore(section, devToolsSection);
      } else {
        this.content.appendChild(section);
      }
    }
    
    const contentContainer = section.querySelector('.debug-panel-section-content');
    const btn = document.createElement('button');
    btn.className = 'debug-panel-button';
    btn.textContent = label;
    btn.onclick = onClick;
    contentContainer.appendChild(btn);
    return btn;
  }
  
  /**
   * Inject panel styles
   */
  injectStyles() {
    if (document.getElementById('debug-panel-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'debug-panel-styles';
    style.textContent = `
      .debug-panel {
        position: fixed;
        top: 20px;
        right: 20px;
        background: rgba(0, 0, 0, 0.85);
        border: 1px solid rgba(100, 200, 255, 0.3);
        border-radius: 8px;
        padding: 0;
        color: #fff;
        min-width: 220px;
        max-width: 300px;
        display: none;
        z-index: 1000;
        max-height: calc(100vh - 40px);
        overflow-y: auto;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px;
      }
      
      .debug-panel.visible {
        display: block;
      }
      
      .debug-panel.dragging {
        user-select: none;
      }
      
      .debug-panel-header {
        margin: 0;
        padding: 12px 16px;
        font-size: 14px;
        font-weight: 600;
        color: rgba(100, 200, 255, 0.9);
        text-transform: uppercase;
        letter-spacing: 1px;
        cursor: grab;
        background: rgba(100, 200, 255, 0.1);
        border-radius: 8px 8px 0 0;
        border-bottom: 1px solid rgba(100, 200, 255, 0.2);
      }
      
      .debug-panel-header:active {
        cursor: grabbing;
      }
      
      .debug-panel-content {
        padding: 8px 16px 16px;
      }
      
      .debug-panel-section {
        margin-bottom: 16px;
      }
      
      .debug-panel-section:last-child {
        margin-bottom: 0;
      }
      
      .debug-panel-section-title {
        font-size: 11px;
        color: rgba(255, 255, 255, 0.5);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 8px;
        padding-top: 8px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
      }
      
      .debug-panel-section:first-child .debug-panel-section-title {
        border-top: none;
        padding-top: 0;
      }
      
      .debug-panel-section-content {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      
      .debug-panel-button {
        display: block;
        width: 100%;
        padding: 8px 12px;
        background: rgba(100, 200, 255, 0.15);
        border: 1px solid rgba(100, 200, 255, 0.3);
        border-radius: 4px;
        color: #fff;
        font-size: 13px;
        cursor: pointer;
        transition: all 0.2s;
        text-align: center;
      }
      
      .debug-panel-button:hover {
        background: rgba(100, 200, 255, 0.25);
        border-color: rgba(100, 200, 255, 0.5);
      }
      
      .debug-panel-button:active {
        background: rgba(100, 200, 255, 0.35);
        transform: scale(0.98);
      }
      
      .debug-panel-button.active {
        background: rgba(100, 200, 255, 0.4);
        border-color: rgba(100, 200, 255, 0.7);
      }
      
      .debug-panel-checkbox-label {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 0;
        font-size: 13px;
        cursor: pointer;
        color: rgba(255, 255, 255, 0.8);
      }
      
      .debug-panel-checkbox-label input[type="checkbox"] {
        width: 16px;
        height: 16px;
        cursor: pointer;
        accent-color: rgba(100, 200, 255, 0.8);
      }
      
      /* Override debug-controls styles to fit panel theme */
      .debug-panel .debug-controls {
        font-size: 13px;
      }
      
      .debug-panel .debug-control-group {
        padding: 6px 0;
      }
      
      .debug-panel .debug-number-control input[type="range"] {
        accent-color: rgba(100, 200, 255, 0.8);
      }
      
      .debug-panel .debug-boolean-control input[type="checkbox"] {
        accent-color: rgba(100, 200, 255, 0.8);
      }
      
      .debug-panel .debug-trigger-button {
        background: rgba(100, 200, 255, 0.2);
        border-color: rgba(100, 200, 255, 0.4);
        color: rgba(100, 200, 255, 0.9);
      }
      
      .debug-panel .debug-trigger-button:hover {
        background: rgba(100, 200, 255, 0.3);
        border-color: rgba(100, 200, 255, 0.6);
      }
      
      .debug-panel .debug-trigger-indicator {
        background: rgba(100, 200, 255, 0.9);
      }
      
      .debug-panel .binding-indicator {
        color: rgba(100, 200, 255, 0.9);
      }
      
      /* Scrollbar styling */
      .debug-panel::-webkit-scrollbar {
        width: 6px;
      }
      
      .debug-panel::-webkit-scrollbar-track {
        background: rgba(0, 0, 0, 0.2);
        border-radius: 3px;
      }
      
      .debug-panel::-webkit-scrollbar-thumb {
        background: rgba(100, 200, 255, 0.3);
        border-radius: 3px;
      }
      
      .debug-panel::-webkit-scrollbar-thumb:hover {
        background: rgba(100, 200, 255, 0.5);
      }
    `;
    document.head.appendChild(style);
  }
  
  /**
   * Destroy the panel and clean up
   */
  destroy() {
    if (this.liveReloadInterval) {
      clearInterval(this.liveReloadInterval);
    }
    if (this.panel) {
      this.panel.remove();
    }
  }
}

/**
 * Helper to create a hint element that auto-hides in iframe
 */
export function createHint(text) {
  if (window.self !== window.top) return null;
  
  const hint = document.createElement('div');
  hint.className = 'debug-hint';
  hint.textContent = text;
  hint.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 20px;
    color: rgba(255, 255, 255, 0.3);
    font-size: 12px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    pointer-events: none;
    letter-spacing: 0.5px;
  `;
  document.body.appendChild(hint);
  return hint;
}
