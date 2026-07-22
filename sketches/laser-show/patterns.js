/**
 * Laser pattern generators, modeled on how real ILDA/DMX laser projectors
 * are programmed: each fixture has a square scan field (galvo mirrors that
 * deflect the beam up to ~±30°) and a pattern is a function that, for a given
 * musical time, emits a set of beams as (x, y) scan angles inside that field.
 *
 * Every pattern supports the standard "console channels":
 *   size     - scan field usage 0..1
 *   rot      - static frame rotation (deg)
 *   rotSpeed - frame rotation speed (rev per 8 beats)
 *   ox, oy   - frame offset within the scan field (-1..1)
 *   speed    - pattern animation speed (cycles per 4 beats, pattern-specific)
 *   phase    - animation phase offset (0..1)
 *   count    - number of beams
 *   strobe   - strobe divisions per beat (0 = off)
 *   duty     - strobe on fraction
 *   colorMode- 'fixture' | 'rainbow' | 'alternate'
 *   dim      - master dimmer 0..1
 *
 * A pattern returns an array of { x, y, i } where x/y are normalized scan
 * coords (-1..1, scaled by the fixture's maxScan) and i is beam intensity.
 */

export const PATTERN_DEFAULTS = {
  size: 1, rot: 0, rotSpeed: 0, ox: 0, oy: 0,
  speed: 1, phase: 0, count: 7, strobe: 0, duty: 0.5,
  colorMode: 'fixture', dim: 1,
  spreadY: 0, wave: 0, waveFreq: 2, seed: 1,
};

function frac(x) { return x - Math.floor(x); }

/** Apply frame rotation + offset + size, shared by all patterns. */
function frame(beams, p, beat) {
  const ang = (p.rot * Math.PI / 180) + (p.rotSpeed * beat / 8) * Math.PI * 2;
  const c = Math.cos(ang), s = Math.sin(ang);
  for (const b of beams) {
    const x = b.x * p.size, y = b.y * p.size;
    b.x = x * c - y * s + p.ox;
    b.y = x * s + y * c + p.oy;
  }
  return beams;
}

function strobeGate(p, beat) {
  if (!p.strobe) return 1;
  return frac(beat * p.strobe) < p.duty ? 1 : 0;
}

// mulberry32-ish hash for repeatable "random" bursts
function hash(n) {
  let x = Math.imul(n ^ 61, 0x27d4eb2d);
  x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d);
  x ^= x >>> 12; x = Math.imul(x, 0x297a2d39);
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}

