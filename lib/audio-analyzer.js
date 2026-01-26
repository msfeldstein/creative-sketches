/**
 * Audio Analyzer - Offline audio analysis using Web Audio API
 * 
 * Analyzes audio files to extract:
 * - Beat detection (kicks, snares, hihats)
 * - Frequency bands (sub, bass, mid, high)
 * - Energy levels (RMS)
 * - BPM estimation
 * 
 * Uses optimized Cooley-Tukey FFT for fast processing.
 */

// Analysis constants
const SAMPLE_RATE = 30; // Samples per second for frequency/energy data
const FFT_SIZE = 2048;

// Frequency band ranges (Hz)
const BANDS = {
  sub: [20, 60],
  bass: [60, 250],
  mid: [250, 2000],
  high: [2000, 20000]
};

// Pre-computed twiddle factors for FFT (computed once per size)
const twiddleCache = new Map();

/**
 * Get or compute twiddle factors for FFT
 */
function getTwiddleFactors(N) {
  if (twiddleCache.has(N)) {
    return twiddleCache.get(N);
  }
  
  const cos = new Float32Array(N / 2);
  const sin = new Float32Array(N / 2);
  
  for (let i = 0; i < N / 2; i++) {
    const angle = -2 * Math.PI * i / N;
    cos[i] = Math.cos(angle);
    sin[i] = Math.sin(angle);
  }
  
  const factors = { cos, sin };
  twiddleCache.set(N, factors);
  return factors;
}

/**
 * Cooley-Tukey radix-2 FFT (in-place, iterative)
 * Much faster than naive DFT: O(n log n) vs O(n²)
 * 
 * @param {Float32Array} real - Real part (input/output)
 * @param {Float32Array} imag - Imaginary part (output, should be zeros on input)
 */
function fft(real, imag) {
  const N = real.length;
  const { cos, sin } = getTwiddleFactors(N);
  
  // Bit-reversal permutation
  const bits = Math.log2(N);
  for (let i = 0; i < N; i++) {
    const j = reverseBits(i, bits);
    if (j > i) {
      // Swap real
      const tempR = real[i];
      real[i] = real[j];
      real[j] = tempR;
      // Swap imag
      const tempI = imag[i];
      imag[i] = imag[j];
      imag[j] = tempI;
    }
  }
  
  // Cooley-Tukey iterative FFT
  for (let size = 2; size <= N; size *= 2) {
    const halfSize = size / 2;
    const step = N / size;
    
    for (let i = 0; i < N; i += size) {
      for (let j = 0; j < halfSize; j++) {
        const idx = j * step;
        const cosVal = cos[idx];
        const sinVal = sin[idx];
        
        const evenIdx = i + j;
        const oddIdx = i + j + halfSize;
        
        const tReal = cosVal * real[oddIdx] - sinVal * imag[oddIdx];
        const tImag = sinVal * real[oddIdx] + cosVal * imag[oddIdx];
        
        real[oddIdx] = real[evenIdx] - tReal;
        imag[oddIdx] = imag[evenIdx] - tImag;
        real[evenIdx] = real[evenIdx] + tReal;
        imag[evenIdx] = imag[evenIdx] + tImag;
      }
    }
  }
}

/**
 * Reverse bits of an integer
 */
function reverseBits(n, bits) {
  let result = 0;
  for (let i = 0; i < bits; i++) {
    result = (result << 1) | (n & 1);
    n >>= 1;
  }
  return result;
}

/**
 * Compute FFT magnitudes from real data
 * Returns magnitude array (first N/2 bins)
 */
function computeFFT(data) {
  const N = data.length;
  const real = new Float32Array(N);
  const imag = new Float32Array(N);
  
  // Copy input to real array
  real.set(data);
  
  // Run FFT
  fft(real, imag);
  
  // Compute magnitudes for first N/2 bins
  const magnitudes = new Float32Array(N / 2);
  for (let i = 0; i < N / 2; i++) {
    magnitudes[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]) / N;
  }
  
  return magnitudes;
}

/**
 * Main analysis function - processes entire audio buffer
 * @param {AudioBuffer} audioBuffer - Decoded audio data
 * @param {Function} onProgress - Optional progress callback (0-1)
 * @returns {Object} Complete analysis results
 */
