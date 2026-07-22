import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { BeamPool } from './beams.js';
import { buildStage, updateStage, ROOM } from './stage.js';
import { createRig, createDemoShow, energyAt, accentAt, cameraAt, DEMO_BPM, DEMO_BEATS } from './demo-show.js';
import { HarnessUI } from './ui.js';

const params = new URLSearchParams(location.search);
const RECORD = params.get('record') === '1';
const REC_W = parseInt(params.get('w') || '1280', 10);
const REC_H = parseInt(params.get('h') || '720', 10);

class App {
  constructor() {
    this.canvas = document.getElementById('c');
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: !RECORD,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: RECORD,
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 200);
    this.camera.position.set(0, 3, 20);

    this.stage = buildStage(this.scene);
    this.pool = new BeamPool(this.scene, { maxBeams: 640, room: ROOM });

    this.fixtures = createRig();
    this.show = createDemoShow();

    // fixture housings so you can see the hardware on the rig
    this.housings = [];
    const housingGeo = new THREE.BoxGeometry(0.42, 0.34, 0.5);
    for (const f of this.fixtures) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x14141c, roughness: 0.4, metalness: 0.8 });
      const m = new THREE.Mesh(housingGeo, mat);
      const lens = new THREE.Mesh(
        new THREE.CircleGeometry(0.09, 16),
        new THREE.MeshBasicMaterial({ color: f.color })
      );
      lens.position.z = 0.26;
      m.add(lens);
      this.scene.add(m);
      this.housings.push({ mesh: m, lens });
    }

    // post: bloom is what makes the beams glow
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.4, 0.3);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    this.playing = true;
    this.mode = 'show';          // 'show' | 'live'
    this.cameraMode = 'show-cam';
    this.showTime = 0;
    this.wallTime = 0;
    this.lastNow = performance.now();

    this.orbit = new OrbitControls(this.camera, this.canvas);
    this.orbit.target.set(0, 5, -20);
    this.orbit.enableDamping = true;
    this.orbit.enabled = false;

    this.resize();
    window.addEventListener('resize', () => this.resize());

    if (!RECORD) {
      this.ui = new HarnessUI(this);
      const loop = (now) => {
        requestAnimationFrame(loop);
        const dt = Math.min(0.05, (now - this.lastNow) / 1000);
        this.lastNow = now;
        this.wallTime += dt;
        if (this.playing) this.showTime += dt;
        this.frame();
      };
      requestAnimationFrame(loop);
    }
  }

  setCameraMode(mode) {
    this.cameraMode = mode;
    this.orbit.enabled = mode === 'orbit';
    if (mode === 'orbit') {
      this.camera.position.set(0, 4, 18);
      this.orbit.target.set(0, 5, -20);
    }
  }

  resize() {
    const w = RECORD ? REC_W : window.innerWidth;
    const h = RECORD ? REC_H : window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.setPixelRatio(RECORD ? 1 : Math.min(window.devicePixelRatio, 2));
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  frame() {
    const time = this.showTime;
    const beatRaw = this.show.beatsAt(time);
    const beat = beatRaw % DEMO_BEATS; // loop the show
    const energy = energyAt(beat);
    const accent = accentAt(beat);

    // camera
    if (this.cameraMode === 'show-cam') {
      const cam = cameraAt(beat, time);
      this.camera.position.copy(cam.pos);
      this.camera.lookAt(cam.look);
    } else {
      this.orbit.update();
    }

    // stage animation
    updateStage(this.stage, time, beat, energy, accent);

    // lasers
    this.pool.begin(time, this.camera.position);
    this.fixtures.forEach((f, i) => {
      const override = this.mode === 'show' ? this.show.overrideFor(f, i, beat) : null;
      if (this.mode === 'show' && !override && !f.isWash) return; // blackout between cues
      f.emit(this.pool, beat, override);
    });
    this.pool.end();

    // sync fixture housings
    this.fixtures.forEach((f, i) => {
      const h = this.housings[i];
      if (!h) return;
      h.mesh.position.copy(f.position);
      h.mesh.quaternion.copy(f.quaternion);
      h.mesh.visible = !f.isWash;
      h.lens.material.color.copy(f.color);
    });

    this.composer.render();
    this.ui?.tick(beat);
  }
}

const app = new App();
window.__app = app;

if (RECORD) {
  // Deterministic offline rendering: the recorder calls step(i) per frame.
  window.__laserRecord = {
    ready: true,
    totalBeats: DEMO_BEATS,
    bpm: DEMO_BPM,
    step(frameIndex, fps) {
      app.showTime = frameIndex / fps;
      app.frame();
      return app.show.beatsAt(app.showTime) < DEMO_BEATS;
    },
  };
}
