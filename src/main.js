/**
 * Everwake entry point.
 * The error reporter is installed first and everything else is loaded
 * dynamically, so a failure in any later module is shown on screen.
 */
import { installErrorReporter } from './core/errorReporter.js';

const report = installErrorReporter({
  panel: document.getElementById('error-panel'),
  list: document.getElementById('error-list'),
  dismiss: document.getElementById('error-dismiss'),
});

// Bounded prototype map (1 + 3*R*(R+1) = 4921 hexes); see world.js for chunking.
const WORLD_RADIUS = 40;
// Largest hex size in the Map overview (a small explored area is not blown up).
const MAP_MAX_HEX = 16;

async function boot() {
  const [
    { attachCanvasSurface },
    camera,
    { hexToScreen, screenToHex, visibleHexes, fitView },
    { drawGrid },
    { createWorld },
    { normalizeSeed, randomSeed },
    { TERRAIN },
    { hexEquals, hexNeighbors },
    { attachPointerInput },
    { createHud, describeSelection, coordText },
    { createWorldPanel },
    { createGame, createTurnSystem, setOut },
    { planRoute },
    { createTravel },
    { decideTap },
    text,
    clockText,
    { timeOf },
    { createMapPanel },
    { nodeState },
    gatherText,
    { poiState },
    poiText,
    { createJournalPanel },
    { enemyIntent },
    enemyText,
    { ENEMY_TYPES },
    combat,
    combatText,
    { createSanctuaryPanel },
    contextActions,
    { inventoryView },
    itemText,
    { createInventoryPanel },
    { buyUpgrade, upgradeView },
    { lastReport },
    expeditionText,
    { parseSave, gameSummary },
    saveSlot,
    saveText,
    savePanels,
    strideText,
    { planningCost },
  ] = await Promise.all([
    import('./render/canvasSurface.js'),
    import('./render/camera.js'),
    import('./render/gridView.js'),
    import('./render/gridRenderer.js'),
    import('./world/world.js'),
    import('./world/seed.js'),
    import('./data/terrain.js'),
    import('./world/hex.js'),
    import('./ui/pointerInput.js'),
    import('./ui/hud.js'),
    import('./ui/worldPanel.js'),
    import('./core/game.js'),
    import('./systems/movement.js'),
    import('./systems/travel.js'),
    import('./ui/moveIntent.js'),
    import('./ui/travelText.js'),
    import('./ui/clockText.js'),
    import('./core/clock.js'),
    import('./ui/mapPanel.js'),
    import('./systems/gathering.js'),
    import('./ui/gatherText.js'),
    import('./systems/pois.js'),
    import('./ui/poiText.js'),
    import('./ui/journalPanel.js'),
    import('./systems/enemies.js'),
    import('./ui/enemyText.js'),
    import('./data/enemies.js'),
    import('./systems/combat.js'),
    import('./ui/combatText.js'),
    import('./ui/sanctuaryPanel.js'),
    import('./ui/contextActions.js'),
    import('./systems/items.js'),
    import('./ui/itemText.js'),
    import('./ui/inventoryPanel.js'),
    import('./systems/progression.js'),
    import('./systems/expedition.js'),
    import('./ui/expeditionText.js'),
    import('./systems/persistence.js'),
    import('./systems/saveSlot.js'),
    import('./ui/saveText.js'),
    import('./ui/savePanels.js'),
    import('./ui/strideText.js'),
    import('./systems/stride.js'),
  ]);

  const canvas = document.getElementById('world-canvas');

  // Debug only (G01): `?debug=walked` draws faint footprints on walked ground.
  const debugWalked = new URLSearchParams(window.location.search).getAll('debug').includes('walked');

  // The seed is also kept in the URL (?seed=…) so the link can be shared.
  // The save (Task 13) is what a reload restores; a link naming another
  // world is offered on the start screen as a new world.
  function seedFromUrl() {
    const raw = new URLSearchParams(window.location.search).get('seed');
    if (raw === null) return null;
    const result = normalizeSeed(raw);
    return result.ok ? result.seed : null;
  }
  function writeSeedToUrl(seed) {
    const url = new URL(window.location.href);
    url.searchParams.set('seed', seed);
    window.history.replaceState(null, '', url);
  }

  // Game state (core/game.js): the world, the player (expedition state:
  // position and inventory; replaced when an expedition sets out), map memory (player persistent state: only
  // known/unknown is saved), world changes (gathered nodes, used
  // POIs), the journal (discoveries), the world clock, the log, the
  // expedition under way and permanent progress (insight, upgrades, reports). `world`, `player` and `memory` are
  // shorthands for the current game's parts, not separate state.
  let game, world, player, memory;
  function useGame(next) {
    game = next;
    ({ world, player, memory } = next);
  }
  // Saving (Task 13, systems/saveSlot.js): the saved world is loaded if it
  // can be. A damaged save is held (`damaged`) and never written over until
  // the player chooses on the recovery screen; meanwhile a throwaway world
  // sits behind it and nothing is saved. Without usable storage the game
  // runs unsaved and says so.
  const urlSeed = seedFromUrl();
  const opened = saveSlot.openStorage();
  const storage = opened.ok ? opened.storage : null;
  const slot = storage ? saveSlot.readSave(storage, { radius: WORLD_RADIUS }) : { status: 'unavailable', error: opened.error };
  /** @type {{ raw: string, error: string } | null} */
  let damaged = slot.status === 'damaged' ? { raw: slot.raw, error: slot.error } : null;
  /** What the save status line says (ui/saveText.js describeSaveStatus). */
  let saveStatus = { state: 'none' };
  if (slot.status === 'unavailable') saveStatus = { state: 'unavailable', error: slot.error };
  else if (damaged) saveStatus = { state: 'held' };
  else if (slot.status === 'ok') {
    const t = timeOf(slot.game.clock.turn);
    saveStatus = { state: 'saved', turn: slot.game.clock.turn, day: t.day, part: t.part };
  }
  useGame(slot.status === 'ok' ? slot.game : createGame(createWorld(urlSeed ?? randomSeed(), WORLD_RADIUS)));
  writeSeedToUrl(world.seed);

  /** Save the game now (after every turn, setting out, an upgrade, a new world or an import). */
  function autosave() {
    if (!storage) return;
    if (damaged) { saveStatus = { state: 'held' }; return; }
    const r = saveSlot.writeSave(storage, game);
    const t = timeOf(game.clock.turn);
    saveStatus = r.ok ? { state: 'saved', turn: game.clock.turn, day: t.day, part: t.part } : { state: 'failed', error: r.error };
    if (!r.ok) console.warn(`Everwake: ${r.error}`);
  }

  // Every player action goes through this pipeline: validate, apply, advance
  // the clock, reactions (enemies, systems/enemies.js), visibility, log,
  // expedition tally, save. Invalid actions cost no turn and are not saved;
  // nothing happens while idle.
  // Reactions: the enemies (with real blows), then the player's condition
  // (defeat at 0 health, recovery on sanctuary ground): systems/combat.js.
  const turns = createTurnSystem({ reactions: combat.createCombatReactions(), onSave: () => autosave() });

  // UI/view state only: nothing here is game/world state and none is saved.
  // `preview` is a planned route awaiting confirmation; `noWay` marks a hex
  // that cannot be reached; `selected` is the hex the readout talks about;
  // `travelTarget` is the node a route is walking next to, if any.
  const ui = { hovered: null, selected: null, showCoords: false, preview: null, noWay: null, travelTarget: null };
  let readoutText = text.MOVE_HINT;
  let cam = null; // created once the canvas has a size

  const terrainOf = (h) => {
    const t = world.tileAt(h);
    return t ? TERRAIN[t.terrain] : null;
  };
  const labelOf = (h) => text.placeLabel(h, terrainOf(h), world.sanctuary);

  // Resource nodes as the player knows them: only on mapped hexes.
  const nodeInfo = (h) => (h && memory.isKnown(h) ? nodeState(game, h) : null);
  const liveNodeAt = (h) => { const s = nodeInfo(h); return s && s.left > 0 ? s : null; };
  // Points of interest likewise: a mapped POI is a discovered one.
  const poiInfo = (h) => (h && memory.isKnown(h) ? poiState(game, h) : null);
  // Enemies are mobile: known only while their hex is in sight.
  const enemyInfo = (h) => (h && memory.isVisible(h) ? game.enemies.at(h) : null);
  const enemyNoteFor = (h) => { const e = enemyInfo(h); return e ? enemyText.enemyNote(e, enemyIntent(game, e)) : ''; };
  const noteFor = (h) => gatherText.nodeNote(nodeInfo(h)) + poiText.poiNote(poiInfo(h)) + enemyNoteFor(h);
  /** Enemies in sight, as the renderer draws them. */
  const visibleEnemies = () => game.enemies.list
    .filter((e) => e.health > 0 && memory.isVisible(e.position))
    .map((e) => ({ position: e.position, type: e.type, health: e.health, maxHealth: ENEMY_TYPES[e.type].health, intent: enemyIntent(game, e) }));
  // What can be done right here (ui/contextActions.js): combat, consumables,
  // POIs, then resource nodes in reach; nothing while travelling.
  const contextOptions = () => contextActions.contextOptions(game, { travelling: travel.active });
  const { buttonFor, actionFor } = contextActions;

  // Events (e.g. a new day part) from the most recent successful action,
  // appended to the readout that describes that action.
  let lastEvents = [];
  // An expedition ended (return or defeat) by the most recent action,
  // handled on the next refresh.
  let pendingEnd = null;

  /** Perform one action through the turn pipeline. */
  function act(action) {
    const result = turns.perform(game, action);
    lastEvents = result.ok ? result.events : [];
    if (result.ok && result.ended) pendingEnd = result.ended;
    return result;
  }

  // Each travel step is its own move action, and so its own turn.
  const travel = createTravel({
    step: (to) => act({ type: 'move', to }),
    onEvent: onTravelEvent,
  });

  const surface = attachCanvasSurface(
    canvas,
    (ctx, width, height) => {
      const view = camera.cameraToView(cam, width, height);
      const cells = visibleHexes(view, width, height, world.has);
      let route = null;
      if (travel.active) route = { path: travel.remaining, mode: 'travel' };
      else if (ui.preview) route = { path: ui.preview.path, mode: 'preview' };
      const options = contextOptions();
      drawGrid(ctx, {
        width, height, view, cells,
        has: world.has,
        tileAt: world.tileAt,
        sanctuary: world.sanctuary,
        ui,
        player: player.position,
        stepRim: travel.active ? [] : hexNeighbors(player.position).filter((h) => world.isWalkable(h) && !enemyInfo(h)),
        route,
        noWay: ui.noWay,
        fog: memory,
        nodeAt: nodeInfo,
        poiAt: poiInfo,
        gatherable: options.filter((x) => x.kind === 'gather').map((x) => x.o.at),
        usable: options.filter((x) => x.kind === 'interact').map((x) => x.o.at),
        enemies: visibleEnemies(),
        walked: debugWalked ? memory.isWalked : null,
      });
    },
    report,
  );

  const size0 = surface.getSize();
  cam = camera.centerOnHex(
    camera.createCamera({
      zoom: camera.initialZoom(size0.width, size0.height),
      bounds: camera.gridWorldBounds(WORLD_RADIUS),
    }),
    player.position,
  );

  /** The world hex under a canvas point, or null if outside the map. */
  function hexAt(point) {
    const { width, height } = surface.getSize();
    const h = screenToHex(camera.cameraToView(cam, width, height), point.x, point.y);
    return world.has(h) ? h : null;
  }

  let lastPointer = null; // for refreshing hover after button zoom

  function setHovered(h) {
    const same = h === ui.hovered || (h && ui.hovered && hexEquals(h, ui.hovered));
    if (same) return false;
    ui.hovered = h;
    return true;
  }

  function updateCamera(next) {
    cam = next;
    hud.showZoom(cam);
    // The world moved under a stationary mouse: keep hover truthful.
    if (lastPointer) setHovered(hexAt(lastPointer));
    surface.requestRepaint();
  }

  /** Camera follow: recentre when the player nears the edge of the view. */
  function followPlayer() {
    const { width, height } = surface.getSize();
    const view = camera.cameraToView(cam, width, height);
    const c = hexToScreen(view, player.position);
    const mx = Math.min(width * 0.4, Math.max(view.size * 2, width * 0.18));
    const my = Math.min(height * 0.4, Math.max(view.size * 2, height * 0.18));
    if (c.x < mx || c.x > width - mx || c.y < my || c.y > height - my) {
      updateCamera(camera.centerOnHex(cam, player.position));
    }
  }

  /**
   * An expedition has ended (systems/expedition.js): the player is already
   * at the sanctuary. Drop any route, say what happened, look at the
   * sanctuary and open the sanctuary screen with the report.
   */
  function showEnded() {
    travel.stop({ silent: true });
    Object.assign(ui, { preview: null, travelTarget: null, selected: null, noWay: null });
    if (inventoryPanel.isOpen) inventoryPanel.close();
    readoutText = clockText.describeEvents(lastEvents);
    updateCamera(camera.centerOnHex(cam, player.position));
    sanctuaryPanel.show();
  }

  function refresh() {
    if (pendingEnd) {
      pendingEnd = null;
      showEnded();
    }
    // Between expeditions the sanctuary screen is always up (after a reload,
    // or once a dialog over it closes).
    if (game.expedition.status === 'ended' && !document.querySelector('dialog[open]')) sanctuaryPanel.show();
    hud.showReadout(readoutText);
    hud.showSaveWarning(saveText.hudSaveWarning(saveStatus));
    worldPanel.showSaveStatus(saveText.describeSaveStatus(saveStatus));
    hud.showStatus(text.describePlayer(player));
    hud.showHealth(combatText.describeHealth(player.health, player.maxHealth), player.health, player.maxHealth);
    hud.showClock(clockText.describeClock(game.clock.turn), timeOf(game.clock.turn).part);
    hud.setWaitEnabled(!travel.active && game.expedition.status === 'active');
    hud.showInventory(itemText.inventoryEntries(player.inventory));
    hud.showActions(contextOptions().map(buttonFor));
    hud.showStride(strideText.describeStride(game.deck));
    hud.showHand(strideText.handButtons(game.deck.hand()), game.expedition.status === 'active');
    surface.requestRepaint();
    mapPanel.refresh();
    journalPanel.refresh();
    inventoryPanel.refresh();
  }

  function onTravelEvent(e) {
    const label = labelOf(e.destination);
    if (e.type === 'step') {
      readoutText = clockText.withEvents(text.describeTravelling(label, e.done, e.total), lastEvents);
    } else if (e.type === 'arrived') {
      // Walking next to a node: keep it selected and say it is in reach.
      const target = ui.travelTarget;
      ui.travelTarget = null;
      ui.selected = target;
      readoutText = clockText.withEvents(text.describeArrived(label, e.total) + noteFor(target ?? e.destination), lastEvents);
    } else if (e.type === 'stopped' || e.type === 'interrupted' || e.type === 'needStride') {
      // Keep the rest of the route as a preview: tapping the destination (or
      // the node it leads to) resumes.
      const rest = planRoute(world, player.position, e.destination, { knows: memory.isKnown, avoid: enemyInfo, stepCost: planningCost(game) });
      const target = ui.travelTarget;
      ui.travelTarget = null;
      ui.preview = rest.status === 'ok'
        ? { destination: e.destination, path: rest.path, cost: rest.cost, ...(target ? { target } : {}) }
        : null;
      const resumeLabel = target ? labelOf(target) : label;
      if (e.type === 'stopped') readoutText = text.describeStopped(resumeLabel, e.done, e.total);
      else if (e.type === 'needStride') readoutText = strideText.describeNeedStride(resumeLabel, e.done, e.total, e.cost, e.pool);
      else readoutText = clockText.withEvents(text.describeInterrupted(resumeLabel, e.done, e.total), lastEvents);
    } else if (e.type === 'blocked') {
      ui.preview = null;
      ui.travelTarget = null;
      ui.noWay = e.at;
      ui.selected = e.at;
      const blocker = e.reason === 'occupied' ? game.enemies.at(e.at) : null;
      readoutText = blocker ? enemyText.describeRouteBlockedBy(e.at, blocker, e.done) : text.describeBlocked(e.at, e.done);
    }
    if (e.type !== 'stopped') followPlayer();
    refresh();
  }

  function applyTapAction(action) {
    ui.noWay = null;
    switch (action.kind) {
      case 'clear':
        ui.preview = null;
        ui.selected = null;
        readoutText = text.MOVE_HINT;
        break;
      case 'here':
        ui.preview = null;
        ui.selected = player.position;
        readoutText = `${describeSelection(player.position, terrainOf(player.position), world.sanctuary)} · you are here${noteFor(player.position)}`;
        break;
      case 'step': {
        ui.preview = null;
        ui.selected = null;
        const result = act({ type: 'move', to: action.to });
        if (result.ok) readoutText = clockText.withEvents(text.describeStepped(labelOf(action.to)) + noteFor(action.to), lastEvents);
        else if (result.reason === 'occupied') readoutText = enemyText.describeOccupied(labelOf(action.to), game.enemies.at(action.to));
        else if (result.reason === 'noStride') readoutText = strideText.describeNoStride(labelOf(action.to), result.cost, result.pool);
        else readoutText = text.describeImpassable(labelOf(action.to));
        if (result.ok) followPlayer();
        break;
      }
      case 'preview': {
        const p = action.preview;
        ui.preview = p;
        ui.selected = p.destination;
        readoutText = text.describePreview(labelOf(p.destination), p.path.length, p.cost) + noteFor(p.destination);
        break;
      }
      case 'approach': {
        const p = action.preview;
        ui.preview = p;
        ui.selected = p.target;
        readoutText = gatherText.describeApproach(labelOf(p.target), nodeInfo(p.target), p.path.length, p.cost);
        break;
      }
      case 'node':
        ui.preview = null;
        ui.selected = action.at;
        readoutText = gatherText.describeInReach(labelOf(action.at), nodeInfo(action.at));
        break;
      case 'blocked':
        ui.preview = null;
        ui.selected = action.at;
        ui.noWay = action.at;
        readoutText = gatherText.describeNodeBlocked(labelOf(action.at), nodeInfo(action.at));
        break;
      case 'travel':
        ui.preview = null;
        ui.selected = action.preview.target ?? action.preview.destination;
        ui.travelTarget = action.preview.target ?? null;
        if (action.preview.path.length === 0) {
          // Already next to the node (the approach hex is where you stand).
          ui.travelTarget = null;
          readoutText = gatherText.describeInReach(labelOf(action.preview.target), nodeInfo(action.preview.target));
          break;
        }
        travel.start(action.preview.path); // first step now; onTravelEvent updates the readout
        break;
      case 'unexplored':
        ui.preview = null;
        ui.selected = action.at;
        readoutText = text.describeUnexplored(action.at);
        break;
      case 'enemy': {
        // Inspect only (no turn): fighting is done with the Attack button.
        const foe = enemyInfo(action.at);
        ui.preview = null;
        ui.selected = action.at;
        readoutText = enemyText.describeEnemyHex(labelOf(action.at), foe, enemyIntent(game, foe));
        break;
      }
      case 'impassable':
      case 'unreachable':
        ui.preview = null;
        ui.selected = action.at;
        ui.noWay = action.at;
        readoutText = (action.kind === 'impassable'
          ? text.describeImpassable(labelOf(action.at))
          : text.describeUnreachable(labelOf(action.at))) + noteFor(action.at);
        break;
    }
  }

  function handleTap(h) {
    const { stop, action } = decideTap(
      world,
      {
        position: player.position, preview: ui.preview, travelling: travel.destination,
        travelTarget: ui.travelTarget, knows: memory.isKnown, nodeAt: liveNodeAt, enemyAt: enemyInfo,
        stepCost: planningCost(game),
      },
      h,
    );
    if (stop) travel.stop();
    if (action) applyTapAction(action);
    refresh();
  }

  const hud = createHud(
    {
      readout: document.getElementById('selection-readout'),
      status: document.getElementById('player-status'),
      saveWarning: document.getElementById('save-warning'),
      coordsToggle: document.getElementById('coords-toggle'),
      zoomIn: document.getElementById('zoom-in'),
      zoomOut: document.getElementById('zoom-out'),
      recenter: document.getElementById('recenter'),
      clock: document.getElementById('clock-status'),
      wait: document.getElementById('wait-button'),
      inventory: document.getElementById('inventory-status'),
      health: document.getElementById('health-status'),
      actions: document.getElementById('context-actions'),
      stride: document.getElementById('stride-status'),
      hand: document.getElementById('hand'),
    },
    {
      onToggleCoords(on) {
        ui.showCoords = on;
        surface.requestRepaint();
      },
      onZoomStep(factor) {
        const { width, height } = surface.getSize();
        updateCamera(camera.zoomAt(cam, factor, width / 2, height / 2, width, height));
      },
      onRecenter() {
        updateCamera(camera.centerOnHex(cam, player.position));
      },
      onWait() {
        if (travel.active) return; // the button is disabled while travelling
        const result = act({ type: 'wait' });
        if (result.ok) {
          ui.noWay = null;
          readoutText = clockText.withEvents(clockText.WAITED, lastEvents);
        }
        refresh();
      },
      onPlayCard(index) {
        // Not a turn (G03): the deck changes, nothing else. A Scout card's
        // sight is applied at once by the pipeline's observe step.
        const result = act({ type: 'playCard', index });
        readoutText = result.ok ? clockText.describeEvents(lastEvents) : strideText.describeCardRefused(result.reason);
        refresh();
      },
      onAction(index) {
        // Buttons are rebuilt on every refresh, so `index` names a current
        // option; the action is still validated by the turn pipeline.
        const option = contextOptions()[index];
        if (!option) return;
        const { kind, o } = option;
        const result = act(actionFor(option));
        ui.preview = null;
        ui.noWay = null;
        ui.selected = o.at ?? null;
        if (result.ok) readoutText = clockText.describeEvents(lastEvents);
        else if (result.reason === 'noStride') readoutText = strideText.describeNoStride(labelOf(o.at ?? player.position), result.cost, result.pool);
        else if (kind === 'gather') readoutText = gatherText.describeGatherRefused(result.reason, labelOf(o.at));
        else if (kind === 'interact') readoutText = poiText.describeInteractRefused(result.reason, labelOf(o.at));
        else if (kind === 'return') readoutText = expeditionText.describeReturnRefused(result.reason);
        else readoutText = combatText.describeCombatRefused(kind, result.reason, o.at && kind === 'attack' ? labelOf(o.at) : '');
        if (result.ok && kind === 'flee') followPlayer();
        refresh();
      },
    },
  );

  const worldPanel = createWorldPanel(
    {
      button: document.getElementById('seed-button'),
      buttonText: document.getElementById('seed-text'),
      dialog: document.getElementById('world-dialog'),
      form: document.getElementById('world-form'),
      current: document.getElementById('world-current-seed'),
      input: document.getElementById('seed-input'),
      error: document.getElementById('seed-error'),
      random: document.getElementById('seed-random'),
      cancel: document.getElementById('seed-cancel'),
      saveStatus: document.getElementById('save-status'),
      saveMessage: document.getElementById('save-message'),
      exportSave: document.getElementById('save-export'),
      importSave: document.getElementById('save-import'),
    },
    {
      onCreate: (seed) => { requestNewWorld(seed); },
      onExport: () => exportSave(),
      onImport: (show) => pickImport(show),
    },
  );
  document.getElementById('world-dialog').addEventListener('close', () => refresh());

  // ---------------------------------------------------------------- saving and loading (Task 13)

  /** Give the browser a file to save. */
  function download(name, content) {
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  /** Download the current world's save; returns what to show. */
  function exportSave() {
    if (damaged) return 'There is no world to export yet: download the damaged save instead.';
    const name = saveSlot.exportFileName(game, timeOf(game.clock.turn).day);
    download(name, saveSlot.exportText(game));
    return `Save exported as ${name}.`;
  }

  /** What the current save holds, for the confirmations (null while the save is damaged). */
  const currentSummary = () => (damaged ? null : gameSummary(game));

  /**
   * Make way for a new game in the slot: a damaged save is kept as a backup
   * first (if that fails, the player is asked whether to go on without one).
   * Resolves true when it is safe to replace.
   */
  async function clearDamaged() {
    if (!damaged) return true;
    const kept = storage ? saveSlot.setAsideDamaged(storage, damaged.raw) : { ok: false, error: 'browser storage is unavailable' };
    if (!kept.ok && !(await confirmPanel.ask(saveText.confirmNoBackup(kept.error)))) return false;
    damaged = null;
    recoveryPanel.close();
    return true;
  }

  /** Put `next` in play (a new world or an imported save), save it, and show it. */
  function adopt(next, readout) {
    travel.stop({ silent: true });
    useGame(next);
    writeSeedToUrl(world.seed);
    worldPanel.showSeed(world.seed);
    Object.assign(ui, { selected: null, hovered: null, preview: null, noWay: null, travelTarget: null });
    pendingEnd = null;
    lastEvents = [];
    sanctuaryPanel.close();
    startPanel.close();
    autosave();
    readoutText = readout;
    updateCamera(camera.centerOnHex(cam, player.position));
    refresh(); // between expeditions this opens the sanctuary screen
  }

  /** The seed dialog chose `seed`: confirm, then replace the world. */
  async function requestNewWorld(seed) {
    const ok = await confirmPanel.ask(
      saveText.confirmReplace({ current: currentSummary(), damaged: !!damaged, seed }),
      { offerExport: !damaged },
    );
    if (!ok || !(await clearDamaged())) { refresh(); return; }
    adopt(createGame(createWorld(seed, WORLD_RADIUS)), text.MOVE_HINT);
  }

  // Import: one hidden file input, shared by every panel that offers it.
  const importInput = document.getElementById('import-file');
  let onPicked = null;
  importInput.addEventListener('change', () => {
    const file = importInput.files?.[0] ?? null;
    importInput.value = '';
    const cb = onPicked;
    onPicked = null;
    if (file && cb) cb(file);
  });

  /** Pick a save file, check it, confirm, and load it. Problems are shown through `show`. */
  function pickImport(show) {
    show('');
    onPicked = async (file) => {
      if (file.size > saveText.MAX_IMPORT_BYTES) { show(saveText.describeImportError('the file is far too large to be a save')); return; }
      let content;
      try {
        content = await file.text();
      } catch (err) {
        show(saveText.describeImportError(`the file could not be read (${err?.message ?? err})`));
        return;
      }
      const r = parseSave(content, { radius: WORLD_RADIUS });
      if (!r.ok) { show(saveText.describeImportError(r.error)); return; }
      const incoming = gameSummary(r.game);
      const ok = await confirmPanel.ask(
        saveText.confirmImport({ current: currentSummary(), damaged: !!damaged, incoming }),
        { offerExport: !damaged },
      );
      if (!ok || !(await clearDamaged())) { refresh(); return; }
      adopt(r.game, saveText.describeImported(incoming));
      worldPanel.close();
    };
    importInput.click();
  }

  const confirmPanel = savePanels.createConfirmPanel(
    {
      dialog: document.getElementById('confirm-dialog'),
      title: document.getElementById('confirm-title'),
      lines: document.getElementById('confirm-lines'),
      confirm: document.getElementById('confirm-ok'),
      cancel: document.getElementById('confirm-cancel'),
      exportFirst: document.getElementById('confirm-export'),
      message: document.getElementById('confirm-message'),
    },
    { onExport: () => exportSave() },
  );

  const startPanel = savePanels.createStartPanel(
    {
      dialog: document.getElementById('start-dialog'),
      summary: document.getElementById('start-summary'),
      detail: document.getElementById('start-detail'),
      link: document.getElementById('start-link'),
      message: document.getElementById('start-message'),
      cont: document.getElementById('start-continue'),
      newWorld: document.getElementById('start-new'),
      importSave: document.getElementById('start-import'),
    },
    {
      onContinue() {
        readoutText = saveText.describeContinued(gameSummary(game));
        refresh(); // between expeditions this opens the sanctuary screen
      },
      onNewWorld: () => worldPanel.open(urlSeed && urlSeed !== world.seed ? urlSeed : null),
      onImport: (show) => pickImport(show),
    },
  );

  const recoveryPanel = savePanels.createRecoveryPanel(
    {
      dialog: document.getElementById('recovery-dialog'),
      reason: document.getElementById('recovery-reason'),
      message: document.getElementById('recovery-message'),
      download: document.getElementById('recovery-download'),
      retry: document.getElementById('recovery-retry'),
      importSave: document.getElementById('recovery-import'),
      newWorld: document.getElementById('recovery-new'),
    },
    {
      onDownload() {
        download('everwake-damaged-save.json', damaged.raw);
        return 'Damaged save downloaded as everwake-damaged-save.json.';
      },
      onRetry: () => window.location.reload(),
      onImport: (show) => pickImport(show),
      onNewWorld: () => worldPanel.open(urlSeed),
    },
  );

  // Map overview: the same renderer, fitted to everything mapped so far.
  const mapPanel = createMapPanel(
    {
      button: document.getElementById('map-button'),
      dialog: document.getElementById('map-dialog'),
      canvas: document.getElementById('map-canvas'),
      summary: document.getElementById('map-summary'),
    },
    {
      draw(ctx, width, height) {
        const view = fitView(memory.knownHexes(), width, height, { maxSize: MAP_MAX_HEX });
        drawGrid(ctx, {
          width, height, view,
          cells: visibleHexes(view, width, height, memory.isKnown, 0),
          has: world.has,
          tileAt: world.tileAt,
          sanctuary: world.sanctuary,
          ui: { hovered: null, selected: null, showCoords: false },
          player: player.position,
          fog: memory,
          nodeAt: nodeInfo,
          poiAt: poiInfo,
          walked: debugWalked ? memory.isWalked : null,
        });
        return view;
      },
      summary: () => `${text.describeExplored(memory.knownCount, memory.totalCount)} · you are at ${coordText(player.position)}`,
      isPickable: (h) => memory.isKnown(h),
      // Travel would carry on behind the modal map: stop it (one tap resumes).
      onOpen: () => travel.stop(),
      onPick(h) {
        ui.preview = null;
        ui.noWay = null;
        ui.selected = h;
        readoutText = describeSelection(h, terrainOf(h), world.sanctuary) + noteFor(h);
        refresh();
        updateCamera(camera.centerOnHex(cam, h));
      },
    },
    report,
  );

  // Sanctuary screen: the report of the expedition that just ended, insight
  // and upgrades, and Set out (the only way back to the map).
  const sanctuaryPanel = createSanctuaryPanel(
    {
      dialog: document.getElementById('sanctuary-dialog'),
      title: document.getElementById('report-title'),
      summary: document.getElementById('report-summary'),
      rows: document.getElementById('report-rows'),
      insight: document.getElementById('report-insight'),
      balance: document.getElementById('sanctuary-balance'),
      upgrades: document.getElementById('upgrade-list'),
      message: document.getElementById('sanctuary-message'),
      setOut: document.getElementById('set-out'),
    },
    {
      view: () => ({
        report: lastReport(game), insight: game.progress.insight, upgrades: upgradeView(game), next: game.expedition.number + 1,
      }),
      onBuy(id) {
        const r = buyUpgrade(game, id);
        if (r.ok) autosave();
        const shown = r.ok ? expeditionText.describeUpgraded(r.event) : expeditionText.describeBuyRefused(r.reason, r.cost ?? null);
        return shown;
      },
      onSetOut() {
        const r = setOut(game);
        if (!r.ok) return;
        useGame(game); // a new expedition has a new player
        autosave();
        sanctuaryPanel.close();
        readoutText = clockText.describeEvents(r.events);
        refresh();
        updateCamera(camera.centerOnHex(cam, player.position));
      },
    },
  );

  // Journal: places discovered and what came of them; tap one to look there.

  const journalPanel = createJournalPanel(
    {
      button: document.getElementById('journal-button'),
      dialog: document.getElementById('journal-dialog'),
      list: document.getElementById('journal-list'),
      summary: document.getElementById('journal-summary'),
    },
    {
      entries: () => game.journal.entries,
      // As with the map, travel would carry on behind the modal: stop it.
      onOpen: () => travel.stop(),
      onPick(h) {
        ui.preview = null;
        ui.noWay = null;
        ui.selected = h;
        readoutText = describeSelection(h, terrainOf(h), world.sanctuary) + noteFor(h);
        refresh();
        updateCamera(camera.centerOnHex(cam, h));
      },
    },
  );

  // Pack: what is carried and worn. Every button is one action through the
  // pipeline (a turn, then the enemies); the dialog stays open and shows the outcome.
  const inventoryPanel = createInventoryPanel(
    {
      button: document.getElementById('pack-button'),
      dialog: document.getElementById('pack-dialog'),
      stats: document.getElementById('pack-stats'),
      slots: document.getElementById('pack-slots'),
      list: document.getElementById('pack-list'),
      message: document.getElementById('pack-message'),
    },
    {
      view: () => inventoryView(game),
      // As with the map, travel would carry on behind the modal: stop it.
      onOpen: () => travel.stop(),
      onAction(action) {
        const result = act(action);
        ui.noWay = null;
        readoutText = result.ok ? clockText.describeEvents(lastEvents) : itemText.describeItemRefused(action.type, result.reason);
        const shown = readoutText;
        refresh(); // a defeat closes the dialog and rewrites the readout
        return shown;
      },
    },
  );

  document.getElementById('sanctuary-world').addEventListener('click', () => worldPanel.open());

  worldPanel.showSeed(world.seed);
  // What the page opens on: the recovery screen for a damaged save, the
  // start screen for a saved world, or straight into a new world (saved now).
  if (damaged) {
    recoveryPanel.show(saveText.recoveryReason(damaged.error));
  } else if (slot.status === 'ok') {
    const sum = gameSummary(game);
    const when = slot.savedAt ? new Date(slot.savedAt) : null;
    const savedText = when && !Number.isNaN(when.getTime()) ? ` · saved ${when.toLocaleString()}` : '';
    startPanel.show({
      summary: saveText.describeSummary(sum),
      detail: saveText.describeProgress(sum) + savedText,
      link: urlSeed && urlSeed !== world.seed ? saveText.linkNote(urlSeed) : '',
    });
  } else {
    autosave();
  }
  refresh();
  hud.showZoom(cam);

  // Escape stops travel, or clears a planned route.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    handleTap(null);
  });

  attachPointerInput(canvas, {
    onHover(point) {
      lastPointer = point;
      const changed = setHovered(point ? hexAt(point) : null);
      canvas.style.cursor = ui.hovered ? 'pointer' : 'grab';
      if (changed) surface.requestRepaint();
    },
    onTap(point) {
      handleTap(hexAt(point));
    },
    onPan(dx, dy) {
      updateCamera(camera.panBy(cam, dx, dy));
    },
    onZoom(factor, x, y) {
      const { width, height } = surface.getSize();
      updateCamera(camera.zoomAt(cam, factor, x, y, width, height));
    },
    onDragChange(dragging) {
      if (dragging) lastPointer = null;
      canvas.style.cursor = dragging ? 'grabbing' : 'grab';
    },
  });
}

boot().catch((err) => report(err, 'Startup failed'));
