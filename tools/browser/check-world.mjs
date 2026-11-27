/**
 * End-to-end browser check of the current build (Tasks 01–06 behaviour):
 * hex picking at several zoom levels and viewports, terrain readout, the
 * sanctuary, tap-to-move (step, route preview, stepwise travel, interrupt,
 * resume, retarget, unreachable feedback), fog of war (reveal boundary,
 * reveal on movement, dim memory, unexplored taps) and the Map dialog, the
 * turn clock (one turn per step and per Wait, none for anything else), the
 * seed dialog, URL seed retention, Centre, Coords, console cleanliness, and
 * drag frame times.
 *
 * Usage: node tools/browser/check-world.mjs [screenshotDir]
 * Set VIEWPORT=<name fragment> (e.g. phone-390) to run a single viewport.
 * Starts its own dev server (port 8137) and headless Chrome; see cdp.mjs.
 * Exits non-zero on any failure. Screenshots are written only if a
 * directory is given.
 *
 * The expected readout for each tapped hex is computed in Node from the
 * same pure modules the page uses (camera, gridView, world, hud), mirroring
 * each camera operation the check performs. Map memory is mirrored too: the
 * check reveals sight around every hex the player is seen to stand on.
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startSession, REPO, VIEWPORTS } from './cdp.mjs';

const shotDir = process.argv[2] ?? null;
const imp = (p) => import(pathToFileURL(join(REPO, p)).href);
const C = await imp('src/render/camera.js');
const { hexToScreen, screenToHex, fitView } = await imp('src/render/gridView.js');
const { createMapMemory, SIGHT_RADIUS } = await imp('src/world/mapMemory.js');
const { coordText } = await imp('src/ui/hud.js');
const { hexCorners, hexKey, hexDistance, hexEquals, hexNeighbors, hexesInRange } = await imp('src/world/hex.js');
const { createWorld } = await imp('src/world/world.js');
const { TERRAIN } = await imp('src/data/terrain.js');
const { describeSelection } = await imp('src/ui/hud.js');
const { decideTap } = await imp('src/ui/moveIntent.js');
const { planRoute } = await imp('src/systems/movement.js');
const T = await imp('src/ui/travelText.js');
const K = await imp('src/ui/clockText.js');
const G = await imp('src/ui/gatherText.js');
const { nodeState, gatherOptions, planApproach } = await imp('src/systems/gathering.js');
const { createWorldChanges } = await imp('src/world/worldChanges.js');
const { createInventory, addItem } = await imp('src/systems/inventory.js');
const { NODE_KINDS } = await imp('src/data/resources.js');
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
  const seed = new URL(url).searchParams.get('seed');
  if (seed) resetMemory(createWorld(seed, R));
  await s.send('Page.navigate', { url });
  for (let i = 0; i < 50; i++) {
    await s.wait(100);
    if (await ev(`!!document.getElementById('seed-text') && document.getElementById('seed-text').textContent.length > 0`)) break;
  }
  await frame();
}

/** Node mirror of the page's map memory; reset on every page load. */
let mem = null;
/** Node mirror of the page's world changes and inventory (gathering); reset with map memory. */
let chg = null;
let inv = null;
const resetMemory = (world) => { mem = createMapMemory(R); mem.observe(world.sanctuary, SIGHT_RADIUS); chg = createWorldChanges(); inv = createInventory(); };
/** The player stood on each of these hexes, in order. */
const walked = (hexes) => { for (const h of hexes) mem.observe(h, SIGHT_RADIUS); };
const knows = (h) => mem.isKnown(h);

const terrainOf = (world, h) => { const t = world.tileAt(h); return t ? TERRAIN[t.terrain] : null; };
const labelOf = (world, h) => T.placeLabel(h, terrainOf(world, h), world.sanctuary);
/** A mapped hex's node as the page knows it (gathering.js nodeState), or null. */
const nodeOf = (world, h) => (h && knows(h) ? nodeState({ world, changes: chg }, h) : null);
const liveNodeOf = (world) => (h) => { const n = nodeOf(world, h); return n && n.left > 0 ? n : null; };
const noteOf = (world, h) => G.nodeNote(nodeOf(world, h));
const hereText = (world, pos) => `${describeSelection(pos, terrainOf(world, pos), world.sanctuary)} · you are here${noteOf(world, pos)}`;

/** The readout the page should show after an idle tap on `h` (mirrors main.js applyTapAction). */
function expectTap(world, pos, h, preview = null) {
  const { action } = decideTap(world, { position: pos, preview, travelling: null, knows, nodeAt: liveNodeOf(world) }, h);
  switch (action.kind) {
    case 'unexplored': return T.describeUnexplored(h);
    case 'clear': return T.MOVE_HINT;
    case 'here': return hereText(world, pos);
    case 'step': return T.describeStepped(labelOf(world, h)) + noteOf(world, h);
    case 'preview': return T.describePreview(labelOf(world, h), action.preview.path.length, action.preview.cost) + noteOf(world, h);
    case 'impassable': return T.describeImpassable(labelOf(world, h)) + noteOf(world, h);
    case 'unreachable': return T.describeUnreachable(labelOf(world, h)) + noteOf(world, h);
    case 'node': return G.describeInReach(labelOf(world, h), nodeOf(world, h));
    case 'approach': return G.describeApproach(labelOf(world, h), nodeOf(world, h), action.preview.path.length, action.preview.cost);
    case 'blocked': return G.describeNodeBlocked(labelOf(world, h), nodeOf(world, h));
    default: return `(${action.kind})`;
  }
}

