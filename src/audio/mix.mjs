// @ts-check
/**
 * A mix bus for a game's own tools: filters, a sidechain duck, a look-ahead true-peak limiter, a
 * master to a loudness under a ceiling, a phone speaker's render and a 24-bit WAV. Audio is one
 * Float32Array per channel, in plain arrays with no Web Audio, so it runs in Node and in tests.
 *
 * The filters are RBJ biquads. The limiter's detector is the meter's own true-peak interpolator,
 * so what the limiter holds is what `measure` reads.
 */
import { measure, oversampling, TRUE_PEAK_TAPS } from './meter.mjs'

/** @typedef {import('./meter.mjs').Biquad} Biquad */

/** @param {number} db @returns {number} */
export const dbToGain = (db) => 10 ** (db / 20)

/**
 * @param {Float32Array[]} chans
 * @param {number} db
 * @returns {Float32Array[]}
 */
export function gain(chans, db) {
  const g = dbToGain(db)
  return chans.map((c) => c.map((v) => v * g))
}

/**
 * One biquad, direct form I, over a channel.
 * @param {Float32Array} x
 * @param {Biquad} f
 * @returns {Float32Array}
 */
export function biquad(x, f) {
  const y = new Float32Array(x.length)
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < x.length; i++) {
    const xi = /** @type {number} */ (x[i])
    const v = f.b0 * xi + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2
    x2 = x1
    x1 = xi
    y2 = y1
    y1 = v
    y[i] = v
  }
  return y
}

/**
 * An RBJ high- or lowpass at `hz`.
 * @param {'high' | 'low'} kind
 * @param {number} hz
 * @param {{ q?: number, sampleRate?: number }} [o]
 * @returns {Biquad}
 */
export function pass(kind, hz, { q = Math.SQRT1_2, sampleRate = 48000 } = {}) {
  const w = (2 * Math.PI * hz) / sampleRate
  const cw = Math.cos(w)
  const al = Math.sin(w) / (2 * q)
  const a0 = 1 + al
  const edge = (kind === 'high' ? 1 + cw : 1 - cw) / 2
  return {
    b0: edge / a0,
    b1: ((kind === 'high' ? -2 : 2) * edge) / a0,
    b2: edge / a0,
    a1: (-2 * cw) / a0,
    a2: (1 - al) / a0,
  }
}

/**
 * An RBJ shelf of slope 1 at `hz`: `db` up or down below it (`low`) or above it (`high`).
 * @param {'low' | 'high'} kind
 * @param {number} hz
 * @param {number} db
 * @param {{ sampleRate?: number }} [o]
 * @returns {Biquad}
 */
export function shelf(kind, hz, db, { sampleRate = 48000 } = {}) {
  const A = 10 ** (db / 40)
  const w = (2 * Math.PI * hz) / sampleRate
  const cw = Math.cos(w)
  const al = (Math.sin(w) / 2) * Math.SQRT2
  const r = 2 * Math.sqrt(A) * al
  const sg = kind === 'low' ? 1 : -1
  const a0 = A + 1 + sg * (A - 1) * cw + r
  return {
    b0: (A * (A + 1 - sg * (A - 1) * cw + r)) / a0,
    b1: (sg * 2 * A * (A - 1 - sg * (A + 1) * cw)) / a0,
    b2: (A * (A + 1 - sg * (A - 1) * cw - r)) / a0,
    a1: (-sg * 2 * (A - 1 + sg * (A + 1) * cw)) / a0,
    a2: (A + 1 + sg * (A - 1) * cw - r) / a0,
  }
}

/**
 * Each sample's true peak across the channels: the largest of the sample and the oversampled
 * points after it, the greatest over the channels (a linked limiter's detector).
 * @param {Float32Array[]} chans
 * @param {number} sampleRate
 * @returns {Float32Array}
 */
