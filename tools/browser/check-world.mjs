/**
 * End-to-end browser check of the current build (Tasks 01–10 behaviour):
 * hex picking at several zoom levels and viewports, terrain readout, the
 * sanctuary, tap-to-move (step, route preview, stepwise travel, interrupt,
 * resume, retarget, unreachable feedback), fog of war (reveal boundary,
 * reveal on movement, dim memory, unexplored taps) and the Map dialog, the
 * turn clock (one turn per step and per Wait, none for anything else),
 * gathering, points of interest (discovery, interrupting travel, the
 * context buttons, used state on revisit, the shrine's reveal, the Journal
 * dialog), enemies and combat (being noticed interrupts travel, approach,
 * real blows and the health line, inspecting, no movement while idle, the
 * combat buttons, Defend, Flee, disengaging at the sanctuary and recovering
 * there, fighting an enemy until it falls, being defeated), expeditions
 * (a voluntary return, the report after a return and after a defeat, learning
 * an upgrade, setting out again with the pack kept or lost), the seed dialog, URL seed retention, Centre, Coords, console cleanliness, and
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
 * check reveals sight around every hex the player is seen to stand on, and
 * works out from it which POIs each step discovers (their events are
 * appended to readouts, and a discovery interrupts travel).
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startSession, REPO, VIEWPORTS } from './cdp.mjs';

const shotDir = process.argv[2] ?? null;
const imp = (p) => import(pathToFileURL(join(REPO, p)).href);
const C = await imp('src/render/camera.js');
const { hexToScreen, screenToHex, fitView } = await imp('src/render/gridView.js');
const { createMapMemory, restoreMapMemory, SIGHT_RADIUS } = await imp('src/world/mapMemory.js');
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
const { STARTING_KIT } = await imp('src/entities/player.js');
const { inventoryView } = await imp('src/systems/items.js');
const IT = await imp('src/ui/itemText.js');
const { NODE_KINDS } = await imp('src/data/resources.js');
const P = await imp('src/ui/poiText.js');
const { poiState, interactOptions, discoverIn } = await imp('src/systems/pois.js');
const { rollFind } = await imp('src/world/poiPlacement.js');
const { POI_TYPES } = await imp('src/data/pois.js');
const { timeOf } = await imp('src/core/clock.js');
const { ENEMY_TYPES } = await imp('src/data/enemies.js');
const E = await imp('src/ui/enemyText.js');
const { createGame, createTurnSystem } = await imp('src/core/game.js');
const { enemyIntent } = await imp('src/systems/enemies.js');
const { createCombatReactions } = await imp('src/systems/combat.js');
const CT = await imp('src/ui/combatText.js');
const { contextOptions, buttonFor, actionFor } = await imp('src/ui/contextActions.js');
const { setOut } = await imp('src/core/game.js');
const { lastReport } = await imp('src/systems/expedition.js');
const { buyUpgrade, upgradeView } = await imp('src/systems/progression.js');
const X = await imp('src/ui/expeditionText.js');
/**
 * Enemies (Task 09). The general flows keep every hex the player stands on
 * out of every enemy's detection range (`quietPath`), so enemies stay idle
 * at home and the mirrors above need no enemy simulation; an idle enemy in
 * sight still shows in readouts (`idleEnemyAt`). verifyEnemies covers
 * encounters with a full Node game run through the real turn pipeline.
 */
const quiet = (world, h) => world.enemySpawns.every((e) => hexDistance(e, h) > ENEMY_TYPES[e.type].detectRange);
const quietPath = (world, path) => path.every((h) => quiet(world, h));
const spawnIndex = new WeakMap();
/** An idle enemy at home on a hex in sight (as the page shows it), or null. */
function idleEnemyAt(world, h) {
  if (!h || !mem.isVisible(h)) return null;
  if (!spawnIndex.has(world)) spawnIndex.set(world, new Map(world.enemySpawns.map((e) => [hexKey(e), e])));
  const sp = spawnIndex.get(world).get(hexKey(h));
  return sp ? { id: sp.id, type: sp.type, health: ENEMY_TYPES[sp.type].health, mode: 'idle', position: sp, home: sp } : null;
}
/** Route options as the page plans them: mapped hexes only, around enemies in sight. */
const routeOpts = (world) => ({ knows: (h) => mem.isKnown(h), avoid: (h) => !!idleEnemyAt(world, h) });
/** The clock's event for the step that ends on `turn`, if it starts a new day part (game.js pipeline order: before discoveries). */
const dayPartAt = (turn) => {
  const t = timeOf(turn);
  return t.partIndex !== timeOf(turn - 1).partIndex ? [{ type: 'dayPart', turn, day: t.day, part: t.part }] : [];
};
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
  const r = await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.scrollIntoView({ block: 'nearest' }); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
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
/** Node mirror of the page's world changes and inventory (gathering, POIs); reset with map memory. */
let chg = null;
let inv = null;
/** The world the mirrors belong to (the page's current seed). */
let curWorld = null;
const resetMemory = (world) => { curWorld = world; mem = createMapMemory(R); mem.observe(world.sanctuary, SIGHT_RADIUS); chg = createWorldChanges(); inv = createInventory(STARTING_KIT); };
/**
 * The player stood on each of these hexes, in order. Returns the POI
 * discoveries of the last one (the events its readout ends with).
 */
const walked = (hexes) => {
  let found = [];
  for (const h of hexes) found = discoverIn({ world: curWorld, player: { position: h } }, mem.observe(h, SIGHT_RADIUS).newly);
  return found;
};
const knows = (h) => mem.isKnown(h);
/** Would walking `path` discover a POI (and so be interrupted)? Leaves the mirror untouched. */
function discoversAlong(world, path) {
  const copy = restoreMapMemory(mem.serialize(), R).memory;
  return path.some((h) => copy.observe(h, SIGHT_RADIUS).newly.some((x) => world.poiAt(x)));
}
/** POI discoveries a single step to `h` would make (for expected readouts), without walking it. */
function peekDiscoveries(world, h) {
  const copy = restoreMapMemory(mem.serialize(), R).memory;
  return discoverIn({ world, player: { position: h } }, copy.observe(h, SIGHT_RADIUS).newly);
}

const terrainOf = (world, h) => { const t = world.tileAt(h); return t ? TERRAIN[t.terrain] : null; };
const labelOf = (world, h) => T.placeLabel(h, terrainOf(world, h), world.sanctuary);
/** A mapped hex's node as the page knows it (gathering.js nodeState), or null. */
const nodeOf = (world, h) => (h && knows(h) ? nodeState({ world, changes: chg }, h) : null);
const liveNodeOf = (world) => (h) => { const n = nodeOf(world, h); return n && n.left > 0 ? n : null; };
/** A mapped hex's POI as the page knows it (systems/pois.js poiState), or null. */
const poiOf = (world, h) => (h && knows(h) ? poiState({ world, changes: chg }, h) : null);
const noteOf = (world, h) => G.nodeNote(nodeOf(world, h)) + P.poiNote(poiOf(world, h)) + E.enemyNote(idleEnemyAt(world, h), 'idle');
const hereText = (world, pos) => `${describeSelection(pos, terrainOf(world, pos), world.sanctuary)} · you are here${noteOf(world, pos)}`;

