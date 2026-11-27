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

async function boot() {
  const [
    { attachCanvasSurface },
    camera,
    { screenToHex, visibleHexes },
    { drawGrid },
    { createWorld },
    { normalizeSeed, randomSeed },
    { TERRAIN },
    { hexEquals },
    { attachPointerInput },
    { createHud },
    { createWorldPanel },
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

  let world = createWorld(seedFromUrl() ?? randomSeed(), WORLD_RADIUS);
  writeSeedToUrl(world.seed);

  // UI/view state only: nothing here is game/world state and none is saved.
  const ui = { hovered: null, selected: null, showCoords: false };
  let cam = null; // created once the canvas has a size

  const surface = attachCanvasSurface(
    canvas,
    (ctx, width, height) => {
      const view = camera.cameraToView(cam, width, height);
      const cells = visibleHexes(view, width, height, world.has);
      drawGrid(ctx, {
        width, height, view, cells,
        has: world.has,
        tileAt: world.tileAt,
        sanctuary: world.sanctuary,
        ui,
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
    world.sanctuary,
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

  function showSelection() {
    const tile = ui.selected ? world.tileAt(ui.selected) : null;
    hud.showSelection(ui.selected, tile ? TERRAIN[tile.terrain] : null, world.sanctuary);
  }

  const hud = createHud(
    {
      readout: document.getElementById('selection-readout'),
      coordsToggle: document.getElementById('coords-toggle'),
      zoomIn: document.getElementById('zoom-in'),
      zoomOut: document.getElementById('zoom-out'),
      recenter: document.getElementById('recenter'),
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
        updateCamera(camera.centerOnHex(cam, ui.selected ?? world.sanctuary));
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
        world = createWorld(seed, WORLD_RADIUS);
        writeSeedToUrl(world.seed);
        worldPanel.showSeed(world.seed);
        ui.selected = null;
        ui.hovered = null;
        showSelection();
        updateCamera(camera.centerOnHex(cam, world.sanctuary));
      },
    },
  );

  worldPanel.showSeed(world.seed);
  showSelection();
  hud.showZoom(cam);

  attachPointerInput(canvas, {
    onHover(point) {
      lastPointer = point;
      const changed = setHovered(point ? hexAt(point) : null);
      canvas.style.cursor = ui.hovered ? 'pointer' : 'grab';
      if (changed) surface.requestRepaint();
    },
    onTap(point) {
      const h = hexAt(point);
      // Tapping the selected hex again, or empty space, clears the selection.
      ui.selected = h && !(ui.selected && hexEquals(h, ui.selected)) ? h : null;
      showSelection();
      surface.requestRepaint();
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
