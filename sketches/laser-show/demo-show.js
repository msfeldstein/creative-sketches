/**
 * Demo show: a 96-beat (45s @ 128 BPM) programmed laser show.
 *
 * Rig (like a real club install):
 *   0-4  back-truss array of five heads above the DJ, aimed over the crowd
 *   5-6  side-tower heads on the stage towers, crossing inward
 *   7-8  floor units in front of the stage firing up
 *   9    center booth laser
 *   10-11 wide wash cones on the mid truss (atmosphere only)
 *
 * Timeline:
 *   beats  0-16  intro      sparse single beams, slow liquid sky
 *   beats 16-32  build      fans opening, sweeps accelerating, strobe ramp
 *   beats 32-64  drop 1     full rig: rainbow fans, spinning cones, bursts
 *   beats 64-80  breakdown  deep blue liquid sky, then chase build
 *   beats 80-96  drop 2     helix + bursts + strobed fans, finale
 */
import * as THREE from 'three';
import { LaserFixture, Show } from './show.js';

export const DEMO_BPM = 128;
export const DEMO_BEATS = 96;

export function createRig() {
  const fixtures = [];

  // back truss array
  const xs = [-11, -5.5, 0, 5.5, 11];
  for (let i = 0; i < xs.length; i++) {
    fixtures.push(new LaserFixture({
      name: `truss-${i + 1}`,
      position: [xs[i], 9.1, -23.8],
      yaw: -xs[i] * 0.8,
      pitch: 5,
      color: '#00ff66',
      maxScan: 32,
    }));
  }

  // side towers, crossing inward
  fixtures.push(new LaserFixture({
    name: 'tower-L', position: [-12.6, 7.4, -23.6], yaw: 24, pitch: 3,
    color: '#00eaff', maxScan: 30,
  }));
  fixtures.push(new LaserFixture({
    name: 'tower-R', position: [12.6, 7.4, -23.6], yaw: -24, pitch: 3,
    color: '#00eaff', maxScan: 30,
  }));

  // floor units firing up over the DJ
  fixtures.push(new LaserFixture({
    name: 'floor-L', position: [-8, 0.4, -20.5], yaw: 8, pitch: 24,
    color: '#d022ff', maxScan: 26,
  }));
  fixtures.push(new LaserFixture({
    name: 'floor-R', position: [8, 0.4, -20.5], yaw: -8, pitch: 24,
    color: '#d022ff', maxScan: 26,
  }));

  // center booth laser
  fixtures.push(new LaserFixture({
    name: 'booth', position: [0, 3.4, -23.2], yaw: 0, pitch: 7,
    color: '#ffffff', maxScan: 34,
  }));

  // mid-truss washes (pure atmosphere)
  fixtures.push(new LaserFixture({
    name: 'wash-L', position: [-9, 8.4, -6], yaw: 0, pitch: -62,
    color: '#2a55ff', maxScan: 10, intensity: 0.06, r0: 0.5, r1: 5.5, isWash: true,
  }));
  fixtures.push(new LaserFixture({
    name: 'wash-R', position: [9, 8.4, -6], yaw: 0, pitch: -62,
    color: '#d022ff', maxScan: 10, intensity: 0.06, r0: 0.5, r1: 5.5, isWash: true,
  }));

  return fixtures;
}

const TRUSS = [0, 1, 2, 3, 4];
const TOWERS = [5, 6];
const FLOOR = [7, 8];
const BOOTH = [9];
const WASHES = [10, 11];