function peaks(chans, sampleRate) {
  const n = chans[0]?.length ?? 0
  const out = new Float32Array(n)
  const phases = oversampling(sampleRate)
  const N = TRUE_PEAK_TAPS
  const D = N / 2 - 1
  for (const x of chans) {
    for (let i = 0; i < n; i++) {
      let p = Math.abs(/** @type {number} */ (x[i]))
      for (const h of phases) {
        let v = 0
        const j0 = i + D
        for (let t = 0; t < N; t++) {
          const j = j0 - t
          if (j >= 0 && j < n) v += /** @type {number} */ (h[t]) * /** @type {number} */ (x[j])
        }
        if (Math.abs(v) > p) p = Math.abs(v)
      }
      if (p > /** @type {number} */ (out[i])) out[i] = p
    }
  }
  return out
}

/**
 * The true peak and when it is.
 * @param {Float32Array[]} chans
 * @param {{ sampleRate?: number }} [o]
 * @returns {{ db: number, at: number }} dBTP, and seconds from the start
 */
export function peakAt(chans, { sampleRate = 48000 } = {}) {
  const p = peaks(chans, sampleRate)
  let peak = 0
  let at = 0
  for (let i = 0; i < p.length; i++) {
    const v = /** @type {number} */ (p[i])
    if (v > peak) {
      peak = v
      at = i / sampleRate
    }
  }
  return { db: peak > 0 ? 20 * Math.log10(peak) : Number.NEGATIVE_INFINITY, at }
}

/**
 * A look-ahead true-peak limiter: the gain each sample needs to sit under `ceiling` dBTP, held
 * forward over the look-ahead and ramped in over it (so it is down before the peak arrives), then
 * let go over `release` seconds. The channels share one gain, so the stereo image holds.
 * @param {Float32Array[]} chans
 * @param {number} ceiling dBTP
 * @param {{ lookahead?: number, release?: number, sampleRate?: number }} [o]
 * @returns {{ out: Float32Array[], cut: number }} the limited audio and the deepest cut, dB (<= 0)
 */
export function limit(
  chans,
  ceiling,
  { lookahead = 0.005, release = 0.12, sampleRate = 48000 } = {},
) {
  const p = peaks(chans, sampleRate)
  const n = p.length
  const c = dbToGain(ceiling)
  const at = (/** @type {Float32Array} */ a, /** @type {number} */ i) =>
    /** @type {number} */ (a[i])
  const need = new Float32Array(n)
  for (let i = 0; i < n; i++) need[i] = Math.min(1, c / Math.max(1e-9, at(p, i)))
  const L = Math.max(1, Math.round(lookahead * sampleRate))
  // The least gain from here to L samples ahead (a monotonic deque).
  const ahead = new Float32Array(n)
  /** @type {number[]} */
  const q = []
  let head = 0
  for (let i = n - 1; i >= 0; i--) {
    while (q.length > head && at(need, /** @type {number} */ (q[q.length - 1])) >= at(need, i))
      q.pop()
    q.push(i)
    while (/** @type {number} */ (q[head]) > i + L) head++
    ahead[i] = at(need, /** @type {number} */ (q[head]))
  }
  // Ramp in: the mean of the last L of those.
  const ramp = new Float32Array(n)
  let sum = 0
  for (let i = 0; i < n; i++) {
    sum += at(ahead, i)
    if (i >= L) sum -= at(ahead, i - L)
    ramp[i] = sum / Math.min(i + 1, L)
  }
  const rel = 1 - Math.exp(-1 / (release * sampleRate))
  const g = new Float32Array(n)
  let last = 1
  let cut = 1
  for (let i = 0; i < n; i++) {
    const r = at(ramp, i)
    last = r < last ? r : last + (r - last) * rel
    g[i] = last
    if (last < cut) cut = last
  }
  return { out: chans.map((ch) => ch.map((v, i) => v * at(g, i))), cut: 20 * Math.log10(cut) }
}

/**
 * A sidechain duck: `key`'s level, followed fast and let go slowly, cuts by `ratio` of each dB it
 * rises over `threshold` dBFS, at most `depth` dB. Multiply the ducked stem by `gain`.
 * @param {Float32Array[]} key
 * @param {{ threshold: number, depth: number, ratio?: number, attack?: number, release?: number, sampleRate?: number }} o
 * @returns {{ gain: Float32Array, ducked: number, deepest: number }} the linear gain per sample,
 *   the share of time cut by over 1 dB, and the deepest cut in dB (>= 0)
 */
