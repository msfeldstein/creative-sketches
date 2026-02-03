/**
 * DebugPanel - Unified debug panel component for sketches
 * 
 * Features:
 * - Draggable panel with position persistence
 * - Automatic iframe detection (hides in grid view)
 * - Keyboard toggle (D key)
 * - Integrates with DebugControls for schema-based controls
 * - Custom UI hooks for complex visualizations (FFT, audio meters, etc.)
 * - Collapsible sections with <details>
 * - Dev tools section (copy config, reload, live reload)
 * 
 * Usage:
 * ```js
 * import { DebugPanel, createHint } from '/lib/debug-panel.js';
 * 
 * const panel = new DebugPanel({
 *   title: 'My Sketch',
 *   storageKey: 'mySketchSettings',
 *   
 *   // Control schema - same format as DebugControls
 *   schema: {
 *     bloom: { type: 'number', label: 'Bloom', min: 0, max: 100, default: 50, group: 'Visual' },
 *     showStars: { type: 'boolean', label: 'Stars', default: true, group: 'Effects' },
 *   },
 *   
 *   // Optional sections with custom content - rendered BEFORE schema controls
 *   sections: [
 *     { title: 'Actions', content: (container, panel) => {
 *       const btn = document.createElement('button');
 *       btn.className = 'debug-panel-button';
 *       btn.textContent = 'Regenerate';
 *       btn.onclick = () => regenerate();
 *       container.appendChild(btn);
 *     }},
 *     // Collapsible section
 *     { title: 'Advanced', collapsible: true, content: (container, panel) => {
 *       // Add custom canvas, meters, etc.
 *     }},
 *   ],
 *   
 *   // Optional: sections to render AFTER schema controls
 *   afterSections: [...],
 *   
 *   // Optional audio signals integration
 *   audioSignals: myAudioSignals,
 *   
 *   // Callback when any control changes
 *   onChange: (name, value, allValues) => {
 *     // Update your visualization
 *   }
 * });
 * 
 * // Add sections dynamically after creation
 * panel.addSection('Custom', (container) => { ... });
 * panel.addCollapsibleSection('Audio Debug', (container) => { ... });
 * 
 * // Get references to custom elements
 * const fftCanvas = panel.getElement('fftCanvas');
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
      afterSections: options.afterSections || [],
      audioSignals: options.audioSignals || null,
      onChange: options.onChange || null,
      toggleKey: options.toggleKey ?? 'KeyD',
      showAudioPanel: options.showAudioPanel ?? false,
      showDevTools: options.showDevTools ?? true,
      defaultOpen: options.defaultOpen ?? false,
      // Function to get current config for "Copy Config" button
      getConfig: options.getConfig || null,
    };
    
    // Named element references for custom UI
    this.elements = {};
    
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
    
    // Defer applyStoredValues to next microtask so sketch variables are initialized
    queueMicrotask(() => this.applyStoredValues());
  }
  
  /**
   * Apply all stored values by firing onChange for each
   * This ensures the sketch uses localStorage values on startup
   */
  applyStoredValues() {
    if (this.isInIframe || !this.options.onChange) return;
    
    const values = this.getValues();
    for (const [name, value] of Object.entries(values)) {
      this.options.onChange(name, value, values);
    }
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
    
    // Render custom sections first (before schema controls)
    for (const section of this.options.sections) {
      if (section.collapsible) {
        this.addCollapsibleSection(section.title, section.content, section.open);
      } else {
        this.addSection(section.title, section.content);
      }
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
        // Sync main controls FROM group controls (group controls loaded from localStorage)
        for (const name of Object.keys(groupSchema)) {
          this.controls.values[name] = groupControls.values[name];
        }
        groupControls.render(controlsContainer);
        
        // Store reference for updates
        if (!this._groupControls) this._groupControls = {};
        this._groupControls[groupName] = groupControls;
        
        sectionEl.appendChild(controlsContainer);
        this.content.appendChild(sectionEl);
      }
    }
    
    // Render after sections (after schema controls)
    for (const section of this.options.afterSections) {
      if (section.collapsible) {
        this.addCollapsibleSection(section.title, section.content, section.open);
      } else {
        this.addSection(section.title, section.content);
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
   * Add a collapsible section using <details>/<summary>
   */
  addCollapsibleSection(title, contentFn, defaultOpen = false) {
    const details = document.createElement('details');
    details.className = 'debug-panel-details';
    if (defaultOpen) details.open = true;
    
    const summary = document.createElement('summary');
    summary.className = 'debug-panel-summary';
    summary.textContent = title;
    details.appendChild(summary);
    
    const contentContainer = document.createElement('div');
    contentContainer.className = 'debug-panel-details-content';
    
    if (typeof contentFn === 'function') {
      contentFn(contentContainer, this);
    }
    
    details.appendChild(contentContainer);
    this.content.appendChild(details);
    return details;
  }
  
  /**
   * Register a named element for later retrieval
   */
  registerElement(name, element) {
    this.elements[name] = element;
    return element;
  }
  
  /**
   * Get a registered element by name
   */
  getElement(name) {
    return this.elements[name];
  }
  
  /**
   * Create and register a named element
   */
  createElement(tag, name, options = {}) {
    const el = document.createElement(tag);
    if (options.className) el.className = options.className;
    if (options.id) el.id = options.id;
    if (options.style) Object.assign(el.style, options.style);
    if (options.textContent) el.textContent = options.textContent;
    if (name) this.registerElement(name, el);
    return el;
  }
  
  // ==========================================
  // UI HELPER METHODS
  // ==========================================
  
  /**
   * Create a canvas element for visualizations (FFT, etc.)
   */
  createCanvas(name, options = {}) {
    const canvas = document.createElement('canvas');
    canvas.className = options.className || 'debug-panel-canvas';
    if (options.width) canvas.width = options.width;
    if (options.height) canvas.height = options.height;
    Object.assign(canvas.style, {
      width: '100%',
      height: options.styleHeight || '80px',
      ...options.style
    });
    if (name) this.registerElement(name, canvas);
    return canvas;
  }
  
  /**
   * Create an audio meter bar with threshold indicator
   */
  createMeter(name, options = {}) {
    const container = document.createElement('div');
    container.className = 'debug-panel-meter';
    
    const bar = document.createElement('div');
    bar.className = 'debug-panel-meter-bar';
    container.appendChild(bar);
    
    if (options.showThreshold !== false) {
      const threshold = document.createElement('div');
      threshold.className = 'debug-panel-meter-threshold';
      threshold.style.left = (options.thresholdPercent || 50) + '%';
      container.appendChild(threshold);
      if (name) this.registerElement(name + 'Threshold', threshold);
    }
    
    if (options.showLabel !== false) {
      const label = document.createElement('div');
      label.className = 'debug-panel-meter-label';
      label.textContent = options.labelText || '0.00';
      container.appendChild(label);
      if (name) this.registerElement(name + 'Label', label);
    }
    
    if (name) {
      this.registerElement(name, container);
      this.registerElement(name + 'Bar', bar);
    }
    return container;
  }
  
  /**
   * Create a values grid for displaying metrics
   */
  createValuesGrid(values, name) {
    const grid = document.createElement('div');
    grid.className = 'debug-panel-values-grid';
    
    for (const { label, id } of values) {
      const box = document.createElement('div');
      box.className = 'debug-panel-value-box';
      
      const labelEl = document.createElement('div');
      labelEl.className = 'debug-panel-value-label';
      labelEl.textContent = label;
      box.appendChild(labelEl);
      
      const valueEl = document.createElement('div');
      valueEl.className = 'debug-panel-value-num';
      valueEl.textContent = '0.00';
      valueEl.id = id;
      box.appendChild(valueEl);
      
      if (id) this.registerElement(id, valueEl);
      grid.appendChild(box);
    }
    
    if (name) this.registerElement(name, grid);
    return grid;
  }
  
  /**
   * Create a signal bar row (label, bar, value)
   */
  createSignalBar(label, name) {
    const row = document.createElement('div');
    row.className = 'debug-panel-signal-row';
    
    const labelEl = document.createElement('label');
    labelEl.textContent = label;
    row.appendChild(labelEl);
    
    const barContainer = document.createElement('div');
    barContainer.className = 'debug-panel-signal-bar-container';
    const bar = document.createElement('div');
    bar.className = 'debug-panel-signal-bar';
    barContainer.appendChild(bar);
    row.appendChild(barContainer);
    
    const value = document.createElement('span');
    value.className = 'debug-panel-signal-value';
    value.textContent = '0.00';
    row.appendChild(value);
    
    if (name) {
      this.registerElement(name + 'Bar', bar);
      this.registerElement(name + 'Value', value);
    }
    return row;
  }
  
  /**
   * Create a status indicator
   */
  createStatus(text, name) {
    const status = document.createElement('div');
    status.className = 'debug-panel-status';
    status.textContent = text;
    if (name) this.registerElement(name, status);
    return status;
  }
  
  /**
   * Create a select dropdown
   */
  createSelect(options, name, onChange) {
    const select = document.createElement('select');
    select.className = 'debug-panel-select';
    
    for (const opt of options) {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      if (opt.disabled) option.disabled = true;
      select.appendChild(option);
    }
    
    if (onChange) select.onchange = () => onChange(select.value);
    if (name) this.registerElement(name, select);
    return select;
  }
  
  /**
   * Create a row with multiple elements
   */
  createRow(...elements) {
    const row = document.createElement('div');
    row.className = 'debug-panel-row';
    for (const el of elements) {
      row.appendChild(el);
    }
    return row;
  }
  
  /**
   * Create an info text element
   */
  createInfo(text, name) {
    const info = document.createElement('div');
    info.className = 'debug-panel-info';
    info.textContent = text;
    if (name) this.registerElement(name, info);
    return info;
  }
  
  /**
   * Add the dev tools section (collapsible)
   */
  addDevToolsSection() {
    this.addCollapsibleSection('Dev Tools', (container) => {
      // Copy Config button
      if (this.options.getConfig) {
        const btnCopy = document.createElement('button');
        btnCopy.className = 'debug-panel-button';
        btnCopy.textContent = 'Copy Config';
        btnCopy.onclick = async () => {
          const config = this.options.getConfig();
          const configStr = `const DEFAULT_CONFIG = ${JSON.stringify(config, null, 2)};`;
          try {
            await navigator.clipboard.writeText(configStr);
            btnCopy.textContent = 'Copied!';
            setTimeout(() => btnCopy.textContent = 'Copy Config', 1500);
          } catch (e) {
            console.error('Copy this to DEFAULT_CONFIG:\n', configStr);
            btnCopy.textContent = 'Check Console';
            setTimeout(() => btnCopy.textContent = 'Copy Config', 1500);
          }
        };
        container.appendChild(btnCopy);
      }

      // Reload button
      const btnReload = document.createElement('button');
      btnReload.className = 'debug-panel-button';
      btnReload.textContent = 'Reload';
      btnReload.onclick = () => location.reload();
      container.appendChild(btnReload);

      // Live reload checkbox
      const liveReloadLabel = document.createElement('label');
      liveReloadLabel.className = 'debug-panel-checkbox-label';
      const liveReloadCheck = document.createElement('input');
      liveReloadCheck.type = 'checkbox';
      liveReloadCheck.onchange = () => this.toggleLiveReload(liveReloadCheck.checked);
      liveReloadLabel.appendChild(liveReloadCheck);
      liveReloadLabel.appendChild(document.createTextNode(' Live Reload'));
      container.appendChild(liveReloadLabel);
    }, false); // collapsed by default
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
   * Setup drag behavior for the panel (disabled for sidebar style)
   */
  setupDrag() {
    // Sidebar style - no dragging
    return;
    
    /* Original drag code - disabled
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
    */
  }
  
  /**
   * Setup keyboard toggle
   */
  setupKeyboardToggle() {
    window.addEventListener('keydown', (e) => {
      // Check both e.code and e.key for better compatibility
      const keyMatch = e.code === this.options.toggleKey || 
                       (this.options.toggleKey === 'KeyD' && e.key.toLowerCase() === 'd');
      if (keyMatch && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Don't toggle if typing in an input or select
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
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

    // Inject Space Grotesk font
    if (!document.querySelector('link[href*="Space+Grotesk"]')) {
      const fontLink = document.createElement('link');
      fontLink.rel = 'stylesheet';
      fontLink.href = 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500&display=swap';
      document.head.appendChild(fontLink);
    }

    const style = document.createElement('style');
    style.id = 'debug-panel-styles';
    style.textContent = `
      .debug-panel {
        position: fixed;
        top: 40px;
        left: 40px;
        bottom: 40px;
        width: 300px;
        display: flex;
        flex-direction: column;
        z-index: 1000;
        color: #fff;
        font-family: 'Space Grotesk', -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 12px;
        font-weight: 300;
        opacity: 0;
        transform: translateX(-30px);
        pointer-events: none;
        transition: opacity 0.15s ease-out, transform 0.15s ease-out;
      }

      /* Solid backdrop behind panel */
      .debug-panel::before {
        content: '';
        position: absolute;
        top: -40px;
        left: -40px;
        right: -20px;
        bottom: -40px;
        background: rgba(0, 0, 0, 0.5);
        pointer-events: none;
        z-index: -1;
        transition: background 0.3s ease;
      }

      .debug-panel:hover::before {
        background: rgba(0, 0, 0, 0.85);
      }

      .debug-panel.visible {
        opacity: 1;
        transform: translateX(0);
        pointer-events: auto;
      }

      .debug-panel-header {
        margin: 0 0 8px 0;
        padding: 0;
        font-size: 24px;
        font-weight: 300;
        color: #fff;
        letter-spacing: -0.02em;
        cursor: default;
        flex-shrink: 0;
      }

      .debug-panel-header::before {
        content: 'Controls';
        display: block;
        font-size: 10px;
        font-weight: 300;
        color: rgba(255, 255, 255, 0.4);
        text-transform: uppercase;
        letter-spacing: 0.2em;
        margin-bottom: 4px;
      }

      .debug-panel-content {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        padding-right: 12px;
        mask-image: linear-gradient(to bottom, black 85%, transparent 100%);
        -webkit-mask-image: linear-gradient(to bottom, black 85%, transparent 100%);
      }

      .debug-panel-section {
        margin-bottom: 24px;
        position: relative;
        padding-left: 20px;
      }

      .debug-panel-section:last-child {
        margin-bottom: 40px;
      }

      /* Vertical line connecting sections */
      .debug-panel-section::before {
        content: '';
        position: absolute;
        left: 4px;
        top: 8px;
        bottom: -16px;
        width: 1px;
        background: linear-gradient(to bottom, rgba(255, 255, 255, 0.15), transparent);
      }

      .debug-panel-section:last-child::before {
        display: none;
      }

      /* Dot indicator */
      .debug-panel-section::after {
        content: '';
        position: absolute;
        left: 1px;
        top: 4px;
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.2);
        transition: all 0.3s ease;
      }

      .debug-panel-section:hover::after {
        background: rgba(255, 122, 69, 0.8);
        box-shadow: 0 0 12px rgba(255, 122, 69, 0.5);
      }

      .debug-panel-section-title {
        font-size: 13px;
        font-weight: 400;
        color: rgba(255, 255, 255, 0.6);
        margin-bottom: 12px;
        transition: color 0.3s ease;
      }

      .debug-panel-section:hover .debug-panel-section-title {
        color: #fff;
      }

      .debug-panel-section:first-child .debug-panel-section-title {
        border-top: none;
        padding-top: 0;
      }

      .debug-panel-section-content {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      /* Scrollbar */
      .debug-panel-content::-webkit-scrollbar {
        width: 2px;
      }

      .debug-panel-content::-webkit-scrollbar-track {
        background: transparent;
      }

      .debug-panel-content::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.1);
        border-radius: 1px;
      }

      /* Collapsible sections */
      .debug-panel-details {
        margin-bottom: 24px;
        position: relative;
        padding-left: 20px;
      }

      .debug-panel-details::before {
        content: '';
        position: absolute;
        left: 4px;
        top: 8px;
        bottom: -16px;
        width: 1px;
        background: linear-gradient(to bottom, rgba(255, 255, 255, 0.1), transparent);
      }

      .debug-panel-details::after {
        content: '';
        position: absolute;
        left: 1px;
        top: 4px;
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.15);
        transition: all 0.3s ease;
      }

      .debug-panel-details[open]::after {
        background: rgba(255, 122, 69, 0.6);
      }

      .debug-panel-summary {
        font-size: 13px;
        font-weight: 400;
        color: rgba(255, 255, 255, 0.4);
        cursor: pointer;
        padding: 0;
        margin: 0 0 10px 0;
        list-style: none;
        display: flex;
        align-items: center;
        gap: 8px;
        user-select: none;
        transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      }

      .debug-panel-summary::-webkit-details-marker { display: none; }

      .debug-panel-summary::before {
        content: '▶';
        font-size: 8px;
        opacity: 0.4;
        transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      }

      .debug-panel-details[open] .debug-panel-summary::before {
        transform: rotate(90deg);
        opacity: 0.7;
      }

      .debug-panel-details[open] .debug-panel-summary {
        color: rgba(255, 255, 255, 0.6);
      }

      .debug-panel-summary:hover {
        color: rgba(255, 255, 255, 0.8);
      }

      .debug-panel-details-content {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      /* Common custom UI elements */
      .debug-panel-canvas {
        width: 100%;
        height: 80px;
        background: rgba(0, 0, 0, 0.3);
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.06);
      }

      .debug-panel-meter {
        position: relative;
        height: 28px;
        background: rgba(0, 0, 0, 0.3);
        border-radius: 6px;
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, 0.04);
      }

      .debug-panel-meter-bar {
        position: absolute;
        left: 0;
        top: 0;
        height: 100%;
        background: linear-gradient(90deg, #ff7a45, #ff9a6c);
        transition: width 0.05s;
        opacity: 0.9;
      }

      .debug-panel-meter-threshold {
        position: absolute;
        top: 0;
        height: 100%;
        width: 2px;
        background: rgba(255, 255, 255, 0.5);
        box-shadow: 0 0 8px rgba(255, 255, 255, 0.3);
      }

      .debug-panel-meter-label {
        position: absolute;
        right: 8px;
        top: 50%;
        transform: translateY(-50%);
        font-size: 10px;
        font-weight: 400;
        color: rgba(255, 255, 255, 0.6);
        font-family: 'SF Mono', 'Fira Code', monospace;
      }

      .debug-panel-values-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }

      .debug-panel-value-box {
        background: rgba(255, 255, 255, 0.03);
        padding: 10px 12px;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.04);
        transition: all 0.3s ease;
      }

      .debug-panel-value-box:hover {
        background: rgba(255, 255, 255, 0.05);
        border-color: rgba(255, 255, 255, 0.08);
      }

      .debug-panel-value-label {
        color: rgba(255, 255, 255, 0.35);
        font-size: 9px;
        font-weight: 400;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 4px;
      }

      .debug-panel-value-num {
        color: rgba(255, 122, 69, 0.9);
        font-size: 14px;
        font-weight: 400;
        font-family: 'SF Mono', 'Fira Code', monospace;
      }

      .debug-panel-status {
        text-align: center;
        color: rgba(255, 255, 255, 0.3);
        font-size: 10px;
        font-weight: 400;
        padding: 10px;
        background: rgba(255, 255, 255, 0.02);
        border-radius: 6px;
        transition: all 0.3s ease;
      }

      .debug-panel-status.active {
        color: rgba(120, 255, 150, 0.8);
        background: rgba(120, 255, 150, 0.08);
      }

      .debug-panel-signal-row {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 10px;
      }

      .debug-panel-signal-row label {
        min-width: 48px;
        color: rgba(255, 255, 255, 0.4);
        font-weight: 400;
      }

      .debug-panel-signal-bar-container {
        flex: 1;
        height: 4px;
        background: rgba(255, 255, 255, 0.06);
        border-radius: 2px;
        overflow: hidden;
      }

      .debug-panel-signal-bar {
        height: 100%;
        background: linear-gradient(90deg, #ff7a45, #ff9a6c);
        transition: width 0.05s;
        width: 0%;
        border-radius: 2px;
      }

      .debug-panel-signal-value {
        min-width: 36px;
        text-align: right;
        font-family: 'SF Mono', 'Fira Code', monospace;
        font-size: 9px;
        color: rgba(255, 255, 255, 0.4);
      }

      .debug-panel-row {
        display: flex;
        gap: 6px;
        align-items: center;
      }

      .debug-panel-select {
        flex: 1;
        padding: 8px 10px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 6px;
        color: rgba(255, 255, 255, 0.8);
        font-size: 11px;
        font-family: inherit;
        font-weight: 400;
        transition: all 0.3s ease;
        cursor: pointer;
      }

      .debug-panel-select:hover {
        background: rgba(255, 255, 255, 0.06);
        border-color: rgba(255, 255, 255, 0.12);
      }

      .debug-panel-select:focus {
        outline: none;
        border-color: rgba(255, 122, 69, 0.4);
      }

      .debug-panel-info {
        font-size: 10px;
        color: rgba(255, 255, 255, 0.35);
        margin: 6px 0;
        line-height: 1.5;
      }

      .debug-panel-button {
        display: inline-block;
        padding: 8px 16px;
        background: transparent;
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 20px;
        color: rgba(255, 255, 255, 0.5);
        font-size: 11px;
        font-family: inherit;
        font-weight: 400;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        text-align: center;
      }
      
      .debug-panel-button:hover {
        background: rgba(255, 255, 255, 0.05);
        border-color: rgba(255, 255, 255, 0.3);
        color: #fff;
      }
      
      .debug-panel-button:active {
        background: rgba(255, 122, 69, 0.15);
        border-color: rgba(255, 122, 69, 0.4);
        transform: scale(0.97);
      }
      
      .debug-panel-button.active {
        background: rgba(255, 122, 69, 0.2);
        border-color: rgba(255, 122, 69, 0.5);
        color: #ff9a6c;
      }
      
      .debug-panel-checkbox-label {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 0;
        font-size: 12px;
        font-weight: 400;
        cursor: pointer;
        color: rgba(255, 255, 255, 0.6);
        transition: color 0.3s ease;
      }

      .debug-panel-checkbox-label:hover {
        color: rgba(255, 255, 255, 0.9);
      }
      
      .debug-panel-checkbox-label input[type="checkbox"] {
        width: 14px;
        height: 14px;
        cursor: pointer;
        accent-color: #ff7a45;
      }
      
      /* Override debug-controls styles to fit panel theme */
      .debug-panel .debug-controls {
        font-size: 12px;
        font-family: inherit;
      }
      
      .debug-panel .debug-control-group {
        padding: 8px 0;
      }

      .debug-panel .debug-control-label {
        font-size: 11px;
        font-weight: 400;
        color: rgba(255, 255, 255, 0.5);
        transition: color 0.3s ease;
      }

      .debug-panel .debug-control-group:hover .debug-control-label {
        color: rgba(255, 255, 255, 0.8);
      }
      
      .debug-panel .debug-boolean-control input[type="checkbox"] {
        accent-color: #ff7a45;
      }
      
      .debug-panel .debug-trigger-button {
        background: transparent;
        border: 1px solid rgba(255, 122, 69, 0.3);
        color: rgba(255, 122, 69, 0.8);
        border-radius: 6px;
        font-family: inherit;
        font-weight: 400;
        transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      }
      
      .debug-panel .debug-trigger-button:hover {
        background: rgba(255, 122, 69, 0.1);
        border-color: rgba(255, 122, 69, 0.5);
        color: #ff9a6c;
      }
      
      .debug-panel .debug-trigger-indicator {
        background: #ff7a45;
        box-shadow: 0 0 12px rgba(255, 122, 69, 0.5);
      }
      
      .debug-panel .binding-indicator {
        color: rgba(255, 122, 69, 0.8);
      }

      .debug-panel .debug-select-control select {
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 6px;
        color: rgba(255, 255, 255, 0.8);
        font-family: inherit;
        font-size: 11px;
        padding: 8px 10px;
        transition: all 0.3s ease;
      }

      .debug-panel .debug-select-control select:hover {
        background: rgba(255, 255, 255, 0.06);
        border-color: rgba(255, 255, 255, 0.12);
      }

      .debug-panel .debug-select-control select:focus {
        outline: none;
        border-color: rgba(255, 122, 69, 0.4);
      }

      .debug-panel .debug-color-control input[type="color"] {
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 4px;
        background: transparent;
      }

      .debug-panel .debug-color-hex {
        font-family: 'SF Mono', 'Fira Code', monospace;
        font-size: 10px;
        color: rgba(255, 255, 255, 0.5);
      }
      
      /* Keyboard hint styling */
      .debug-hint {
        font-family: 'Space Grotesk', -apple-system, sans-serif !important;
        font-weight: 300 !important;
        letter-spacing: 0.05em !important;
      }

      .debug-hint kbd {
        display: inline-block;
        padding: 2px 6px;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 3px;
        margin: 0 2px;
        font-family: inherit;
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
    color: rgba(255, 255, 255, 0.2);
    font-size: 10px;
    font-family: 'Space Grotesk', -apple-system, BlinkMacSystemFont, sans-serif;
    font-weight: 300;
    pointer-events: none;
    letter-spacing: 0.05em;
  `;
  document.body.appendChild(hint);
  return hint;
}
