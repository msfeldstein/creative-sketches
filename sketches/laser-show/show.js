/**
 * LaserFixture: a virtual laser projector head, positioned in the venue like
 * a real rig (truss-mounted, floor, side towers). Orientation is mount
 * yaw/pitch/roll; the pattern deflects the beam inside the projector's scan
 * field (maxScan, like galvo mirror range).
 *
 * Show: a BPM-locked cue list. Each cue targets fixtures and sets their
 * pattern + params + color for a beat range — the same mental model as
 * programming a laser console (Pangolin-style cues on a timeline).
 */
import * as THREE from 'three';
import { runPattern } from './patterns.js';

const _dir = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _euler = new THREE.Euler();

const RAINBOW = [0xff2020, 0xff9500, 0xf7ff00, 0x2bff35, 0x00eaff, 0x2a55ff, 0xd022ff]
  .map((c) => new THREE.Color(c));

export class LaserFixture {
  constructor({
    name = 'laser',
    position = [0, 5, -24],
    yaw = 0,          // deg, 0 faces +Z (toward the crowd)
    pitch = 0,        // deg, positive aims up
    roll = 0,         // deg
    color = '#00ff66',
    maxScan = 30,     // deg half-angle of the scan field
    intensity = 1,
    r0 = 0.022,       // aperture radius (m)
    r1 = 0.16,        // radius at full throw (divergence)
    isWash = false,
  } = {}) {
    this.name = name;
    this.position = new THREE.Vector3(...position);
    this.yaw = yaw;
    this.pitch = pitch;
    this.roll = roll;
    this.color = new THREE.Color(color);
    this.maxScan = maxScan;
    this.intensity = intensity;
    this.r0 = r0;
    this.r1 = r1;
    this.isWash = isWash;
    this.enabled = true;

    // live pattern state (used directly in Live mode; overridden by cues in Show mode)
    this.pattern = 'fan';
    this.params = {};

    this.quaternion = new THREE.Quaternion();
    this._altColor = new THREE.Color('#ffffff');
    this.updateOrientation();
  }

  updateOrientation() {
    // negated so positive pitch aims up
    _euler.set(
      THREE.MathUtils.degToRad(-this.pitch),
      THREE.MathUtils.degToRad(this.yaw),
      THREE.MathUtils.degToRad(this.roll),
      'YXZ'
    );
    this.quaternion.setFromEuler(_euler);
  }

  /**
   * Compute beams/sheets for the current musical time and emit them into the
   * pools. sheetPool may be null (sheets are then skipped).
   */
  emit(pool, beat, override, sheetPool) {
    if (!this.enabled) return;
    const patName = override?.pattern ?? this.pattern;
    const params = override?.params ? { ...this.params, ...override.params } : this.params;
    const color = override?.color ?? this.color;
    const master = (override?.intensity ?? 1) * this.intensity;
    if (master <= 0.001) return;

    const { beams, sheets, params: p } = runPattern(patName, beat, params);
    const scan = THREE.MathUtils.degToRad(this.maxScan);
    const seedBase = this.position.x * 7.3 + this.position.z * 3.1;

    if (sheetPool) {
      for (let k = 0; k < sheets.length; k++) {
        const sh = sheets[k];
        if (sh.i <= 0.002) continue;
        const ax = sh.x * scan;
        const ay = sh.y * scan;
        _dir.set(Math.sin(ax), Math.sin(ay), Math.cos(ax) * Math.cos(ay)).normalize();
        _dir.applyQuaternion(this.quaternion);
        // fan opens along the rotated scan-space axis
        _axis.set(Math.cos(sh.axis), Math.sin(sh.axis), 0);
        _axis.applyQuaternion(this.quaternion);
        sheetPool.add(this.position, _dir, _axis, {
          color: p.colorMode === 'rainbow' ? RAINBOW[k % RAINBOW.length] : color,
          intensity: sh.i * master,
          halfArc: sh.w * scan,
          rippleAmp: (sh.amp ?? 0) * scan * 0.5,
          rippleFreq: sh.freq ?? 1,
          ripplePhase: sh.phase ?? 0,
          seed: seedBase + k * 3.7,
        });
      }
    }

    for (let k = 0; k < beams.length; k++) {
      const b = beams[k];
      if (b.i <= 0.002) continue;

      const ax = b.x * scan;
      const ay = b.y * scan;
      _dir.set(Math.sin(ax), Math.sin(ay), Math.cos(ax) * Math.cos(ay)).normalize();
      _dir.applyQuaternion(this.quaternion);

      let c = color;
      if (p.colorMode === 'rainbow') {
        c = RAINBOW[k % RAINBOW.length];
      } else if (p.colorMode === 'alternate') {
        c = k % 2 === 0 ? color : this._altColor;
      }

      pool.add(this.position, _dir, {
        color: c,
        intensity: b.i * master,
        r0: this.r0,
        r1: this.r1,
        seed: seedBase + k * 1.618,
        spot: !this.isWash,
      });
    }
  }

