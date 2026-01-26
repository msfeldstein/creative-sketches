/**
 * Audio Signals - Playback synchronization library for sketches
 * 
 * Provides real-time access to pre-analyzed audio signals during playback.
 * Signals include beats, frequency bands, energy, and custom automations.
 */

export class AudioSignals {
  constructor() {
    this.audioContext = null;
    this.audioBuffer = null;
    this.sourceNode = null;
    this.gainNode = null;
    
    this.trackData = null;
    this.audioUrl = null;
    
    this.playing = false;
    this.startTime = 0;
    this.pauseTime = 0;
    
    // Beat tracking
    this.lastBeatIndex = { all: -1, kicks: -1, snares: -1, hihats: -1 };
    this.beatWindow = 0.05; // 50ms window for beat detection
    
    // Callbacks
    this.onBeat = null;
    this.onKick = null;
    this.onSnare = null;
    this.onHihat = null;
    this.onEnd = null;
  }
  
  /**
   * Load a track and its audio file
   * @param {string} trackUrl - URL to the track JSON file
   * @param {string} audioUrl - URL to the audio file (MP3)
   */
  async loadTrack(trackUrl, audioUrl) {
    // Load track data
    const response = await fetch(trackUrl);
    if (!response.ok) {
      throw new Error(`Failed to load track: ${response.statusText}`);
    }
    this.trackData = await response.json();
    
    // Store audio URL for later loading
    this.audioUrl = audioUrl;
    
    // Reset state
    this.lastBeatIndex = { all: -1, kicks: -1, snares: -1, hihats: -1 };
    this.playing = false;
    this.startTime = 0;
    this.pauseTime = 0;
  }
  
  /**
   * Load track data directly (without fetching)
   * @param {Object} trackData - Track data object
   * @param {string} audioUrl - URL to the audio file (optional - if not provided, uses simulated playback)
   */
  async loadTrackData(trackData, audioUrl = null) {
    // Stop any current playback
    if (this.playing) {
      this.stop();
    }
    
    this.trackData = trackData;
    
    // Clear old audio buffer if URL changed
    if (audioUrl && this.audioUrl !== audioUrl) {
      this.audioBuffer = null;
    }
    this.audioUrl = audioUrl;
    
    // Reset state
    this.lastBeatIndex = { all: -1, kicks: -1, snares: -1, hihats: -1 };
    this.playing = false;
    this.startTime = 0;
    this.pauseTime = 0;
    this._simulatedStartTime = null;
    
    // Clean up any simulated playback interval
    if (this._simulatedInterval) {
      clearInterval(this._simulatedInterval);
      this._simulatedInterval = null;
    }
  }
  
  /**
   * Initialize audio context and load audio buffer
   */
  async initAudio() {
    if (!this.audioUrl) {
      throw new Error('No audio URL set. Call loadTrack or loadTrackData first.');
    }
    
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
    
    if (!this.audioBuffer) {
      try {
        const response = await fetch(this.audioUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch audio: ${response.status} ${response.statusText}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength === 0) {
          throw new Error('Audio file is empty');
        }
        this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      } catch (e) {
        console.error('Error loading audio:', e);
        throw new Error(`Could not load audio: ${e.message}`);
      }
    }
    
    // Create gain node for volume control
    if (!this.gainNode) {
      this.gainNode = this.audioContext.createGain();
      this.gainNode.connect(this.audioContext.destination);
    }
  }
  
  /**
   * Start playback
   * @param {number} offset - Start position in seconds (optional)
   */
  async play(offset = null) {
    // If no audio URL, use simulated playback mode
    if (!this.audioUrl) {
      if (!this.trackData) {
        throw new Error('No track data loaded. Call loadTrack or loadTrackData first.');
      }
      // Start simulated playback
      const startOffset = offset !== null ? offset : this.pauseTime;
      this._simulatedStartTime = performance.now() - startOffset * 1000;
      this.playing = true;
      this.resetBeatTracking(startOffset);
      
      // Start simulated playback loop
      this._startSimulatedPlayback();
      return;
    }
    
    await this.initAudio();
    
    // Stop any existing playback
    if (this.sourceNode) {
      this.sourceNode.stop();
      this.sourceNode.disconnect();
    }
    
    // Create new source
    this.sourceNode = this.audioContext.createBufferSource();
    this.sourceNode.buffer = this.audioBuffer;
    this.sourceNode.connect(this.gainNode);
    
    // Handle end of playback
    this.sourceNode.onended = () => {
      if (this.playing) {
        this.playing = false;
        if (this.onEnd) this.onEnd();
      }
    };
    
    // Calculate start position
    const startOffset = offset !== null ? offset : this.pauseTime;
    
    // Start playback
    this.sourceNode.start(0, startOffset);
    this.startTime = this.audioContext.currentTime - startOffset;
    this.playing = true;
    
    // Reset beat tracking from current position
    this.resetBeatTracking(startOffset);
  }
  
