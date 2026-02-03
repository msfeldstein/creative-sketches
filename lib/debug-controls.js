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

        let input;

        if (config.type === 'number') {
          input = this.createNumberControl(name, config);
          // Number controls include their own label, add binding indicator to it
          const binding = this.bindings[name];
          if (binding) {
            const bindingIndicator = document.createElement('span');
            bindingIndicator.className = 'binding-indicator';
            bindingIndicator.textContent = ` ⟵ ${binding.signalName}`;
            bindingIndicator.title = 'Right-click to unbind';
            input.querySelector('.debug-number-label').appendChild(bindingIndicator);
          }
        } else if (config.type === 'boolean') {
          input = this.createBooleanControl(name, config);
        } else if (config.type === 'select') {
          input = this.createSelectControl(name, config);
        } else if (config.type === 'trigger') {
          input = this.createTriggerControl(name, config);
        } else if (config.type === 'color') {
          input = this.createColorControl(name, config);
        }
        
        if (input) {
          this.elements[name] = input;
          
          // Number controls already include label; others need external label
          if (!input._isNumberControl) {
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
            group.appendChild(label);
          }
          
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
    
    // Background track (gray)
    const track = document.createElement('div');
    track.className = 'debug-number-track';
    wrapper.appendChild(track);
    
    // Fill bar (orange) - width based on value
    const fill = document.createElement('div');
    fill.className = 'debug-number-fill';
    wrapper.appendChild(fill);
    
    // Header row with label and value
    const header = document.createElement('div');
    header.className = 'debug-number-header';
    
    const label = document.createElement('span');
    label.className = 'debug-number-label';
    label.textContent = config.label || name;
    
    const valueDisplay = document.createElement('span');
    valueDisplay.className = 'debug-number-value';
    const unit = config.unit || '';
    valueDisplay.textContent = Math.round(this.values[name]) + unit;
    
    header.appendChild(label);
    header.appendChild(valueDisplay);
    wrapper.appendChild(header);
    
    // Invisible slider input (covers entire control)
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = config.min ?? 0;
    slider.max = config.max ?? 100;
    slider.step = config.step ?? 1;
    slider.value = this.values[name];
    wrapper.appendChild(slider);
    
    // Update fill width based on value
    const updateFill = () => {
      const min = parseFloat(slider.min);
      const max = parseFloat(slider.max);
      const val = parseFloat(slider.value);
      const percent = ((val - min) / (max - min)) * 100;
      fill.style.width = percent + '%';
    };
    
    // Initial fill
    updateFill();

    slider.addEventListener('input', () => {
      const val = parseFloat(slider.value);
      this.values[name] = val;
      valueDisplay.textContent = Math.round(val) + unit;
      updateFill();
      this.saveState();
      if (this.onChange) this.onChange(name, val);
    });
    
    wrapper._slider = slider;
    wrapper._valueDisplay = valueDisplay;
    wrapper._unit = unit;
    wrapper._updateFill = updateFill;
    wrapper._isNumberControl = true; // Flag for render to skip label
    
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
  
  createColorControl(name, config) {
    const wrapper = document.createElement('div');
    wrapper.className = 'debug-color-control';
    
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = this.values[name];
    colorInput.className = 'debug-color-input';
    
    const hexDisplay = document.createElement('span');
    hexDisplay.className = 'debug-color-hex';
    hexDisplay.textContent = this.values[name];
    
    colorInput.addEventListener('input', () => {
      const val = colorInput.value;
      this.values[name] = val;
      hexDisplay.textContent = val;
      this.saveState();
      if (this.onChange) this.onChange(name, val);
    });
    
    wrapper.appendChild(colorInput);
    wrapper.appendChild(hexDisplay);
    wrapper._colorInput = colorInput;
    wrapper._hexDisplay = hexDisplay;
    
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
          if (element._updateFill) element._updateFill();
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
      if (element._updateFill) element._updateFill();
    } else if (config.type === 'boolean' && element) {
      element._checkbox.checked = value;
    } else if (config.type === 'select' && element) {
      element.value = value;
    } else if (config.type === 'color' && element) {
      element._colorInput.value = value;
      element._hexDisplay.textContent = value;
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
        font-family: 'Space Grotesk', -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 12px;
        font-weight: 300;
      }

      .debug-control-group {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 0;
        border-bottom: 1px solid rgba(255, 255, 255, 0.04);
        transition: all 0.3s ease;
      }

      .debug-control-group:last-child {
        border-bottom: none;
      }

      /* Number controls need full width for the slider */
      .debug-control-group:has(.debug-number-control) {
        flex-direction: column;
        align-items: stretch;
      }

      .debug-group-header {
        font-size: 9px;
        font-weight: 400;
        color: rgba(255, 255, 255, 0.3);
        text-transform: uppercase;
        letter-spacing: 0.15em;
        padding: 12px 0 6px 0;
        margin-top: 8px;
        border-top: 1px solid rgba(255, 255, 255, 0.04);
      }

      .debug-group-header:first-child {
        border-top: none;
        margin-top: 0;
      }

      .debug-control-label {
        color: rgba(255, 255, 255, 0.5);
        font-weight: 400;
        flex: 1;
        min-width: 80px;
        font-size: 11px;
        transition: color 0.3s ease;
      }

      .debug-control-group:hover .debug-control-label {
        color: rgba(255, 255, 255, 0.8);
      }

      .binding-indicator {
        color: rgba(255, 122, 69, 0.8);
        font-size: 9px;
        margin-left: 6px;
      }

      .debug-number-control {
        position: relative;
        width: 100%;
        margin: 0 -8px;
        padding: 0;
        width: calc(100% + 16px);
        cursor: pointer;
      }

      /* Background track (gray) */
      .debug-number-track {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        height: 3px;
        background: rgba(255, 255, 255, 0.15);
        transition: height 0.2s ease;
      }

      .debug-number-control:hover .debug-number-track {
        height: 100%;
      }

      /* Fill bar (orange) - grows up on hover */
      .debug-number-fill {
        position: absolute;
        bottom: 0;
        left: 0;
        height: 3px;
        background: #e87949;
        transition: height 0.2s ease;
        pointer-events: none;
      }

      .debug-number-control:hover .debug-number-fill {
        height: 100%;
      }

      /* Header with label and value */
      .debug-number-header {
        position: relative;
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        padding: 8px 10px;
        z-index: 1;
      }

      .debug-number-label {
        color: rgba(255, 255, 255, 0.5);
        font-size: 11px;
        font-weight: 400;
        transition: color 0.2s ease;
      }

      .debug-number-control:hover .debug-number-label {
        color: rgba(255, 255, 255, 0.95);
      }

      .debug-number-value {
        color: rgba(255, 255, 255, 0.5);
        font-family: 'SF Mono', 'Fira Code', monospace;
        font-size: 10px;
        font-variant-numeric: tabular-nums;
        transition: color 0.2s ease;
      }

      .debug-number-control:hover .debug-number-value {
        color: rgba(255, 255, 255, 0.95);
      }

      /* Invisible slider input covers entire control */
      .debug-number-control input[type="range"] {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        cursor: pointer;
        -webkit-appearance: none;
        appearance: none;
        background: transparent;
        outline: none;
        margin: 0;
        z-index: 2;
      }

      .debug-number-control input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 0;
        height: 0;
        background: transparent;
        cursor: pointer;
      }

      .debug-number-control input[type="range"]::-moz-range-thumb {
        width: 0;
        height: 0;
        background: transparent;
        cursor: pointer;
        border: none;
      }

      .debug-boolean-control input[type="checkbox"] {
        width: 14px;
        height: 14px;
        cursor: pointer;
        accent-color: #ff7a45;
      }

      .debug-select-control {
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        color: rgba(255, 255, 255, 0.8);
        padding: 8px 10px;
        border-radius: 6px;
        font-size: 11px;
        font-family: inherit;
        font-weight: 400;
        cursor: pointer;
        transition: all 0.3s ease;
      }

      .debug-select-control:hover {
        background: rgba(255, 255, 255, 0.06);
        border-color: rgba(255, 255, 255, 0.12);
      }

      .debug-select-control:focus {
        outline: none;
        border-color: rgba(255, 122, 69, 0.4);
      }

      /* Binding Menu */
      .debug-binding-menu {
        position: fixed;
        background: rgba(0, 0, 0, 0.9);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        padding: 6px 0;
        min-width: 200px;
        z-index: 10000;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        font-family: 'Space Grotesk', -apple-system, sans-serif;
      }

      .debug-binding-header {
        padding: 10px 14px;
        font-size: 9px;
        font-weight: 400;
        color: rgba(255, 255, 255, 0.35);
        text-transform: uppercase;
        letter-spacing: 0.15em;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      }
      
      .debug-binding-item {
        padding: 10px 14px;
        cursor: pointer;
        font-size: 11px;
        font-weight: 400;
        color: rgba(255, 255, 255, 0.7);
        transition: all 0.2s ease;
      }
      
      .debug-binding-item:hover {
        background: rgba(255, 122, 69, 0.1);
        color: rgba(255, 255, 255, 0.9);
      }
      
      .debug-binding-item.active {
        background: rgba(255, 122, 69, 0.15);
        color: #ff9a6c;
      }
      
      .debug-binding-item.disabled {
        color: rgba(255, 255, 255, 0.2);
        cursor: default;
      }
      
      .debug-binding-item.disabled:hover {
        background: none;
        color: rgba(255, 255, 255, 0.2);
      }
      
      .debug-binding-item.unbind {
        color: rgba(255, 100, 100, 0.8);
      }

      .debug-binding-item.unbind:hover {
        background: rgba(255, 100, 100, 0.1);
      }
      
      .debug-binding-item .signal-type {
        font-size: 8px;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        margin-right: 6px;
        opacity: 0.5;
      }
      
      .debug-binding-separator {
        height: 1px;
        background: rgba(255, 255, 255, 0.06);
        margin: 6px 0;
      }
      
      /* Trigger Controls */
      .debug-trigger-control {
        display: flex;
        align-items: center;
        gap: 10px;
        position: relative;
      }
      
      .debug-trigger-button {
        padding: 8px 14px;
        background: transparent;
        border: 1px solid rgba(255, 122, 69, 0.3);
        border-radius: 6px;
        color: rgba(255, 122, 69, 0.8);
        font-size: 11px;
        font-family: inherit;
        font-weight: 400;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      }
      
      .debug-trigger-button:hover {
        background: rgba(255, 122, 69, 0.1);
        border-color: rgba(255, 122, 69, 0.5);
        color: #ff9a6c;
      }
      
      .debug-trigger-button:active,
      .debug-trigger-button.triggered {
        background: rgba(255, 122, 69, 0.2);
        transform: scale(0.96);
      }
      
      .debug-trigger-indicator {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #ff7a45;
        opacity: 0;
        transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        transform: scale(0.5);
        box-shadow: 0 0 12px rgba(255, 122, 69, 0.6);
      }
      
      /* Color Controls */
      .debug-color-control {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      
      .debug-color-input {
        width: 36px;
        height: 24px;
        padding: 0;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 4px;
        cursor: pointer;
        background: transparent;
        transition: border-color 0.3s ease;
      }

      .debug-color-input:hover {
        border-color: rgba(255, 255, 255, 0.2);
      }
      
      .debug-color-input::-webkit-color-swatch-wrapper {
        padding: 2px;
      }
      
      .debug-color-input::-webkit-color-swatch {
        border-radius: 2px;
        border: none;
      }
      
      .debug-color-hex {
        font-size: 10px;
        color: rgba(255, 255, 255, 0.4);
        font-family: 'SF Mono', 'Fira Code', monospace;
        min-width: 64px;
      }
    `;
    document.head.appendChild(style);
  }
}