export async function analyzeAudio(audioBuffer, onProgress = null) {
  const duration = audioBuffer.duration;
  const sampleRate = audioBuffer.sampleRate;
  
  // Get mono channel data
  const channelData = getMono(audioBuffer);
  
  // Pre-compute twiddle factors
  getTwiddleFactors(FFT_SIZE);
  getTwiddleFactors(1024);
  
  // Run analyses with progress updates
  if (onProgress) onProgress(0.1);
  
  const [frequencyData, energyData] = analyzeFrequencyAndEnergy(channelData, sampleRate, (p) => {
    if (onProgress) onProgress(0.1 + p * 0.4);
  });
  
  if (onProgress) onProgress(0.5);
  
  const beats = detectBeats(channelData, sampleRate, (p) => {
    if (onProgress) onProgress(0.5 + p * 0.4);
  });
  
  if (onProgress) onProgress(0.9);
  
  const bpm = estimateBPM(beats.all, duration);
  
  if (onProgress) onProgress(1.0);
  
  return {
    name: '',
    duration,
    bpm,
    analysisVersion: 1,
    beats,
    frequency: {
      sampleRate: SAMPLE_RATE,
      ...frequencyData
    },
    energy: energyData,
    automations: {}
  };
}

/**
 * Convert audio buffer to mono Float32Array
 */
function getMono(audioBuffer) {
  if (audioBuffer.numberOfChannels === 1) {
    return audioBuffer.getChannelData(0);
  }
  
  const left = audioBuffer.getChannelData(0);
  const right = audioBuffer.getChannelData(1);
  const mono = new Float32Array(left.length);
  
  for (let i = 0; i < left.length; i++) {
    mono[i] = (left[i] + right[i]) / 2;
  }
  
  return mono;
}

/**
 * Analyze frequency bands and energy over time
 */
function analyzeFrequencyAndEnergy(channelData, sampleRate, onProgress = null) {
  const duration = channelData.length / sampleRate;
  const numSamples = Math.floor(duration * SAMPLE_RATE);
  const samplesPerFrame = Math.floor(channelData.length / numSamples);
  
  const frequency = {
    sub: new Array(numSamples),
    bass: new Array(numSamples),
    mid: new Array(numSamples),
    high: new Array(numSamples)
  };
  const energy = new Array(numSamples);
  
  const fftSize = FFT_SIZE;
  const binCount = fftSize / 2;
  const binFrequency = sampleRate / fftSize;
  
  // Calculate bin ranges for each band
  const bandBins = {};
  for (const [band, [low, high]] of Object.entries(BANDS)) {
    bandBins[band] = {
      start: Math.floor(low / binFrequency),
      end: Math.min(Math.ceil(high / binFrequency), binCount - 1)
    };
  }
  
  // Reusable buffers
  const frameData = new Float32Array(fftSize);
  const window = createHannWindow(fftSize);
  
  // Process each frame
  for (let frame = 0; frame < numSamples; frame++) {
    const startSample = frame * samplesPerFrame;
    
    // Extract and window frame data
    frameData.fill(0);
    const copyLen = Math.min(fftSize, channelData.length - startSample);
    for (let i = 0; i < copyLen; i++) {
      frameData[i] = channelData[startSample + i] * window[i];
    }
    
    // Compute FFT magnitudes
    const magnitudes = computeFFT(frameData);
    
    // Calculate band energies
    for (const [band, { start, end }] of Object.entries(bandBins)) {
      let sum = 0;
      for (let bin = start; bin <= end; bin++) {
        sum += magnitudes[bin] * magnitudes[bin];
      }
      const avgEnergy = Math.sqrt(sum / (end - start + 1));
      frequency[band][frame] = Math.min(1, avgEnergy * 4);
    }
    
    // Calculate RMS energy (from original samples, not windowed)
    let rms = 0;
    for (let i = 0; i < copyLen; i++) {
      const sample = channelData[startSample + i];
      rms += sample * sample;
    }
    energy[frame] = Math.min(1, Math.sqrt(rms / copyLen) * 3);
    
    // Progress update every 100 frames
    if (onProgress && frame % 100 === 0) {
      onProgress(frame / numSamples);
    }
  }
  
  // Normalize each band to its own range for better visualization
  for (const band of Object.keys(frequency)) {
    normalizeArray(frequency[band]);
  }
  normalizeArray(energy);
  
  return [frequency, energy];
}

