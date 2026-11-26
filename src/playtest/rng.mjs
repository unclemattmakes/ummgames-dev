// @ts-check
/**
 * The playtest's own random numbers: mulberry32, the same generator as `runtime/sim/rng.ts`, so a
 * cast and a day draw the same numbers as a game's sim would for the same seed. Kept here because
 * linked code cannot import the runtime's TypeScript.
 */

/** @typedef {() => number} RngFn */

/**
 * @param {number} seed
 * @returns {RngFn} draws in [0, 1)
 */
export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * `lo` plus a draw scaled to `hi - lo`: in [lo, hi).
 * @param {RngFn} r
 * @param {number} lo
 * @param {number} hi
 */
export const range = (r, lo, hi) => lo + (hi - lo) * r()

/**
 * A draw inside a `[lo, hi]` pair.
 * @param {RngFn} r
 * @param {readonly [number, number]} pair
 */
export const within = (r, [lo, hi]) => range(r, lo, hi)