const num = (x) => Number(x.replace('−', '-'));
/** Player position (status line) and turn (clock). */
async function playerState() {
  const m = (await text('player-status')).match(/^You · q (−?\d+), r (−?\d+)$/);
  const c = (await text('clock-status')).match(/ · turn (\d+)$/);
  return m && c ? { pos: { q: num(m[1]), r: num(m[2]) }, turn: Number(c[1]) } : null;
}

async function hudBoxes() {
  return ev(`[...document.querySelectorAll('button, #selection-readout, #player-status, #clock-status, #inventory-status, .hud-bottom')].map(b => { const r = b.getBoundingClientRect(); /* Gather buttons can appear above the readout later: reserve room for a row. */ const g = b.classList.contains('hud-bottom') ? { x: 160, y: 56 } : { x: 0, y: 0 }; return [r.left - 24 - g.x, r.top - 24 - g.y, r.right + 24 + g.x, r.bottom + 24]; })`);
}

const initialCamera = (world, w, h) =>
  C.centerOnHex(C.createCamera({ zoom: C.initialZoom(w, h), bounds: C.gridWorldBounds(R) }), world.sanctuary);

/**
 * Tap centres and near-corners of sample hexes; each must pick exactly that
 * hex (the readout names it). Hexes next to the player are skipped (a tap
 * would step there). Tapping the player's own hex in between clears the
 * route preview, so the next tap previews instead of travelling.
 */
async function verifyPicking(label, world, cam, w, h, isTouch) {
  const view = C.cameraToView(cam, w, h);
  const { pos } = await playerState();
  const me = hexToScreen(view, pos);
  const samples = [];
  for (const fx of [0.12, 0.3, 0.48, 0.66]) for (const fy of [0.25, 0.5, 0.72]) {
    const hh = screenToHex(view, w * fx, h * fy);
    if (world.has(hh) && hexDistance(hh, pos) > 1) samples.push(hh);
  }
  // Chrome's touch adjustment snaps taps near controls onto them: avoid.
  const hud = await hudBoxes();
  const nearHud = (p) => hud.some(([l, t, r, b]) => p.x >= l && p.x <= r && p.y >= t && p.y <= b) || p.x < 2 || p.y < 2 || p.x > w - 2 || p.y > h - 2;
  let ok = 0;
  let total = 0;
  const kinds = new Set();
  for (const target of samples) {
    const c = hexToScreen(view, target);
    const pts = [c, ...hexCorners(c.x, c.y, view.size).filter((_, i) => i % 2).map((p) => ({ x: c.x + (p.x - c.x) * 0.8, y: c.y + (p.y - c.y) * 0.8 }))];
    for (const p of pts) {
      if (nearHud(p)) continue;
      await tap(p.x, p.y, isTouch);
      total++;
      const got = await readout();
      const want = expectTap(world, pos, target);
      if (got === want) { ok++; kinds.add(decideTap(world, { position: pos, preview: null, travelling: null, knows }, target).action.kind); } else fail(`${label}: ${hexKey(target)} -> "${got}" want "${want}"`);
      await tap(me.x, me.y, isTouch); // tap yourself: clears the preview
    }
  }
  const st = await playerState();
  check(st.turn === 0 || hexEquals(st.pos, pos), `${label}: picking taps never moved the player`);
  console.log(`  ${label}: picking ${ok}/${total} (hex ${view.size.toFixed(1)}px; outcomes: ${[...kinds].join(', ')})`);
}

/** Poll while the readout says "Travelling"; returns every distinct position seen. */
async function watchTravel(start, timeoutMs = 20000) {
  const seen = [start];
  let waitDisabledSeen = false;
  const end = Date.now() + timeoutMs;
  for (;;) {
    const r = await readout(); // read first: a step can land between the two reads
    const st = await playerState();
    if (!hexEquals(seen[seen.length - 1], st.pos)) seen.push(st.pos);
    if (r.startsWith('Travelling') && (await ev("document.getElementById('wait-button').disabled"))) waitDisabledSeen = true;
    if (!r.startsWith('Travelling') || Date.now() > end) return { seen, readout: r, turn: st.turn, waitDisabledSeen };
    await frame();
  }
}

const samePath = (a, b) => a.length === b.length && a.every((h, i) => hexEquals(h, b[i]));
const contiguous = (path) => path.every((h, i) => i === 0 || hexDistance(path[i - 1], h) === 1);

/** Keys of every hex reachable on foot from `from`. */
function reachableKeys(world, from) {
  const seen = new Set([hexKey(from)]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    for (const n of hexNeighbors(queue[i])) {
      const k = hexKey(n);
      if (!seen.has(k) && world.isWalkable(n)) { seen.add(k); queue.push(n); }
    }
  }
  return seen;
}

