/**
 * Debug Controls - Generalized UI control system with audio signal binding
 * 
 * Define controls in a schema, render UI automatically, and bind to audio signals.
 * 
 * Schema format:
 * {
 *   controlName: {
 *     type: 'number' | 'boolean' | 'select' | 'trigger',
 *     label: 'Display Name',
 *     default: defaultValue,
 *     // For number type:
 *     min: 0, max: 100, step: 1,
 *     // For select type:
 *     options: ['option1', 'option2'] or [{value: 'val', label: 'Label'}, ...]
 *     // For trigger type:
 *     onTrigger: (velocity) => { ... } // Called when triggered manually or by signal
 *   }
 * }
 */

export class DebugControls {
  constructor(schema, options = {}) {
    this.schema = schema;
    this.values = {};
    this.bindings = {}; // controlName -> { trackIndex, trackType, ... }
    this.elements = {};
    this.container = null;
    this.audioSignals = options.audioSignals || null;
    this.trackData = null;
    this.onChange = options.onChange || null;
    this.storageKey = options.storageKey || 'debugControlsState';
    
    // Track trigger states for edge detection
    this._triggerStates = {}; // controlName -> { lastValue, lastTriggerTime }
    
    // Initialize default values
    for (const [name, config] of Object.entries(schema)) {
      this.values[name] = config.default;
      if (config.type === 'trigger') {
        this._triggerStates[name] = { lastValue: 0, lastTriggerTime: -Infinity };
      }
    }
    
    // Load saved state
    this.loadState();
  }
  
