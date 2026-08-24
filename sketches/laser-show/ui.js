/**
 * Harness control panel: transport (play/pause, BPM, mode, camera), fixture
 * list, and a per-fixture editor exposing position, mount rotation, color and
 * every pattern console channel. Setups export/import as JSON.
 */
import { PATTERN_NAMES, PATTERN_DEFAULTS } from './patterns.js';
import { LaserFixture } from './show.js';

const PARAM_DEFS = [
  ['count', 'Beams', 1, 24, 1],
  ['size', 'Size', 0, 1, 0.01],
  ['speed', 'Speed', -4, 4, 0.05],
  ['rot', 'Rotation °', -180, 180, 1],
  ['rotSpeed', 'Rot Speed', -2, 2, 0.05],
  ['ox', 'Offset X', -1, 1, 0.01],
  ['oy', 'Offset Y', -1, 1, 0.01],
  ['wave', 'Wave Amt', 0, 1, 0.01],
  ['waveFreq', 'Wave Freq', 0.5, 8, 0.1],
  ['spreadY', 'Spread Y', -1, 1, 0.01],
  ['phase', 'Phase', 0, 1, 0.01],
  ['strobe', 'Strobe /beat', 0, 16, 1],
  ['duty', 'Strobe Duty', 0.05, 0.95, 0.01],
  ['dim', 'Dimmer', 0, 1, 0.01],
];

export class HarnessUI {
  constructor(app) {
    this.app = app;
    this.selected = 0;
    this.root = document.getElementById('panel');
    this.build();
  }

  el(tag, cls, parent, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  slider(parent, label, min, max, step, get, set, fmt = (v) => (+v).toFixed(2)) {
    const row = this.el('div', 'row', parent);
    this.el('label', null, row, label);
    const input = this.el('input', null, row);
    input.type = 'range';
    input.min = min; input.max = max; input.step = step;
    input.value = get();
    const val = this.el('span', 'val', row, fmt(get()));
    input.addEventListener('input', () => {
      set(parseFloat(input.value));
      val.textContent = fmt(parseFloat(input.value));
    });
    row._sync = () => { input.value = get(); val.textContent = fmt(get()); };
    return row;
  }

  select(parent, label, options, get, set) {
    const row = this.el('div', 'row', parent);
    this.el('label', null, row, label);
    const sel = this.el('select', null, row);
    for (const o of options) {
      const opt = this.el('option', null, sel, o);
      opt.value = o;
    }
    sel.value = get();
    sel.addEventListener('change', () => set(sel.value));
    row._sync = () => { sel.value = get(); };
    return row;
  }

  build() {
    const app = this.app;
    const root = this.root;
    root.innerHTML = '';

    // ---- transport ----
    const transport = this.el('div', 'section', root);
    this.el('h3', null, transport, 'Transport');
    const tRow = this.el('div', 'row btns', transport);
    const playBtn = this.el('button', 'primary', tRow, 'Pause');
    playBtn.addEventListener('click', () => {
      app.playing = !app.playing;
      playBtn.textContent = app.playing ? 'Pause' : 'Play';
    });
    const restartBtn = this.el('button', null, tRow, 'Restart');
    restartBtn.addEventListener('click', () => { app.showTime = 0; });
    this.beatDisplay = this.el('div', 'beat-display', transport, 'beat 0.0');
    this.slider(transport, 'BPM', 60, 200, 1, () => app.show.bpm, (v) => { app.show.bpm = v; }, (v) => v.toFixed(0));
    this.select(transport, 'Mode', ['show', 'live'], () => app.mode, (v) => { app.mode = v; });
    this.select(transport, 'Camera', ['show-cam', 'orbit'], () => app.cameraMode, (v) => app.setCameraMode(v));

    // ---- atmosphere ----
    const atmo = this.el('div', 'section', root);
    this.el('h3', null, atmo, 'Atmosphere');
    this.slider(atmo, 'Haze', 0, 0.12, 0.001, () => app.pool.uniforms.uAtten.value, (v) => { app.pool.uniforms.uAtten.value = v; });
    this.slider(atmo, 'Fog Wisps', 0, 1, 0.01, () => app.pool.uniforms.uNoiseAmt.value, (v) => { app.pool.uniforms.uNoiseAmt.value = v; });
    this.slider(atmo, 'Master', 0, 2, 0.01, () => app.pool.uniforms.uGlobal.value, (v) => { app.pool.uniforms.uGlobal.value = v; });
    this.slider(atmo, 'Bloom', 0, 3, 0.01, () => app.bloomPass.strength, (v) => { app.bloomPass.strength = v; });

    // ---- fixtures ----
    const fxSection = this.el('div', 'section', root);
    this.el('h3', null, fxSection, 'Fixtures');
    this.fixtureList = this.el('div', 'fixture-list', fxSection);
    const fxBtns = this.el('div', 'row btns', fxSection);
    const addBtn = this.el('button', null, fxBtns, '+ Add');
    addBtn.addEventListener('click', () => {
      app.fixtures.push(new LaserFixture({
        name: `laser-${app.fixtures.length + 1}`,
        position: [0, 8, -23], color: '#00ff66',
      }));
      this.selected = app.fixtures.length - 1;
      this.buildFixtureList();
      this.buildEditor();
    });
    const delBtn = this.el('button', null, fxBtns, '− Remove');
    delBtn.addEventListener('click', () => {
      if (app.fixtures.length <= 1) return;
      app.fixtures.splice(this.selected, 1);
      this.selected = Math.min(this.selected, app.fixtures.length - 1);
      this.buildFixtureList();
      this.buildEditor();
    });

    this.editor = this.el('div', 'section', root);

    // ---- export / import ----
    const io = this.el('div', 'section', root);
    this.el('h3', null, io, 'Setup');
    const ioBtns = this.el('div', 'row btns', io);
    const exportBtn = this.el('button', null, ioBtns, 'Export JSON');
    exportBtn.addEventListener('click', () => {
      const data = JSON.stringify({ bpm: app.show.bpm, fixtures: app.fixtures.map((f) => f.toJSON()) }, null, 2);
      const blob = new Blob([data], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'laser-setup.json';
      a.click();
    });
    const importBtn = this.el('button', null, ioBtns, 'Import JSON');
    importBtn.addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.json';
      inp.addEventListener('change', async () => {
        const text = await inp.files[0].text();
        const data = JSON.parse(text);
        app.show.bpm = data.bpm ?? app.show.bpm;
        app.fixtures.length = 0;
        for (const f of data.fixtures) {
          const fx = new LaserFixture(f);
          fx.pattern = f.pattern ?? 'fan';
          fx.params = f.params ?? {};
          app.fixtures.push(fx);
        }
        this.selected = 0;
        this.buildFixtureList();
        this.buildEditor();
      });
      inp.click();
    });

    this.el('div', 'hint', root,
      'live mode: the editor drives fixtures directly · show mode: the cue list drives them (position/color edits still apply)');

    this.buildFixtureList();
    this.buildEditor();
  }

