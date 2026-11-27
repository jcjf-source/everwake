/**
 * End-to-end browser check of the current build (Tasks 01–03 behaviour):
 * hex picking at several zoom levels and viewports, terrain readout, the
 * sanctuary, the seed dialog, URL seed retention, Centre, Coords, console
 * cleanliness, and drag frame times.
 *
 * Usage: node tools/browser/check-world.mjs [screenshotDir]
 * Starts its own dev server (port 8137) and headless Chrome; see cdp.mjs.
 * Exits non-zero on any failure. Screenshots are written only if a
 * directory is given.
 *
 * The expected readout for each tapped hex is computed in Node from the
 * same pure modules the page uses (camera, gridView, world, hud), mirroring
 * each camera operation the check performs.
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startSession, REPO, VIEWPORTS } from './cdp.mjs';

const shotDir = process.argv[2] ?? null;
const imp = (p) => import(pathToFileURL(join(REPO, p)).href);
const C = await imp('src/render/camera.js');
const { hexToScreen, screenToHex } = await imp('src/render/gridView.js');
const { hexCorners, hexKey } = await imp('src/world/hex.js');
const { createWorld } = await imp('src/world/world.js');
const { TERRAIN } = await imp('src/data/terrain.js');
const { describeSelection } = await imp('src/ui/hud.js');
const R = 40; // must match WORLD_RADIUS in src/main.js

const s = await startSession();
const { ev, frame, mouse, touch, tap, logs } = s;
let failures = 0;
const fail = (msg) => { failures++; console.log('  FAIL ' + msg); };
const check = (cond, msg) => { if (cond) console.log('  ok   ' + msg); else fail(msg); };
const readout = () => ev(`document.getElementById('selection-readout').textContent`);
const text = (id) => ev(`document.getElementById('${id}').textContent`);
const dialogOpen = () => ev(`document.getElementById('world-dialog').open`);
const shot = async (name) => { if (shotDir) await s.screenshot(join(shotDir, `${name}.png`)); };

async function clickEl(sel) {
  const r = await ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  await mouse('mouseMoved', r.x, r.y, { button: 'none' });
  await mouse('mousePressed', r.x, r.y, { clickCount: 1 });
  await mouse('mouseReleased', r.x, r.y, { clickCount: 1 });
  await frame();
}

async function load(url) {
  await s.send('Page.navigate', { url });
  for (let i = 0; i < 50; i++) {
    await s.wait(100);
    if (await ev(`!!document.getElementById('seed-text') && document.getElementById('seed-text').textContent.length > 0`)) break;
  }
  await frame();
}

const expectText = (world, h) => {
  const t = world.tileAt(h);
  return describeSelection(h, t ? TERRAIN[t.terrain] : null, world.sanctuary);
};
const initialCamera = (world, w, h) =>
  C.centerOnHex(C.createCamera({ zoom: C.initialZoom(w, h), bounds: C.gridWorldBounds(R) }), world.sanctuary);

/** Tap centres and near-corners of sample hexes; each must select exactly that hex. */
async function verifyPicking(label, world, cam, w, h, isTouch) {
  const view = C.cameraToView(cam, w, h);
  const samples = [];
  for (const fx of [0.12, 0.3, 0.48, 0.66]) for (const fy of [0.25, 0.5, 0.72]) {
    const hh = screenToHex(view, w * fx, h * fy);
    if (world.has(hh)) samples.push(hh);
  }
  // Chrome's touch adjustment snaps taps near controls onto them: avoid.
  const hud = await ev(`[...document.querySelectorAll('button, #selection-readout')].map(b => { const r = b.getBoundingClientRect(); return [r.left - 24, r.top - 24, r.right + 24, r.bottom + 24]; })`);
  const nearHud = (p) => hud.some(([l, t, r, b]) => p.x >= l && p.x <= r && p.y >= t && p.y <= b) || p.x < 2 || p.y < 2 || p.x > w - 2 || p.y > h - 2;
  let ok = 0;
  let total = 0;
  const terrains = new Set();
  for (const target of samples) {
    const c = hexToScreen(view, target);
    const pts = [c, ...hexCorners(c.x, c.y, view.size).filter((_, i) => i % 2).map((p) => ({ x: c.x + (p.x - c.x) * 0.8, y: c.y + (p.y - c.y) * 0.8 }))];
    for (const p of pts) {
      if (nearHud(p)) continue;
      if ((await readout()) !== describeSelection(null)) {
        await tap(c.x, c.y, isTouch);
        if ((await readout()) !== describeSelection(null)) await tap(c.x, c.y, isTouch);
      }
      await tap(p.x, p.y, isTouch);
      total++;
      const got = await readout();
      const want = expectText(world, target);
      if (got === want) { ok++; terrains.add(world.tileAt(target).terrain); } else fail(`${label}: ${hexKey(target)} -> "${got}" want "${want}"`);
      await tap(p.x, p.y, isTouch); // deselect
    }
  }
  console.log(`  ${label}: picking ${ok}/${total} (hex ${view.size.toFixed(1)}px; terrains: ${[...terrains].join(', ')})`);
}