/** Tap-to-move flows: step, preview, travel, interrupt/resume, retarget, unreachable feedback. */
async function verifyMovement(world, w, h, isTouch) {
  await load(`${s.appUrl}?seed=everwake`);
  let cam = initialCamera(world, w, h);
  const tag = `${isTouch ? 'touch' : 'mouse'}-${w}x${h}`;
  const hud = await hudBoxes();
  const nearHud = (p) => hud.some(([l, t, r, b]) => p.x >= l && p.x <= r && p.y >= t && p.y <= b);
  const view = () => C.cameraToView(cam, w, h);
  const screenOf = (hh) => hexToScreen(view(), hh);
  const inner = (hh, f = 0.25) => { const p = screenOf(hh); return p.x > w * f && p.x < w * (1 - f) && p.y > h * f && p.y < h * (1 - f) && !nearHud(p); };
  const tapHex = async (hh) => { const p = screenOf(hh); await tap(p.x, p.y, isTouch); };
  const recentre = async () => { await clickEl('#recenter'); cam = C.centerOnHex(cam, (await playerState()).pos); };
  /** A deterministic reachable destination on screen, a few steps away. */
  const pickTarget = (from, avoid = []) => {
    for (const hh of hexesInRange(from, 8)) {
      if (hexDistance(hh, from) < 3 || !inner(hh) || avoid.some((a) => hexDistance(a, hh) < 3)) continue;
      const r = planRoute(world, from, hh, { knows });
      if (r.status === 'ok' && r.path.length >= 4) return { hex: hh, ...r };
    }
    return null;
  };

  let st = await playerState();
  check(st && hexEquals(st.pos, world.sanctuary) && st.turn === 0, `player starts on the sanctuary at turn 0: ${await text('player-status')}`);
  check((await text('clock-status')) === K.describeClock(0), `clock starts at day 1, morning: "${await text('clock-status')}"`);
  check((await readout()) === T.MOVE_HINT, 'movement hint shown');

  // One-tap step to a neighbour, and back.
  const nb = hexNeighbors(st.pos).find((n) => world.isWalkable(n) && inner(n, 0.1));
  await tapHex(nb);
  walked([nb]);
  st = await playerState();
  check(hexEquals(st.pos, nb) && st.turn === 1 && (await readout()) === T.describeStepped(labelOf(world, nb)) + noteOf(world, nb), `adjacent tap steps one hex: "${await readout()}"`);
  await tapHex(world.sanctuary);
  walked([world.sanctuary]);
  st = await playerState();
  check(hexEquals(st.pos, world.sanctuary) && st.turn === 2, 'stepping back works: one turn per step');
  check((await text('clock-status')) === K.describeClock(2), 'clock shows the turn');

  // Wait: one turn passes where you stand; idle time never advances.
  await clickEl('#wait-button');
  st = await playerState();
  check(hexEquals(st.pos, world.sanctuary) && st.turn === 3 && (await readout()) === K.WAITED, `Wait costs one turn and stays put: "${await readout()}"`);
  await s.wait(500);
  check((await playerState()).turn === 3, 'idle: no turn passes while waiting for input');
  await tapHex(world.sanctuary); // inspecting your own hex is not an action
  check((await playerState()).turn === 3, 'inspecting costs no turn');
  const base = 3;

  // Preview then travel a route, one hex at a time.
  let target = pickTarget(st.pos);
  if (!target) { fail('no route target on screen'); return; }
  await tapHex(target.hex);
  check((await readout()) === T.describePreview(labelOf(world, target.hex), target.path.length, target.cost), `first tap previews: "${await readout()}"`);
  check((await playerState()).turn === base, 'preview costs no turn');
  await shot(`${tag}-route-preview`);
  await tapHex(target.hex);
  let run = await watchTravel(st.pos);
  walked(target.path);
  check(samePath(run.seen, [st.pos, ...target.path]), `travel walks the planned path hex by hex (${run.seen.length - 1} of ${target.path.length} positions observed)`);
  check(contiguous(run.seen), 'every observed move is to a neighbour (no teleport)');
  check(run.readout === T.describeArrived(labelOf(world, target.hex), target.path.length) + noteOf(world, target.hex) && run.turn === base + target.path.length, `arrives: "${run.readout}", turn ${run.turn} (one per hex)`);
  check(run.waitDisabledSeen, 'Wait is disabled while travelling');
  check(!(await ev(`document.getElementById('wait-button').disabled`)), 'Wait is enabled again on arrival');

  // Interrupt, confirm it stays stopped, then resume.
  await recentre();
  st = await playerState();
  target = pickTarget(st.pos);
  await tapHex(target.hex);
  await tapHex(target.hex);
  for (let i = 0; i < 100 && (await playerState()).turn < st.turn + 2; i++) await frame();
  await tapHex(target.hex); // tapping the destination while travelling stops
  const stopped = await playerState();
  await s.wait(600);
  const later = await playerState();
  const stopText = await readout();
  walked(target.path.slice(0, target.path.findIndex((hh) => hexEquals(hh, later.pos)) + 1));
  check(stopText.startsWith('Stopped after') && hexEquals(stopped.pos, later.pos) && stopped.turn === later.turn && !hexEquals(later.pos, target.hex),
    `tap stops travel and nothing moves while idle: "${stopText}"`);
  await shot(`${tag}-stopped`);
  await recentre();
  await tapHex(target.hex); // the rest of the route is still previewed: one tap resumes
  run = await watchTravel(later.pos);
  walked(run.seen);
  check(hexEquals(run.seen[run.seen.length - 1], target.hex) && contiguous(run.seen) && run.readout.startsWith('Arrived'), `resume reaches the destination: "${run.readout}"`);

  // Retarget mid-route.
  await recentre();
  st = await playerState();
  const a = pickTarget(st.pos);
  const b = a && pickTarget(st.pos, [a.hex]);
  if (!b) { fail('no second target for retargeting'); return; }
  await tapHex(a.hex);
  await tapHex(a.hex);
  for (let i = 0; i < 100 && (await playerState()).turn < st.turn + 1; i++) await frame();
  await tapHex(b.hex);
  const mid = await playerState();
  walked(a.path.slice(0, a.path.findIndex((hh) => hexEquals(hh, mid.pos)) + 1));
  await s.wait(400);
  check(hexEquals((await playerState()).pos, mid.pos), 'tapping another hex stops travel');
  check((await readout()) === expectTap(world, mid.pos, b.hex), `and plans the new route: "${await readout()}"`);
  await tapHex(b.hex);
  run = await watchTravel(mid.pos);
  walked(planRoute(world, mid.pos, b.hex, { knows }).path);
  check(hexEquals(run.seen[run.seen.length - 1], b.hex) && contiguous(run.seen), `retargeted route reaches the new destination: "${run.readout}" seen ${run.seen.map(hexKey).join(' ')} want ${hexKey(b.hex)}`);

  if (!isTouch) {
    await recentre();
    st = await playerState();
    const t2 = pickTarget(st.pos);
    await tapHex(t2.hex);
    await tapHex(t2.hex);
    const esc = async () => {
      await s.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await s.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await frame();
    };
    await esc();
    const e0 = await playerState();
    walked(t2.path.slice(0, t2.path.findIndex((hh) => hexEquals(hh, e0.pos)) + 1));
    await s.wait(400);
    check((await readout()).startsWith('Stopped after') && (await playerState()).turn === e0.turn, 'Escape stops travel');
    await esc();
    check((await readout()) === T.MOVE_HINT, 'Escape again clears the route');
  }

  // Impassable and unreachable targets: clear feedback, no move. The
  // everwake start has no cut-off land nearby, so island-133 (found by
  // searching seeds) covers "unreachable": it has an islet ~7 hexes away.
  const feedback = async (wld, kinds) => {
    const reach = reachableKeys(wld, (await playerState()).pos);
    const isKind = {
      impassable: (hh) => !wld.isWalkable(hh) && !wld.resourceAt(hh), // a node there makes it a gather target
      unreachable: (hh) => wld.isWalkable(hh) && !reach.has(hexKey(hh)),
    };
    // Fog: only a mapped hex can be explained. Walk toward the nearest hex
    // of the wanted kind (known to the check, not the player) until it is mapped.
    const explore = async (what) => {
      for (let leg = 0; leg < 8; leg++) {
        st = await playerState();
        const found = hexesInRange(st.pos, 40).filter((hh) => wld.has(hh) && knows(hh) && hexDistance(hh, st.pos) > 1 && isKind[what](hh));
        if (found.length) return found.sort((x, y) => hexDistance(x, st.pos) - hexDistance(y, st.pos))[0];
        const goal = hexesInRange(st.pos, 40).filter((hh) => wld.has(hh) && isKind[what](hh)).sort((x, y) => hexDistance(x, st.pos) - hexDistance(y, st.pos))[0];
        if (!goal) return null;
        await recentre();
        const tappable = (hh) => { const p = screenOf(hh); return !nearHud(p) && p.x > 4 && p.y > 4 && p.x < w - 4 && p.y < h - 4; };
        const step = mem.knownHexes().filter((hh) => reach.has(hexKey(hh)) && tappable(hh))
          .sort((x, y) => hexDistance(x, goal) - hexDistance(y, goal))
          .map((hh) => ({ hh, r: planRoute(wld, st.pos, hh, { knows }) }))
          .find((x) => x.r.status === 'ok' && x.r.path.length >= 2);
        if (!step) { fail(`exploring toward ${what}: no tappable mapped hex to walk to`); return null; }
        await tapHex(step.hh);
        await tapHex(step.hh);
        const trip = await watchTravel(st.pos);
        walked(step.r.path);
        if (!hexEquals(trip.seen[trip.seen.length - 1], step.hh)) { fail(`exploring toward ${what}: stopped at ${hexKey(trip.seen[trip.seen.length - 1])}`); return null; }
      }
      return null;
    };
    for (const what of kinds) {
      const hh = await explore(what);
      await recentre();
      let outs = 0;
      for (let i = 0; i < 20 && !(await ev(`document.getElementById('zoom-out').disabled`)); i++) {
        outs++;
        await clickEl('#zoom-out');
        cam = C.zoomAt(cam, 1 / 1.25, w / 2, h / 2, w, h);
      }
      st = await playerState();
      if (!hh) { fail(`no mapped ${what} hex found by exploring`); continue; }
      if (!inner(hh, 0.08)) {
        // Near a HUD control: drag the map so the target sits mid-screen (a pan, never a tap).
        const c = screenOf(hh);
        const p0 = { x: w / 2, y: h * 0.4 };
        const p1 = { x: p0.x + (w / 2 - c.x), y: p0.y + (h / 2 - c.y) };
        const pm = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
        if (isTouch) { await touch('touchStart', [p0]); await touch('touchMove', [pm]); await touch('touchMove', [p1]); await touch('touchEnd', []); }
        else { await mouse('mousePressed', p0.x, p0.y, { clickCount: 1 }); await mouse('mouseMoved', pm.x, pm.y, { buttons: 1 }); await mouse('mouseMoved', p1.x, p1.y, { buttons: 1 }); await mouse('mouseReleased', p1.x, p1.y, { clickCount: 1 }); }
        await frame();
        cam = C.panBy(cam, p1.x - p0.x, p1.y - p0.y);
      }
      await tapHex(hh);
      const got = await readout();
      check(got === expectTap(wld, st.pos, hh) && (await playerState()).turn === st.turn, `${what} target explained, no move: "${got}"`);
      await shot(`${tag}-${what}`);
      // Zoom back in so later exploring legs tap at a comfortable size.
      for (let i = 0; i < outs; i++) {
        await clickEl('#zoom-in');
        cam = C.zoomAt(cam, 1.25, w / 2, h / 2, w, h);
      }
    }
  };
  await recentre();
  await feedback(world, ['impassable']);
  const isle = createWorld('island-133', R);
  await load(`${s.appUrl}?seed=island-133`);
  cam = initialCamera(isle, w, h);
  await feedback(isle, ['unreachable']);
}

