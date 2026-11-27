import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DIRECTIONS, hex, hexKey, hexEquals, hexAdd, hexSubtract, hexNeighbor, hexNeighbors,
  hexDistance, axialToCube, cubeToAxial, hexRound, hexToPixel, pixelToHex,
  hexCorners, hexesInRange, hexDimensions,
} from '../src/world/hex.js';
import { hash01 } from '../src/core/hash.js';

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('six directions: distinct, unit distance, opposite pairs cancel', () => {
  assert.equal(DIRECTIONS.length, 6);
  assert.deepEqual(
    DIRECTIONS.map((d) => [d.q, d.r]),
    [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]],
  );
  const keys = new Set(DIRECTIONS.map(hexKey));
  assert.equal(keys.size, 6);
  for (let i = 0; i < 6; i++) {
    assert.equal(hexDistance(hex(0, 0), DIRECTIONS[i]), 1);
    const opposite = DIRECTIONS[(i + 3) % 6];
    assert.ok(hexEquals(hexAdd(DIRECTIONS[i], opposite), hex(0, 0)));
  }
});

test('neighbors of an arbitrary hex', () => {
  const h = hex(2, -1);
  assert.deepEqual(
    hexNeighbors(h).map(hexKey),
    ['3,-1', '3,-2', '2,-2', '1,-1', '1,0', '2,0'],
  );
  for (const n of hexNeighbors(h)) assert.equal(hexDistance(h, n), 1);
  assert.ok(hexEquals(hexNeighbor(h, 6), hexNeighbor(h, 0)), 'direction wraps');
  assert.ok(hexEquals(hexNeighbor(h, -1), hexNeighbor(h, 5)), 'negative direction wraps');
});

test('neighbors are geometrically adjacent and evenly spaced', () => {
  const size = 10;
  const c = hexToPixel(hex(0, 0), size);
  const expectedGap = Math.sqrt(3) * size; // centre-to-centre, pointy-top
  for (const n of hexNeighbors(hex(0, 0))) {
    const p = hexToPixel(n, size);
    assert.ok(close(Math.hypot(p.x - c.x, p.y - c.y), expectedGap));
  }
});

test('hex distance: known values, symmetry, triangle inequality', () => {
  assert.equal(hexDistance(hex(0, 0), hex(0, 0)), 0);
  assert.equal(hexDistance(hex(0, 0), hex(3, -1)), 3);
  assert.equal(hexDistance(hex(0, 0), hex(2, 2)), 4);
  assert.equal(hexDistance(hex(-3, 1), hex(2, -4)), 5);
  assert.equal(hexDistance(hex(1, -3), hex(-2, 3)), 6);
  const area = hexesInRange(hex(0, 0), 3);
  for (const a of area) {
    for (const b of area) {
      assert.equal(hexDistance(a, b), hexDistance(b, a));
      assert.ok(hexDistance(a, b) <= hexDistance(a, hex(0, 0)) + hexDistance(hex(0, 0), b));
    }
  }
});

test('hexesInRange returns exactly the hexes within the radius', () => {
  for (const radius of [0, 1, 2, 5]) {
    const center = hex(4, -7);
    const cells = hexesInRange(center, radius);
    assert.equal(cells.length, 1 + 3 * radius * (radius + 1));
    assert.equal(new Set(cells.map(hexKey)).size, cells.length);
    for (const h of cells) assert.ok(hexDistance(center, h) <= radius);
  }
});

test('axial <-> cube conversion round-trips and sums to zero', () => {
  for (const h of hexesInRange(hex(0, 0), 4)) {
    const c = axialToCube(h);
    assert.equal(c.x + c.y + c.z, 0);
    assert.ok(hexEquals(cubeToAxial(c), h));
  }
});

test('add / subtract / key, and -0 normalisation', () => {
  assert.ok(hexEquals(hexSubtract(hexAdd(hex(2, 3), hex(-5, 1)), hex(-5, 1)), hex(2, 3)));
  assert.equal(hexKey(hex(-0, -0)), '0,0');
  assert.equal(hexKey(pixelToHex(0, 0, 10)), '0,0');
  assert.equal(hexKey(hexRound(-0.2, 0.1)), '0,0');
});