export function duck(key, o) {
  const { threshold, depth, ratio = 0.6, attack = 0.01, release = 0.3, sampleRate = 48000 } = o
  const n = key[0]?.length ?? 0
  const att = 1 - Math.exp(-1 / (attack * sampleRate))
  const rel = 1 - Math.exp(-1 / (release * sampleRate))
  // The key's level: a 10 ms RMS of all its channels.
  const win = Math.round(0.01 * sampleRate)
  const sq = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) {
    let e = 0
    for (const c of key) e += /** @type {number} */ (c[i]) ** 2
    sq[i + 1] = /** @type {number} */ (sq[i]) + e / key.length
  }
  const g = new Float32Array(n)
  let cutDb = 0
  let ducked = 0
  let deepest = 0
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - win)
    const sum = /** @type {number} */ (sq[i + 1]) - /** @type {number} */ (sq[a])
    const db = 10 * Math.log10(Math.max(1e-12, sum / Math.max(1, i + 1 - a)))
    const want = Math.min(depth, Math.max(0, (db - threshold) * ratio))
    cutDb += (want - cutDb) * (want > cutDb ? att : rel)
    g[i] = dbToGain(-cutDb)
    if (cutDb > 1) ducked++
    if (cutDb > deepest) deepest = cutDb
  }
  return { gain: g, ducked: ducked / Math.max(1, n), deepest }
}

/**
 * Master a mix: gain to `target` LUFS, then the limiter at `ceiling` dBTP, again until both hold
 * (limiting lowers the loudness, so one pass falls short). Silence comes back unchanged.
 * @param {Float32Array[]} chans
 * @param {{ target?: number, ceiling?: number, passes?: number, sampleRate?: number }} [o]
 * @returns {{ out: Float32Array[], cut: number }} the master and the limiter's deepest cut, dB
 */
export function master(
  chans,
  { target = -14, ceiling = -1.5, passes = 4, sampleRate = 48000 } = {},
) {
  let out = chans
  let cut = 0
  for (let i = 0; i < passes; i++) {
    const l = measure(out, sampleRate)
    if (!Number.isFinite(l.integrated)) break
    if (Math.abs(l.integrated - target) < 0.05 && l.truePeak <= ceiling + 0.05) break
    const lim = limit(gain(out, target - l.integrated), ceiling, { sampleRate })
    out = lim.out
    cut = Math.min(cut, lim.cut)
  }
  return { out, cut }
}

/**
 * A phone's speaker: mono, nothing under 300 Hz, rolled off over 8 kHz.
 * @param {Float32Array[]} chans
 * @param {{ sampleRate?: number }} [o]
 * @returns {Float32Array[]} one channel
 */
export function phone(chans, { sampleRate = 48000 } = {}) {
  const n = chans[0]?.length ?? 0
  const m = new Float32Array(n)
  for (const c of chans)
    for (let i = 0; i < n; i++)
      m[i] = /** @type {number} */ (m[i]) + /** @type {number} */ (c[i]) / chans.length
  const steep = biquad(m, pass('high', 300, { q: 0.9, sampleRate }))
  const high = biquad(steep, pass('high', 300, { sampleRate }))
  return [biquad(high, pass('low', 8000, { sampleRate }))]
}

/**
 * A 24-bit PCM WAV.
 * @param {Float32Array[]} chans
 * @param {{ sampleRate?: number }} [o]
 * @returns {Buffer}
 */
export function encodeWav(chans, { sampleRate = 48000 } = {}) {
  const n = chans[0]?.length ?? 0
  const ch = chans.length
  const pcm = Buffer.alloc(n * ch * 3)
  let o = 0
  for (let i = 0; i < n; i++)
    for (const c of chans) {
      const v = Math.round(/** @type {number} */ (c[i]) * 8388607)
      pcm.writeIntLE(Math.max(-8388607, Math.min(8388607, v)), o, 3)
      o += 3
    }
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + pcm.length, 4)
  h.write('WAVEfmt ', 8)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(ch, 22)
  h.writeUInt32LE(sampleRate, 24)
  h.writeUInt32LE(sampleRate * 3 * ch, 28)
  h.writeUInt16LE(3 * ch, 32)
  h.writeUInt16LE(24, 34)
  h.write('data', 36)
  h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}