/**
 * Create Hann window (cached)
 */
const windowCache = new Map();
function createHannWindow(size) {
  if (windowCache.has(size)) {
    return windowCache.get(size);
  }
  
  const window = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (size - 1)));
  }
  
  windowCache.set(size, window);
  return window;
}

/**
 * Normalize array to 0-1 range
 */
function normalizeArray(arr) {
  let max = 0;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] > max) max = arr[i];
  }
  if (max > 0) {
    for (let i = 0; i < arr.length; i++) {
      arr[i] /= max;
    }
  }
}

/**
 * Beat detection using spectral flux in low frequencies
 */
function detectBeats(channelData, sampleRate, onProgress = null) {
  const frameSize = 1024;
  const hopSize = 512; // Increased hop size for faster processing
  const numFrames = Math.floor((channelData.length - frameSize) / hopSize);
  
  // Calculate spectral flux for different frequency ranges
  const kickFlux = new Float32Array(numFrames);
  const snareFlux = new Float32Array(numFrames);
  const hihatFlux = new Float32Array(numFrames);
  
  let prevKickSpectrum = null;
  let prevSnareSpectrum = null;
  let prevHihatSpectrum = null;
  
  const binFreq = sampleRate / frameSize;
  
  // Bin ranges for different drum types
  const kickBins = { start: Math.floor(40 / binFreq), end: Math.ceil(120 / binFreq) };
  const snareBins = { start: Math.floor(120 / binFreq), end: Math.ceil(500 / binFreq) };
  const hihatBins = { start: Math.floor(5000 / binFreq), end: Math.min(Math.ceil(15000 / binFreq), frameSize / 2 - 1) };
  
  // Reusable buffers
  const frameData = new Float32Array(frameSize);
  const window = createHannWindow(frameSize);
  
  for (let frame = 0; frame < numFrames; frame++) {
    const startSample = frame * hopSize;
    
    // Extract and window frame data
    for (let i = 0; i < frameSize; i++) {
      frameData[i] = (channelData[startSample + i] || 0) * window[i];
    }
    
    const magnitudes = computeFFT(frameData);
    
    // Extract frequency band spectrums
    const kickSpectrum = magnitudes.slice(kickBins.start, kickBins.end);
    const snareSpectrum = magnitudes.slice(snareBins.start, snareBins.end);
    const hihatSpectrum = magnitudes.slice(hihatBins.start, hihatBins.end);
    
    // Calculate spectral flux (positive differences only)
    if (prevKickSpectrum) {
      kickFlux[frame] = spectralFlux(kickSpectrum, prevKickSpectrum);
      snareFlux[frame] = spectralFlux(snareSpectrum, prevSnareSpectrum);
      hihatFlux[frame] = spectralFlux(hihatSpectrum, prevHihatSpectrum);
    }
    
    prevKickSpectrum = kickSpectrum.slice();
    prevSnareSpectrum = snareSpectrum.slice();
    prevHihatSpectrum = hihatSpectrum.slice();
    
    // Progress update every 500 frames
    if (onProgress && frame % 500 === 0) {
      onProgress(frame / numFrames);
    }
  }
  
  // Find peaks in flux signals
  const frameDuration = hopSize / sampleRate;
  
  const kicks = findPeaks(kickFlux, frameDuration, 0.15);
  const snares = findPeaks(snareFlux, frameDuration, 0.12);
  const hihats = findPeaks(hihatFlux, frameDuration, 0.08);
  
  // Combine all beats and sort
  const allBeats = [...kicks, ...snares, ...hihats].sort((a, b) => a - b);
  
  // Remove duplicates within 50ms
  const uniqueBeats = [];
  for (const beat of allBeats) {
    if (uniqueBeats.length === 0 || beat - uniqueBeats[uniqueBeats.length - 1] > 0.05) {
      uniqueBeats.push(beat);
    }
  }
  
  return {
    all: uniqueBeats,
    kicks,
    snares,
    hihats
  };
}

