/**
 * Records the laser show demo to an mp4 by driving the sketch's deterministic
 * record mode in headless Chrome, frame by frame, and piping PNG frames into
 * ffmpeg. Optionally muxes in an audio track.
 *
 * Usage:
 *   node tools/record-laser-demo.mjs [--out demo.mp4] [--fps 30] [--w 1280] [--h 720]
 *     [--audio track.wav] [--frames N] [--probe]      (--probe = single still)
 *
 * Requires a vite dev server on :3000 (the script starts one if needed).
 */
import puppeteer from 'puppeteer-core';
import { spawn, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import http from 'node:http';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const PROBE = args.includes('--probe');
const OUT = opt('out', '/tmp/laser-demo.mp4');
const FPS = parseInt(opt('fps', '30'), 10);
const W = parseInt(opt('w', '1280'), 10);
const H = parseInt(opt('h', '720'), 10);
const AUDIO = opt('audio', null);
const MAX_FRAMES = parseInt(opt('frames', '100000'), 10);
const URL_BASE = 'http://localhost:3000/sketches/laser-show/index.html';

const CHROME = ['/usr/local/bin/google-chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .find((p) => existsSync(p));

function serverUp() {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:3000/', () => resolve(true));
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

async function ensureServer() {
  if (await serverUp()) return null;
  console.log('starting vite dev server...');
  const proc = spawn('npx', ['vite', '--port', '3000'], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: 'ignore',
    detached: true,
  });
  proc.unref();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await serverUp()) return proc;
  }
  throw new Error('vite dev server did not start');
}

async function main() {
  await ensureServer();

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--enable-unsafe-swiftshader',
      '--use-angle=swiftshader',
      '--disable-gpu-vsync',
      `--window-size=${W},${H}`,
      '--hide-scrollbars',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  page.on('console', (m) => {
    if (m.type() === 'error') console.error('[page]', m.text());
  });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));

  const url = `${URL_BASE}?record=1&w=${W}&h=${H}`;
  console.log('opening', url);
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction('window.__laserRecord && window.__laserRecord.ready', { timeout: 30000 });

  if (PROBE) {
    const frame = parseInt(opt('frame', String(FPS * 18)), 10);
    await page.evaluate((i, fps) => window.__laserRecord.step(i, fps), frame, FPS);
    await page.screenshot({ path: '/tmp/laser-probe.png' });
    console.log('probe frame written to /tmp/laser-probe.png');
    await browser.close();
    return;
  }

  const ffArgs = [
    '-y',
    '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    ...(AUDIO ? ['-i', AUDIO] : []),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
    ...(AUDIO ? ['-c:a', 'aac', '-b:a', '192k', '-shortest'] : []),
    OUT,
  ];
  const ff = spawn('ffmpeg', ffArgs, { stdio: ['pipe', 'ignore', 'pipe'] });
  let ffErr = '';
  ff.stderr.on('data', (d) => { ffErr += d; if (ffErr.length > 40000) ffErr = ffErr.slice(-20000); });

  const write = (buf) => new Promise((resolve, reject) => {
    ff.stdin.write(buf, (err) => (err ? reject(err) : resolve()));
  });

  const t0 = Date.now();
  let i = 0;
  for (; i < MAX_FRAMES; i++) {
    const more = await page.evaluate((idx, fps) => window.__laserRecord.step(idx, fps), i, FPS);
    const shot = await page.screenshot({ type: 'png', optimizeForSpeed: true });
    await write(Buffer.from(shot));
    if (i % 60 === 0) {
      const rate = (i + 1) / ((Date.now() - t0) / 1000);
      console.log(`frame ${i}  (${rate.toFixed(1)} fps capture)`);
    }
    if (!more) { i++; break; }
  }

  ff.stdin.end();
  await new Promise((resolve, reject) => {
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}\n${ffErr}`))));
  });
  await browser.close();

  const dur = (i / FPS).toFixed(1);
  console.log(`done: ${i} frames -> ${OUT} (${dur}s) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  try {
    console.log(execSync(`ls -la ${OUT}`).toString().trim());
  } catch {}
}

main().catch((e) => { console.error(e); process.exit(1); });