/** The readout the page should show after an idle tap on `h` (mirrors main.js applyTapAction). */
function expectTap(world, pos, h, preview = null) {
  const enemyAt = (x) => idleEnemyAt(world, x);
  const { action } = decideTap(world, { position: pos, preview, travelling: null, knows, nodeAt: liveNodeOf(world), enemyAt }, h);
  switch (action.kind) {
    case 'enemy': return E.describeEnemyHex(labelOf(world, h), enemyAt(h), 'idle');
    case 'unexplored': return T.describeUnexplored(h);
    case 'clear': return T.MOVE_HINT;
    case 'here': return hereText(world, pos);
    case 'step': return K.withEvents(T.describeStepped(labelOf(world, h)) + noteOf(world, h), peekDiscoveries(world, h));
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
      const r = planRoute(world, from, hh, routeOpts(world));
      // A route that sights a POI is interrupted (checked in verifyPois), and so is one that wakes an enemy.
      // The flows recentre on the player mid-route and tap the destination again: it must stay clear of the HUD from every hex on the way.
      const clearAlong = (path) => path.every((p) => { const q = hexToScreen(C.cameraToView(C.centerOnHex(cam, p), w, h), hh); return q.x > 0 && q.x < w && q.y > 0 && q.y < h && !nearHud(q); });
      if (r.status === 'ok' && r.path.length >= 4 && !discoversAlong(world, r.path) && quietPath(world, r.path) && clearAlong(r.path)) return { hex: hh, ...r };
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
  const nbEvents = walked([nb]);
  st = await playerState();
  check(hexEquals(st.pos, nb) && st.turn === 1 && (await readout()) === K.withEvents(T.describeStepped(labelOf(world, nb)) + noteOf(world, nb), nbEvents), `adjacent tap steps one hex: "${await readout()}"`);
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
  check((await readout()) === T.describePreview(labelOf(world, target.hex), target.path.length, target.cost) + noteOf(world, target.hex), `first tap previews: "${await readout()}"`);
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
  walked(run.seen.slice(1));
  // The route from where travel stopped may sight a POI: resume until there.
  for (let i = 0; i < 4 && run.readout.startsWith('Interrupted'); i++) {
    const at = run.seen[run.seen.length - 1];
    await recentre();
    await tapHex(b.hex);
    const more = await watchTravel(at);
    walked(more.seen.slice(1));
    run = { ...more, seen: [...run.seen, ...more.seen.slice(1)] };
  }
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
          .map((hh) => ({ hh, r: planRoute(wld, st.pos, hh, routeOpts(wld)) }))
          .find((x) => x.r.status === 'ok' && x.r.path.length >= 2 && quietPath(wld, x.r.path));
        if (!step) { fail(`exploring toward ${what}: no tappable mapped hex to walk to`); return null; }
        await tapHex(step.hh);
        await tapHex(step.hh);
        const trip = await watchTravel(st.pos);
        walked(trip.seen.slice(1));
        if (trip.readout.startsWith('Interrupted')) {
          // A POI came into sight: fine, carry on from here. Tap yourself to
          // drop the remaining preview so the next leg starts fresh.
          await recentre();
          await tapHex(trip.seen[trip.seen.length - 1]);
          continue;
        }
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

/** The context buttons on the page: `[{ text, label, index }]`. */
const contextButtons = () => ev(`[...document.querySelectorAll('#context-actions button')].map(b => ({ text: b.textContent, label: b.getAttribute('aria-label'), index: b.dataset.index }))`);
/** The context buttons the page should show at `pos` (POIs first, then nodes; main.js contextOptions). */
function wantContextButtons(world, pos) {
  const g = { world, changes: chg, memory: mem, player: { position: pos } };
  const fmt = (b) => ({ text: `${b.text} ${b.where}`, label: b.label });
  return [...interactOptions(g).map((o) => fmt(P.interactButton(o))), ...gatherOptions(g).map((o) => fmt(G.gatherButton(o)))];
}
const sameButtons = (got, want) => JSON.stringify(got.map(({ text, label }) => ({ text, label }))) === JSON.stringify(want);

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
  const buttons = contextButtons;
  const wantButtons = (pos) => wantContextButtons(world, pos);

  check((await text('inventory-status')) === G.describeInventory(inv), `inventory starts empty: "${await text('inventory-status')}"`);

  // Nearest mapped walkable node with a route, on screen.
  let st = await playerState();
  const node = world.resourceNodes
    .filter((n) => knows(n) && world.isWalkable(n) && tappable(n) && hexDistance(n, st.pos) >= 2)
    .sort((a, b) => hexDistance(a, st.pos) - hexDistance(b, st.pos))
    .map((n) => ({ n, r: planRoute(world, st.pos, n, routeOpts(world)) }))
    .find((x) => x.r.status === 'ok' && !discoversAlong(world, x.r.path) && quietPath(world, x.r.path));
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
  check(sameButtons(got, wantButtons(st.pos)), `Gather buttons for nodes in reach: ${got.map((b) => b.text).join(', ')}`);
  await shot(`gather-${w}x${h}`);

  // Gather until spent: one turn each.
  const def = NODE_KINDS[node.n.kind];
  let turn = st.turn;
  for (let left = nodeOf(world, at).left; left > 0; left--) {
    const btn = (await buttons()).find((b) => b.label === G.gatherButton({ ...nodeOf(world, at), direction: null }).label);
    if (!btn) { fail('no Gather button for the node underfoot'); return; }
    await clickEl(`#context-actions button[data-index="${btn.index}"]`);
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
  const backEvents = walked([at]);
  check((await readout()) === K.withEvents(T.describeStepped(labelOf(world, at)) + noteOf(world, at), backEvents) && nodeOf(world, at).left === 0, `back on the node, it is still spent: "${await readout()}"`);
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
    .find((x) => x.a && x.a.path.length > 0 && !discoversAlong(aw, x.a.path) && quietPath(aw, x.a.path));
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

/**
 * Points of interest: the POI in sight of the everwake start is already in
 * the Journal; walk to it, search it with its context button (one turn, the
 * seeded find, journalled), see it stay searched after leaving and coming
 * back, pick its entry in the Journal; a route that sights a new POI is
 * interrupted and resumes with one tap; and on shrine-64 (a shrine three
 * steps from the start, found by searching seeds) reading the shrine maps
 * the land around it and discovers a chest.
 */
async function verifyPois(world, w, h, isTouch) {
  await load(`${s.appUrl}?seed=everwake`);
  let cam = initialCamera(world, w, h);
  const hud = await hudBoxes();
  const view = () => C.cameraToView(cam, w, h);
  const screenOf = (hh) => hexToScreen(view(), hh);
  const tappable = (hh, f = 0.12) => { const p = screenOf(hh); return p.x > w * f && p.x < w * (1 - f) && p.y > h * f && p.y < h * (1 - f) && !hud.some(([l, t, r, b]) => p.x >= l && p.x <= r && p.y >= t && p.y <= b); };
  const tapHex = async (hh) => { const p = screenOf(hh); await tap(p.x, p.y, isTouch); };
  const recentre = async () => { await clickEl('#recenter'); cam = C.centerOnHex(cam, (await playerState()).pos); };
  /** Drag the map (a pan, never a tap) so `hh` sits mid-screen, clear of the HUD on short screens. */
  const bringIntoView = async (hh) => {
    const c = screenOf(hh);
    const p0 = { x: w / 2, y: h * 0.4 };
    const p1 = { x: p0.x + (w / 2 - c.x), y: p0.y + (h * 0.45 - c.y) };
    const pm = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
    if (isTouch) { await touch('touchStart', [p0]); await touch('touchMove', [pm]); await touch('touchMove', [p1]); await touch('touchEnd', []); }
    else { await mouse('mousePressed', p0.x, p0.y, { clickCount: 1 }); await mouse('mouseMoved', pm.x, pm.y, { buttons: 1 }); await mouse('mouseMoved', p1.x, p1.y, { buttons: 1 }); await mouse('mouseReleased', p1.x, p1.y, { clickCount: 1 }); }
    await frame();
    cam = C.panBy(cam, p1.x - p0.x, p1.y - p0.y);
  };
  const journal = () => ev(`({ open: document.getElementById('journal-dialog').open, summary: document.getElementById('journal-summary').textContent, entries: [...document.querySelectorAll('.journal-entry')].map(b => b.textContent) })`);
  /** Expected journal lines, newest first, from the entries the check has mirrored. */
  const wantJournal = (entries) => [...entries].reverse().map((e) => P.journalWhen(e.turn) + P.journalText(e));
  /** Tap a destination twice and follow travel there, resuming after any discovery; returns the last leg and its last step's discoveries. */
  async function travelTo(dest) {
    let st = await playerState();
    await tapHex(dest);
    await tapHex(dest);
    for (let leg = 0; leg < 6; leg++) {
      const run = await watchTravel(st.pos);
      const found = walked(run.seen.slice(1));
      if (!run.readout.startsWith('Interrupted')) return { run, found };
      st = await playerState();
      await recentre();
      if (!tappable(dest)) await bringIntoView(dest);
      await tapHex(dest);
    }
    return { run: { readout: 'too many interruptions', seen: [] }, found: [] };
  }

  // At the start: what is in sight is already discovered and journalled.
  const start = world.sanctuary;
  const entries = discoverIn({ world, player: { position: start } }, world.pois.filter((p) => knows(p))).map((e) => ({ turn: 0, ...e }));
  if (entries.length === 0) { fail('everwake: no POI in sight of the start'); return; }
  await clickEl('#journal-button');
  let j = await journal();
  check(j.open && j.summary === P.describeJournalSummary(entries) && JSON.stringify(j.entries) === JSON.stringify(wantJournal(entries)),
    `Journal lists what is in sight at the start: "${j.summary}" ${JSON.stringify(j.entries)}`);
  await shot(`journal-start-${w}x${h}`);
  await clickEl('#journal-close');
  check(!(await journal()).open && (await playerState()).turn === 0, 'Journal closes; reading it costs no turn');

  // Walk to the nearest POI and use it.
  const poi = world.poiAt(entries[0].at);
  const at = { q: poi.q, r: poi.r };
  if (!tappable(at)) await bringIntoView(at);
  if (!tappable(at)) { fail(`POI ${hexKey(at)} is not tappable on this viewport`); return; }
  await tapHex(at);
  check((await readout()) === expectTap(world, start, at) && (await readout()).includes(P.describePoi(poiOf(world, at))),
    `tapping a POI previews the route and names it: "${await readout()}"`);
  const route = planRoute(world, start, at, routeOpts(world));
  check(quietPath(world, route.path), 'the route to the first POI wakes no enemy');
  await tapHex(at);
  const trip = await watchTravel(start);
  const tripFound = walked(trip.seen.slice(1));
  let st = await playerState();
  if (!hexEquals(st.pos, at)) { fail(`did not reach the POI: "${trip.readout}"`); return; }
  check(trip.readout === K.withEvents(T.describeArrived(labelOf(world, at), route.path.length) + noteOf(world, at), tripFound),
    `arrive at the POI: "${trip.readout}"`);
  check(sameButtons(await contextButtons(), wantContextButtons(world, at)), `context buttons: ${(await contextButtons()).map((b) => b.text).join(', ')}`);
  const opt = interactOptions({ world, changes: chg, memory: mem, player: { position: at } }).find((o) => hexEquals(o.at, at));
  const btn = (await contextButtons()).find((b) => opt && b.label === P.interactButton(opt).label);
  if (!btn) { fail('no button for the POI underfoot'); return; }
  await shot(`poi-arrived-${w}x${h}`);
  const turn0 = st.turn;
  await clickEl(`#context-actions button[data-index="${btn.index}"]`);
  chg.recordPoiUse(at, 1);
  const found = rollFind(world.seedNumber, poi, 0);
  for (const [id, n] of Object.entries(found ?? {})) addItem(inv, id, n);
  const used = { type: 'interacted', at, poi: poi.type, name: poi.name, use: 1, left: poi.uses - 1, ...(found ? { found } : {}) };
  st = await playerState();
  check(st.turn === turn0 + 1 && hexEquals(st.pos, at) && (await readout()) === K.describeEvents([used]),
    `using it takes one turn and has an outcome: "${await readout()}" (turn ${st.turn})`);
  check((await text('inventory-status')) === G.describeInventory(inv), `the find is carried: "${await text('inventory-status')}"`);
  entries.push({ turn: st.turn, ...used });
  await shot(`poi-used-${w}x${h}`);
  if (poi.uses === 1) {
    check(!(await contextButtons()).some((b) => b.label.startsWith(`${POI_VERB(poi)} `)) && sameButtons(await contextButtons(), wantContextButtons(world, at)), 'a used-up POI offers no button');
    await tapHex(at);
    check((await readout()) === hereText(world, at) && (await playerState()).turn === st.turn, `inspecting it shows its state, no turn: "${await readout()}"`);

    // Leave and come back: still used.
    const away = hexNeighbors(at).find((n) => world.isWalkable(n) && tappable(n) && !world.poiAt(n));
    await tapHex(away);
    walked([away]);
    await tapHex(at);
    const backFound = walked([at]);
    check((await readout()) === K.withEvents(T.describeStepped(labelOf(world, at)) + noteOf(world, at), backFound) && poiOf(world, at).left === 0,
      `back at the POI, it stays ${POI_TYPES_DONE(poi)}: "${await readout()}"`);
    check(sameButtons(await contextButtons(), wantContextButtons(world, at)), 'and still offers no button for it');
    st = await playerState();
  }

  // The Journal records the use; an entry takes you to the place.
  await clickEl('#journal-button');
  j = await journal();
  check(j.summary === P.describeJournalSummary(entries) && JSON.stringify(j.entries) === JSON.stringify(wantJournal(entries)),
    `Journal records the use: "${j.summary}" ${JSON.stringify(j.entries.slice(0, 2))}`);
  await shot(`journal-${w}x${h}`);
  const pickIndex = await ev(`[...document.querySelectorAll('.journal-entry')].length - 1`); // the oldest: the first discovery
  await clickEl(`.journal-entry[data-index="${pickIndex}"]`);
  check(!(await journal()).open && (await readout()) === describeSelection(at, terrainOf(world, at), world.sanctuary) + noteOf(world, at) && (await playerState()).turn === st.turn,
    `picking an entry closes the Journal and looks there: "${await readout()}"`);

  // A route that sights a new POI stops there; one tap resumes.
  await recentre();
  st = await playerState();
  const target = hexesInRange(st.pos, 8)
    .filter((hh) => hexDistance(hh, st.pos) >= 3 && tappable(hh, 0.15) && knows(hh))
    .map((hh) => ({ hh, r: planRoute(world, st.pos, hh, routeOpts(world)) }))
    .filter((x) => x.r.status === 'ok' && x.r.path.length >= 3 && quietPath(world, x.r.path))
    .map((x) => {
      const copy = restoreMapMemory(mem.serialize(), R).memory;
      const k = x.r.path.findIndex((p) => copy.observe(p, SIGHT_RADIUS).newly.some((n) => world.poiAt(n)));
      return { ...x, k };
    })
    .find((x) => x.k >= 0 && x.k < x.r.path.length - 1);
  if (!target) { console.log('  (no route on screen sights a new POI here; interrupt flow skipped)'); return; }
  await tapHex(target.hh);
  await tapHex(target.hh);
  const cut = await watchTravel(st.pos);
  const cutFound = walked(cut.seen.slice(1));
  const cutAt = await playerState();
  check(cutAt.turn === st.turn + target.k + 1 && hexEquals(cutAt.pos, target.r.path[target.k])
    && cut.readout === K.withEvents(T.describeInterrupted(labelOf(world, target.hh), target.k + 1, target.r.path.length), [...dayPartAt(cutAt.turn), ...cutFound]),
    `sighting a POI interrupts travel: "${cut.readout}"`);
  await shot(`poi-interrupt-${w}x${h}`);
  await recentre();
  await tapHex(target.hh);
  const rest = await watchTravel(cutAt.pos);
  walked(rest.seen.slice(1));
  check(hexEquals((await playerState()).pos, target.hh) || rest.readout.startsWith('Interrupted'), `one tap resumes: "${rest.readout}"`);

  // A shrine: reading it maps the land around and discovers what is there.
  const sw = createWorld('shrine-64', R);
  await load(`${s.appUrl}?seed=shrine-64`);
  cam = initialCamera(sw, w, h);
  const shrine = sw.pois.find((p) => p.type === 'shrine' && knows(p));
  if (shrine && !tappable(shrine)) await bringIntoView(shrine);
  if (!shrine || !tappable(shrine)) { fail('shrine-64: no tappable shrine in sight of the start'); return; }
  const sat = { q: shrine.q, r: shrine.r };
  await travelTo(sat);
  st = await playerState();
  if (!hexEquals(st.pos, sat)) { fail(`shrine-64: did not reach the shrine (${hexKey(st.pos)})`); return; }
  const sopt = interactOptions({ world: sw, changes: chg, memory: mem, player: { position: sat } }).find((o) => hexEquals(o.at, sat));
  const sbtn = (await contextButtons()).find((b) => sopt && b.label === P.interactButton(sopt).label);
  if (!sbtn || !sbtn.text.startsWith('Read shrine')) { fail(`no Read shrine button: ${JSON.stringify(await contextButtons())}`); return; }
  const known0 = mem.knownCount;
  await clickEl(`#context-actions button[data-index="${sbtn.index}"]`);
  chg.recordPoiUse(sat, 1);
  const { newly } = mem.reveal(sat, POI_REVEAL(shrine));
  const sEvents = [{ type: 'interacted', at: sat, poi: 'shrine', name: shrine.name, use: 1, left: 0, revealed: newly.length },
    ...discoverIn({ world: sw, player: { position: sat } }, newly)];
  check((await readout()) === K.describeEvents(sEvents) && (await playerState()).turn === st.turn + 1 && mem.knownCount > known0,
    `reading the shrine maps the land around it: "${await readout()}"`);
  check(sEvents.some((e) => e.type === 'discovered'), `and discovers places there (${sEvents.filter((e) => e.type === 'discovered').map((e) => e.poi).join(', ')})`);
  await clickEl('#map-button');
  check((await text('map-summary')) === `${T.describeExplored(mem.knownCount, mem.totalCount)} · you are at ${coordText(sat)}`, `the Map shows the revealed land: "${await text('map-summary')}"`);
  await frame();
  await shot(`shrine-map-${w}x${h}`);
  await clickEl('#map-close');
}
/**
 * Enemies and combat (Tasks 09–10). Walk toward the nearest enemy of the
 * everwake world and travel into its detection range (it notices you and
 * travel is interrupted); wait while it closes in and strikes (real damage:
 * the health line drops); inspect it (no turn) and see that nothing moves
 * while idle; check the combat buttons; Defend (a softened blow) and Flee
 * (no parting strike); walk back to the sanctuary (it follows and gives up
 * at the ward) and recover there; go back out and fight it with the Attack
 * button until it falls; then wait beside the next enemy until you are
 * defeated (the sanctuary screen opens with the report; learn an upgrade if
 * affordable, then set out again with the basic kit).
 * Every turn is mirrored by a Node game run through the real pipeline, so
 * each readout, the health line and the buttons are compared exactly.
 */
async function verifyEnemies(world, w, h, isTouch) {
  await load(`${s.appUrl}?seed=everwake`);
  let cam = initialCamera(world, w, h);
  const view = () => C.cameraToView(cam, w, h);
  const screenOf = (hh) => hexToScreen(view(), hh);
  const tapHex = async (hh) => { const p = screenOf(hh); await tap(p.x, p.y, isTouch); };
  const recentre = async () => { await clickEl('#recenter'); cam = C.centerOnHex(cam, (await playerState()).pos); };
  const mg = createGame(world);
  const turns = createTurnSystem({ reactions: createCombatReactions() });
  const seen = (x) => (mg.memory.isVisible(x) ? mg.enemies.at(x) : null);
  const note = (x) => G.nodeNote(mg.memory.isKnown(x) ? nodeState(mg, x) : null) + P.poiNote(mg.memory.isKnown(x) ? poiState(mg, x) : null)
    + (seen(x) ? E.enemyNote(seen(x), enemyIntent(mg, seen(x))) : '');
  const opts = () => ({ knows: mg.memory.isKnown, avoid: (x) => !!seen(x) });
  const allEvents = [];
  const healthWant = () => CT.describeHealth(mg.player.health, mg.player.maxHealth);
  const synced = async (label) => {
    const st = await playerState();
    const hp = await text('health-status');
    const ok = hexEquals(st.pos, mg.player.position) && st.turn === mg.clock.turn && hp === healthWant();
    if (!ok) fail(`${label}: page at ${hexKey(st.pos)} turn ${st.turn} "${hp}", mirror at ${hexKey(mg.player.position)} turn ${mg.clock.turn} "${healthWant()}"`);
    return ok;
  };
  const has = (res, type) => res.events.some((e) => e.type === type);
  const defeatedIn = (res) => has(res, 'defeated');
  /** The readout after an action: a defeat replaces it with the turn's events (main.js showDefeat). */
  const readoutFor = (res, line) => (defeatedIn(res) ? K.describeEvents(res.events) : line);
  const compare = async (label, want) => {
    const got = await readout();
    if (got !== want) fail(`${label}: "${got}" want "${want}"`);
    return got === want;
  };
  /** One single-hex step by tapping a neighbour; checks the readout. */
  const step = async (to, label) => {
    await recentre();
    const { action } = decideTap(world, { position: mg.player.position, preview: null, travelling: null, knows: mg.memory.isKnown, nodeAt: null, enemyAt: seen }, to);
    if (action.kind !== 'step') { fail(`${label}: tapping ${hexKey(to)} would be "${action.kind}", not a step`); return null; }
    await tapHex(to);
    const res = turns.perform(mg, { type: 'move', to });
    allEvents.push(...res.events);
    await compare(label, readoutFor(res, K.withEvents(T.describeStepped(labelOf(world, to)) + note(to), res.events)));
    return (await synced(label)) ? res : null;
  };
  const waitTurn = async (label) => {
    await clickEl('#wait-button');
    const res = turns.perform(mg, { type: 'wait' });
    allEvents.push(...res.events);
    await compare(label, readoutFor(res, K.withEvents(K.WAITED, res.events)));
    return (await synced(label)) ? res : null;
  };
  const pageButtons = () => ev(`[...document.querySelectorAll('#context-actions button')].map(b => b.getAttribute('aria-label'))`);
  const wantButtons = () => contextOptions(mg).map((o) => buttonFor(o).label);
  const buttonsMatch = async (label) => {
    const got = await pageButtons();
    const want = wantButtons();
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fail(`${label}: buttons ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
    return ok;
  };
  /** Press the first context button of `kind`; checks the buttons, readout and state. */
  const press = async (kind, label) => {
    const options = contextOptions(mg);
    const i = options.findIndex((o) => o.kind === kind);
    if (i < 0) { fail(`${label}: no ${kind} button offered`); return null; }
    if (!(await buttonsMatch(label))) return null;
    await clickEl(`#context-actions button[data-index="${i}"]`);
    const res = turns.perform(mg, actionFor(options[i]));
    if (!res.ok) { fail(`${label}: the mirror refused ${kind} (${res.reason})`); return null; }
    allEvents.push(...res.events);
    await compare(label, K.describeEvents(res.events));
    return (await synced(label)) ? res : null;
  };
  /** Step toward `foe` (around enemies in sight) until it hunts you or `stop` holds. */
  const approach = async (foe, label, stop = () => false) => {
    for (let i = 0; i < 60 && foe.mode !== 'hunting' && !stop(); i++) {
      // Around other enemies in sight, not the one being approached.
      const r = planRoute(world, mg.player.position, foe.position, { knows: mg.memory.isKnown, avoid: (x) => !!seen(x) && !hexEquals(x, foe.position) });
      if (r.status !== 'ok' || r.path.length < 2) break;
      if (!(await step(r.path[0], `${label} ${i + 1}`))) return false;
    }
    return true;
  };

  // The nearest enemy on foot, by route length over the whole map.
  const target = world.enemySpawns
    .map((e) => ({ e, r: planRoute(world, world.sanctuary, e) }))
    .filter((x) => x.r.status === 'ok')
    .sort((a, b) => a.r.path.length - b.r.path.length)[0];
  if (!target) { fail('everwake: no enemy reachable on foot'); return; }
  const foe = mg.enemies.list[target.e.id];
  const def = ENEMY_TYPES[foe.type];
  console.log(`  approaching the ${foe.type} at ${hexKey(foe.home)} (${target.r.path.length} steps)`);
  check((await text('health-status')) === CT.describeHealth(24, 24), `the health line starts full: "${await text('health-status')}"`);

  // Single steps until within a few hexes of its detection range.
  for (let i = 0; i < 40 && hexDistance(mg.player.position, foe.position) > def.detectRange + 2; i++) {
    const next = planRoute(world, mg.player.position, foe.position).path[0];
    const res = await step(next, `approach step ${i + 1}`);
    if (!res) return;
    if (has(res, 'enemyDetected')) break;
  }
  check(foe.mode === 'idle' || mg.enemies.list.some((e) => e.mode === 'hunting'), `walked to ${hexDistance(mg.player.position, foe.position)} hexes from the ${foe.type}`);

  // Travel on toward it: being noticed interrupts the route.
  if (mg.enemies.list.every((e) => e.mode === 'idle')) {
    await recentre();
    const full = planRoute(world, mg.player.position, foe.position).path;
    const dest = full.find((x) => hexDistance(x, foe.position) <= def.detectRange - 1 && mg.memory.isKnown(x)) ?? null;
    const route = dest && planRoute(world, mg.player.position, dest, opts());
    if (!route || route.status !== 'ok') { fail(`no mapped route toward the ${foe.type}`); return; }
    await tapHex(dest);
    await tapHex(dest);
    const run = await watchTravel(mg.player.position);
    let last = null;
    for (const x of run.seen.slice(1)) { last = turns.perform(mg, { type: 'move', to: x }); allEvents.push(...last.events); }
    const done = run.seen.length - 1;
    const want = last && last.interrupt && done < route.path.length
      ? K.withEvents(T.describeInterrupted(labelOf(world, dest), done, route.path.length), last.events)
      : K.withEvents(T.describeArrived(labelOf(world, dest), route.path.length) + note(dest), last ? last.events : []);
    check(run.readout === want && (await synced('travel')), `travel into its range: "${run.readout}"`);
    check(!!last && has(last, 'enemyDetected') && run.readout.startsWith('Interrupted'), 'being noticed interrupts travel');
  }
  check(allEvents.some((e) => e.type === 'enemyDetected'), `an enemy noticed you: "${E.describeEnemyEvent(allEvents.find((e) => e.type === 'enemyDetected') ?? { type: 'none' })}"`);
  await shot(`enemy-noticed-${w}x${h}`);

  // Wait while it closes in, until it strikes: real damage now.
  let attack = null;
  for (let i = 0; i < 12 && !attack; i++) {
    const res = await waitTurn(`wait ${i + 1}`);
    if (!res) return;
    attack = res.events.find((e) => e.type === 'enemyAttack') ?? null;
  }
  check(!!attack && !attack.stub && attack.damage > 0 && mg.player.health === 24 - attack.damage, `it strikes only once beside you: "${await readout()}"`);
  check((await text('health-status')) === CT.describeHealth(mg.player.health, 24), `the health line drops: "${await text('health-status')}"`);
  const attacker = attack && mg.enemies.list[attack.id];
  if (!attacker) return;

  // Hurt: drink the healing potion from the Pack. One turn; the enemy acts after it.
  await clickEl('#pack-button');
  const potionKey = '#pack-list button[data-key="use:healingPotion"]';
  check(await ev(`!!document.querySelector('${potionKey}') && !document.querySelector('${potionKey}').disabled`), 'hurt: the Drink button is enabled');
  await clickEl(potionKey);
  const drunk = turns.perform(mg, { type: 'use', item: 'healingPotion' });
  allEvents.push(...drunk.events);
  const drinkMsg = await text('pack-message');
  check(drunk.ok && drinkMsg === K.describeEvents(drunk.events), `drinking takes a turn and the enemy acts: "${drinkMsg}"`);
  if (defeatedIn(drunk)) return;
  check(!(await ev(`!!document.querySelector('${potionKey}')`)), 'the only potion is gone from the pack');
  await clickEl('#pack-close');
  check((await synced('after the potion')) && (await text('inventory-status')) === G.describeInventory(mg.player.inventory), `the HUD line agrees: "${await text('inventory-status')}"`);
  check(hexDistance(attacker.position, mg.player.position) <= ENEMY_TYPES[attacker.type].attackRange, 'the attacker is within its attack range');
  await shot(`enemy-attack-${w}x${h}`);

  // Inspect it: no turn, and its intent shows.
  await recentre();
  await tapHex(attacker.position);
  const insp = E.describeEnemyHex(labelOf(world, attacker.position), attacker, enemyIntent(mg, attacker));
  check((await readout()) === insp && (await synced('inspect')), `tapping it inspects it, no turn: "${await readout()}"`);
  await s.wait(600);
  await tapHex(attacker.position);
  check((await readout()) === insp && (await synced('idle')), 'idle: nothing moves while waiting for input');

  // The combat buttons: Attack (with its damage), Defend, Flee.
  const kinds = contextOptions(mg).map((o) => o.kind);
  check((await buttonsMatch('combat buttons')) && ['attack', 'defend', 'flee'].every((k) => kinds.includes(k)), `combat buttons: ${JSON.stringify(await pageButtons())}`);
  const fit = await ev(`(() => { const r = document.getElementById('context-actions').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && [...document.querySelectorAll('#context-actions button')].every(b => b.getBoundingClientRect().height >= 44); })()`);
  check(fit, 'the combat buttons fit the screen and are touch-sized');
  await shot(`combat-buttons-${w}x${h}`);

  // Defend: the blow that turn is softened.
  const d = await press('defend', 'defend');
  if (!d) return;
  const guardedHit = d.events.find((e) => e.type === 'enemyAttack');
  check(d.events[0].type === 'defended' && (!guardedHit || guardedHit.guarded), `Defend takes a turn and softens the blow: "${await readout()}"`);

  // Flee: a clean break, no parting strike, and the gap opens.
  const hp1 = mg.player.health;
  const f = await press('flee', 'flee');
  if (!f) return;
  check(f.events[0].type === 'fled' && !has(f, 'enemyAttack') && mg.player.health === hp1 && hexDistance(attacker.position, mg.player.position) >= 2,
    `Flee breaks away without a strike: "${await readout()}"`);

  // Walk home: it follows, then gives up at the sanctuary's ward.
  let off = null;
  for (let i = 0; i < 60 && !off; i++) {
    const r = planRoute(world, mg.player.position, world.sanctuary, opts());
    if (r.status !== 'ok') { fail(`no way back to the sanctuary from ${hexKey(mg.player.position)} (${r.status})`); return; }
    const res = await step(r.path[0], `retreat step ${i + 1}`);
    if (!res) return;
    off = res.events.find((e) => e.type === 'enemyDisengaged' && e.id === attacker.id) ?? null;
  }
  check(!!off, `the ${attacker.type} disengages: "${off ? E.describeEnemyEvent(off) : 'never'}"`);
  // It heads back home; nothing hunts you here, and the sanctuary heals.
  for (let i = 0; i < 14 && (i < 4 || mg.player.health < mg.player.maxHealth); i++) if (!(await waitTurn(`wait at home ${i + 1}`))) return;
  check(attacker.mode !== 'hunting' && mg.enemies.list.every((e) => e.mode !== 'hunting'), `no enemy hunts you near the sanctuary (the ${attacker.type} is ${attacker.mode})`);
  check(allEvents.some((e) => e.type === 'recovered') && mg.player.health === mg.player.maxHealth, `resting on sanctuary ground heals: "${await text('health-status')}"`);
  await shot(`enemy-retreat-${w}x${h}`);

  // Back out to fight it to the end with the Attack button.
  if (!(await approach(attacker, 'return step', () => hexDistance(mg.player.position, attacker.position) <= 1))) return;
  for (let i = 0; i < 12 && hexDistance(mg.player.position, attacker.position) > 1; i++) if (!(await waitTurn(`wait for it ${i + 1}`))) return;
  let fallen = null;
  for (let i = 0; i < 12 && !fallen && attacker.health > 0; i++) {
    const res = await press('attack', `attack ${i + 1}`);
    if (!res) return;
    if (defeatedIn(res)) break;
    fallen = res.events.find((e) => e.type === 'enemyDefeated') ?? null;
  }
  check(!!fallen && attacker.health === 0 && !mg.enemies.at(attacker.position), `the ${attacker.type} falls: "${await readout()}"`);
  check(!!fallen && !!fallen.loot && (await readout()).includes(`you take ${IT.describeBundle(fallen.loot)}`)
    && (await text('inventory-status')) === G.describeInventory(mg.player.inventory), `its loot is carried: "${await text('inventory-status')}"`);
  check((await buttonsMatch('after the fight')) && !contextOptions(mg).some((o) => o.kind === 'attack'), 'no Attack button once it has fallen');
  await shot(`enemy-defeated-${w}x${h}`);

  // Stand beside the next enemy and wait until you fall.
  const next = mg.enemies.list
    .filter((e) => e.health > 0)
    .map((e) => ({ e, r: planRoute(world, mg.player.position, e.position) }))
    .filter((x) => x.r.status === 'ok')
    .sort((a, b) => a.r.path.length - b.r.path.length)[0];
  if (!next) { fail('no second enemy on foot'); return; }
  console.log(`  waiting beside the ${next.e.type} at ${hexKey(next.e.position)} to be defeated`);
  if (!(await approach(next.e, 'to the next enemy'))) return;
  let fell = null;
  for (let i = 0; i < 60 && !fell; i++) {
    const res = await waitTurn(`wait to fall ${i + 1}`);
    if (!res) return;
    fell = res.events.find((e) => e.type === 'defeated') ?? null;
  }
  check(!!fell, `defeated at turn ${mg.clock.turn}: "${await readout()}"`);
  if (!fell) return;
  check(hexEquals(mg.player.position, world.sanctuary) && (await synced('after defeat')), `you wake at the sanctuary: ${await text('player-status')} · ${await text('health-status')}`);
  check(lastReport(mg)?.outcome === 'defeated' && (await text('inventory-status')) === G.describeInventory(mg.player.inventory), `the pack is lost: "${await text('inventory-status')}"`);
  await shot(`defeat-${w}x${h}`);
  if (!(await verifySanctuary(mg, `defeat-${w}x${h}`))) return;
  check(JSON.stringify(mg.player.inventory) === JSON.stringify(createInventory(STARTING_KIT)), 'after a defeat you set out with the basic kit');
  check(mg.enemies.list.every((e) => e.health <= 0 || (e.mode === 'idle' && hexEquals(e.position, e.home))), 'survivors are home and unaware; the fallen stay fallen');
  check(attacker.health === 0 && !mg.enemies.at(attacker.home), `the ${attacker.type} you defeated is still gone`);
  await waitTurn('wait on the next expedition');
}

/**
 * The sanctuary screen once an expedition has ended (mirror `mg` already
 * finished): the report matches the mirror's, it fits the screen, Escape
 * does not dismiss it, the cheapest affordable upgrade (if any) is learned,
 * and Set out starts the next expedition (no turn passes).
 */
async function verifySanctuary(mg, label) {
  const rep = lastReport(mg);
  const read = () => ev(`(() => {
    const d = document.getElementById('sanctuary-dialog'); const r = d.getBoundingClientRect();
    const t = (id) => document.getElementById(id).textContent;
    return { open: d.open, title: t('report-title'), summary: t('report-summary'), insight: t('report-insight'), balance: t('sanctuary-balance'),
      rows: [...document.querySelectorAll('#report-rows dd')].map(e => e.textContent),
      buttons: [...document.querySelectorAll('#upgrade-list button')].map(b => ({ id: b.dataset.upgrade, text: b.textContent, disabled: b.disabled })),
      setOut: t('set-out'), message: t('sanctuary-message'),
      inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
      sw: document.scrollingElement.scrollWidth <= innerWidth, dw: d.scrollWidth <= d.clientWidth,
      touch: [...d.querySelectorAll('button')].every(b => b.getBoundingClientRect().height >= 44) };
  })()`);
  const wantButtons = () => upgradeView(mg).map((u) => ({ id: u.id, text: X.upgradeRow(u).button, disabled: !u.check.ok }));
  let got = await read();
  check(got.open && got.title === X.reportTitle(rep) && got.summary === X.reportSummary(rep), `${label}: the sanctuary screen opens: "${got.title}" · "${got.summary}"`);
  const rowsWant = X.reportRows(rep).map((r) => r.value);
  check(JSON.stringify(got.rows) === JSON.stringify(rowsWant), `${label}: report rows ${JSON.stringify(got.rows)}${JSON.stringify(got.rows) === JSON.stringify(rowsWant) ? '' : ` want ${JSON.stringify(rowsWant)}`}`);
  check(got.insight === X.describeInsight(rep.insight) && got.balance === X.describeBalance(mg.progress.insight), `${label}: "${got.insight}" · "${got.balance}"`);
  check(JSON.stringify(got.buttons) === JSON.stringify(wantButtons()) && got.setOut === X.setOutText(mg.expedition.number + 1), `${label}: upgrade buttons ${JSON.stringify(got.buttons.map((b) => b.text + (b.disabled ? ' (off)' : '')))} · "${got.setOut}"`);
  check(got.inside && got.sw && got.dw && got.touch, `${label}: fits the screen, touch-sized buttons ${JSON.stringify({ inside: got.inside, sw: got.sw, dw: got.dw, touch: got.touch })}`);
  await s.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await s.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  check((await read()).open, `${label}: Escape does not dismiss it (Set out is the way back)`);
  const afford = upgradeView(mg).filter((u) => u.check.ok).sort((a, b) => a.cost - b.cost)[0];
  if (afford) {
    await clickEl(`#upgrade-list button[data-upgrade="${afford.id}"]`);
    const b = buyUpgrade(mg, afford.id);
    got = await read();
    check(b.ok && got.message === X.describeUpgraded(b.event) && got.balance === X.describeBalance(mg.progress.insight)
      && JSON.stringify(got.buttons) === JSON.stringify(wantButtons()), `${label}: learned ${afford.id}: "${got.message}"`);
    const stillOn = upgradeView(mg).find((u) => u.id === afford.id).check.ok;
    const focused = await ev(`document.activeElement?.dataset?.upgrade ?? document.activeElement?.id`);
    check(focused === (stillOn ? afford.id : 'set-out'), `${label}: focus stays on its button, or moves to Set out once it is disabled (${focused})`);
  } else {
    console.log(`  (no upgrade affordable with ${mg.progress.insight} insight)`);
  }
  await shot(`sanctuary-${label}`);
  const turn = mg.clock.turn;
  await clickEl('#set-out');
  const so = setOut(mg);
  const st = await playerState();
  check(so.ok && !(await ev(`document.getElementById('sanctuary-dialog').open`)), `${label}: Set out closes the screen`);
  check((await readout()) === K.describeEvents(so.events), `${label}: "${await readout()}"`);
  check(st && hexEquals(st.pos, mg.player.position) && st.turn === turn
    && (await text('health-status')) === CT.describeHealth(mg.player.health, mg.player.maxHealth)
    && (await text('inventory-status')) === G.describeInventory(mg.player.inventory),
  `${label}: expedition ${mg.expedition.number} starts at the sanctuary, no turn taken: ${await text('health-status')} · ${await text('inventory-status')}`);
  return so.ok;
}

/**
 * A voluntary return: walk out along a quiet route (one that wakes no enemy)
 * far enough to earn an upgrade, and back onto sanctuary ground, where
 * Return appears; it ends expedition 1 (one turn) and the report keeps the
 * pack, which the next expedition sets out with.
 */
async function verifyReturn(world, w, h, isTouch) {
  await load(`${s.appUrl}?seed=${world.seed}`);
  let cam = initialCamera(world, w, h);
  const tapHex = async (hh) => { const p = hexToScreen(C.cameraToView(cam, w, h), hh); await tap(p.x, p.y, isTouch); };
  const mg = createGame(world);
  const turns = createTurnSystem({ reactions: createCombatReactions() });
  const home = world.sanctuary;
  /** One step by tapping a neighbour, recentred first so it is clear of the HUD. */
  const step = async (to) => {
    await clickEl('#recenter');
    cam = C.centerOnHex(cam, mg.player.position);
    await tapHex(to);
    const res = turns.perform(mg, { type: 'move', to });
    const st = await playerState();
    if (!res.ok || !st || !hexEquals(st.pos, to)) { fail(`step to ${hexKey(to)}: page at ${st ? hexKey(st.pos) : '?'} (${res.reason ?? 'ok'})`); return false; }
    return true;
  };
  // The longest quiet route out (up to 12 hexes), as far as POIs allow.
  const out = hexesInRange(home, 12)
    .filter((x) => hexDistance(x, home) >= 8 && world.has(x) && world.isWalkable(x))
    .map((x) => planRoute(world, home, x))
    .filter((r) => r.status === 'ok' && r.path.length <= 14 && quietPath(world, r.path))
    .sort((a, b) => hexDistance(b.path.at(-1), home) - hexDistance(a.path.at(-1), home) || a.path.length - b.path.length)[0];
  if (!out) { fail('no quiet route out of the sanctuary'); return; }
  const returnShown = async () => (await ev(`[...document.querySelectorAll('#context-actions button')].map(b => b.textContent)`)).some((t) => t.startsWith('Return'));
  check(!(await returnShown()), 'no Return button before setting off');
  for (const to of out.path) if (!(await step(to))) return;
  check(!(await returnShown()), `no Return button off sanctuary ground (${out.path.length} hexes out)`);
  const back = [...out.path].reverse().slice(1);
  for (const to of back) {
    if (!(await step(to))) return;
    if (hexDistance(to, home) === 1) break;
  }
  const options = contextOptions(mg);
  const i = options.findIndex((o) => o.kind === 'return');
  const labels = await ev(`[...document.querySelectorAll('#context-actions button')].map(b => b.getAttribute('aria-label'))`);
  check(i >= 0 && JSON.stringify(labels) === JSON.stringify(options.map((o) => buttonFor(o).label)), `back on sanctuary ground, Return is offered: ${JSON.stringify(labels)}`);
  if (i < 0) return;
  await clickEl(`#context-actions button[data-index="${i}"]`);
  const res = turns.perform(mg, actionFor(options[i]));
  check(res.ok && res.ended?.outcome === 'returned' && (await readout()) === K.describeEvents(res.events), `Return ends the expedition (one turn): "${await readout()}"`);
  const st = await playerState();
  check(st && hexEquals(st.pos, home) && st.turn === mg.clock.turn, `you stand on the sanctuary at turn ${st?.turn}`);
  const kept = JSON.stringify(mg.player.inventory);
  if (!(await verifySanctuary(mg, `return-${w}x${h}`))) return;
  check(JSON.stringify(mg.player.inventory) === kept, 'the pack you returned with is kept');
  await clickEl('#wait-button');
  const wres = turns.perform(mg, { type: 'wait' });
  check(wres.ok && (await playerState()).turn === mg.clock.turn, `expedition 2 is under way: Wait takes a turn (turn ${mg.clock.turn})`);
}

/**
 * The Pack dialog at the sanctuary: it fits the screen, shows the starting
 * kit and stats, refuses what cannot be done (a disabled Drink at full
 * health), and Take off / Equip each take one turn and change the stats.
 */
async function verifyPack(world, w, h, isTouch) {
  await load(`${s.appUrl}?seed=${world.seed}`);
  const mg = createGame(world);
  const turns = createTurnSystem({ reactions: createCombatReactions() });
  const statsWant = () => { const v = inventoryView(mg).stats; return `${CT.describeHealth(v.health, v.maxHealth)} · ${IT.describeStats(v)}`; };
  const rows = () => ev(`[...document.querySelectorAll('#pack-slots .pack-row__name, #pack-list .pack-row__name')].map(e => e.textContent)`);
  const rowsWant = () => {
    const v = inventoryView(mg);
    return [...v.slots.map((x) => IT.describeSlot(x.slot, x.item)), ...v.items.map((e) => `${e.def.name} × ${e.count}`)];
  };
  const agrees = async (label) => {
    const got = { stats: await text('pack-stats'), rows: await rows() };
    const ok = got.stats === statsWant() && JSON.stringify(got.rows) === JSON.stringify(rowsWant());
    if (!ok) fail(`${label}: pack shows ${JSON.stringify(got)}, want ${JSON.stringify({ stats: statsWant(), rows: rowsWant() })}`);
    return ok;
  };
  const turn0 = (await playerState()).turn;

  await clickEl('#pack-button');
  check(await ev("document.getElementById('pack-dialog').open"), 'Pack opens the dialog');
  const fit = await ev(`(() => { const dlg = document.getElementById('pack-dialog'); const d = dlg.getBoundingClientRect(); const bs = [...dlg.querySelectorAll('button')]; return { inside: d.left >= 0 && d.top >= 0 && d.right <= innerWidth && d.bottom <= innerHeight, sw: document.scrollingElement.scrollWidth <= innerWidth, dw: dlg.scrollWidth <= dlg.clientWidth, touch: bs.every(b => b.getBoundingClientRect().height >= 44) }; })()`);
  check(fit.inside && fit.sw && fit.dw && fit.touch, `the pack fits the screen with touch-sized buttons ${JSON.stringify(fit)}`);
  check(await agrees('starting kit'), `starting kit and stats: "${await text('pack-stats')}"`);
  await shot(`pack-${w}x${h}`);

  // Full health: Drink is shown but disabled, and nothing happens.
  const potion = '#pack-list button[data-key="use:healingPotion"]';
  check(await ev(`document.querySelector('${potion}').disabled`), 'at full health the Drink button is disabled');
  await clickEl(potion);
  check((await playerState()).turn === turn0 && (await text('pack-message')) === '', 'pressing it does nothing and takes no turn');

  // Take off the knife: one turn, attack drops to bare hands; the knife is carried.
  await clickEl('#pack-slots button[data-key="unequip:weapon"]');
  let r = turns.perform(mg, { type: 'unequip', slot: 'weapon' });
  check(r.ok && (await text('pack-message')) === K.describeEvents(r.events), `Take off: "${await text('pack-message')}"`);
  check((await agrees('after taking off')) && (await playerState()).turn === mg.clock.turn, `one turn, bare-handed: "${await text('pack-stats')}"`);
  check(!(await ev(`!!document.querySelector('#pack-slots button[data-key="unequip:weapon"]')`)), 'an empty slot has no Take off button');

  // Equip it again.
  await clickEl('#pack-list button[data-key="equip:huntingKnife"]');
  r = turns.perform(mg, { type: 'equip', item: 'huntingKnife' });
  check(r.ok && (await text('pack-message')) === K.describeEvents(r.events) && (await agrees('after equipping')), `Equip: "${await text('pack-message')}"`);
  await clickEl('#pack-close');
  check(!(await ev("document.getElementById('pack-dialog').open")), 'Close shuts the pack');
  check((await playerState()).turn === mg.clock.turn && mg.clock.turn === turn0 + 2, `two item actions took two turns (turn ${mg.clock.turn})`);
  check((await readout()) === K.describeEvents(r.events), `the readout reports the last one: "${await readout()}"`);
  check((await text('inventory-status')) === G.describeInventory(mg.player.inventory), `HUD line: "${await text('inventory-status')}"`);
}

const POI_VERB = (poi) => POI_TYPES[poi.type].verb;
const POI_TYPES_DONE = (poi) => POI_TYPES[poi.type].done;
const POI_REVEAL = (poi) => POI_TYPES[poi.type].revealRadius;

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
    const layout = await ev(`(() => { const r = (q) => document.querySelector(q).getBoundingClientRect(); const t = r('.hud-title'), sb = r('#seed-button'), c = r('#coords-toggle'), m = r('#journal-button'), pk = r('#pack-button'), z = r('#zoom-in'), st = r('.hud-info'), wb = r('#wait-button'); return { overlap: t.right > sb.left, stackClear: z.top >= c.bottom || z.right <= c.left, right: c.right, mapBottom: m.bottom, statusClear: (z.top > st.bottom || z.left > st.right) && st.top >= t.bottom, waitIn: wb.right <= innerWidth && wb.height >= 44 && pk.right <= innerWidth && pk.height >= 44 && pk.bottom <= innerHeight, sw: document.scrollingElement.scrollWidth }; })()`);
    check(!layout.overlap && layout.stackClear && layout.right <= w && layout.sw <= w && layout.mapBottom <= h && layout.statusClear && layout.waitIn, `top bar and view controls fit ${JSON.stringify(layout)}`);

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

    console.log('  -- points of interest');
    await verifyPois(world, w, h, mobile);

    console.log('  -- enemies and combat');
    await verifyEnemies(world, w, h, mobile);

    console.log('  -- pack (inventory and equipment)');
    await verifyPack(world, w, h, mobile);

    console.log('  -- expeditions (return, report, upgrades, setting out)');
    await verifyReturn(world, w, h, mobile);

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