test('hexRound keeps q + r + s = 0 and rounds to the nearest hex', () => {
  assert.ok(hexEquals(hexRound(2, -1), hex(2, -1)));
  assert.ok(hexEquals(hexRound(2.1, -0.9), hex(2, -1)));
  assert.ok(hexEquals(hexRound(0.45, 0.45), hex(0, 1)) || hexEquals(hexRound(0.45, 0.45), hex(1, 0)));
  for (let i = 0; i < 500; i++) {
    const h = hexRound(hash01(i) * 20 - 10, hash01(i + 9999) * 20 - 10);
    assert.ok(Number.isInteger(h.q) && Number.isInteger(h.r));
  }
});

test('hexToPixel known values (pointy-top)', () => {
  const s = 10;
  const p10 = hexToPixel(hex(1, 0), s);
  assert.ok(close(p10.x, Math.sqrt(3) * s) && close(p10.y, 0));
  const p01 = hexToPixel(hex(0, 1), s);
  assert.ok(close(p01.x, (Math.sqrt(3) / 2) * s) && close(p01.y, 1.5 * s));
  const pm = hexToPixel(hex(-2, 3), s);
  assert.ok(close(pm.x, Math.sqrt(3) * s * (-2 + 1.5)) && close(pm.y, 4.5 * s));
  const dim = hexDimensions(s);
  assert.ok(close(dim.width, Math.sqrt(3) * s) && dim.height === 2 * s);
});

test('pixelToHex inverts hexToPixel at many sizes', () => {
  for (const size of [3, 10, 24.5, 57]) {
    for (const h of hexesInRange(hex(0, 0), 8)) {
      const p = hexToPixel(h, size);
      assert.ok(hexEquals(pixelToHex(p.x, p.y, size), h), `${hexKey(h)} at size ${size}`);
    }
  }
});

test('pixelToHex picks the hex whose centre is nearest (exhaustive sample)', () => {
  // For a regular hex grid, the cell containing a point is the one with the
  // nearest centre. Brute-force check against 3000 pseudo-random points.
  const size = 17;
  // Points span ±10 sizes; radius 14 covers every hex they can fall in.
  const candidates = hexesInRange(hex(0, 0), 14);
  for (let i = 0; i < 3000; i++) {
    const x = (hash01(i * 2) - 0.5) * size * 20;
    const y = (hash01(i * 2 + 1) - 0.5) * size * 20;
    let best = null;
    let bestD = Infinity;
    for (const c of candidates) {
      const p = hexToPixel(c, size);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) { bestD = d; best = c; }
    }
    const got = pixelToHex(x, y, size);
    if (!hexEquals(got, best)) {
      // Only acceptable on an exact boundary (equidistant centres).
      const pg = hexToPixel(got, size);
      assert.ok(close(Math.hypot(pg.x - x, pg.y - y), bestD, 1e-6), `point ${x},${y}: got ${hexKey(got)} expected ${hexKey(best)}`);
    }
  }
});

test('points just inside each edge and corner stay in the hex', () => {
  const size = 20;
  for (const h of [hex(0, 0), hex(3, -2), hex(-4, 1)]) {
    const c = hexToPixel(h, size);
    for (const corner of hexCorners(c.x, c.y, size)) {
      const x = c.x + (corner.x - c.x) * 0.97;
      const y = c.y + (corner.y - c.y) * 0.97;
      assert.ok(hexEquals(pixelToHex(x, y, size), h));
    }
    // Just inside the flat-side midpoints, at 0.97 of the inner radius.
    const inner = (Math.sqrt(3) / 2) * size * 0.97;
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i);
      assert.ok(hexEquals(pixelToHex(c.x + inner * Math.cos(a), c.y + inner * Math.sin(a), size), h));
    }
  }
});

test('hex corners: pointy-top, on the circumradius, shared with neighbours', () => {
  const size = 12;
  const corners = hexCorners(0, 0, size);
  assert.equal(corners.length, 6);
  // Pointy-top: one corner straight up (y = -size) and one straight down.
  assert.ok(corners.some((p) => close(p.x, 0) && close(p.y, -size)));
  assert.ok(corners.some((p) => close(p.x, 0) && close(p.y, size)));
  for (let i = 0; i < 6; i++) {
    const p = corners[i];
    const q = corners[(i + 1) % 6];
    assert.ok(close(Math.hypot(p.x, p.y), size));
    assert.ok(close(Math.hypot(p.x - q.x, p.y - q.y), size));
  }
  // Each neighbour shares exactly two corners with the centre hex.
  for (const n of hexNeighbors(hex(0, 0))) {
    const c = hexToPixel(n, size);
    const shared = hexCorners(c.x, c.y, size).filter((a) => corners.some((b) => close(a.x, b.x, 1e-6) && close(a.y, b.y, 1e-6)));
    assert.equal(shared.length, 2);
  }
});
