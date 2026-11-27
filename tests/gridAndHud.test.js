import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHexGrid } from '../src/world/hexGrid.js';
import { hex } from '../src/world/hex.js';
import { describeSelection } from '../src/ui/hud.js';
import { eventToCanvasPoint, wheelZoomFactor, pinchStep } from '../src/ui/pointerInput.js';
import { tilePaletteIndex, TERRAIN_PALETTE, SHADES } from '../src/render/terrainStyle.js';
import { TERRAIN, TERRAIN_IDS } from '../src/data/terrain.js';

test('hex grid membership', () => {
  const grid = createHexGrid(2);
  assert.equal(grid.cells.length, 19);
  assert.ok(grid.has(hex(0, 0)));
  assert.ok(grid.has(hex(2, -2)));
  assert.ok(grid.has(hex(-1, -1)));
  assert.ok(!grid.has(hex(2, 1)));
  assert.ok(!grid.has(hex(3, 0)));
  assert.ok(!grid.has(null));
  assert.ok(!grid.has({ q: 0.5, r: 0 }));
  assert.throws(() => createHexGrid(-1), RangeError);
  assert.throws(() => createHexGrid(1.5), RangeError);
});

test('selection readout text', () => {
  const sanctuary = hex(1, -1);
  assert.match(describeSelection(null), /inspect/i);
  assert.equal(describeSelection(hex(2, -3)), 'Hex · q 2, r −3');
  assert.equal(describeSelection(hex(1, -1), TERRAIN.grassland, sanctuary), 'Sanctuary (grassland) · q 1, r −1 · safe start');
  assert.equal(describeSelection(hex(2, -1), TERRAIN.forest, sanctuary), 'Forest · q 2, r −1 · move cost 2 · 1 hex from sanctuary');
  assert.equal(describeSelection(hex(-2, 3), TERRAIN.mountains, sanctuary), 'Mountains · q −2, r 3 · impassable · 4 hexes from sanctuary');
});

test('pointer events map to canvas-local CSS pixels', () => {
  assert.deepEqual(eventToCanvasPoint({ clientX: 150, clientY: 80 }, { left: 50, top: 30 }), { x: 100, y: 50 });
});

test('wheel: scroll down zooms out, up zooms in, modes normalised, clamped', () => {
  assert.ok(wheelZoomFactor({ deltaY: 100, deltaMode: 0, ctrlKey: false }) < 1);
  assert.ok(wheelZoomFactor({ deltaY: -100, deltaMode: 0, ctrlKey: false }) > 1);
  const px = wheelZoomFactor({ deltaY: 48, deltaMode: 0, ctrlKey: false });
  const lines = wheelZoomFactor({ deltaY: 3, deltaMode: 1, ctrlKey: false });
  assert.ok(Math.abs(px - lines) < 1e-12, '3 lines == 48px');
  assert.equal(wheelZoomFactor({ deltaY: 1e6, deltaMode: 0, ctrlKey: false }), 0.5);
  assert.equal(wheelZoomFactor({ deltaY: -1e6, deltaMode: 0, ctrlKey: false }), 2);
  assert.equal(wheelZoomFactor({ deltaY: 0, deltaMode: 0, ctrlKey: false }), 1);
  // Trackpad pinch (ctrl+wheel) is more sensitive per unit delta.
  assert.ok(wheelZoomFactor({ deltaY: -10, deltaMode: 0, ctrlKey: true }) > wheelZoomFactor({ deltaY: -10, deltaMode: 0, ctrlKey: false }));
});

test('pinch: spread zooms in about the midpoint; moving both fingers pans', () => {
  const spread = pinchStep({ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 50, y: 100 }, { x: 250, y: 100 });
  assert.equal(spread.factor, 2);
  assert.equal(spread.midX, 150);
  assert.equal(spread.dx, 0);
  const slide = pinchStep({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 7 }, { x: 15, y: 7 });
  assert.equal(slide.factor, 1);
  assert.deepEqual([slide.dx, slide.dy], [5, 7]);
  const degenerate = pinchStep({ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }, { x: 9, y: 1 });
  assert.equal(degenerate.factor, 1);
});

test('tile colour bucket is deterministic, matches its terrain, and uses relief', () => {
  const perTerrain = SHADES.length;
  assert.equal(TERRAIN_PALETTE.length, TERRAIN_IDS.length * perTerrain);
  for (const terrain of TERRAIN_IDS) {
    const shades = new Set();
    for (let q = -10; q <= 10; q++) {
      for (let e = 0; e <= 1; e += 0.05) {
        const tile = { q, r: 3, terrain, elevation: e };
        const i = tilePaletteIndex(tile);
        assert.equal(i, tilePaletteIndex({ ...tile }));
        assert.equal(Math.floor(i / perTerrain), TERRAIN_IDS.indexOf(terrain), 'bucket belongs to its terrain');
        shades.add(i % perTerrain);
      }
    }
    assert.equal(shades.size, perTerrain, `${terrain} uses every shade`);
  }
  // Higher ground is never darker than lower ground at the same hex.
  const low = tilePaletteIndex({ q: 0, r: 0, terrain: 'hills', elevation: 0.2 });
  const high = tilePaletteIndex({ q: 0, r: 0, terrain: 'hills', elevation: 0.9 });
  assert.ok(high >= low);
});