/**
 * Calculate spectral flux between two spectrums
 */
function spectralFlux(current, previous) {
  let flux = 0;
  const len = Math.min(current.length, previous.length);
  for (let i = 0; i < len; i++) {
    const diff = current[i] - previous[i];
    if (diff > 0) {
      flux += diff;
    }
  }
  return flux;
}

/**
 * Find peaks in a signal above threshold
 */
function findPeaks(signal, frameDuration, threshold) {
  const peaks = [];
  const windowSize = 20;
  
  for (let i = windowSize; i < signal.length - windowSize; i++) {
    // Calculate local mean
    let localSum = 0;
    for (let j = i - windowSize; j <= i + windowSize; j++) {
      localSum += signal[j];
    }
    const localMean = localSum / (windowSize * 2 + 1);
    
    // Check if this is a peak
    const adaptiveThreshold = Math.max(threshold, localMean * 1.5);
    
    if (signal[i] > adaptiveThreshold &&
        signal[i] > signal[i - 1] &&
        signal[i] > signal[i + 1]) {
      peaks.push(i * frameDuration);
    }
  }
  
  return peaks;
}

/**
 * Estimate BPM from beat timestamps using autocorrelation
 */
function estimateBPM(beats, duration) {
  if (beats.length < 4) return 120;
  
  // Calculate inter-beat intervals
  const intervals = [];
  for (let i = 1; i < beats.length; i++) {
    intervals.push(beats[i] - beats[i - 1]);
  }
  
  // Find most common interval using histogram
  const minBPM = 60;
  const maxBPM = 200;
  const resolution = 0.5;
  const numBins = Math.ceil((maxBPM - minBPM) / resolution);
  const histogram = new Float32Array(numBins);
  
  for (const interval of intervals) {
    if (interval <= 0) continue;
    const bpm = 60 / interval;
    
    for (const multiplier of [0.5, 1, 2]) {
      const adjustedBPM = bpm * multiplier;
      if (adjustedBPM >= minBPM && adjustedBPM <= maxBPM) {
        const bin = Math.floor((adjustedBPM - minBPM) / resolution);
        if (bin >= 0 && bin < numBins) {
          histogram[bin] += 1;
        }
      }
    }
  }
  
  // Smooth histogram
  const smoothed = new Float32Array(numBins);
  for (let i = 2; i < numBins - 2; i++) {
    smoothed[i] = (histogram[i - 2] + histogram[i - 1] * 2 + histogram[i] * 3 + 
                   histogram[i + 1] * 2 + histogram[i + 2]) / 9;
  }
  
  // Find peak
  let maxBin = 0;
  let maxValue = 0;
  for (let i = 0; i < numBins; i++) {
    if (smoothed[i] > maxValue) {
      maxValue = smoothed[i];
      maxBin = i;
    }
  }
  
  return Math.round(minBPM + maxBin * resolution);
}

/**
 * Decode audio file to AudioBuffer
 * @param {ArrayBuffer} arrayBuffer - Raw file data
 * @returns {Promise<AudioBuffer>}
 */
export async function decodeAudio(arrayBuffer) {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    await audioContext.close();
    return audioBuffer;
  } catch (error) {
    await audioContext.close();
    throw error;
  }
}

/**
 * Generate waveform data for visualization
 * @param {AudioBuffer} audioBuffer 
 * @param {number} numPoints - Number of points to generate
 * @returns {Float32Array} - Min/max pairs for each point
 */
export function generateWaveform(audioBuffer, numPoints = 1000) {
  const channelData = getMono(audioBuffer);
  const samplesPerPoint = Math.floor(channelData.length / numPoints);
  const waveform = new Float32Array(numPoints * 2);
  
  for (let i = 0; i < numPoints; i++) {
    const start = i * samplesPerPoint;
    const end = Math.min(start + samplesPerPoint, channelData.length);
    
    let min = 1;
    let max = -1;
    
    for (let j = start; j < end; j++) {
      const sample = channelData[j];
      if (sample < min) min = sample;
      if (sample > max) max = sample;
    }
    
    waveform[i * 2] = min;
    waveform[i * 2 + 1] = max;
  }
  
  return waveform;
}