  toJSON() {
    return {
      name: this.name,
      position: this.position.toArray(),
      yaw: this.yaw, pitch: this.pitch, roll: this.roll,
      color: `#${this.color.getHexString()}`,
      maxScan: this.maxScan,
      intensity: this.intensity,
      pattern: this.pattern,
      params: { ...this.params },
      isWash: this.isWash,
    };
  }
}

/**
 * Show: BPM clock + cue list.
 *
 * Cue fields:
 *   start, len  - beat range [start, start+len)
 *   fixtures    - 'all' | array of fixture indices | predicate(fixture, index)
 *   pattern     - pattern name
 *   params      - static values, [from, to] ramps (lerped over the cue),
 *                 or functions (u, beat) => value
 *   color       - '#hex' | array of '#hex' cycled once per beat | (u, beat) => Color
 *   intensity   - same forms as a param; multiplied with fixture intensity
 */
export class Show {
  constructor({ bpm = 128, cues = [] } = {}) {
    this.bpm = bpm;
    this.cues = cues;
    this._colorCache = new Map();
  }

  beatsAt(timeSec) {
    return timeSec * this.bpm / 60;
  }

  _color(spec, u, beat) {
    if (!spec) return undefined;
    if (typeof spec === 'function') return spec(u, beat);
    if (Array.isArray(spec)) {
      const key = spec[Math.floor(beat) % spec.length];
      return this._cached(key);
    }
    return this._cached(spec);
  }

  _cached(hex) {
    if (!this._colorCache.has(hex)) this._colorCache.set(hex, new THREE.Color(hex));
    return this._colorCache.get(hex);
  }

  static _param(v, u, beat) {
    if (typeof v === 'function') return v(u, beat);
    if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number') {
      return v[0] + (v[1] - v[0]) * u;
    }
    return v;
  }

  /**
   * Resolve the active override for a fixture at a musical time.
   * Later cues in the list win when they overlap.
   */
  overrideFor(fixture, index, beat) {
    let active = null;
    for (const cue of this.cues) {
      if (beat < cue.start || beat >= cue.start + cue.len) continue;
      const t = cue.fixtures ?? 'all';
      const match =
        t === 'all' ? !fixture.isWash
        : typeof t === 'function' ? t(fixture, index)
        : t.includes(index);
      if (match) active = cue;
    }
    if (!active) return null;

    const u = (beat - active.start) / active.len;
    const params = {};
    if (active.params) {
      for (const [k, v] of Object.entries(active.params)) {
        params[k] = Show._param(v, u, beat);
      }
    }
    return {
      pattern: active.pattern,
      params,
      color: this._color(active.color, u, beat),
      intensity: active.intensity !== undefined ? Show._param(active.intensity, u, beat) : 1,
    };
  }

  get lengthBeats() {
    return this.cues.reduce((m, c) => Math.max(m, c.start + c.len), 0);
  }
}