  /**
   * Start simulated playback (no audio, just time-based)
   */
  _startSimulatedPlayback() {
    if (this._simulatedInterval) {
      clearInterval(this._simulatedInterval);
    }
    
    this._simulatedInterval = setInterval(() => {
      if (!this.playing) {
        clearInterval(this._simulatedInterval);
        this._simulatedInterval = null;
        return;
      }
      
      const currentTime = this.getCurrentTime();
      if (currentTime >= this.getDuration()) {
        this.playing = false;
        this.pauseTime = 0;
        clearInterval(this._simulatedInterval);
        this._simulatedInterval = null;
        if (this.onEnd) this.onEnd();
      }
    }, 100);
  }
  
  /**
   * Pause playback
   */
  pause() {
    if (!this.playing) return;
    
    this.pauseTime = this.getCurrentTime();
    this.playing = false;
    
    // Clean up real audio
    if (this.sourceNode) {
      this.sourceNode.stop();
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    
    // Clean up simulated playback
    if (this._simulatedInterval) {
      clearInterval(this._simulatedInterval);
      this._simulatedInterval = null;
    }
  }
  
  /**
   * Stop playback and reset position
   */
  stop() {
    this.pause();
    this.pauseTime = 0;
    this._simulatedStartTime = null;
    this.resetBeatTracking(0);
  }
  
  /**
   * Seek to a specific time
   * @param {number} time - Time in seconds
   */
  async seek(time) {
    const wasPlaying = this.playing;
    
    if (wasPlaying) {
      this.pause();
    }
    
    this.pauseTime = Math.max(0, Math.min(time, this.getDuration()));
    this._simulatedStartTime = null; // Reset simulated start time
    this.resetBeatTracking(this.pauseTime);
    
    if (wasPlaying) {
      await this.play(this.pauseTime);
    }
  }
  
  /**
   * Set volume
   * @param {number} volume - Volume level (0-1)
   */
  setVolume(volume) {
    if (this.gainNode) {
      this.gainNode.gain.value = Math.max(0, Math.min(1, volume));
    }
  }
  
  /**
   * Get current playback time
   * @returns {number} Time in seconds
   */
  getCurrentTime() {
    if (!this.playing) {
      return this.pauseTime || 0;
    }
    
    // Simulated playback mode (no audio)
    if (this._simulatedStartTime !== undefined && this._simulatedStartTime !== null) {
      return (performance.now() - this._simulatedStartTime) / 1000;
    }
    
    // Real audio playback
    if (this.audioContext) {
      return this.audioContext.currentTime - this.startTime;
    }
    
    return this.pauseTime || 0;
  }
  
  /**
   * Get track duration
   * @returns {number} Duration in seconds
   */
  getDuration() {
    return this.trackData?.duration || this.audioBuffer?.duration || 0;
  }
  
  /**
   * Check if currently playing
   * @returns {boolean}
   */
  isPlaying() {
    return this.playing;
  }
  
  /**
   * Check if a track is loaded
   * @returns {boolean}
   */
  isLoaded() {
    return this.trackData !== null;
  }
  
  /**
   * Get current signal values
   * Call this in your animation loop.
   * @returns {Object} Current signal values
   */
  getCurrentSignals() {
    if (!this.trackData) {
      return this.getDefaultSignals();
    }
    
    const time = this.getCurrentTime();
    const { frequency, energy, beats, automations } = this.trackData;
    
    // Calculate sample index for frequency/energy data
    const sampleRate = frequency?.sampleRate || 30;
    const sampleIndex = Math.floor(time * sampleRate);
    
    // Get frequency band values
    const sub = this.getSampleValue(frequency?.sub, sampleIndex);
    const bass = this.getSampleValue(frequency?.bass, sampleIndex);
    const mid = this.getSampleValue(frequency?.mid, sampleIndex);
    const high = this.getSampleValue(frequency?.high, sampleIndex);
    
    // Get energy value
    const energyValue = this.getSampleValue(energy, sampleIndex);
    
    // Check for beats (with callbacks)
    const beat = this.checkBeat(time, beats?.all, 'all');
    const kick = this.checkBeat(time, beats?.kicks, 'kicks');
    const snare = this.checkBeat(time, beats?.snares, 'snares');
    const hihat = this.checkBeat(time, beats?.hihats, 'hihats');
    
    // Fire callbacks
    if (beat && this.onBeat) this.onBeat(time);
    if (kick && this.onKick) this.onKick(time);
    if (snare && this.onSnare) this.onSnare(time);
    if (hihat && this.onHihat) this.onHihat(time);
    
    // Get automation values
    const automationValues = {};
    if (automations) {
      for (const [name, automation] of Object.entries(automations)) {
        automationValues[name] = this.interpolateAutomation(automation, time);
      }
    }
    
    return {
      time,
      // Frequency bands (0-1)
      sub,
      bass,
      mid,
      high,
      // Overall energy (0-1)
      energy: energyValue,
      // Beat triggers (true if beat just occurred)
      beat,
      kick,
      snare,
      hihat,
      // BPM
      bpm: this.trackData.bpm || 120,
      // Custom automations
      automations: automationValues
    };
  }
  
  /**
   * Get default signal values (when no track loaded)
   */
  getDefaultSignals() {
    return {
      time: 0,
      sub: 0,
      bass: 0,
      mid: 0,
      high: 0,
      energy: 0,
      beat: false,
      kick: false,
      snare: false,
      hihat: false,
      bpm: 120,
      automations: {}
    };
  }
  
  /**
   * Get value from sample array with bounds checking
   */
  getSampleValue(array, index) {
    if (!array || array.length === 0) return 0;
    const clampedIndex = Math.max(0, Math.min(index, array.length - 1));
    return array[clampedIndex] || 0;
  }
  
  /**
   * Check if a beat occurred at the current time
   */
  checkBeat(time, beatArray, type) {
    if (!beatArray || beatArray.length === 0) return false;
    
    // Find beats within the window
    const lastIndex = this.lastBeatIndex[type];
    
    for (let i = lastIndex + 1; i < beatArray.length; i++) {
      const beatTime = beatArray[i];
      
      if (beatTime > time + this.beatWindow) {
        break;
      }
      
      if (beatTime <= time && beatTime > time - this.beatWindow) {
        this.lastBeatIndex[type] = i;
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Reset beat tracking for seek operations
   */
  resetBeatTracking(time) {
    for (const type of ['all', 'kicks', 'snares', 'hihats']) {
      const beats = this.trackData?.beats?.[type];
      if (!beats) {
        this.lastBeatIndex[type] = -1;
        continue;
      }
      
      // Find the last beat before current time
      let index = -1;
      for (let i = 0; i < beats.length; i++) {
        if (beats[i] < time - this.beatWindow) {
          index = i;
        } else {
          break;
        }
      }
      this.lastBeatIndex[type] = index;
    }
  }
  
  /**
   * Interpolate automation curve value at time
   */
  interpolateAutomation(automation, time) {
    const { points, curve = 'linear' } = automation;
    
    if (!points || points.length === 0) return 0;
    if (points.length === 1) return points[0][1];
    
    // Find surrounding points
    let i = 0;
    while (i < points.length - 1 && points[i + 1][0] <= time) {
      i++;
    }
    
    // Before first point
    if (time <= points[0][0]) return points[0][1];
    
    // After last point
    if (i >= points.length - 1) return points[points.length - 1][1];
    
    const [t0, v0] = points[i];
    const [t1, v1] = points[i + 1];
    
    const t = (time - t0) / (t1 - t0);
    
    if (curve === 'smooth') {
      // Smooth step interpolation
      const smoothT = t * t * (3 - 2 * t);
      return v0 + (v1 - v0) * smoothT;
    } else if (curve === 'step') {
      // Step interpolation
      return v0;
    } else {
      // Linear interpolation
      return v0 + (v1 - v0) * t;
    }
  }
  
  /**
   * Get track metadata
   */
  getTrackInfo() {
    if (!this.trackData) return null;
    
    return {
      name: this.trackData.name,
      duration: this.trackData.duration,
      bpm: this.trackData.bpm,
      beatCount: this.trackData.beats?.all?.length || 0
    };
  }
  
  /**
   * Clean up resources
   */
  dispose() {
    this.stop();
    
    if (this._simulatedInterval) {
      clearInterval(this._simulatedInterval);
      this._simulatedInterval = null;
    }
    
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    
    this.audioBuffer = null;
    this.trackData = null;
    this._simulatedStartTime = null;
  }
}

// Export singleton for convenience
export const audioSignals = new AudioSignals();
