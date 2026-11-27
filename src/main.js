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
    { createGame, createTurnSystem },
    { planRoute },
    { createTravel },
    { decideTap },
    text,
    clockText,
    { timeOf },
    { createMapPanel },
    { nodeState, gatherOptions },
    gatherText,
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
  ]);

  const canvas = document.getElementById('world-canvas');

  // The seed is kept in the URL (?seed=…) so reloading or sharing the link
  // reopens the same world. Real save data arrives with persistence (Task 13).
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
  // position and inventory), map memory (player persistent state: only
  // known/unknown is saved, Task 13), world changes (gathered nodes), the
  // world clock and the log. `world`, `player` and `memory` are
  // shorthands for the current game's parts, not separate state.
  let game, world, player, memory;
  function useGame(next) {
    game = next;
    ({ world, player, memory } = next);
  }
  useGame(createGame(createWorld(seedFromUrl() ?? randomSeed(), WORLD_RADIUS)));
  writeSeedToUrl(world.seed);

  // Every player action goes through this pipeline: validate, apply, advance
  // the clock, reactions (enemies/environment from Task 09), visibility, log,
  // save (Task 13). Invalid actions cost no turn; nothing happens while idle.
  const turns = createTurnSystem({ reactions: [], onSave: null });

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
  const noteFor = (h) => gatherText.nodeNote(nodeInfo(h));
  // Nodes in reach right now (none while travelling: a tap stops travel first).
  const currentGatherOptions = () => (travel.active ? [] : gatherOptions(game));

  // Events (e.g. a new day part) from the most recent successful action,
  // appended to the readout that describes that action.
  let lastEvents = [];

  /** Perform one action through the turn pipeline. */
  function act(action) {
    const result = turns.perform(game, action);
    lastEvents = result.ok ? result.events : [];
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
      drawGrid(ctx, {
        width, height, view, cells,
        has: world.has,
        tileAt: world.tileAt,
        sanctuary: world.sanctuary,
        ui,
        player: player.position,
        stepRim: travel.active ? [] : hexNeighbors(player.position).filter(world.isWalkable),
        route,
        noWay: ui.noWay,
        fog: memory,
        nodeAt: nodeInfo,
        gatherable: currentGatherOptions().map((o) => o.at),
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

  function refresh() {
    hud.showReadout(readoutText);
    hud.showStatus(text.describePlayer(player));
    hud.showClock(clockText.describeClock(game.clock.turn), timeOf(game.clock.turn).part);
    hud.setWaitEnabled(!travel.active);
    hud.showInventory(gatherText.inventoryEntries(player.inventory));
    hud.showGather(currentGatherOptions().map((o) => ({
      key: `${o.at.q},${o.at.r}`, resource: o.node.resource, ...gatherText.gatherButton(o),
    })));
    surface.requestRepaint();
    mapPanel.refresh();
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
    } else if (e.type === 'stopped' || e.type === 'interrupted') {
      // Keep the rest of the route as a preview: tapping the destination (or
      // the node it leads to) resumes.
      const rest = planRoute(world, player.position, e.destination, { knows: memory.isKnown });
      const target = ui.travelTarget;
      ui.travelTarget = null;
      ui.preview = rest.status === 'ok'
        ? { destination: e.destination, path: rest.path, cost: rest.cost, ...(target ? { target } : {}) }
        : null;
      const resumeLabel = target ? labelOf(target) : label;
      readoutText = e.type === 'stopped'
        ? text.describeStopped(resumeLabel, e.done, e.total)
        : clockText.withEvents(text.describeInterrupted(resumeLabel, e.done, e.total), lastEvents);
    } else if (e.type === 'blocked') {
      ui.preview = null;
      ui.travelTarget = null;
      ui.noWay = e.at;
      ui.selected = e.at;
      readoutText = text.describeBlocked(e.at, e.done);
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
        readoutText = result.ok
          ? clockText.withEvents(text.describeStepped(labelOf(action.to)) + noteFor(action.to), lastEvents)
          : text.describeImpassable(labelOf(action.to));
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
        travelTarget: ui.travelTarget, knows: memory.isKnown, nodeAt: liveNodeAt,
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
      coordsToggle: document.getElementById('coords-toggle'),
      zoomIn: document.getElementById('zoom-in'),
      zoomOut: document.getElementById('zoom-out'),
      recenter: document.getElementById('recenter'),
      clock: document.getElementById('clock-status'),
      wait: document.getElementById('wait-button'),
      inventory: document.getElementById('inventory-status'),
      gather: document.getElementById('gather-actions'),
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
      onGather(index) {
        // Buttons are rebuilt on every refresh, so `index` names a current
        // option; the action is still validated by the turn pipeline.
        const option = currentGatherOptions()[index];
        if (!option) return;
        const result = act({ type: 'gather', at: option.at });
        ui.preview = null;
        ui.noWay = null;
        ui.selected = option.at;
        readoutText = result.ok
          ? clockText.describeEvents(lastEvents)
          : gatherText.describeGatherRefused(result.reason, labelOf(option.at));
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
    },
    {
      onCreate(seed) {
        travel.stop({ silent: true });
        useGame(createGame(createWorld(seed, WORLD_RADIUS)));
        writeSeedToUrl(world.seed);
        worldPanel.showSeed(world.seed);
        Object.assign(ui, { selected: null, hovered: null, preview: null, noWay: null, travelTarget: null });
        readoutText = text.MOVE_HINT;
        refresh();
        updateCamera(camera.centerOnHex(cam, player.position));
      },
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

  worldPanel.showSeed(world.seed);
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
