/**
 * Seeded random numbers for a deterministic sim. A sim draws only from here, never from the
 * engine's own random source or a clock, so a seed and the inputs replay a run exactly on any
 * machine. (The file never names those, even in a comment: games' guard tests grep for them.)
 *
 * Two styles over the same generator, mulberry32, whose whole state is one 32-bit number:
 * - `Rng`, a class: `rng.next()`, `rng.range(lo, hi)`, `rng.pick(list)` and the rest.
 * - `mulberry32(seed)`, a bare function `() => number` (an `RngFn`), with free helpers
 *   `range(rng, lo, hi)`, `pick(rng, items)` and `pickWeighted(rng, items)`.
 * For the same seed both give the same draws. Plus stateless hashes: `hash3` (ints to [0, 1)),
 * `hashSeed` (numbers to a seed) and `seedFromString` (text to a seed).
 *
 * It is all integer arithmetic and one exact division, the same in every engine, and it calls no
 * engine trig, so a sim that bans `Math.sin` and the like can copy it. A random direction, which
 * needs trig, is `unitOnSphere` in `sphere.ts` beside it.
 */

/** A draw in [0, 1): what `mulberry32` returns. */
export type RngFn = () => number

/** mulberry32's step: the state moves by this each draw. */
const STEP = 0x6d2b79f5

/** The 32-bit fractional part of the golden ratio: `zeroSeed` for an `Rng` that must not start at 0. */
export const GOLDEN_SEED = 0x9e3779b9

/** mulberry32: a small, fast, seedable generator. Returns floats in [0, 1). */
export function mulberry32(seed: number): RngFn {
  let a = seed >>> 0
  return () => {
    a = (a + STEP) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** `lo` plus a draw scaled to `hi - lo`: in [lo, hi). */
export const range = (rng: RngFn, lo: number, hi: number): number => lo + (hi - lo) * rng()

/** One of `items`, uniformly. Throws on an empty list (or an `undefined` item), after drawing. */
export const pick = <T>(rng: RngFn, items: readonly T[]): T => {
  const item = items[Math.floor(rng() * items.length)]
  if (item === undefined) throw new Error('pick from an empty list')
  return item
}

/**
 * One of `items`, by weight: `[item, weight]` pairs whose weights need not sum to one. One draw.
 * The first item whose running total reaches the draw wins; the last is the fallback. Throws on an
 * empty list.
 */
export function pickWeighted<T>(rng: RngFn, items: readonly (readonly [T, number])[]): T {
  let total = 0
  for (const [, w] of items) total += w
  let r = rng() * total
  for (const [item, w] of items) {
    r -= w
    if (r <= 0) return item
  }
  const last = items[items.length - 1]
  if (last === undefined) throw new Error('pickWeighted from an empty list')
  return last[0]
}

/** Integer hash of up to three ints and a seed, to [0, 1). Stateless. Each argument is read with `| 0`. */
export function hash3(a: number, b: number, c: number, seed: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0
  h = Math.imul(h ^ (a | 0), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13) ^ (b | 0), 0xc2b2ae35)
  h = Math.imul(h ^ (h >>> 16) ^ (c | 0), 0x27d4eb2f)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

/** Mixes numbers into one 32-bit seed: FNV-1a over the four low bytes of each, floored. */
export function hashSeed(...parts: number[]): number {
  let h = 0x811c9dc5
  for (const p of parts) {
    let v = Math.floor(p) | 0
    for (let i = 0; i < 4; i++) {
      h ^= v & 0xff
      h = Math.imul(h, 0x01000193)
      v >>>= 8
    }
  }
  return h >>> 0
}

/** A seed from free text (a `?seed=`, a date for a daily run): FNV-1a over its UTF-16 code units. */
export function seedFromString(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** `seedFromString` by its other name. */
export const seedFromText = seedFromString

export interface RngOptions {
  /**
   * The state a seed of 0 (after `>>> 0`) starts from. Default 0, which mulberry32 handles like
   * any other seed. Pass `GOLDEN_SEED` to keep a sim that always swapped 0 out.
   */
  zeroSeed?: number
  /**
   * What `pick` does when its draw lands on `undefined` (an empty list, or an `undefined` item):
   * `'throw'` (the default), or `'undefined'`, returning it typed as the item, for a sim that has
   * always carried on. Either way the draw is taken first.
   */
  emptyPick?: 'throw' | 'undefined'
}

/** mulberry32 as an object, with the helpers a sim reaches for. */
export class Rng {
  private s: number
  private readonly looseEmpty: boolean

  constructor(seed: number, options: RngOptions = {}) {
    this.s = seed >>> 0 || (options.zeroSeed ?? 0) >>> 0
    this.looseEmpty = options.emptyPick === 'undefined'
  }

  /** The whole generator, so a save or a snapshot carries on exactly where it stopped. */
  get state(): number {
    return this.s
  }

  set state(v: number) {
    this.s = v >>> 0
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.s = (this.s + STEP) >>> 0
    let t = this.s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** In [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next()
  }

  /**
   * An integer. `int(n)` is 0 to n - 1: `Math.floor(next() * n)`. `int(lo, hi)` is lo to hi, both
   * included. One draw either way.
   */
  int(n: number): number
  int(lo: number, hi: number): number
  int(a: number, b?: number): number {
    if (b === undefined) return Math.floor(this.next() * a)
    return a + Math.floor(this.next() * (b - a + 1))
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    return this.next() < p
  }

  /** One of `list`, uniformly. On an empty list (or a draw landing on `undefined`), see `RngOptions.emptyPick`. */
  pick<T>(list: readonly T[]): T {
    const v = list[Math.floor(this.next() * list.length)]
    if (v === undefined && !this.looseEmpty) throw new Error('pick from an empty list')
    return v as T
  }

  /** An index picked by weight; negative weights count as 0. -1, with no draw, when every weight is 0. */
  weighted(weights: readonly number[]): number {
    let total = 0
    for (const w of weights) total += Math.max(0, w)
    if (total <= 0) return -1
    let r = this.next() * total
    for (let i = 0; i < weights.length; i++) {
      r -= Math.max(0, weights[i] ?? 0)
      if (r < 0) return i
    }
    return weights.length - 1
  }

  /** Shuffles `list` in place (Fisher-Yates, from the end) and returns it. */
  shuffle<T>(list: T[]): T[] {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      const t = list[i] as T
      list[i] = list[j] as T
      list[j] = t
    }
    return list
  }
}
