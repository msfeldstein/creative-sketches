/**
 * The venue: a dark warehouse — floor, walls, stage riser, DJ booth with a
 * pulsing LED face, back LED wall, truss rig, bobbing crowd silhouettes and
 * floating haze dust. Everything opaque renders before the beams so depth
 * testing clips lasers against walls, floor and bodies.
 */
import * as THREE from 'three';

export const ROOM = {
  minX: -22, maxX: 22,
  minY: 0, maxY: 13,
  minZ: -30, maxZ: 26,
};

export function buildStage(scene) {
  const out = {};

  scene.fog = new THREE.FogExp2(0x04040a, 0.016);
  scene.background = new THREE.Color(0x020208);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x14141e, roughness: 0.95, metalness: 0.05 });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x11111a, roughness: 0.35, metalness: 0.55 });

  // floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(44, 56), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, -2);
  scene.add(floor);

  // walls + ceiling
  const mkWall = (w, h, pos, ry = 0, rx = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat);
    m.position.set(...pos);
    m.rotation.y = ry;
    m.rotation.x = rx;
    scene.add(m);
    return m;
  };
  mkWall(44, 13, [0, 6.5, ROOM.minZ], 0);                 // back (behind stage)
  mkWall(44, 13, [0, 6.5, ROOM.maxZ], Math.PI);           // front (behind camera)
  mkWall(56, 13, [ROOM.minX, 6.5, -2], Math.PI / 2);      // left
  mkWall(56, 13, [ROOM.maxX, 6.5, -2], -Math.PI / 2);     // right
  mkWall(44, 56, [0, ROOM.maxY, -2], 0, Math.PI / 2);     // ceiling

  // stage riser
  const riser = new THREE.Mesh(
    new THREE.BoxGeometry(26, 1.6, 8),
    new THREE.MeshStandardMaterial({ color: 0x0c0c14, roughness: 0.8 })
  );
  riser.position.set(0, 0.8, -25);
  scene.add(riser);

  // DJ booth with emissive face
  const booth = new THREE.Mesh(
    new THREE.BoxGeometry(5.5, 1.5, 1.6),
    new THREE.MeshStandardMaterial({ color: 0x090910, roughness: 0.7 })
  );
  booth.position.set(0, 2.35, -24);
  scene.add(booth);

  const boothFaceMat = new THREE.MeshBasicMaterial({ color: 0x001133 });
  const boothFace = new THREE.Mesh(new THREE.PlaneGeometry(5.3, 1.3), boothFaceMat);
  boothFace.position.set(0, 2.35, -23.18);
  scene.add(boothFace);
  out.boothFaceMat = boothFaceMat;

  // DJ silhouette
  const dj = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x05050a, roughness: 1 });
  const djBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.9, 4, 8), bodyMat);
  djBody.position.y = 0.85;
  const djHead = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), bodyMat);
  djHead.position.y = 1.75;
  dj.add(djBody, djHead);
  dj.position.set(0, 1.6, -25.4);
  scene.add(dj);
  out.dj = dj;

  // LED wall behind the stage: grid of emissive tiles
  const ledCols = 18, ledRows = 7;
  const ledGeo = new THREE.PlaneGeometry(1.15, 1.15);
  const ledMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const leds = new THREE.InstancedMesh(ledGeo, ledMat, ledCols * ledRows);
  const _m = new THREE.Matrix4();
  let li = 0;
  for (let r = 0; r < ledRows; r++) {
    for (let c = 0; c < ledCols; c++) {
      _m.makeTranslation((c - (ledCols - 1) / 2) * 1.3, 3.2 + r * 1.3, -29.7);
      leds.setMatrixAt(li, _m);
      leds.setColorAt(li, new THREE.Color(0x000000));
      li++;
    }
  }
  scene.add(leds);
  out.leds = leds;
  out.ledCols = ledCols;
  out.ledRows = ledRows;

  // truss: front truss over stage + two side towers + mid truss
  const trussMat = new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.5, metalness: 0.8 });
  const chord = new THREE.CylinderGeometry(0.05, 0.05, 1, 6);
  const trussPieces = [];
  const addTrussSpan = (from, to) => {
    const f = new THREE.Vector3(...from), t = new THREE.Vector3(...to);
    const len = f.distanceTo(t);
    const offsets = [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]];
    const dir = t.clone().sub(f).normalize();
    const mid = f.clone().add(t).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    // pick two axes perpendicular to the span for chord offsets
    const side = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const a1 = new THREE.Vector3().crossVectors(dir, side).normalize();
    const a2 = new THREE.Vector3().crossVectors(dir, a1).normalize();
    for (const [u, v] of offsets) {
      const m = new THREE.Mesh(chord, trussMat);
      m.scale.y = len;
      m.quaternion.copy(q);
      m.position.copy(mid)
        .addScaledVector(a1, u)
        .addScaledVector(a2, v);
      trussPieces.push(m);
    }
    // cross braces
    const nBrace = Math.floor(len / 1.2);
    for (let i = 0; i < nBrace; i++) {
      const p = f.clone().addScaledVector(dir, (i + 0.5) * (len / nBrace));
      const b = new THREE.Mesh(chord, trussMat);
      b.scale.set(0.7, 0.62, 0.7);
      b.position.copy(p);
      b.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), a1);
      b.rotateOnWorldAxis(dir, i % 2 ? 0.8 : -0.8);
      trussPieces.push(b);
    }
  };
  addTrussSpan([-13, 9.6, -24], [13, 9.6, -24]);   // front truss over stage
  addTrussSpan([-16, 8.6, -6], [16, 8.6, -6]);     // mid truss over crowd
  addTrussSpan([-13, 0, -24], [-13, 9.6, -24]);    // stage-left tower
  addTrussSpan([13, 0, -24], [13, 9.6, -24]);      // stage-right tower
  const trussGroup = new THREE.Group();
  trussGroup.add(...trussPieces);
  scene.add(trussGroup);

  // crowd: instanced dark silhouettes bobbing to the beat
  const crowdCount = 260;
  const crowdGeo = new THREE.CapsuleGeometry(0.26, 1.15, 3, 8);
  crowdGeo.translate(0, 0.85, 0);
  const crowdMat = new THREE.MeshStandardMaterial({ color: 0x030308, roughness: 1 });
  const crowd = new THREE.InstancedMesh(crowdGeo, crowdMat, crowdCount);
  const crowdData = [];
  let ci = 0;
  while (ci < crowdCount) {
    const x = (Math.random() - 0.5) * 36;
    const z = -18 + Math.random() * 38;
    if (Math.abs(x) < 3 && z < -16) continue; // keep the stage-front clearish
    crowdData.push({
      x, z,
      s: 0.85 + Math.random() * 0.3,
      phase: Math.random() * Math.PI * 2,
      energy: 0.6 + Math.random() * 0.4,
    });
    ci++;
  }
  crowd.frustumCulled = false;
  scene.add(crowd);
  out.crowd = crowd;
  out.crowdData = crowdData;

  // heads for the crowd (same instancing, separate mesh)
  const headGeo = new THREE.SphereGeometry(0.17, 8, 6);
  const heads = new THREE.InstancedMesh(headGeo, crowdMat, crowdCount);
  heads.frustumCulled = false;
  scene.add(heads);
  out.heads = heads;

  // floating dust / haze particles
  const dustCount = 900;
  const dustPos = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * 42;
    dustPos[i * 3 + 1] = Math.random() * 12.5;
    dustPos[i * 3 + 2] = -29 + Math.random() * 54;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dustMat = new THREE.PointsMaterial({
    color: 0x8899bb,
    size: 0.045,
    transparent: true,
    opacity: 0.35,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  scene.add(dust);
  out.dust = dust;

  // base lighting: near-dark with a faint cool wash
  scene.add(new THREE.AmbientLight(0x3a4a77, 1.15));
  const key = new THREE.PointLight(0x3355aa, 25, 60, 1.8);
  key.position.set(0, 11, -18);
  scene.add(key);
  out.keyLight = key;

  return out;
}

const _cm = new THREE.Matrix4();
const _col = new THREE.Color();

/**
 * Animate crowd bob, DJ, LED wall and booth glow. energy: 0..1 show intensity,
 * accent: color of the current look.
 */
export function updateStage(stage, time, beat, energy, accent) {
  const beatPulse = Math.pow(1 - (beat % 1), 2.2);

  // crowd: jump on the beat when energy is high, gentle sway otherwise
  const { crowd, heads, crowdData } = stage;
  for (let i = 0; i < crowdData.length; i++) {
    const d = crowdData[i];
    const sway = Math.sin(time * 1.7 + d.phase) * 0.05;
    const jump = Math.max(0, Math.sin((beat + d.phase * 0.16) * Math.PI * 2)) * 0.22 * energy * d.energy;
    _cm.makeTranslation(d.x + sway, jump, d.z);
    _cm.scale(new THREE.Vector3(d.s, d.s, d.s));
    crowd.setMatrixAt(i, _cm);
    _cm.makeTranslation(d.x + sway, jump + 1.78 * d.s, d.z);
    _cm.scale(new THREE.Vector3(d.s, d.s, d.s));
    heads.setMatrixAt(i, _cm);
  }
  crowd.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;

  // DJ bounce
  stage.dj.position.y = 1.6 + Math.max(0, Math.sin(beat * Math.PI)) * 0.08 * energy;
  stage.dj.children[0].rotation.x = Math.sin(beat * Math.PI) * 0.06 * energy;

  // booth face pulses with the beat in the accent color
  _col.copy(accent).multiplyScalar(0.12 + beatPulse * 0.5 * energy);
  stage.boothFaceMat.color.copy(_col);

  // LED wall: scrolling bars + beat flash in accent color
  const { leds, ledCols, ledRows } = stage;
  let li = 0;
  for (let r = 0; r < ledRows; r++) {
    for (let c = 0; c < ledCols; c++) {
      const u = c / ledCols, v = r / ledRows;
      const bar = Math.pow(0.5 + 0.5 * Math.sin(u * 14 - beat * Math.PI), 8);
      const wave = Math.pow(0.5 + 0.5 * Math.sin(v * 6 + u * 3 + time * 1.3), 3) * 0.4;
      const lvl = 0.02 + (bar * 0.8 + wave) * (0.10 + energy * 0.5) + beatPulse * energy * 0.22;
      _col.copy(accent).multiplyScalar(Math.min(1.4, lvl));
      leds.setColorAt(li, _col);
      li++;
    }
  }
  leds.instanceColor.needsUpdate = true;

  // dust drift
  stage.dust.rotation.y = time * 0.004;
  stage.dust.position.y = Math.sin(time * 0.11) * 0.35;

  // key light breathes with energy
  stage.keyLight.intensity = 14 + energy * 22 * (0.6 + beatPulse * 0.6);
  stage.keyLight.color.copy(accent).lerp(new THREE.Color(0x3355aa), 0.6);
}
