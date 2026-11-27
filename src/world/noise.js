/**
 * Seeded 2D gradient noise and fractal sums.
 *
 * Lattice gradients come from a stateless coordinate hash, so a sample at
 * (x, y) depends only on the seed and (x, y), never on sampling order.
 * That is what lets terrain be generated per tile, per chunk, or lazily.
 */
import { hashInts } from '../core/rng.js';

// 16 evenly spaced unit gradients.
const GRADS = Array.from({ length: 16 }, (_, i) => {
  const a = (i / 16) * Math.PI * 2;
  return [Math.cos(a), Math.sin(a)];
});

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** @returns {(x: number, y: number) => number} noise in roughly [-1, 1] */
export function createNoise2D(seed) {
  function corner(ix, iy, dx, dy) {
    const g = GRADS[hashInts(seed, ix, iy) & 15];
    return g[0] * dx + g[1] * dy;
  }
  return function noise(x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const u = fade(fx);
    const v = fade(fy);
    const n00 = corner(x0, y0, fx, fy);
    const n10 = corner(x0 + 1, y0, fx - 1, fy);
    const n01 = corner(x0, y0 + 1, fx, fy - 1);
    const n11 = corner(x0 + 1, y0 + 1, fx - 1, fy - 1);
    const a = n00 + (n10 - n00) * u;
    const b = n01 + (n11 - n01) * u;
    // Max |value| of 2D gradient noise is 1/sqrt(2); rescale to ~[-1, 1].
    return (a + (b - a) * v) * Math.SQRT2;
  };
}

/**
 * Fractal Brownian motion: summed octaves, normalised to roughly [-1, 1].
 * Each octave is offset so octaves don't share lattice points at the origin.
 */
export function fbm(noise, x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq + i * 17.31, y * freq - i * 9.77);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}
