/**
 * Synthesizes the 96-beat 128 BPM techno track that accompanies the laser
 * show demo (structure matches demo-show.js: intro / build / drop / breakdown
 * / drop 2). Pure Node, writes a 16-bit stereo WAV.
 *
 * Usage: node tools/make-laser-track.mjs [out.wav]
 */
import { writeFileSync } from 'node:fs';

const SR = 44100;
const BPM = 128;
const SPB = 60 / BPM;           // seconds per beat
const BEATS = 96;
const TAIL = 2.0;
const N = Math.ceil((BEATS * SPB + TAIL) * SR);

// drums+leads vs bass+pads (bass bus gets sidechain ducking)
const busA = new Float32Array(N * 2);
const busB = new Float32Array(N * 2);

const beatToSample = (b) => Math.floor(b * SPB * SR);
let seed = 12345;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296 - 0.5;
};

function add(bus, i, l, r) {
  if (i < 0 || i >= N) return;
  bus[i * 2] += l;
  bus[i * 2 + 1] += r;
}

// ---------------------------------------------------------------- voices
function kick(atBeat, gain = 1, punch = 1) {
  const s0 = beatToSample(atBeat);
  const dur = Math.floor(0.30 * SR);
  let phase = 0;
  for (let i = 0; i < dur; i++) {
    const t = i / SR;
    const f = 42 + 120 * Math.exp(-t * 34) * punch;
    phase += (2 * Math.PI * f) / SR;
    const env = Math.exp(-t * 9);
    let v = Math.tanh(Math.sin(phase) * 2.2) * env * gain;
    if (i < 220) v += rand() * Math.exp(-i / 60) * 0.7 * gain * punch; // click
    add(busA, s0 + i, v, v);
  }
}

function hat(atBeat, gain = 0.3, decay = 0.045) {
  const s0 = beatToSample(atBeat);
  const dur = Math.floor(decay * 5 * SR);
  let prev = 0;
  for (let i = 0; i < dur; i++) {
    const t = i / SR;
    const n = rand() * 2;
    const hp = n - prev; // crude highpass
    prev = n;
    const v = hp * Math.exp(-t / decay) * gain;
    add(busA, s0 + i, v * 0.8, v);
  }
}

function clap(atBeat, gain = 0.5) {
  const s0 = beatToSample(atBeat);
  const dur = Math.floor(0.25 * SR);
  let lp = 0;
  for (let i = 0; i < dur; i++) {
    const t = i / SR;
    // three micro-bursts then tail
    const burst = t < 0.03 ? (Math.floor(t / 0.01) % 2 ? 0.4 : 1) : 1;
    const n = rand() * 2;
    lp += (n - lp) * 0.18; // band-ish
    const v = (n - lp) * Math.exp(-t * 16) * burst * gain;
    add(busA, s0 + i, v, v * 0.85);
  }
}

function snareRoll(fromBeat, toBeat, startDiv = 2, endDiv = 8, gain = 0.45) {
  let b = fromBeat;
  while (b < toBeat) {
    const u = (b - fromBeat) / (toBeat - fromBeat);
    clap(b, gain * (0.4 + 0.6 * u));
    const div = startDiv + (endDiv - startDiv) * u;
    b += 1 / div;
  }
}

function subBass(atBeat, lenBeats, freq, gain = 0.5) {
  const s0 = beatToSample(atBeat);
  const dur = Math.floor(lenBeats * SPB * SR);
  let phase = 0;
  for (let i = 0; i < dur; i++) {
    const t = i / SR;
    phase += (2 * Math.PI * freq) / SR;
    const env = Math.min(1, t * 90) * Math.exp(-t * 2.2);
    const v = (Math.sin(phase) + Math.sin(phase * 2) * 0.28) * env * gain;
    add(busB, s0 + i, v, v);
  }
}

function saw(phase) {
  const x = phase / (2 * Math.PI);
  return 2 * (x - Math.floor(x + 0.5));
}