  buildFixtureList() {
    this.fixtureList.innerHTML = '';
    this.app.fixtures.forEach((f, i) => {
      const b = this.el('button', i === this.selected ? 'fx selected' : 'fx', this.fixtureList, f.name);
      b.style.setProperty('--fx-color', `#${f.color.getHexString()}`);
      b.addEventListener('click', () => {
        this.selected = i;
        this.buildFixtureList();
        this.buildEditor();
      });
    });
  }

  buildEditor() {
    const f = this.app.fixtures[this.selected];
    const ed = this.editor;
    ed.innerHTML = '';
    if (!f) return;
    this.el('h3', null, ed, `Edit: ${f.name}`);

    const enRow = this.el('div', 'row', ed);
    this.el('label', null, enRow, 'Enabled');
    const en = this.el('input', null, enRow);
    en.type = 'checkbox';
    en.checked = f.enabled;
    en.addEventListener('change', () => { f.enabled = en.checked; });

    const colRow = this.el('div', 'row', ed);
    this.el('label', null, colRow, 'Color');
    const col = this.el('input', null, colRow);
    col.type = 'color';
    col.value = `#${f.color.getHexString()}`;
    col.addEventListener('input', () => {
      f.color.set(col.value);
      this.buildFixtureList();
    });

    this.slider(ed, 'Intensity', 0, 1.5, 0.01, () => f.intensity, (v) => { f.intensity = v; });
    this.slider(ed, 'Pos X', -20, 20, 0.1, () => f.position.x, (v) => { f.position.x = v; });
    this.slider(ed, 'Pos Y', 0.2, 12.5, 0.1, () => f.position.y, (v) => { f.position.y = v; });
    this.slider(ed, 'Pos Z', -29, 24, 0.1, () => f.position.z, (v) => { f.position.z = v; });
    this.slider(ed, 'Yaw °', -180, 180, 1, () => f.yaw, (v) => { f.yaw = v; f.updateOrientation(); }, (v) => v.toFixed(0));
    this.slider(ed, 'Pitch °', -90, 90, 1, () => f.pitch, (v) => { f.pitch = v; f.updateOrientation(); }, (v) => v.toFixed(0));
    this.slider(ed, 'Scan Field °', 5, 60, 1, () => f.maxScan, (v) => { f.maxScan = v; }, (v) => v.toFixed(0));

    this.el('h3', null, ed, 'Pattern (live mode)');
    this.select(ed, 'Pattern', PATTERN_NAMES, () => f.pattern, (v) => { f.pattern = v; });
    this.select(ed, 'Color Mode', ['fixture', 'rainbow', 'alternate'],
      () => f.params.colorMode ?? 'fixture', (v) => { f.params.colorMode = v; });
    for (const [key, label, min, max, step] of PARAM_DEFS) {
      this.slider(ed, label, min, max, step,
        () => f.params[key] ?? PATTERN_DEFAULTS[key],
        (v) => { f.params[key] = v; });
    }
  }

  tick(beat) {
    if (this.beatDisplay) {
      const bar = Math.floor(beat / 4) + 1;
      this.beatDisplay.textContent = `bar ${bar} · beat ${(beat % 4 + 1).toFixed(1)}`;
    }
  }
}