/**
 * Gathering: walk to a node, gather it with the contextual button until it
 * is spent (one turn each, inventory and readout checked), see that it stays
 * spent after leaving and coming back, and walk next to an impassable node
 * by tapping it (approach route), if one is mapped near the start.
 */
async function verifyGathering(world, w, h, isTouch) {
  await load(`${s.appUrl}?seed=everwake`);
  let cam = initialCamera(world, w, h);
  const hud = await hudBoxes();
  const view = () => C.cameraToView(cam, w, h);
  const screenOf = (hh) => hexToScreen(view(), hh);
  const tappable = (hh) => { const p = screenOf(hh); return p.x > w * 0.12 && p.x < w * 0.88 && p.y > h * 0.12 && p.y < h * 0.88 && !hud.some(([l, t, r, b]) => p.x >= l && p.x <= r && p.y >= t && p.y <= b); };
  const tapHex = async (hh) => { const p = screenOf(hh); await tap(p.x, p.y, isTouch); };
  const recentre = async () => { await clickEl('#recenter'); cam = C.centerOnHex(cam, (await playerState()).pos); };
  const mirror = (pos) => ({ world, changes: chg, memory: mem, player: { position: pos } });
  const buttons = () => ev(`[...document.querySelectorAll('#gather-actions button')].map(b => ({ text: b.textContent, label: b.getAttribute('aria-label'), index: b.dataset.index }))`);
  const wantButtons = (pos) => gatherOptions(mirror(pos)).map((o) => { const b = G.gatherButton(o); return { text: `${b.text} ${b.where}`, label: b.label }; });

  check((await text('inventory-status')) === G.describeInventory(inv), `inventory starts empty: "${await text('inventory-status')}"`);

  // Nearest mapped walkable node with a route, on screen.
  let st = await playerState();
  const node = world.resourceNodes
    .filter((n) => knows(n) && world.isWalkable(n) && tappable(n) && hexDistance(n, st.pos) >= 2)
    .sort((a, b) => hexDistance(a, st.pos) - hexDistance(b, st.pos))
    .map((n) => ({ n, r: planRoute(world, st.pos, n, { knows }) }))
    .find((x) => x.r.status === 'ok');
  if (!node) { fail('no walkable resource node near the start'); return; }
  const at = { q: node.n.q, r: node.n.r };
  await tapHex(at);
  check((await readout()) === expectTap(world, st.pos, at), `tapping a node previews a route and names it: "${await readout()}"`);
  await tapHex(at);
  const run = await watchTravel(st.pos);
  walked(node.r.path);
  st = await playerState();
  check(hexEquals(st.pos, at) && run.readout === T.describeArrived(labelOf(world, at), node.r.path.length) + noteOf(world, at), `arrive on the node: "${run.readout}"`);
  const got = await buttons();
  check(JSON.stringify(got.map(({ text, label }) => ({ text, label }))) === JSON.stringify(wantButtons(st.pos)), `Gather buttons for nodes in reach: ${got.map((b) => b.text).join(', ')}`);
  await shot(`gather-${w}x${h}`);

  // Gather until spent: one turn each.
  const def = NODE_KINDS[node.n.kind];
  let turn = st.turn;
  for (let left = nodeOf(world, at).left; left > 0; left--) {
    const btn = (await buttons()).find((b) => b.label === G.gatherButton({ ...nodeOf(world, at), direction: null }).label);
    if (!btn) { fail('no Gather button for the node underfoot'); return; }
    await clickEl(`#gather-actions button[data-index="${btn.index}"]`);
    chg.recordGather(at, 1);
    addItem(inv, node.n.resource, def.yield);
    const want = K.describeEvents([{ type: 'gathered', at, kind: node.n.kind, resource: node.n.resource, amount: def.yield, left: left - 1, total: 0 }]);
    const now = await playerState();
    check(now.turn === turn + 1 && hexEquals(now.pos, at) && (await readout()).startsWith(want), `gather costs one turn: "${await readout()}" (turn ${now.turn})`);
    check((await text('inventory-status')) === G.describeInventory(inv), `inventory updated: "${await text('inventory-status')}"`);
    turn = now.turn;
  }
  check(JSON.stringify((await buttons()).map(({ text, label }) => ({ text, label }))) === JSON.stringify(wantButtons(at)) && !gatherOptions(mirror(at)).some((o) => hexEquals(o.at, at)), 'a spent node offers no Gather button');
  await tapHex(at);
  check((await readout()) === hereText(world, at) && (await readout()).endsWith('picked clean') && (await playerState()).turn === turn, `inspecting the spent node: "${await readout()}", no turn`);
  await s.wait(400);
  check((await playerState()).turn === turn, 'idle: nothing regrows or advances');

  // Leave and come back: still spent.
  const away = hexNeighbors(at).find((n) => world.isWalkable(n) && tappable(n));
  await tapHex(away);
  walked([away]);
  await tapHex(at);
  walked([at]);
  check((await readout()) === T.describeStepped(labelOf(world, at)) + noteOf(world, at) && nodeOf(world, at).left === 0, `back on the node, it is still spent: "${await readout()}"`);
  check(JSON.stringify((await buttons()).map(({ text, label }) => ({ text, label }))) === JSON.stringify(wantButtons(at)), 'Gather buttons match what is in reach after the revisit');

  // An impassable node (mountain stone, deep-water fish): tap to walk next to
  // it. Such nodes are rare in sight of a start; shore-42 (found by searching
  // seeds) has mountain stone a few hexes from its sanctuary.
  const aw = createWorld('shore-42', R);
  await load(`${s.appUrl}?seed=shore-42`);
  cam = initialCamera(aw, w, h);
  st = await playerState();
  const far = aw.resourceNodes
    .filter((n) => knows(n) && !aw.isWalkable(n) && tappable(n) && hexDistance(n, st.pos) >= 2)
    .sort((x, y) => hexDistance(x, st.pos) - hexDistance(y, st.pos))
    .map((n) => ({ n, a: planApproach(aw, st.pos, n, { knows }) }))
    .find((x) => x.a && x.a.path.length > 0);
  if (!far) { fail('shore-42: no mapped impassable node to approach'); return; }
  const fat = { q: far.n.q, r: far.n.r };
  await tapHex(fat);
  check((await readout()) === expectTap(aw, st.pos, fat) && (await readout()).startsWith('Route next to'), `tapping a far impassable node previews a route next to it: "${await readout()}"`);
  await tapHex(fat);
  const run2 = await watchTravel(st.pos);
  walked(far.a.path);
  const end = await playerState();
  check(hexEquals(end.pos, far.a.destination) && run2.readout === T.describeArrived(labelOf(aw, far.a.destination), far.a.path.length) + noteOf(aw, fat), `walks next to it: "${run2.readout}"`);
  const opt = gatherOptions({ world: aw, changes: chg, memory: mem, player: { position: end.pos } }).find((o) => hexEquals(o.at, fat));
  check(!!opt && (await buttons()).some((x) => x.label === G.gatherButton(opt).label), `and can gather it from there (${opt ? G.gatherButton(opt).label : 'not in reach'})`);
  await tapHex(fat);
  check((await readout()) === G.describeInReach(labelOf(aw, fat), nodeOf(aw, fat)) && (await playerState()).turn === end.turn, `tapping it now says it is in reach, no turn: "${await readout()}"`);
  await shot(`gather-approach-${w}x${h}`);
}

