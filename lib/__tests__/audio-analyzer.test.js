/**
 * Audio Analyzer tests
 */
import { describe, it, expect } from 'vitest';
import { generateWaveform } from '../audio-analyzer.js';

describe('generateWaveform', () => {
  it('returns a Float32Array of correct length', () => {
    const mockBuffer = createMockAudioBuffer(1000);
    const waveform = generateWaveform(mockBuffer, 100);
    expect(waveform).toBeInstanceOf(Float32Array);
    expect(waveform.length).toBe(200); // numPoints * 2 (min/max pairs)
  });

  it('uses default numPoints when not specified', () => {
    const mockBuffer = createMockAudioBuffer(10000);
    const waveform = generateWaveform(mockBuffer);
    expect(waveform.length).toBe(2000); // 1000 default * 2
  });
});

function createMockAudioBuffer(sampleCount) {
  const channelData = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    channelData[i] = Math.sin((i / sampleCount) * Math.PI * 2) * 0.5;
  }
  return {
    numberOfChannels: 1,
    length: sampleCount,
    getChannelData: (channel) => (channel === 0 ? channelData : new Float32Array(sampleCount)),
  };
}
