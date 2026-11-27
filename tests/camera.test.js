import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_HEX_SIZE, createCamera, clampCamera, cameraToView, screenToWorld, worldToScreen,
  panBy, zoomAt, centerOn, centerOnHex, gridWorldBounds, initialZoom,
} from '../src/render/camera.js';
import { hex, hexToPixel } from '../src/world/hex.js';

const W = 1000;
const H = 700;
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('defaults and validation', () => {
  const cam = createCamera();
  assert.equal(cam.x, 0);
  assert.equal(cam.y, 0);
  assert.equal(cam.zoom, 1);
  assert.throws(() => createCamera({ minZoom: 0 }), RangeError);
  assert.throws(() => createCamera({ minZoom: 2, maxZoom: 1 }), RangeError);
});

test('view: world origin at viewport centre, size scales with zoom', () => {
  const v = cameraToView(createCamera({ zoom: 2 }), W, H);
  assert.equal(v.originX, W / 2);
  assert.equal(v.originY, H / 2);
  assert.equal(v.size, BASE_HEX_SIZE * 2);
});

test('screen <-> world round trip', () => {
  const cam = createCamera({ x: 123.4, y: -56.7, zoom: 1.6 });
  for (const [sx, sy] of [[0, 0], [W, H], [317, 42.5]]) {
    const w = screenToWorld(cam, W, H, sx, sy);
    const s = worldToScreen(cam, W, H, w.x, w.y);
    assert.ok(near(s.x, sx) && near(s.y, sy));
  }
});

test('view agrees with worldToScreen for hex centres', () => {
  const cam = createCamera({ x: -80, y: 33, zoom: 0.7 });
  const v = cameraToView(cam, W, H);
  const h = hex(4, -9);
  const world = hexToPixel(h, BASE_HEX_SIZE);
  const viaCam = worldToScreen(cam, W, H, world.x, world.y);
  const viaView = hexToPixel(h, v.size);
  assert.ok(near(v.originX + viaView.x, viaCam.x, 1e-6));
  assert.ok(near(v.originY + viaView.y, viaCam.y, 1e-6));
});

test('panning moves content with the drag', () => {
  const cam = createCamera({ zoom: 1.5 });
  const before = worldToScreen(cam, W, H, 10, 20);
  const after = worldToScreen(panBy(cam, 30, -12), W, H, 10, 20);
  assert.ok(near(after.x - before.x, 30) && near(after.y - before.y, -12));
});

test('zoom keeps the point under the cursor fixed', () => {
  const cam = createCamera({ x: 40, y: -10, zoom: 1 });
  const anchor = screenToWorld(cam, W, H, 250, 600);
  const z = zoomAt(cam, 1.8, 250, 600, W, H);
  assert.ok(near(z.zoom, 1.8));
  const s = worldToScreen(z, W, H, anchor.x, anchor.y);
  assert.ok(near(s.x, 250, 1e-6) && near(s.y, 600, 1e-6));
});

test('zoom is clamped to bounds and anchor still holds at the limit', () => {
  const cam = createCamera({ minZoom: 0.5, maxZoom: 2 });
  const zin = zoomAt(cam, 100, 100, 100, W, H);
  assert.equal(zin.zoom, 2);
  const anchor = screenToWorld(cam, W, H, 100, 100);
  const s = worldToScreen(zin, W, H, anchor.x, anchor.y);
  assert.ok(near(s.x, 100, 1e-6) && near(s.y, 100, 1e-6));
  assert.equal(zoomAt(cam, 0.001, 0, 0, W, H).zoom, 0.5);
  assert.equal(zoomAt(cam, NaN, 0, 0, W, H), cam);
  assert.equal(zoomAt(cam, -2, 0, 0, W, H), cam);
  assert.equal(createCamera({ zoom: 99, maxZoom: 3 }).zoom, 3);
});

test('camera centre is clamped to world bounds', () => {
  const bounds = gridWorldBounds(10);
  const cam = createCamera({ bounds });
  const far = panBy(cam, -1e6, -1e6);
  assert.equal(far.x, bounds.maxX);
  assert.equal(far.y, bounds.maxY);
  const other = centerOn(cam, -1e6, 1e6);
  assert.equal(other.x, bounds.minX);
  assert.equal(other.y, bounds.maxY);
  // Outermost hexes are reachable as the screen centre.
  for (const h of [hex(10, 0), hex(-10, 0), hex(0, 10), hex(0, -10), hex(10, -10), hex(-10, 10)]) {
    const p = hexToPixel(h, BASE_HEX_SIZE);
    const c = centerOnHex(cam, h);
    assert.ok(near(c.x, p.x, 1e-6) && near(c.y, p.y, 1e-6), `${h.q},${h.r}`);
  }
  assert.deepEqual(clampCamera({ ...cam, x: 5, y: 5 }), { ...cam, x: 5, y: 5 });
});

test('initial zoom fits roughly 11 hexes across the short side, within bounds', () => {
  const z = initialZoom(390, 844);
  assert.ok(z >= 0.4 && z <= 2.5);
  const across = 390 / (Math.sqrt(3) * BASE_HEX_SIZE * z);
  assert.ok(near(across, 11, 1e-6));
  assert.equal(initialZoom(10, 10), 0.4);
  assert.equal(initialZoom(1e5, 1e5), 2.5);
});