/** Mean colour `{ r, g, b, v }` (v = brightness) of a small box of world-canvas pixels around a CSS point. */
async function sample(p) {
  return ev(`(() => {
    const c = document.getElementById('world-canvas');
    const k = c.width / c.getBoundingClientRect().width;
    // Read from a copy: repeated getImageData on the page's own context makes
    // Chrome log a willReadFrequently warning, which the console check counts.
    const copy = document.createElement('canvas');
    copy.width = c.width; copy.height = c.height;
    const cc = copy.getContext('2d', { willReadFrequently: true });
    cc.drawImage(c, 0, 0);
    const d = cc.getImageData(Math.round((${p.x} - 2) * k), Math.round((${p.y} - 2) * k), Math.max(1, Math.round(4 * k)), Math.max(1, Math.round(4 * k))).data;
    const m = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) { m[0] += d[i]; m[1] += d[i + 1]; m[2] += d[i + 2]; }
    const n = d.length / 4;
    return { r: m[0] / n, g: m[1] / n, b: m[2] / n, v: (m[0] + m[1] + m[2]) / n / 3 };
  })()`);
}
const colourDistance = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);

/**
 * Fog of war: only hexes within sight are mapped at start (boundary checked
 * by tapping rings SIGHT_RADIUS and SIGHT_RADIUS + 1), a step reveals the
 * next ring, terrain left behind stays mapped but drawn dim, and the Map
 * dialog shows and picks explored hexes.
 */
