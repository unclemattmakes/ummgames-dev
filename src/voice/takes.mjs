// @ts-check
/**
 * The record-and-ship loop every game's voice tool repeats: a key for each take, so a recast or a
 * reworded line is made again; the best of a few seeds by the transcript; and the shipped pieces
 * packed into one bin a speaker with a cues list, the format `runtime/audio/voice.ts` plays.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A short, stable key for a take: the first 16 hex digits of the SHA-256 of `parts` as JSON. Put
 * in everything that changes the take (the voice, the model, the settings, the words said, the
 * seed), and a take whose key no longer matches is stale.
 * @param {unknown[]} parts
 */
export function takeKey(...parts) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16)
}

/**
 * Takes a line with each seed in turn until one is clean, and returns the best: the fewest
 * misses, the earliest seed on a tie. `take(seed)` makes the take and returns anything (a file
 * path, a transcript); `judge(made, seed)` says how many words it got wrong. Every take is made
 * in order, one at a time; run lines side by side with `inPool`.
 * @template T
 * @param {readonly number[]} seeds
 * @param {(seed: number) => Promise<T>} take
 * @param {(made: T, seed: number) => number | Promise<number>} judge
 * @returns {Promise<{ seed: number, made: T, miss: number, tried: { seed: number, made: T, miss: number }[] }>}
 */
export async function bestTake(seeds, take, judge) {
  if (seeds.length === 0) throw new Error('bestTake needs at least one seed')
  /** @type {{ seed: number, made: T, miss: number }[]} */
  const tried = []
  for (const seed of seeds) {
    const made = await take(seed)
    const miss = await judge(made, seed)
    tried.push({ seed, made, miss })
    if (miss === 0) break
  }
  const best = tried.reduce((a, b) => (b.miss < a.miss ? b : a))
  return { ...best, tried }
}

/**
 * Packs shipped pieces one bin a speaker. Each piece names its `bin` and its `key` (how the game
 * finds the line) and carries its `bytes`; anything else on it (its length in ticks, where its
 * words end) is kept on its cue. Returns each bin's bytes and each key's cue: `{ bin, o, n, ...rest }`,
 * `o` and `n` being the piece's offset and length in its bin. With `bin: false` a cue leaves the
 * bin out, for cues that name each speaker's bin once elsewhere. Pieces go in the order given. A
 * key given twice throws.
 * @template {Record<string, unknown>} R
 * @param {Iterable<{ bin: string, key: string, bytes: Uint8Array } & R>} pieces
 * @param {{ bin?: boolean }} [options]
 * @returns {{ bins: Record<string, Buffer>, cues: Record<string, any> }}
 */
export function packBins(pieces, { bin: withBin = true } = {}) {
  /** @type {Record<string, Uint8Array[]>} */
  const parts = {}
  /** @type {Record<string, number>} */
  const sizes = {}
  /** @type {Record<string, any>} */
  const cues = {}
  for (const { bin, key, bytes, ...rest } of pieces) {
    if (key in cues) throw new Error(`packBins: the key ${key} is given twice`)
    const o = sizes[bin] ?? 0
    const list = parts[bin] ?? []
    list.push(bytes)
    parts[bin] = list
    sizes[bin] = o + bytes.length
    cues[key] = withBin ? { bin, o, n: bytes.length, ...rest } : { o, n: bytes.length, ...rest }
  }
  /** @type {Record<string, Buffer>} */
  const bins = {}
  for (const [bin, list] of Object.entries(parts)) bins[bin] = Buffer.concat(list)
  return { bins, cues }
}

/**
 * Writes packed bins into `dir`, made if missing. With `clear`, every other `.bin` in `dir` goes
 * first, so a speaker dropped from the cast leaves no stale bin to ship. Returns the files written.
 * @param {string} dir
 * @param {Record<string, Uint8Array>} bins
 * @param {{ clear?: boolean }} [options]
 */
export function writeBins(dir, bins, { clear = false } = {}) {
  mkdirSync(dir, { recursive: true })
  if (clear)
    for (const f of readdirSync(dir))
      if (f.endsWith('.bin') && !(f in bins)) rmSync(join(dir, f), { force: true })
  const written = []
  for (const [bin, bytes] of Object.entries(bins)) {
    const file = join(dir, bin)
    writeFileSync(file, bytes)
    written.push(file)
  }
  return written
}
