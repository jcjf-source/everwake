/**
 * Shared helpers for the headless-browser checks in tools/browser/.
 *
 * `startSession()` launches its own dev server and headless Chrome (in a
 * throwaway profile), connects over the Chrome DevTools Protocol, and
 * returns helpers. `session.close()` stops only those two processes.
 *
 * Requirements: Node 22+ (global WebSocket) and Chrome or Chromium. Set
 * CHROME_PATH if Chrome is not in a standard location.
 *
 * Notes learned the hard way:
 *  - Do NOT pass --disable-gpu: it forces software raster, which inflates
 *    frame times 10-50x and makes performance numbers meaningless.
 *  - Chrome's touch adjustment snaps taps near buttons onto the button, so
 *    picking checks skip points within ~24px of HUD controls.
 *  - With deviceScaleFactor 2, CDP delivers halved wheel deltas; predict
 *    from what the page received, not from what was sent.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(fileURLToPath(new URL('../..', import.meta.url)));

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, what, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch { /* not ready yet */ }
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** @param {{ serverPort?: number }} [opts] */
export async function startSession({ serverPort = 8137 } = {}) {
  const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!chromePath) throw new Error('Chrome not found; set CHROME_PATH');

  const server = spawn(process.execPath, [join(REPO, 'tools/serve.mjs'), String(serverPort)], { stdio: 'ignore' });
  const appUrl = `http://127.0.0.1:${serverPort}/`;
  await waitFor(async () => (await fetch(appUrl)).ok, 'dev server');

  const profile = mkdtempSync(join(tmpdir(), 'everwake-chrome-'));
  const chrome = spawn(chromePath, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--window-size=1440,900', 'about:blank',
  ], { stdio: 'ignore' });
  const port = await waitFor(() => readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim(), 'Chrome DevTools port');
  const targets = await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/json`)).json(), 'Chrome targets');

  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + m.params.exceptionDetails.exception?.description);
    if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.type + ' ' + JSON.stringify(m.params.args.map((a) => a.value)));
    if (m.method === 'Log.entryAdded') logs.push('LOG ' + m.params.entry.level + ' ' + m.params.entry.text);
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.result.value;
  const frame = () => ev(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))`);
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable'); await send('Performance.enable');

  const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', ...extra });
  const touch = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) });

  async function tap(x, y, isTouch) {
    if (isTouch) { await touch('touchStart', [{ x, y }]); await touch('touchEnd', []); }
    else { await mouse('mouseMoved', x, y, { button: 'none' }); await mouse('mousePressed', x, y, { clickCount: 1 }); await mouse('mouseReleased', x, y, { clickCount: 1 }); }
    await frame();
  }

  /** Drag in a wobbly loop for `frames` frames; returns script/task ms per frame. */
  async function measureDrag(w, h, isTouch, frames = 40) {
    const metric = async () => Object.fromEntries((await send('Performance.getMetrics')).result.metrics.map((m) => [m.name, m.value]));
    const m0 = await metric();
    const p0 = { x: w / 2, y: h / 2 };
    if (isTouch) await touch('touchStart', [p0]); else await mouse('mousePressed', p0.x, p0.y, { clickCount: 1 });
    for (let i = 1; i <= frames; i++) {
      const p = { x: p0.x + Math.sin(i / 6) * w * 0.2, y: p0.y + Math.cos(i / 6) * h * 0.1 };
      if (isTouch) await touch('touchMove', [p]); else await mouse('mouseMoved', p.x, p.y, { buttons: 1 });
      await frame();
    }
    if (isTouch) await touch('touchEnd', []); else await mouse('mouseReleased', p0.x, p0.y, { clickCount: 1 });
    const m1 = await metric();
    await frame();
    return {
      script: ((m1.ScriptDuration - m0.ScriptDuration) * 1000) / frames,
      task: ((m1.TaskDuration - m0.TaskDuration) * 1000) / frames,
    };
  }

  async function setViewport({ w, h, dpr, mobile }) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile });
    await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
  }

  async function screenshot(path) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(path, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  }

  async function close() {
    try { ws.close(); } catch { /* ignore */ }
    chrome.kill();
    server.kill();
    await wait(500);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold files */ }
  }

  return { appUrl, send, ev, frame, mouse, touch, tap, measureDrag, setViewport, screenshot, logs, close, wait };
}

/** Standard viewports used by the checks. */
export const VIEWPORTS = [
  { name: 'desktop-1280x800-dpr1', w: 1280, h: 800, dpr: 1, mobile: false },
  { name: 'desktop-1440x900-dpr2', w: 1440, h: 900, dpr: 2, mobile: false },
  { name: 'phone-390x844-dpr3', w: 390, h: 844, dpr: 3, mobile: true },
  { name: 'phone-844x390-dpr3', w: 844, h: 390, dpr: 3, mobile: true },
];