export function createDemoShow() {
  const cues = [];

  // ------------------------------------------------ intro (0-16)
  cues.push({
    start: 0, len: 16, fixtures: WASHES, pattern: 'wash',
    params: { size: 0.3 }, intensity: [0.4, 1],
  });
  // faint blue curtain behind the DJ so the room reads from the first bar
  cues.push({
    start: 0, len: 16, fixtures: [0, 4], pattern: 'fan', color: '#1030ff',
    params: { count: 6, size: 0.7, oy: 0.25 }, intensity: [0.35, 0.55],
  });
  cues.push({
    start: 0, len: 8, fixtures: [2], pattern: 'sweep', color: '#00eaff',
    params: { count: 1, speed: 0.5, size: 0.8 }, intensity: [0.55, 0.9],
  });
  cues.push({
    start: 4, len: 12, fixtures: TOWERS, pattern: 'sweep', color: '#00eaff',
    params: { count: 1, speed: 0.5, phase: 0.5, size: 0.9 }, intensity: [0.55, 0.95],
  });
  // solid rippling plane: the "beam moving so fast it looks like a sheet" look
  cues.push({
    start: 8, len: 8, fixtures: [1, 2, 3], pattern: 'liquid-sky', color: '#0090ff',
    params: { count: 4, speed: 0.6, wave: 0.3, size: 0.9, oy: 0.12 }, intensity: [0.65, 1.0],
  });

  // ------------------------------------------------ build (16-32)
  cues.push({
    start: 16, len: 16, fixtures: TRUSS, pattern: 'fan', color: '#00ff66',
    params: {
      count: 7,
      size: [0.15, 1],                       // fans open over the build
      rotSpeed: [0, 0.5],
      oy: 0.1,
    },
    intensity: [0.5, 1],
  });
  cues.push({
    start: 16, len: 16, fixtures: TOWERS, pattern: 'sweep', color: '#00eaff',
    params: { count: 3, speed: [0.5, 2], size: 1 }, intensity: 0.9,
  });
  cues.push({
    start: 24, len: 8, fixtures: FLOOR, pattern: 'cone', color: '#d022ff',
    params: { count: 8, speed: [0.5, 2], size: [0.3, 0.8] }, intensity: [0.4, 1],
  });
  // strobe ramp in the last 4 beats of the build
  cues.push({
    start: 28, len: 4, fixtures: TRUSS, pattern: 'fan', color: '#ffffff',
    params: {
      count: 9, size: 1, oy: 0.1,
      strobe: (u) => 2 + Math.floor(u * 6) * 2, // 2 -> 12 flashes per beat
      duty: 0.45,
    },
    intensity: [0.8, 1.2],
  });

  // ------------------------------------------------ DROP 1 (32-64)
  const dropColors = ['#00ff66', '#00eaff', '#d022ff', '#ff2020'];
  cues.push({
    start: 32, len: 16, fixtures: TRUSS, pattern: 'wave', color: dropColors,
    params: {
      count: 11, size: 1, speed: 1, waveFreq: 2, wave: 0.4, oy: 0.12,
      rotSpeed: 0.25,
    },
    intensity: 1.15,
  });
  cues.push({
    start: 32, len: 16, fixtures: TOWERS, pattern: 'cone', color: '#00eaff',
    params: { count: 10, speed: 1.5, size: 0.75 }, intensity: 1,
  });
  cues.push({
    start: 32, len: 32, fixtures: FLOOR, pattern: 'burst', color: '#ffffff',
    params: { count: 3, speed: 2, size: 0.9, seed: 5 }, intensity: 0.9,
  });
  cues.push({
    start: 32, len: 16, fixtures: BOOTH, pattern: 'cone', color: dropColors,
    params: { count: 12, speed: -1, size: [0.4, 1] }, intensity: 1,
  });
  cues.push({
    start: 32, len: 64, fixtures: WASHES, pattern: 'wash', params: { size: 0.35 },
    intensity: (u, beat) => 0.7 + 0.5 * Math.pow(1 - (beat % 1), 2),
  });

  // second half of drop 1: rainbow fans + fast sweeps
  cues.push({
    start: 48, len: 16, fixtures: TRUSS, pattern: 'fan', 
    params: {
      count: 13, size: 1, colorMode: 'rainbow', oy: 0.12,
      rot: (u) => Math.sin(u * Math.PI * 4) * 40,
    },
    intensity: 1.15,
  });
  // solid planes slashing across the room
  cues.push({
    start: 48, len: 16, fixtures: TOWERS, pattern: 'sheet-sweep', color: ['#ff2020', '#ffffff'],
    params: { speed: 1, size: 1, wave: 0.15 }, intensity: 1,
  });
  // truss heads snap to solid rotating fans for the last 8 beats of drop 1
  cues.push({
    start: 56, len: 8, fixtures: [0, 2, 4], pattern: 'sheet', color: '#00ff66',
    params: {
      size: 0.9, oy: 0.12, wave: 0.1, waveFreq: 3,
      rotSpeed: 0.5, rot: (u) => -30 + u * 60,
    },
    intensity: 1.05,
  });
  cues.push({
    start: 56, len: 8, fixtures: BOOTH, pattern: 'helix', color: '#f7ff00',
    params: { count: 6, speed: 2, size: 1 }, intensity: 1,
  });

  // ------------------------------------------------ breakdown (64-80)
  cues.push({
    start: 64, len: 12, fixtures: [1, 2, 3], pattern: 'liquid-sky', color: '#2a55ff',
    params: { count: 8, speed: 0.4, wave: 0.45, size: 1, oy: 0.15 },
    intensity: (u) => 1.2 - 0.5 * u,
  });
  cues.push({
    start: 64, len: 12, fixtures: TOWERS, pattern: 'beam', color: '#2a55ff',
    params: { size: 0 }, intensity: 0.5,
  });
  cues.push({
    start: 64, len: 12, fixtures: WASHES, pattern: 'wash', params: { size: 0.3 }, intensity: 0.5,
  });
  // chase build back in
  cues.push({
    start: 76, len: 4, fixtures: TRUSS, pattern: 'chase', color: '#ffffff',
    params: { count: 13, speed: [1, 4], size: 1, oy: 0.1 }, intensity: [0.7, 1.1],
  });
  cues.push({
    start: 76, len: 4, fixtures: FLOOR, pattern: 'cone', color: '#d022ff',
    params: { count: 8, speed: [1, 3], size: [0.4, 0.9] }, intensity: [0.5, 1],
  });

  // ------------------------------------------------ DROP 2 (80-96)
  cues.push({
    start: 80, len: 16, fixtures: TRUSS, pattern: 'wave', color: dropColors,
    params: {
      count: 13, size: 1, speed: 1.5, waveFreq: 3, wave: 0.5, oy: 0.12,
      rotSpeed: -0.4,
    },
    intensity: 1.2,
  });
  cues.push({
    start: 80, len: 16, fixtures: TOWERS, pattern: 'cone', color: ['#00eaff', '#d022ff'],
    params: { count: 12, speed: -2, size: 0.85 }, intensity: 1.1,
  });
  cues.push({
    start: 80, len: 16, fixtures: FLOOR, pattern: 'burst', color: '#ffffff',
    params: { count: 4, speed: 4, size: 1, seed: 9 }, intensity: 1,
  });
  cues.push({
    start: 80, len: 16, fixtures: BOOTH, pattern: 'helix', color: '#f7ff00',
    params: { count: 6, speed: 3, size: 1 }, intensity: 1.1,
  });
  cues.push({
    start: 80, len: 16, fixtures: WASHES, pattern: 'wash', params: { size: 0.4 },
    intensity: (u, beat) => 0.8 + 0.5 * Math.pow(1 - (beat % 1), 2),
  });
  // strobed rainbow finale
  cues.push({
    start: 92, len: 3.5, fixtures: TRUSS, pattern: 'fan',
    params: { count: 13, size: 1, colorMode: 'rainbow', strobe: 4, duty: 0.5, oy: 0.12, rotSpeed: 1 },
    intensity: 1.3,
  });
  // final hit: everything white for the last half beat, then blackout
  cues.push({
    start: 95.5, len: 0.5, fixtures: 'all', pattern: 'fan', color: '#ffffff',
    params: { count: 13, size: 1, oy: 0.1 }, intensity: (u) => 1.4 * (1 - u),
  });

  return new Show({ bpm: DEMO_BPM, cues });
}