async function verifyFog(world, w, h, isTouch) {
  await load(`${s.appUrl}?seed=everwake`);
  let cam = initialCamera(world, w, h);
  const view = () => C.cameraToView(cam, w, h);
  const hud = await hudBoxes();
  const tappable = (hh) => { const p = hexToScreen(view(), hh); return p.x > 8 && p.y > 8 && p.x < w - 8 && p.y < h - 8 && !hud.some(([l, t, r, b]) => p.x >= l && p.x <= r && p.y >= t && p.y <= b); };
  const start = world.sanctuary;
  const me = hexToScreen(view(), start);
  const ring = (d) => hexesInRange(start, d).filter((hh) => hexDistance(hh, start) === d && tappable(hh));

  // Reveal boundary, read back through taps.
  let edgeOk = 0; let beyondOk = 0;
  const edge = ring(SIGHT_RADIUS).slice(0, 6);
  const beyond = ring(SIGHT_RADIUS + 1).slice(0, 6);
  for (const hh of edge) {
    const p = hexToScreen(view(), hh);
    await tap(p.x, p.y, isTouch);
    const got = await readout();
    if (!got.startsWith('Unexplored') && got === expectTap(world, start, hh)) edgeOk++; else fail(`edge ${hexKey(hh)}: "${got}"`);
    await tap(me.x, me.y, isTouch);
  }
  for (const hh of beyond) {
    const p = hexToScreen(view(), hh);
    await tap(p.x, p.y, isTouch);
    const got = await readout();
    if (got === T.describeUnexplored(hh)) beyondOk++; else fail(`beyond ${hexKey(hh)}: "${got}"`);
    await tap(me.x, me.y, isTouch);
  }
  check(edge.length > 0 && beyond.length > 0 && edgeOk === edge.length && beyondOk === beyond.length,
    `start reveals radius ${SIGHT_RADIUS}: ring ${SIGHT_RADIUS} mapped (${edgeOk}/${edge.length}), ring ${SIGHT_RADIUS + 1} unexplored (${beyondOk}/${beyond.length})`);
  check((await playerState()).turn === 0, 'boundary taps never moved the player');

  // Step toward a hex just beyond sight: it is revealed. Step back: it is remembered (dim).
  const dirs = hexNeighbors(start).filter((n) => world.isWalkable(n));
  let probe = null; let nb = null;
  for (const n of dirs) {
    const far = { q: start.q + (n.q - start.q) * (SIGHT_RADIUS + 1), r: start.r + (n.r - start.r) * (SIGHT_RADIUS + 1) };
    if (world.has(far) && tappable(far) && tappable(n)) { probe = far; nb = n; break; }
  }
  if (!probe) { fail('no probe hex for reveal-on-move'); return; }
  const pp = hexToScreen(view(), probe);
  // Deep fog (three rings past sight, beyond the cloud banks) is plain background.
  const deep = { q: start.q + (probe.q - start.q) / (SIGHT_RADIUS + 1) * (SIGHT_RADIUS + 3), r: start.r + (probe.r - start.r) / (SIGHT_RADIUS + 1) * (SIGHT_RADIUS + 3) };
  const deepP = hexToScreen(view(), deep);
  const onCanvas = deepP.x > 4 && deepP.y > 4 && deepP.x < w - 4 && deepP.y < h - 4;
  const cDeep = onCanvas ? await sample(deepP) : null;
  const cUnknown = await sample(pp); // edge of the fog: under a cloud bank
  await tap(hexToScreen(view(), nb).x, hexToScreen(view(), nb).y, isTouch);
  walked([nb]);
  const cVisible = await sample(pp);
  await tap(pp.x, pp.y, isTouch);
  check((await readout()) === expectTap(world, nb, probe) && !(await readout()).startsWith('Unexplored'), `a step reveals the next ring: "${await readout()}"`);
  await tap(hexToScreen(view(), nb).x, hexToScreen(view(), nb).y, isTouch); // tap yourself: clear
  await tap(me.x, me.y, isTouch); // step back to the sanctuary
  walked([start]);
  const cRemembered = await sample(pp);
  await tap(pp.x, pp.y, isTouch);
  const memText = await readout();
  check(memText === expectTap(world, start, probe) && !memText.startsWith('Unexplored'), `out of sight but still mapped: "${memText}"`);
  await tap(me.x, me.y, isTouch);
  if (cDeep) check(cDeep.v < 40, `deep fog draws no terrain: brightness ${cDeep.v.toFixed(0)}`);
  check(colourDistance(cUnknown, cVisible) > 8 && cRemembered.v < cVisible.v * 0.75,
    `drawn fog edge → visible → remembered (dim): colour change ${colourDistance(cUnknown, cVisible).toFixed(0)}, brightness ${cUnknown.v.toFixed(0)} → ${cVisible.v.toFixed(0)} → ${cRemembered.v.toFixed(0)}`);
  await shot(`fog-${w}x${h}`);

  // Map dialog.
  const turn0 = (await playerState()).turn;
  await clickEl('#map-button');
  check(await ev(`document.getElementById('map-dialog').open`), 'Map opens the map dialog');
  const wantSummary = `${T.describeExplored(mem.knownCount, mem.totalCount)} · you are at ${coordText(start)}`;
  check((await text('map-summary')) === wantSummary, `map summary: "${await text('map-summary')}"`);
  await frame();
  await shot(`map-${w}x${h}`);
  const box = await ev(`(() => { const r = document.getElementById('map-canvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  const mview = fitView(mem.knownHexes(), box.w, box.h, { maxSize: 16 }); // MAP_MAX_HEX in main.js
  // An unmapped hex on the map does nothing.
  const gap = hexesInRange(start, SIGHT_RADIUS + 6).find((hh) => world.has(hh) && !mem.isKnown(hh) && (() => { const c = hexToScreen(mview, hh); return c.x > 20 && c.y > 20 && c.x < box.w - 20 && c.y < box.h - 20; })());
  if (gap) {
    const c = hexToScreen(mview, gap);
    await tap(box.x + c.x, box.y + c.y, isTouch);
    check(await ev(`document.getElementById('map-dialog').open`), 'tapping an unmapped hex on the map does nothing');
  }
  // A mapped hex: the dialog closes and the view centres on it.
  const pick = mem.knownHexes().filter((hh) => hexDistance(hh, start) === SIGHT_RADIUS)[0];
  const pc = hexToScreen(mview, pick);
  await tap(box.x + pc.x, box.y + pc.y, isTouch);
  const pickedText = await readout();
  check(!(await ev(`document.getElementById('map-dialog').open`)) && pickedText === describeSelection(pick, terrainOf(world, pick), world.sanctuary) + noteOf(world, pick),
    `tapping a mapped hex closes the map and looks there: "${pickedText}"`);
  cam = C.centerOnHex(cam, pick);
  await tap(w / 2, h / 2, isTouch);
  check((await readout()) === expectTap(world, start, pick), 'the view is centred on the picked hex');
  check((await playerState()).turn === turn0, 'map use costs no turn');
}

async function perf(label, w, h, isTouch) {
  const m = await s.measureDrag(w, h, isTouch);
  console.log(`  perf ${label}: script ${m.script.toFixed(2)} ms/frame, task ${m.task.toFixed(2)} ms/frame`);
}

try {
  for (const cfg of VIEWPORTS.filter((v) => !process.env.VIEWPORT || v.name.includes(process.env.VIEWPORT))) {
    const { w, h, mobile } = cfg;
    console.log(`\n== ${cfg.name}`);
    await s.setViewport(cfg);
    logs.length = 0;
    await load(`${s.appUrl}?seed=everwake`);
    let world = createWorld('everwake', R);
    let cam = initialCamera(world, w, h);

    check((await text('seed-text')) === 'everwake', 'seed button shows the seed from the URL');
    const layout = await ev(`(() => { const r = (q) => document.querySelector(q).getBoundingClientRect(); const t = r('.hud-title'), sb = r('#seed-button'), c = r('#coords-toggle'), m = r('#map-button'), z = r('#zoom-in'), st = r('.hud-info'), wb = r('#wait-button'); return { overlap: t.right > sb.left, right: c.right, mapBottom: m.bottom, statusClear: (z.top > st.bottom || z.left > st.right) && st.top >= t.bottom, waitIn: wb.right <= innerWidth && wb.height >= 44, sw: document.scrollingElement.scrollWidth }; })()`);
    check(!layout.overlap && layout.right <= w && layout.sw <= w && layout.mapBottom <= h && layout.statusClear && layout.waitIn, `top bar and view controls fit ${JSON.stringify(layout)}`);

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

    console.log('  -- fog of war');
    await verifyFog(world, w, h, mobile);

    console.log('  -- movement');
    await verifyMovement(world, w, h, mobile);

    console.log('  -- gathering');
    await verifyGathering(world, w, h, mobile);

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
      resetMemory(world);
      cam = C.centerOnHex(cam, world.sanctuary);
      check((await readout()) === T.MOVE_HINT, 'selection cleared on new world');
      check((await text('player-status')) === T.describePlayer({ position: world.sanctuary }), 'player reset to the new sanctuary');
      check((await text('clock-status')) === K.describeClock(0), 'clock reset for the new world');
      await tap(w / 2, h / 2, mobile);
      check((await readout()).startsWith('Sanctuary'), 'new world centred on its sanctuary');
      await tap(w / 2, h / 2, mobile);
      await shot(`${cfg.name}-newworld`);
      await verifyPicking('new world', world, cam, w, h, mobile);

      await load(`${s.appUrl}${search}`);
      check((await text('seed-text')) === 'mossy fen 12', 'reload keeps the seed');

      const p0 = { x: w / 2, y: h / 2 };
      const p1 = { x: p0.x + (mobile ? 150 : 260), y: p0.y + (mobile ? 90 : 160) };
      if (mobile) { await touch('touchStart', [p0]); await touch('touchMove', [{ x: p0.x + 60, y: p0.y + 40 }]); await touch('touchMove', [p1]); await touch('touchEnd', []); }
      else { await mouse('mousePressed', p0.x, p0.y, { clickCount: 1 }); await mouse('mouseMoved', p1.x, p1.y, { buttons: 1 }); await mouse('mouseReleased', p1.x, p1.y, { clickCount: 1 }); }
      await frame();
      await tap(w / 2, h / 2, mobile);
      check(!(await readout()).startsWith('Sanctuary') && hexEquals((await playerState()).pos, world.sanctuary), 'drag moved the view off the sanctuary (player did not move)');
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