function stab(atBeat, freqs, len = 0.22, gain = 0.16, echo = 3) {
  for (let e = 0; e <= echo; e++) {
    const s0 = beatToSample(atBeat + e * 0.75);
    const g = gain * Math.pow(0.5, e);
    const dur = Math.floor(len * SR);
    const phases = freqs.map(() => 0);
    let lp = 0, lpR = 0;
    for (let i = 0; i < dur; i++) {
      const t = i / SR;
      let v = 0;
      for (let k = 0; k < freqs.length; k++) {
        phases[k] += (2 * Math.PI * freqs[k] * (1 + 0.004 * Math.sin(t * 30 + k))) / SR;
        v += saw(phases[k]) / freqs.length;
      }
      const env = Math.min(1, t * 220) * Math.exp(-t * 11);
      const cut = 0.12 + 0.5 * Math.exp(-t * 18);
      lp += (v - lp) * cut;
      lpR += (v - lpR) * cut * 0.9;
      const pan = e % 2 ? 0.75 : 1.25;
      add(busA, s0 + i, lp * env * g * (2 - pan), lpR * env * g * pan);
    }
  }
}

function pad(atBeat, lenBeats, freqs, gain = 0.10) {
  const s0 = beatToSample(atBeat);
  const dur = Math.floor(lenBeats * SPB * SR);
  const phases = [];
  for (const f of freqs) phases.push([0, 0], [0, 0]); // two detuned per note
  let lp = 0, lpR = 0;
  for (let i = 0; i < dur; i++) {
    const t = i / SR;
    let v = 0, vr = 0;
    for (let k = 0; k < freqs.length; k++) {
      const f = freqs[k];
      phases[k * 2][0] += (2 * Math.PI * f * 0.997) / SR;
      phases[k * 2 + 1][0] += (2 * Math.PI * f * 1.003) / SR;
      v += saw(phases[k * 2][0]) / freqs.length;
      vr += saw(phases[k * 2 + 1][0]) / freqs.length;
    }
    const u = i / dur;
    const env = Math.min(1, u * 8) * Math.min(1, (1 - u) * 6);
    const cut = 0.04 + 0.05 * Math.sin(t * 0.7);
    lp += (v - lp) * cut;
    lpR += (vr - lpR) * cut;
    add(busB, s0 + i, lp * env * gain, lpR * env * gain);
  }
}

function riser(fromBeat, toBeat, gain = 0.28) {
  const s0 = beatToSample(fromBeat);
  const dur = beatToSample(toBeat) - s0;
  let lp = 0, phase = 0;
  for (let i = 0; i < dur; i++) {
    const u = i / dur;
    const n = rand() * 2;
    lp += (n - lp) * (0.02 + u * u * 0.5); // opening filter
    phase += (2 * Math.PI * (80 + 800 * u * u)) / SR;
    const tone = Math.sin(phase) * 0.25 * u;
    const v = (lp + tone) * u * u * gain;
    add(busA, s0 + i, v * (1 - u * 0.4), v);
  }
}

function impact(atBeat, gain = 0.9) {
  const s0 = beatToSample(atBeat);
  const dur = Math.floor(1.6 * SR);
  let phase = 0, lp = 0;
  for (let i = 0; i < dur; i++) {
    const t = i / SR;
    phase += (2 * Math.PI * (28 + 40 * Math.exp(-t * 10))) / SR;
    const boom = Math.sin(phase) * Math.exp(-t * 3.2);
    const n = rand() * 2;
    lp += (n - lp) * 0.08;
    const wash = lp * Math.exp(-t * 2.2) * 0.7;
    const v = (boom + wash) * gain;
    add(busA, s0 + i, v, v);
  }
}

// ---------------------------------------------------------------- arrangement
// F minor: F1 43.65  Ab1 51.91  C2 65.41  Eb2 77.78
const F1 = 43.65, Ab1 = 51.91, C2 = 65.41, Eb2 = 77.78;
const CHORD_Fm = [174.61, 207.65, 261.63];   // F3 Ab3 C4
const CHORD_Db = [138.59, 174.61, 220.0];    // Db3 F3 A3(~Ab compromise) -> use 207.65
CHORD_Db[2] = 207.65;
const CHORD_Eb = [155.56, 196.0, 233.08];    // Eb3 G3 Bb3

// intro 0-16: muffled kick + pad
for (let b = 0; b < 16; b++) kick(b, 0.5, 0.35);
pad(0, 16, [F1 * 2, Ab1 * 2, C2 * 2], 0.12);
for (let b = 8; b < 16; b += 0.5) hat(b + 0.5, 0.12);

// build 16-32
for (let b = 16; b < 32; b++) kick(b, 0.9, 0.8);
for (let b = 16; b < 32; b += 0.5) hat(b + 0.5, 0.22);
for (let b = 16; b < 32; b += 4) { clap(b + 1, 0.4); clap(b + 3, 0.4); }
pad(16, 16, [F1 * 2, Ab1 * 2, C2 * 2, Eb2 * 2], 0.10);
snareRoll(28, 32, 2, 16, 0.5);
riser(24, 32, 0.32);