  /**
   * Render the controls into a container element
   * @param {HTMLElement} container - The container to render into
   * @param {Object} options - Render options
   * @param {boolean} options.grouped - Whether to group controls by their 'group' property
   */
  render(container, options = {}) {
    this.container = container;
    container.innerHTML = '';
    container.classList.add('debug-controls');
    
    const { grouped = false } = options;
    
    // Organize controls by group if requested
    const groups = {};
    for (const [name, config] of Object.entries(this.schema)) {
      const groupName = grouped ? (config.group || 'default') : 'default';
      if (!groups[groupName]) groups[groupName] = [];
      groups[groupName].push({ name, config });
    }
    
    for (const [groupName, controls] of Object.entries(groups)) {
      // Add group header if grouped and not default
      if (grouped && groupName !== 'default') {
        const header = document.createElement('div');
        header.className = 'debug-group-header';
        header.textContent = groupName.charAt(0).toUpperCase() + groupName.slice(1);
        container.appendChild(header);
      }
      
      for (const { name, config } of controls) {
        const group = document.createElement('div');
        group.className = 'debug-control-group';
        group.dataset.control = name;
        
        const label = document.createElement('label');
        label.textContent = config.label || name;
        label.className = 'debug-control-label';
        
        const binding = this.bindings[name];
        if (binding) {
          const bindingIndicator = document.createElement('span');
          bindingIndicator.className = 'binding-indicator';
          bindingIndicator.textContent = ` ⟵ ${binding.signalName}`;
          bindingIndicator.title = 'Right-click to unbind';
          label.appendChild(bindingIndicator);
        }
        
        let input;
        
        if (config.type === 'number') {
          input = this.createNumberControl(name, config);
        } else if (config.type === 'boolean') {
          input = this.createBooleanControl(name, config);
        } else if (config.type === 'select') {
          input = this.createSelectControl(name, config);
        } else if (config.type === 'trigger') {
          input = this.createTriggerControl(name, config);
        }
        
        if (input) {
          this.elements[name] = input;
          group.appendChild(label);
          group.appendChild(input);
          
          // Right-click to bind (triggers can bind to beat/trigger signals)
          group.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showBindingMenu(e.clientX, e.clientY, name);
          });
        }
        
        container.appendChild(group);
      }
    }
    
    this.injectStyles();
  }
  
  createNumberControl(name, config) {
    const wrapper = document.createElement('div');
    wrapper.className = 'debug-number-control';
    
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = config.min ?? 0;
    slider.max = config.max ?? 100;
    slider.step = config.step ?? 1;
    slider.value = this.values[name];
    
    const valueDisplay = document.createElement('span');
    valueDisplay.className = 'debug-value';
    const unit = config.unit || '';
    valueDisplay.textContent = Math.round(this.values[name]) + unit;

    slider.addEventListener('input', () => {
      const val = parseFloat(slider.value);
      this.values[name] = val;
      valueDisplay.textContent = Math.round(val) + unit;
      this.saveState();
      if (this.onChange) this.onChange(name, val);
    });
    
    wrapper.appendChild(slider);
    wrapper.appendChild(valueDisplay);
    wrapper._slider = slider;
    wrapper._valueDisplay = valueDisplay;
    wrapper._unit = unit;
    
    return wrapper;
  }
  
  createBooleanControl(name, config) {
    const wrapper = document.createElement('div');
    wrapper.className = 'debug-boolean-control';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = this.values[name];
    
    checkbox.addEventListener('change', () => {
      this.values[name] = checkbox.checked;
      this.saveState();
      if (this.onChange) this.onChange(name, checkbox.checked);
    });
    
    wrapper.appendChild(checkbox);
    wrapper._checkbox = checkbox;
    
    return wrapper;
  }
  
  createSelectControl(name, config) {
    const select = document.createElement('select');
    select.className = 'debug-select-control';
    
    for (const opt of config.options) {
      const option = document.createElement('option');
      if (typeof opt === 'object') {
        option.value = opt.value;
        option.textContent = opt.label;
      } else {
        option.value = opt;
        option.textContent = opt;
      }
      if (option.value === this.values[name]) {
        option.selected = true;
      }
      select.appendChild(option);
    }
    
    select.addEventListener('change', () => {
      this.values[name] = select.value;
      this.saveState();
      if (this.onChange) this.onChange(name, select.value);
    });
    
    return select;
  }
  
  createTriggerControl(name, config) {
    const wrapper = document.createElement('div');
    wrapper.className = 'debug-trigger-control';
    
    const button = document.createElement('button');
    button.className = 'debug-trigger-button';
    button.textContent = config.buttonLabel || '⚡';
    button.title = 'Click to trigger, right-click to bind';
    
    const indicator = document.createElement('div');
    indicator.className = 'debug-trigger-indicator';
    
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      this.fireTrigger(name, 1.0);
    });
    
    wrapper.appendChild(button);
    wrapper.appendChild(indicator);
    wrapper._button = button;
    wrapper._indicator = indicator;
    
    return wrapper;
  }
  
  /**
   * Fire a trigger control
   * @param {string} name - Control name
   * @param {number} velocity - Trigger velocity (0-1)
   */
  fireTrigger(name, velocity = 1.0) {
    const config = this.schema[name];
    if (!config || config.type !== 'trigger') return;
    
    // Visual feedback
    const element = this.elements[name];
    if (element) {
      const indicator = element._indicator;
      const button = element._button;
      if (indicator) {
        indicator.style.opacity = velocity;
        indicator.style.transform = `scale(${0.8 + velocity * 0.4})`;
        setTimeout(() => {
          indicator.style.opacity = 0;
          indicator.style.transform = 'scale(0.8)';
        }, 100);
      }
      if (button) {
        button.classList.add('triggered');
        setTimeout(() => button.classList.remove('triggered'), 100);
      }
    }
    
    // Call the trigger callback
    if (config.onTrigger) {
      config.onTrigger(velocity);
    }
    
    // Also call onChange for consistency
    if (this.onChange) {
      this.onChange(name, velocity);
    }
  }
  
  /**
   * Show the binding context menu
   */
  showBindingMenu(x, y, controlName) {
    this.hideBindingMenu();
    
    const menu = document.createElement('div');
    menu.className = 'debug-binding-menu';
    
    const existingBinding = this.bindings[controlName];
    
    // Header
    const header = document.createElement('div');
    header.className = 'debug-binding-header';
    header.textContent = existingBinding ? 'Change Binding' : 'Bind to Signal';
    menu.appendChild(header);
    
    // If already bound, show unbind option
    if (existingBinding) {
      const unbindItem = document.createElement('div');
      unbindItem.className = 'debug-binding-item unbind';
      unbindItem.textContent = '✕ Remove Binding';
      unbindItem.addEventListener('click', () => {
        delete this.bindings[controlName];
        this.saveState();
        this.render(this.container);
        this.hideBindingMenu();
      });
      menu.appendChild(unbindItem);
      
      const separator = document.createElement('div');
      separator.className = 'debug-binding-separator';
      menu.appendChild(separator);
    }
    
    // Get available signals from track data
    const signals = this.getAvailableSignals();
    
    if (signals.length === 0) {
      const noSignals = document.createElement('div');
      noSignals.className = 'debug-binding-item disabled';
      noSignals.textContent = 'No track loaded';
      menu.appendChild(noSignals);
    } else {
      for (const signal of signals) {
        const item = document.createElement('div');
        item.className = 'debug-binding-item';
        if (existingBinding?.signalName === signal.name) {
          item.classList.add('active');
        }
        item.innerHTML = `<span class="signal-type" style="color:${signal.color}">${signal.type}</span> ${signal.name}`;
        item.addEventListener('click', () => {
          this.bindings[controlName] = {
            signalName: signal.name,
            signalType: signal.type,
            signalConfig: signal.config
          };
          this.saveState();
          this.render(this.container);
          this.hideBindingMenu();
        });
        menu.appendChild(item);
      }
    }
    
    // Position menu
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    document.body.appendChild(menu);
    
    // Adjust if off-screen
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = (x - rect.width) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = (y - rect.height) + 'px';
    }
    
    this._activeMenu = menu;
    
    // Close on click outside
    setTimeout(() => {
      document.addEventListener('click', this._closeMenuHandler = (e) => {
        if (!menu.contains(e.target)) {
          this.hideBindingMenu();
        }
      });
    }, 0);
  }
  
  hideBindingMenu() {
    if (this._activeMenu) {
      this._activeMenu.remove();
      this._activeMenu = null;
    }
    if (this._closeMenuHandler) {
      document.removeEventListener('click', this._closeMenuHandler);
      this._closeMenuHandler = null;
    }
  }
  
  /**
   * Get available signals from the loaded track data
   */
  getAvailableSignals() {
    const signals = [];
    const trackData = this.trackData || this.audioSignals?.trackData;
    
    if (!trackData) return signals;
    
    const colors = {
      beat: '#ff6b35',
      frequency: '#a855f7',
      automation: '#00d4ff',
      trigger: '#fbbf24'
    };
    
    // Add signals from signalTracks if available
    if (trackData.signalTracks) {
      for (const track of trackData.signalTracks) {
        signals.push({
          name: track.name,
          type: track.type,
          color: colors[track.type] || '#888',
          config: track
        });
      }
    }
    
    // Add built-in frequency bands
    if (trackData.frequency) {
      for (const band of ['sub', 'bass', 'mid', 'high']) {
        if (trackData.frequency[band]) {
          signals.push({
            name: `Frequency: ${band}`,
            type: 'frequency',
            color: colors.frequency,
            config: { type: 'frequency', subtype: band }
          });
        }
      }
    }
    
    // Add built-in beat types
    if (trackData.beats) {
      for (const beatType of ['all', 'kicks', 'snares', 'hihats']) {
        if (trackData.beats[beatType]?.length > 0) {
          signals.push({
            name: `Beats: ${beatType}`,
            type: 'beat',
            color: colors.beat,
            config: { type: 'beat', subtype: beatType, decay: 0.1 }
          });
        }
      }
    }
    
    return signals;
  }
  
  /**
   * Set the track data for signal binding
   */
  setTrackData(trackData) {
    this.trackData = trackData;
  }
  
  /**
   * Get current value for a control (applying any signal binding)
   * Call this in your animation loop
   * @param {string} name - Control name
   * @param {number} time - Current playback time (for signal evaluation)
   * @returns {*} The current value
   */
  get(name, time = 0) {
    const binding = this.bindings[name];
    const config = this.schema[name];
    
    if (binding && this.trackData) {
      const signalValue = this.evaluateSignal(binding, time);
      
      // Map 0-1 signal to control's range
      if (config.type === 'number') {
        const min = config.min ?? 0;
        const max = config.max ?? 100;
        return min + signalValue * (max - min);
      } else if (config.type === 'boolean') {
        return signalValue > 0.5;
      }
      // For select, use the base value (binding not super useful)
    }
    
    return this.values[name];
  }
  
  /**
   * Get all current values as an object
   * @param {number} time - Current playback time
   * @returns {Object} All control values
   */
  getAll(time = 0) {
    const result = {};
    for (const name of Object.keys(this.schema)) {
      result[name] = this.get(name, time);
    }
    return result;
  }
  
  /**
   * Evaluate a signal binding at the given time
   */
  evaluateSignal(binding, time) {
    const { signalConfig } = binding;
    const trackData = this.trackData;
    
    if (!trackData || !signalConfig) return 0;
    
    if (signalConfig.type === 'beat') {
      const beats = trackData.beats?.[signalConfig.subtype] || [];
      const decay = signalConfig.decay || 0.1;
      let value = 0;
      for (const bt of beats) {
        if (bt <= time && bt > time - decay) {
          value = Math.max(value, 1 - (time - bt) / decay);
        }
      }
      return value;
    }
    
    if (signalConfig.type === 'frequency') {
      const freq = trackData.frequency?.[signalConfig.subtype];
      if (!freq) return 0;
      const sampleRate = trackData.frequency.sampleRate || 30;
      const idx = Math.floor(time * sampleRate);
      const gain = signalConfig.gain || 1;
      return Math.min(1, (freq[Math.min(idx, freq.length - 1)] || 0) * gain);
    }
    
    if (signalConfig.type === 'automation' && signalConfig.points) {
      return this.interpolateAutomation(signalConfig.points, time);
    }
    
    if (signalConfig.type === 'trigger' && signalConfig.triggers) {
      const decay = signalConfig.decay || 0.1;
      let value = 0;
      for (const t of signalConfig.triggers) {
        if (t.time <= time && t.time > time - decay) {
          value = Math.max(value, t.velocity * (1 - (time - t.time) / decay));
        }
      }
      return value;
    }
    
    return 0;
  }
  
  interpolateAutomation(points, time) {
    if (!points?.length) return 0;
    if (time <= points[0][0]) return points[0][1];
    if (time >= points[points.length - 1][0]) return points[points.length - 1][1];
    
    for (let i = 0; i < points.length - 1; i++) {
      if (time >= points[i][0] && time < points[i + 1][0]) {
        const [t0, v0] = points[i];
        const [t1, v1] = points[i + 1];
        const t = (time - t0) / (t1 - t0);
        return v0 + (v1 - v0) * t * t * (3 - 2 * t);
      }
    }
    return 0;
  }
  
  /**
   * Update the UI to reflect current bound values (call during animation)
   */
  updateUI(time) {
    for (const [name, config] of Object.entries(this.schema)) {
      const binding = this.bindings[name];
      if (!binding) continue;
      
      const element = this.elements[name];
      
      if (config.type === 'number' && element) {
        const value = this.get(name, time);
        const slider = element._slider;
        const display = element._valueDisplay;
        const unit = element._unit || '';
        if (slider && display) {
          slider.value = value;
          display.textContent = Math.round(value) + unit;
        }
      } else if (config.type === 'boolean' && element) {
        const value = this.get(name, time);
        const checkbox = element._checkbox;
        if (checkbox) checkbox.checked = value;
      } else if (config.type === 'trigger' && element) {
        // For triggers, detect rising edge and fire
        const signalValue = this.evaluateSignal(binding, time);
        const state = this._triggerStates[name];
        const threshold = config.threshold ?? 0.5;
        const minInterval = config.minInterval ?? 0.05; // Minimum time between triggers
        
        // Rising edge detection: was below threshold, now above
        if (state.lastValue < threshold && signalValue >= threshold) {
          // Check cooldown
          if (time - state.lastTriggerTime >= minInterval) {
            this.fireTrigger(name, signalValue);
            state.lastTriggerTime = time;
          }
        }
        
        state.lastValue = signalValue;
        
        // Update visual indicator based on signal level
        const indicator = element._indicator;
        if (indicator && signalValue > 0.1) {
          indicator.style.opacity = signalValue * 0.5;
          indicator.style.transform = `scale(${0.8 + signalValue * 0.2})`;
        }
      }
    }
  }
  
  /**
   * Set a control value programmatically
   */
  set(name, value) {
    if (!(name in this.schema)) return;
    this.values[name] = value;
    
    const config = this.schema[name];
    const element = this.elements[name];
    
    if (config.type === 'number' && element) {
      element._slider.value = value;
      element._valueDisplay.textContent = Math.round(value) + (element._unit || '');
    } else if (config.type === 'boolean' && element) {
      element._checkbox.checked = value;
    } else if (config.type === 'select' && element) {
      element.value = value;
    }
    
    this.saveState();
  }
  
  /**
   * Save state to localStorage
   */
  saveState() {
    try {
      const state = {
        values: this.values,
        bindings: this.bindings
      };
      localStorage.setItem(this.storageKey, JSON.stringify(state));
    } catch (e) {
      console.warn('Could not save debug controls state:', e);
    }
  }
  
  /**
   * Load state from localStorage
   */
  loadState() {
    try {
      const saved = localStorage.getItem(this.storageKey);
      if (saved) {
        const state = JSON.parse(saved);
        // Merge saved values with defaults (in case schema changed)
        for (const [name, value] of Object.entries(state.values || {})) {
          if (name in this.schema) {
            this.values[name] = value;
          }
        }
        // Load bindings
        for (const [name, binding] of Object.entries(state.bindings || {})) {
          if (name in this.schema) {
            this.bindings[name] = binding;
          }
        }
      }
    } catch (e) {
      console.warn('Could not load debug controls state:', e);
    }
  }
  
  /**
   * Inject CSS styles for the controls
   */
  injectStyles() {
    if (document.getElementById('debug-controls-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'debug-controls-styles';
    style.textContent = `
      .debug-controls {
        font-family: 'JetBrains Mono', monospace;
        font-size: 0.7rem;
      }
      
      .debug-control-group {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.3rem 0;
        border-bottom: 1px solid rgba(255,255,255,0.05);
      }
      
      .debug-control-group:last-child {
        border-bottom: none;
      }
      
      .debug-group-header {
        font-size: 0.6rem;
        color: #666;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        padding: 0.5rem 0 0.25rem 0;
        margin-top: 0.25rem;
        border-top: 1px solid rgba(255,255,255,0.05);
      }
      
      .debug-group-header:first-child {
        border-top: none;
        margin-top: 0;
      }
      
      .debug-control-label {
        color: #888;
        flex: 1;
        min-width: 80px;
      }
      
      .binding-indicator {
        color: #ff6b35;
        font-size: 0.6rem;
        margin-left: 0.3rem;
      }
      
      .debug-number-control {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      
      .debug-number-control input[type="range"] {
        width: 80px;
        height: 4px;
        cursor: pointer;
        accent-color: #ff6b35;
      }
      
      .debug-value {
        min-width: 45px;
        width: 45px;
        text-align: right;
        color: #fff;
        font-variant-numeric: tabular-nums;
      }
      
      .debug-boolean-control input[type="checkbox"] {
        width: 16px;
        height: 16px;
        cursor: pointer;
        accent-color: #ff6b35;
      }
      
      .debug-select-control {
        background: #0a0a0b;
        border: 1px solid rgba(255,255,255,0.1);
        color: #e8e8e8;
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        font-size: 0.65rem;
        font-family: inherit;
        cursor: pointer;
      }
      
      /* Binding Menu */
      .debug-binding-menu {
        position: fixed;
        background: #111113;
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 6px;
        padding: 0.25rem 0;
        min-width: 180px;
        z-index: 10000;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
      }
      
      .debug-binding-header {
        padding: 0.4rem 0.75rem;
        font-size: 0.6rem;
        color: #666;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        border-bottom: 1px solid rgba(255,255,255,0.05);
      }
      
      .debug-binding-item {
        padding: 0.5rem 0.75rem;
        cursor: pointer;
        font-size: 0.7rem;
        color: #e8e8e8;
      }
      
      .debug-binding-item:hover {
        background: rgba(255, 107, 53, 0.15);
      }
      
      .debug-binding-item.active {
        background: rgba(255, 107, 53, 0.2);
        color: #ff6b35;
      }
      
      .debug-binding-item.disabled {
        color: #555;
        cursor: default;
      }
      
      .debug-binding-item.disabled:hover {
        background: none;
      }
      
      .debug-binding-item.unbind {
        color: #ff4444;
      }
      
      .debug-binding-item .signal-type {
        font-size: 0.55rem;
        text-transform: uppercase;
        margin-right: 0.3rem;
      }
      
      .debug-binding-separator {
        height: 1px;
        background: rgba(255,255,255,0.05);
        margin: 0.25rem 0;
      }
      
      /* Trigger Controls */
      .debug-trigger-control {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        position: relative;
      }
      
      .debug-trigger-button {
        padding: 0.3rem 0.6rem;
        background: rgba(255, 107, 53, 0.2);
        border: 1px solid rgba(255, 107, 53, 0.4);
        border-radius: 4px;
        color: #ff6b35;
        font-size: 0.7rem;
        cursor: pointer;
        transition: all 0.1s;
      }
      
      .debug-trigger-button:hover {
        background: rgba(255, 107, 53, 0.3);
        border-color: rgba(255, 107, 53, 0.6);
      }
      
      .debug-trigger-button:active,
      .debug-trigger-button.triggered {
        background: rgba(255, 107, 53, 0.5);
        transform: scale(0.95);
      }
      
      .debug-trigger-indicator {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #ff6b35;
        opacity: 0;
        transition: opacity 0.1s, transform 0.1s;
        transform: scale(0.8);
      }
    `;
    document.head.appendChild(style);
  }
}
