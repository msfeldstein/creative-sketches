/**
 * Volumetric laser beam renderer.
 *
 * All beams in the scene are drawn with a single InstancedMesh whose geometry
 * is a unit tube along +Z. Per-instance attributes carry color, intensity,
 * length, noise seed and start/end radii so one draw call renders every beam
 * (and the wide "wash" cones reuse the same pool with bigger radii).
 *
 * The fragment shader fakes volumetric scattering:
 *  - view-dependent falloff (bright when looking through the tube center)
 *  - exponential attenuation along the beam (haze extinction)
 *  - animated fbm noise along the beam (fog wisps drifting through the beam)
 *  - a hot boost near the aperture
 *
 * A second instanced pool renders billboarded "hit spots" where beams strike
 * the room's walls/floor.
 */
import * as THREE from 'three';

const BEAM_VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute vec4 aData;   // intensity, seed, length, unused
  attribute vec2 aRad;    // start radius, end radius

  varying vec3 vColor;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vAlong;
  varying float vIntensity;
  varying float vSeed;
  varying float vLen;

  void main() {
    vColor = aColor;
    vIntensity = aData.x;
    vSeed = aData.y;
    vLen = aData.z;
    vAlong = position.z;

    // expand unit tube to a cone with per-instance start/end radii
    float r = mix(aRad.x, aRad.y, position.z);
    vec3 p = vec3(position.xy * r, position.z);

    vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
    vWorldPos = wp.xyz;
    vNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const BEAM_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uAtten;      // haze extinction per meter
  uniform float uNoiseAmt;   // how much fog wisps modulate the beam
  uniform float uGlobal;     // master brightness

  varying vec3 vColor;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vAlong;
  varying float vIntensity;
  varying float vSeed;
  varying float vLen;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p) {
    return vnoise(p) * 0.65 + vnoise(p * 2.7 + 13.7) * 0.35;
  }

  void main() {
    if (vIntensity <= 0.001) discard;

    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    // Soft tube: faces pointing at the camera are the "middle" of the beam.
    float facing = abs(dot(viewDir, normalize(vNormal)));
    float body = pow(facing, 3.0) * 0.55;
    float core = pow(facing, 9.0) * 0.75;

    float dist = vAlong * vLen;
    float att = exp(-uAtten * dist);
    // real beams bloom hard right at the aperture
    float aperture = 1.0 + 1.1 * exp(-dist * 0.55);

    // drifting fog wisps
    float n = fbm(vec2(dist * 0.33 - uTime * 2.1, vSeed * 17.3 + uTime * 0.4));
    float wisps = mix(1.0, 0.30 + 1.55 * n, uNoiseAmt);

    // soften the very start and very end of the tube
    float endFade = smoothstep(0.0, 0.015, vAlong) * (1.0 - smoothstep(0.985, 1.0, vAlong) * 0.5);

    float e = (body + core) * att * aperture * wisps * endFade * vIntensity * uGlobal;
    vec3 col = vColor * e;
    // slight white-hot center so saturated colors still read as "laser"
    col += vec3(1.0) * core * att * vIntensity * uGlobal * 0.05;

    gl_FragColor = vec4(col, 1.0);
  }
`;

const SPOT_VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute vec2 aData; // intensity, size

  varying vec3 vColor;
  varying float vIntensity;
  varying vec2 vUvc;

  void main() {
    vColor = aColor;
    vIntensity = aData.x;
    vUvc = position.xy;

    // billboard: instance translation + camera-plane offset
    vec3 origin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 wp = origin + (camRight * position.x + camUp * position.y) * aData.y;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }
`;