/** Crowd/LED energy per beat, drives the stage animation. */
export function energyAt(beat) {
  if (beat < 8) return 0.12;
  if (beat < 16) return 0.2;
  if (beat < 28) return 0.3 + ((beat - 16) / 12) * 0.3;
  if (beat < 32) return 0.7;
  if (beat < 64) return 1.0;
  if (beat < 72) return 0.25;
  if (beat < 80) return 0.35 + ((beat - 72) / 8) * 0.45;
  if (beat < 96) return 1.0;
  return 0.1;
}

const ACCENTS = [
  { at: 0, c: new THREE.Color('#0a3a66') },
  { at: 8, c: new THREE.Color('#0055aa') },
  { at: 16, c: new THREE.Color('#00aa55') },
  { at: 32, c: new THREE.Color('#00ff66') },
  { at: 40, c: new THREE.Color('#00eaff') },
  { at: 48, c: new THREE.Color('#d022ff') },
  { at: 56, c: new THREE.Color('#ff2020') },
  { at: 64, c: new THREE.Color('#12308a') },
  { at: 76, c: new THREE.Color('#8822ff') },
  { at: 80, c: new THREE.Color('#00eaff') },
  { at: 88, c: new THREE.Color('#ff3060') },
];

const _accent = new THREE.Color();
export function accentAt(beat) {
  let cur = ACCENTS[0];
  for (const a of ACCENTS) if (beat >= a.at) cur = a;
  return _accent.copy(cur.c);
}