export const PATTERNS = {
  /** Single static beam. */
  beam(beat, p) {
    return frame([{ x: 0, y: 0, i: 1 }], p, beat);
  },

  /** Classic flat fan of N beams. */
  fan(beat, p) {
    const n = Math.max(1, Math.round(p.count));
    const out = [];
    for (let k = 0; k < n; k++) {
      const u = n === 1 ? 0 : k / (n - 1) - 0.5;
      out.push({ x: u * 2, y: u * p.spreadY * 2, i: 1 });
    }
    return frame(out, p, beat);
  },

  /** Fan sweeping side-to-side (sine). */
  sweep(beat, p) {
    const n = Math.max(1, Math.round(p.count));
    const t = Math.sin((beat / 4 * p.speed + p.phase) * Math.PI * 2);
    const out = [];
    const span = 0.55;
    for (let k = 0; k < n; k++) {
      const u = n === 1 ? 0 : k / (n - 1) - 0.5;
      out.push({ x: u * 2 * span + t * (1 - span * 0.5), y: 0, i: 1 });
    }
    return frame(out, p, beat);
  },

  /** Beams on a circle: the classic cone / tunnel. */
  cone(beat, p) {
    const n = Math.max(3, Math.round(p.count));
    const spin = (beat / 4 * p.speed + p.phase) * Math.PI * 2;
    const out = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + spin;
      out.push({ x: Math.cos(a) * 0.65, y: Math.sin(a) * 0.65, i: 1 });
    }
    return frame(out, p, beat);
  },

  /** Liquid sky: a flat sheet with a traveling ripple through it. */
  liquid(beat, p) {
    const n = Math.max(8, Math.round(p.count));
    const out = [];
    const t = beat / 4 * p.speed + p.phase;
    for (let k = 0; k < n; k++) {
      const u = k / (n - 1) - 0.5;
      const ripple = Math.sin(u * Math.PI * 2 * p.waveFreq - t * Math.PI * 2)
        * Math.sin(t * Math.PI * 0.7 + u);
      out.push({ x: u * 2, y: ripple * (0.18 + p.wave * 0.5), i: 0.85 });
    }
    return frame(out, p, beat);
  },

  /** Fan with a traveling sine wave across the beams. */
  wave(beat, p) {
    const n = Math.max(3, Math.round(p.count));
    const out = [];
    const t = beat / 4 * p.speed + p.phase;
    for (let k = 0; k < n; k++) {
      const u = n === 1 ? 0 : k / (n - 1) - 0.5;
      out.push({
        x: u * 2,
        y: Math.sin(u * Math.PI * p.waveFreq + t * Math.PI * 2) * (0.25 + p.wave * 0.5),
        i: 1,
      });
    }
    return frame(out, p, beat);
  },

  /** Random accent beams that re-aim on beat subdivisions. Drop material. */
  burst(beat, p) {
    const n = Math.max(1, Math.round(p.count));
    const step = Math.floor(beat * Math.max(0.25, p.speed));
    const out = [];
    for (let k = 0; k < n; k++) {
      const h1 = hash(step * 131 + k * 17 + (p.seed | 0) * 7919);
      const h2 = hash(step * 271 + k * 29 + (p.seed | 0) * 104729);
      out.push({ x: (h1 - 0.5) * 2, y: (h2 - 0.5) * 1.2, i: 1 });
    }
    return frame(out, p, beat);
  },

  /** A lit "window" chasing across a fan. */
  chase(beat, p) {
    const n = Math.max(4, Math.round(p.count));
    const pos = frac(beat / 4 * p.speed + p.phase) * n;
    const out = [];
    for (let k = 0; k < n; k++) {
      let d = Math.abs(k + 0.5 - pos);
      d = Math.min(d, n - d);
      const i = Math.max(0, 1 - d / 1.6);
      const u = k / (n - 1) - 0.5;
      out.push({ x: u * 2, y: 0, i: i * i });
    }
    return frame(out, p, beat);
  },

  /** Two beams orbiting each other: helix / DNA look. */
  helix(beat, p) {
    const t = (beat / 4 * p.speed + p.phase) * Math.PI * 2;
    const out = [];
    const arms = Math.max(2, Math.round(p.count / 3));
    for (let k = 0; k < arms; k++) {
      const a = t + (k / arms) * Math.PI * 2;
      out.push({ x: Math.cos(a) * 0.7, y: Math.sin(a * 2) * 0.35, i: 1 });
    }
    return frame(out, p, beat);
  },

  /** Wide, slow-breathing sheet: ambient wash cone (used by wash fixtures). */
  wash(beat, p) {
    return frame([{ x: 0, y: 0, i: 0.8 + 0.2 * Math.sin(beat * Math.PI / 4) }], p, beat);
  },
};

export const PATTERN_NAMES = Object.keys(PATTERNS);

/**
 * Run a pattern and apply the shared console channels (dimmer, strobe).
 * Returns beams with final intensity.
 */
export function runPattern(name, beat, params) {
  const p = { ...PATTERN_DEFAULTS, ...params };
  const fn = PATTERNS[name] || PATTERNS.beam;
  const beams = fn(beat, p);
  const gate = strobeGate(p, beat) * p.dim;
  for (const b of beams) b.i *= gate;
  return { beams, params: p };
}
