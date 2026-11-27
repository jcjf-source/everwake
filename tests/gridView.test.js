import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hexToScreen, screenToHex, visibleHexes } from '../src/render/gridView.js';
import {
  createCamera, cameraToView, panBy, zoomAt, centerOnHex, gridWorldBounds,
} from '../src/render/camera.js';
import { createHexGrid } from '../src/world/hexGrid.js';
import { hex, hexCorners, hexEquals, hexKey, hexesInRange } from '../src/world/hex.js';
import { hash01 } from '../src/core/hash.js';

const VIEWPORTS = [[1920, 1080], [1280, 720], [390, 844], [844, 390], [320, 568]];
const RADIUS = 40;
const grid = createHexGrid(RADIUS);

/** A few camera states per viewport: default, panned, zoomed in/out. */
function cameras(w, h) {
  const base = createCamera({ bounds: gridWorldBounds(RADIUS) });
  return {
    default: base,
    panned: panBy(base, -437, 211),
    zoomedIn: zoomAt(base, 2.3, w * 0.3, h * 0.7, w, h),
    zoomedOut: zoomAt(panBy(base, 900, -500), 0.3, w * 0.8, h * 0.2, w, h),
  };
}

const overlapsViewport = (view, h, w, ht) =>
  hexCorners(hexToScreen(view, h).x, hexToScreen(view, h).y, view.size)
    .some((p) => p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= ht) ||
  (() => { const c = hexToScreen(view, h); return c.x >= 0 && c.x <= w && c.y >= 0 && c.y <= ht; })();

for (const [w, h] of VIEWPORTS) {
  for (const [name, cam] of Object.entries(cameras(w, h))) {
    test(`hit-testing matches rendering: ${w}x${h}, ${name} camera`, () => {
      const view = cameraToView(cam, w, h);
      const inner = (Math.sqrt(3) / 2) * view.size;
      const cells = visibleHexes(view, w, h, grid.has, 0);
      assert.ok(cells.length > 0);
      let i = 0;
      for (const cell of cells.filter((_, k) => k % 7 === 0)) {
        const c = hexToScreen(view, cell);
        assert.ok(hexEquals(screenToHex(view, c.x, c.y), cell));
        for (let k = 0; k < 4; k++, i++) {
          const a = hash01(i) * Math.PI * 2;
          const rr = hash01(i + 777) * inner * 0.95;
          const got = screenToHex(view, c.x + rr * Math.cos(a), c.y + rr * Math.sin(a));
          assert.ok(hexEquals(got, cell), `${hexKey(cell)} -> ${hexKey(got)}`);
        }
      }
    });

    test(`culling includes every on-screen hex and little else: ${w}x${h}, ${name}`, () => {
      const view = cameraToView(cam, w, h);
      const visible = new Set(visibleHexes(view, w, h, grid.has, 0).map(hexKey));
      let onScreen = 0;
      for (const cell of grid.cells) {
        if (overlapsViewport(view, cell, w, h)) {
          onScreen++;
          assert.ok(visible.has(hexKey(cell)), `missing ${hexKey(cell)}`);
        }
      }
      // Allow a ring of extra hexes around the edges, not the whole grid.
      const perimeterHexes = 2 * (w + h) / (Math.sqrt(3) * view.size * 0.5) + 16;
      assert.ok(visible.size <= onScreen + perimeterHexes, `${visible.size} visible vs ${onScreen} on screen`);
    });
  }
}

test('culling work scales with the viewport, not the grid', () => {
  const huge = { has: () => true }; // an unbounded grid
  const view = cameraToView(createCamera({ zoom: 1 }), 1280, 720);
  const n = visibleHexes(view, 1280, 720, huge.has).length;
  assert.ok(n > 300 && n < 1200, `got ${n}`);
});

test('visibleHexes filters with include()', () => {
  const small = createHexGrid(2);
  const view = cameraToView(createCamera({ zoom: 1 }), 1920, 1080);
  const got = visibleHexes(view, 1920, 1080, small.has).map(hexKey).sort();
  assert.deepEqual(got, hexesInRange(hex(0, 0), 2).map(hexKey).sort());
});

test('centring on a hex puts it at the viewport centre', () => {
  const cam = centerOnHex(createCamera({ zoom: 1.7 }), hex(7, -3));
  const c = hexToScreen(cameraToView(cam, 800, 600), hex(7, -3));
  assert.ok(Math.abs(c.x - 400) < 1e-9 && Math.abs(c.y - 300) < 1e-9);
});