/**
 * Camera direction: a shot list cut on musical boundaries.
 * Each shot lerps pos/look with smoothing plus handheld sway.
 */
const SHOTS = [
  { start: 0, len: 8, from: { pos: [0, 3.2, 22], look: [0, 4.5, -20] }, to: { pos: [0, 3.0, 16], look: [0, 5, -20] } },
  { start: 8, len: 8, from: { pos: [-7, 1.8, 4], look: [2, 7, -24] }, to: { pos: [-5, 1.9, 2], look: [1, 8, -24] } },
  { start: 16, len: 8, from: { pos: [14, 2.4, 6], look: [-4, 6, -24] }, to: { pos: [10, 2.8, -2], look: [-2, 6, -24] } },
  { start: 24, len: 8, from: { pos: [0, 3.4, -27.5], look: [0, 6.5, 10] }, to: { pos: [0, 3.8, -27], look: [0, 5.5, 10] } },
  { start: 32, len: 8, from: { pos: [0, 2.2, 20], look: [0, 6, -22] }, to: { pos: [0, 2.6, 10], look: [0, 6, -22] }, shake: 0.5 },
  { start: 40, len: 8, from: { pos: [6, 1.7, 2], look: [-2, 8, -22] }, to: { pos: [4, 1.8, -1], look: [-1, 9, -22] }, shake: 0.4 },
  { start: 48, len: 8, from: { pos: [-13, 3.2, 2], look: [4, 6, -24] }, to: { pos: [-9, 3.6, -5], look: [2, 6, -24] }, shake: 0.4 },
  { start: 56, len: 8, from: { pos: [0, 4.0, -27.5], look: [0, 5.5, 10] }, to: { pos: [0, 3.2, -26.5], look: [0, 6.5, 10] }, shake: 0.5 },
  { start: 64, len: 12, from: { pos: [0, 5.5, 18], look: [0, 5.5, -20] }, to: { pos: [0, 4.2, 13], look: [0, 6, -20] } },
  { start: 76, len: 4, from: { pos: [-4, 1.8, 6], look: [0, 7, -24] }, to: { pos: [-2, 1.9, 4], look: [0, 8, -24] }, shake: 0.3 },
  { start: 80, len: 8, from: { pos: [0, 2.4, 18], look: [0, 6, -22] }, to: { pos: [0, 2.8, 9], look: [0, 6.5, -22] }, shake: 0.5 },
  { start: 88, len: 8.6, from: { pos: [8, 2.0, 8], look: [-1, 7, -23] }, to: { pos: [0, 3.4, 0], look: [0, 6, -23] }, shake: 0.5 },
];

const _pos = new THREE.Vector3();
const _look = new THREE.Vector3();

export function cameraAt(beat, time) {
  let shot = SHOTS[0];
  for (const s of SHOTS) if (beat >= s.start) shot = s;
  const u = Math.min(1, (beat - shot.start) / shot.len);
  const e = u * u * (3 - 2 * u) * 0.4 + u * 0.6; // mostly linear with soft start

  _pos.fromArray(shot.from.pos).lerp(_look.fromArray(shot.to.pos), e);
  const px = _pos.x, py = _pos.y, pz = _pos.z;
  _look.fromArray(shot.from.look).lerp(new THREE.Vector3(...shot.to.look), e);

  const sh = (shot.shake ?? 0.18);
  _pos.set(
    px + Math.sin(time * 1.31) * 0.14 * sh + Math.sin(time * 4.7) * 0.03 * sh,
    py + Math.sin(time * 1.77) * 0.10 * sh,
    pz + Math.cos(time * 1.13) * 0.10 * sh
  );
  _look.x += Math.sin(time * 0.9) * 0.25 * sh;
  _look.y += Math.cos(time * 1.2) * 0.15 * sh;

  return { pos: _pos, look: _look };
}