// drop helper
function dropSection(start, altStabs = false) {
  for (let b = start; b < start + 16; b++) kick(b, 1.0, 1.0);
  for (let b = start; b < start + 16; b += 0.5) hat(b + 0.5, 0.30, altStabs ? 0.09 : 0.05);
  for (let b = start; b < start + 16; b += 0.25) hat(b, 0.07, 0.02);
  for (let b = start; b < start + 16; b += 4) { clap(b + 1, 0.5); clap(b + 3, 0.5); }
  // rolling offbeat bass, chord progression per bar: Fm Fm Db Eb
  const roots = [F1, F1, Ab1 / 2 * 1.189, Eb2 / 2]; // F F Db Eb (Db1=34.65)
  for (let bar = 0; bar < 4; bar++) {
    const root = roots[bar % 4];
    for (let q = 0; q < 4; q++) {
      const b = start + bar * 4 + q;
      subBass(b + 0.5, 0.45, root * 2, 0.55);
    }
  }
  // stabs
  const chords = [CHORD_Fm, CHORD_Fm, CHORD_Db, CHORD_Eb];
  for (let bar = 0; bar < 4; bar++) {
    const ch = chords[bar % 4];
    const base = start + bar * 4;
    const pat = altStabs ? [0.5, 1.25, 2.0, 2.75, 3.5] : [0.5, 1.75, 2.5];
    for (const off of pat) stab(base + off, ch, 0.2, altStabs ? 0.17 : 0.14);
  }
}

impact(32, 0.9);
dropSection(32, false);
dropSection(48, true);

// breakdown 64-76
pad(64, 12, [F1 * 2, Ab1 * 2, C2 * 2], 0.16);
pad(64, 12, [CHORD_Fm[0], CHORD_Fm[1], CHORD_Fm[2]], 0.05);
for (let b = 64; b < 76; b += 2) hat(b + 1, 0.08, 0.12);

// build 76-80
for (let b = 76; b < 80; b++) kick(b, 0.85, 0.8);
snareRoll(76, 80, 4, 24, 0.5);
riser(74, 80, 0.36);

impact(80, 1.0);
dropSection(80, true);

// finale hit
kick(95.5, 0.9, 1);
impact(96, 1.0);

// ---------------------------------------------------------------- mix
// sidechain duck bus B against the kick grid
const out = new Float32Array(N * 2);
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const beat = t / SPB;
  let duck = 1;
  const inKicks =
    (beat >= 0 && beat < 32) || (beat >= 32 && beat < 64) || (beat >= 76 && beat < 96);
  if (inKicks) {
    const ph = beat % 1;
    duck = 0.25 + 0.75 * Math.min(1, ph * 2.4);
  }
  out[i * 2] = busA[i * 2] + busB[i * 2] * duck;
  out[i * 2 + 1] = busA[i * 2 + 1] + busB[i * 2 + 1] * duck;
}

// soft clip + normalize
let peak = 0;
for (let i = 0; i < out.length; i++) {
  out[i] = Math.tanh(out[i] * 1.25);
  peak = Math.max(peak, Math.abs(out[i]));
}
const norm = 0.92 / (peak || 1);

// ---------------------------------------------------------------- wav write
const bytes = Buffer.alloc(44 + out.length * 2);
bytes.write('RIFF', 0);
bytes.writeUInt32LE(36 + out.length * 2, 4);
bytes.write('WAVE', 8);
bytes.write('fmt ', 12);
bytes.writeUInt32LE(16, 16);
bytes.writeUInt16LE(1, 20);        // PCM
bytes.writeUInt16LE(2, 22);        // stereo
bytes.writeUInt32LE(SR, 24);
bytes.writeUInt32LE(SR * 4, 28);
bytes.writeUInt16LE(4, 32);
bytes.writeUInt16LE(16, 34);
bytes.write('data', 36);
bytes.writeUInt32LE(out.length * 2, 40);
for (let i = 0; i < out.length; i++) {
  bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, out[i] * norm)) * 32767), 44 + i * 2);
}

const outPath = process.argv[2] || '/tmp/laser-track.wav';
writeFileSync(outPath, bytes);
console.log(`wrote ${outPath}: ${(N / SR).toFixed(1)}s, ${BPM} BPM, ${BEATS} beats`);