async function perf(label, w, h, isTouch) {
  const m = await s.measureDrag(w, h, isTouch);
  console.log(`  perf ${label}: script ${m.script.toFixed(2)} ms/frame, task ${m.task.toFixed(2)} ms/frame`);
}

try {
  for (const cfg of VIEWPORTS) {
    const { w, h, mobile } = cfg;
    console.log(`\n== ${cfg.name}`);
    await s.setViewport(cfg);
    logs.length = 0;
    await load(`${s.appUrl}?seed=everwake`);
    let world = createWorld('everwake', R);
    let cam = initialCamera(world, w, h);

    check((await text('seed-text')) === 'everwake', 'seed button shows the seed from the URL');
    const layout = await ev(`(() => { const r = (q) => document.querySelector(q).getBoundingClientRect(); const t = r('.hud-title'), sb = r('#seed-button'), c = r('#coords-toggle'); return { overlap: t.right > sb.left, right: c.right, sw: document.scrollingElement.scrollWidth }; })()`);
    check(!layout.overlap && layout.right <= w && layout.sw <= w, `top bar fits ${JSON.stringify(layout)}`);

    await tap(w / 2, h / 2, mobile);
    check((await readout()).startsWith('Sanctuary (grassland)'), `opens centred on the sanctuary: "${await readout()}"`);
    await tap(w / 2, h / 2, mobile);
    await shot(`${cfg.name}-initial`);
    await verifyPicking('initial', world, cam, w, h, mobile);

    for (let i = 0; i < 10 && !(await ev(`document.getElementById('zoom-in').disabled`)); i++) {
      await clickEl('#zoom-in');
      cam = C.zoomAt(cam, 1.25, w / 2, h / 2, w, h);
    }
    await shot(`${cfg.name}-max`);
    await verifyPicking('max zoom', world, cam, w, h, mobile);
    for (let i = 0; i < 20 && !(await ev(`document.getElementById('zoom-out').disabled`)); i++) {
      await clickEl('#zoom-out');
      cam = C.zoomAt(cam, 1 / 1.25, w / 2, h / 2, w, h);
    }
    await shot(`${cfg.name}-min`);
    await verifyPicking('min zoom', world, cam, w, h, mobile);
    await perf('min zoom (drag)', w, h, mobile);

    // Dialog and seed flows on one desktop and one phone viewport.
    if (cfg.name.startsWith('desktop-1280') || cfg.name.startsWith('phone-390')) {
      await load(`${s.appUrl}?seed=everwake`);
      cam = initialCamera(world, w, h);
      for (let i = 0; i < 3; i++) { await clickEl('#zoom-in'); cam = C.zoomAt(cam, 1.25, w / 2, h / 2, w, h); }
      await perf('zoomed in, full detail (drag)', w, h, mobile);
      await load(`${s.appUrl}?seed=everwake`);
      cam = initialCamera(world, w, h);

      await clickEl('#seed-button');
      check(await dialogOpen(), 'Seed opens the dialog');
      check((await text('world-current-seed')) === 'everwake', 'dialog shows the current seed');
      await shot(`${cfg.name}-dialog`);
      const v0 = await ev(`document.getElementById('seed-input').value`);
      await clickEl('#seed-random');
      const v1 = await ev(`document.getElementById('seed-input').value`);
      check(/^[a-z]+-[a-z]+-\d{3}$/.test(v1) && v1 !== v0, `Random fills a new seed (${v0} -> ${v1})`);
      await clickEl('#seed-cancel');
      check(!(await dialogOpen()) && (await text('seed-text')) === 'everwake', 'Cancel closes, world unchanged');

      await clickEl('#seed-button');
      await ev(`(() => { const i = document.getElementById('seed-input'); i.value = '<bad>'; i.dispatchEvent(new Event('input')); })()`);
      await clickEl('#seed-create');
      const err = await text('seed-error');
      check(err.length > 0 && (await dialogOpen()) && (await text('seed-text')) === 'everwake', `invalid seed rejected: "${err}"`);
      await ev(`(() => { const i = document.getElementById('seed-input'); i.value = '   '; i.dispatchEvent(new Event('input')); })()`);
      await clickEl('#seed-create');
      check((await text('seed-error')) === 'Enter a seed.', 'empty seed rejected');

      await ev(`(() => { const i = document.getElementById('seed-input'); i.value = ''; i.focus(); })()`);
      await s.send('Input.insertText', { text: '  mossy   fen 12 ' });
      await s.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
      await s.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await frame();
      const search = await ev('location.search');
      check((await text('seed-text')) === 'mossy fen 12' && !(await dialogOpen()), 'Enter creates the world; seed normalised');
      check(new URLSearchParams(search).get('seed') === 'mossy fen 12', `URL keeps the seed: ${search}`);
      world = createWorld('mossy fen 12', R);
      cam = C.centerOnHex(cam, world.sanctuary);
      check((await readout()) === describeSelection(null), 'selection cleared on new world');
      await tap(w / 2, h / 2, mobile);
      check((await readout()).startsWith('Sanctuary'), 'new world centred on its sanctuary');
      await tap(w / 2, h / 2, mobile);
      await shot(`${cfg.name}-newworld`);
      await verifyPicking('new world', world, cam, w, h, mobile);

      await load(`${s.appUrl}${search}`);
      check((await text('seed-text')) === 'mossy fen 12', 'reload keeps the seed');

      const p0 = { x: w / 2, y: h / 2 };
      const p1 = { x: p0.x + 150, y: p0.y + 90 };
      if (mobile) { await touch('touchStart', [p0]); await touch('touchMove', [{ x: p0.x + 60, y: p0.y + 40 }]); await touch('touchMove', [p1]); await touch('touchEnd', []); }
      else { await mouse('mousePressed', p0.x, p0.y, { clickCount: 1 }); await mouse('mouseMoved', p1.x, p1.y, { buttons: 1 }); await mouse('mouseReleased', p1.x, p1.y, { clickCount: 1 }); }
      await frame();
      await tap(w / 2, h / 2, mobile);
      check(!(await readout()).startsWith('Sanctuary'), 'drag moved the view off the sanctuary');
      await tap(w / 2, h / 2, mobile);
      await clickEl('#recenter');
      await tap(w / 2, h / 2, mobile);
      check((await readout()).startsWith('Sanctuary'), 'Centre returns to the sanctuary');
      await tap(w / 2, h / 2, mobile);

      await load(`${s.appUrl}?seed=%3Cbad%3E`);
      const fb = await text('seed-text');
      check(/^[a-z]+-[a-z]+-\d{3}$/.test(fb) && new URLSearchParams(await ev('location.search')).get('seed') === fb, `invalid URL seed replaced with "${fb}"`);
      await clickEl('#coords-toggle');
      check((await ev(`document.getElementById('coords-toggle').getAttribute('aria-pressed')`)) === 'true', 'Coords toggles on');
      await shot(`${cfg.name}-coords`);
      await clickEl('#coords-toggle');
    }

    const errs = logs.filter((l) => /EXC|error|warn/i.test(l));
    check(errs.length === 0, `console clean ${errs.join(' | ')}`);
    check(await ev(`document.getElementById('error-panel').hidden`), 'error panel hidden');
  }
} catch (err) {
  fail(`check crashed: ${err.stack ?? err}`);
} finally {
  await s.close();
}

console.log(failures ? `\n${failures} FAILURES` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