const SPOT_FRAG = /* glsl */ `
  uniform float uGlobal;
  varying vec3 vColor;
  varying float vIntensity;
  varying vec2 vUvc;

  void main() {
    float d = length(vUvc) * 2.0;
    if (d > 1.0) discard;
    float falloff = pow(1.0 - d, 2.5);
    float core = pow(max(0.0, 1.0 - d * 2.2), 2.0) * 2.0;
    vec3 col = vColor * (falloff + core) * vIntensity * uGlobal;
    col += vec3(1.0) * core * vIntensity * uGlobal * 0.25;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _zAxis = new THREE.Vector3(0, 0, 1);
const _scale = new THREE.Vector3();

export class BeamPool {
  constructor(scene, { maxBeams = 512, room } = {}) {
    this.max = maxBeams;
    this.room = room; // { minX, maxX, minY, maxY, minZ, maxZ }
    this.count = 0;
    this.spotCount = 0;

    // --- beam mesh ---
    const geo = new THREE.CylinderGeometry(1, 1, 1, 20, 24, true);
    geo.rotateX(Math.PI / 2);
    geo.translate(0, 0, 0.5); // unit tube from z=0..1

    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(maxBeams * 3), 3);
    this.aData = new THREE.InstancedBufferAttribute(new Float32Array(maxBeams * 4), 4);
    this.aRad = new THREE.InstancedBufferAttribute(new Float32Array(maxBeams * 2), 2);
    geo.setAttribute('aColor', this.aColor);
    geo.setAttribute('aData', this.aData);
    geo.setAttribute('aRad', this.aRad);

    this.uniforms = {
      uTime: { value: 0 },
      uAtten: { value: 0.045 },
      uNoiseAmt: { value: 0.75 },
      uGlobal: { value: 0.55 },
    };

    const mat = new THREE.ShaderMaterial({
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      uniforms: this.uniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.InstancedMesh(geo, mat, maxBeams);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    scene.add(this.mesh);

    // --- hit spot mesh ---
    const spotGeo = new THREE.PlaneGeometry(1, 1);
    this.sColor = new THREE.InstancedBufferAttribute(new Float32Array(maxBeams * 3), 3);
    this.sData = new THREE.InstancedBufferAttribute(new Float32Array(maxBeams * 2), 2);
    spotGeo.setAttribute('aColor', this.sColor);
    spotGeo.setAttribute('aData', this.sData);

    const spotMat = new THREE.ShaderMaterial({
      vertexShader: SPOT_VERT,
      fragmentShader: SPOT_FRAG,
      uniforms: { uGlobal: this.uniforms.uGlobal },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    });

    this.spots = new THREE.InstancedMesh(spotGeo, spotMat, maxBeams);
    this.spots.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.spots.frustumCulled = false;
    this.spots.renderOrder = 11;
    scene.add(this.spots);

    this._camPos = new THREE.Vector3();
  }

  begin(time, camPos) {
    this.count = 0;
    this.spotCount = 0;
    this.uniforms.uTime.value = time;
    if (camPos) this._camPos.copy(camPos);
  }

  /** Distance from origin along dir to the room AABB interior boundary. */
  clipToRoom(origin, dir, maxLen = 90) {
    const r = this.room;
    if (!r) return maxLen;
    let t = maxLen;
    if (dir.x > 1e-6) t = Math.min(t, (r.maxX - origin.x) / dir.x);
    else if (dir.x < -1e-6) t = Math.min(t, (r.minX - origin.x) / dir.x);
    if (dir.y > 1e-6) t = Math.min(t, (r.maxY - origin.y) / dir.y);
    else if (dir.y < -1e-6) t = Math.min(t, (r.minY - origin.y) / dir.y);
    if (dir.z > 1e-6) t = Math.min(t, (r.maxZ - origin.z) / dir.z);
    else if (dir.z < -1e-6) t = Math.min(t, (r.minZ - origin.z) / dir.z);
    return Math.max(0.1, t);
  }

  /**
   * Add one beam. origin: Vector3, dir: normalized Vector3.
   * opts: { color: THREE.Color, intensity, r0, r1, seed, maxLen, spot }
   */
  add(origin, dir, opts) {
    if (this.count >= this.max) return;
    const i = this.count++;
    const len = this.clipToRoom(origin, dir, opts.maxLen ?? 90);

    _q.setFromUnitVectors(_zAxis, dir);
    _scale.set(1, 1, len);
    _m.compose(origin, _q, _scale);
    this.mesh.setMatrixAt(i, _m);

    const c = opts.color;
    this.aColor.setXYZ(i, c.r, c.g, c.b);
    this.aData.setXYZW(i, opts.intensity, opts.seed ?? i * 0.618, len, 0);
    this.aRad.setXY(i, opts.r0 ?? 0.022, opts.r1 ?? 0.16);

    // hit spot where the beam strikes the room, nudged toward the camera
    if ((opts.spot ?? true) && this.spotCount < this.max && opts.intensity > 0.02) {
      const j = this.spotCount++;
      const hx = origin.x + dir.x * len;
      const hy = origin.y + dir.y * len;
      const hz = origin.z + dir.z * len;
      const dx = this._camPos.x - hx, dy = this._camPos.y - hy, dz = this._camPos.z - hz;
      const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const nudge = 0.35;
      _m.makeTranslation(hx + (dx / dl) * nudge, hy + (dy / dl) * nudge, hz + (dz / dl) * nudge);
      this.spots.setMatrixAt(j, _m);
      this.sColor.setXYZ(j, c.r, c.g, c.b);
      const att = Math.exp(-this.uniforms.uAtten.value * len * 0.8);
      this.sData.setXY(j, opts.intensity * att * 0.85, 0.4 + len * 0.009);
    }
  }

  end() {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aColor.needsUpdate = true;
    this.aData.needsUpdate = true;
    this.aRad.needsUpdate = true;
    this.spots.count = this.spotCount;
    this.spots.instanceMatrix.needsUpdate = true;
    this.sColor.needsUpdate = true;
    this.sData.needsUpdate = true;
  }
}
