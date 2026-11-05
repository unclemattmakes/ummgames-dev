import { describe, expect, it } from 'vitest'
import { measure } from '../../src/audio/meter.mjs'
import {
  biquad,
  duck,
  encodeWav,
  gain,
  limit,
  master,
  pass,
  peakAt,
  phone,
  shelf,
} from '../../src/audio/mix.mjs'

const SR = 48000

/** @param {number} hz @param {number} amp @param {number} secs */
const sine = (hz, amp, secs, phase = 0, rate = SR) =>
  Float32Array.from(
    { length: Math.round(secs * rate) },
    (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate + phase),
  )
/** @param {Float32Array} x */
const rms = (x, from = 0) => {
  let s = 0
  for (let i = from; i < x.length; i++) s += /** @type {number} */ (x[i]) ** 2
  return Math.sqrt(s / (x.length - from))
}

describe('peakAt', () => {
  it('finds the true peak between samples, and when', () => {
    // A tone at a quarter of the rate, sampled at 45 degrees: every sample is 0.707 of its crest.
    const t = sine(SR / 4, 1, 0.2, Math.PI / 4)
    expect(peakAt([t]).db).toBeGreaterThan(-0.5)
    const x = new Float32Array(SR)
    x[SR / 2] = 0.5
    expect(peakAt([x]).at).toBeCloseTo(0.5, 2)
  })

  it('reads silence as -Infinity', () => {
    expect(peakAt([new Float32Array(100)]).db).toBe(Number.NEGATIVE_INFINITY)
  })
})

describe('limit', () => {
  it('holds its ceiling in true peak, and leaves the quiet alone', () => {
    const x = sine(220, 0.1, 2)
    // A burst at 0 dBFS a second in.
    for (let i = SR; i < SR + 4800; i++) x[i] = Math.sin((2 * Math.PI * 3000 * i) / SR)
    const { out, cut } = limit([x], -1.5)
    expect(peakAt(out).db).toBeLessThan(-1.4)
    expect(cut).toBeLessThan(-1)
    const y = /** @type {Float32Array} */ (out[0])
    expect(y[SR / 2]).toBeCloseTo(/** @type {number} */ (x[SR / 2]), 5)
  })

  it('is down before the peak arrives', () => {
    const x = new Float32Array(SR)
    x.fill(0.1)
    x[SR / 2] = 1
    const y = /** @type {Float32Array} */ (limit([x], -6).out[0])
    expect(y[SR / 2 - 1]).toBeLessThan(0.1)
  })

  it('cuts every channel alike', () => {
    const { out } = limit([sine(1000, 1, 0.5), sine(1000, 0.1, 0.5)], -6)
    const [l, r] = /** @type {[Float32Array, Float32Array]} */ (out)
    expect(rms(r, SR / 4) / rms(l, SR / 4)).toBeCloseTo(0.1, 3)
  })
})

describe('duck', () => {
  it('cuts only while the key is loud, and lets go', () => {
    const key = new Float32Array(3 * SR)
    key.set(sine(500, 0.01, 1), 0)
    key.set(sine(500, 0.5, 1), SR)
    key.set(sine(500, 0.01, 1), 2 * SR)
    const d = duck([key], { threshold: -20, depth: 6 })
    expect(d.gain[SR / 2]).toBeCloseTo(1, 3)
    expect(20 * Math.log10(/** @type {number} */ (d.gain[SR + SR / 2]))).toBeCloseTo(-6, 0)
    expect(d.deepest).toBeLessThanOrEqual(6)
    expect(d.gain[3 * SR - 1]).toBeGreaterThan(0.9)
  })
})

describe('master', () => {
  it('lands on the loudness under the ceiling, even with a peak that needs limiting', () => {
    const x = sine(1000, 0.05, 10)
    for (let i = 5 * SR; i < 5 * SR + 480; i++) x[i] = 0.9 * Math.sin((2 * Math.PI * 1000 * i) / SR)
    const { out, cut } = master([x, x], { target: -14, ceiling: -1.5 })
    const l = measure(out, SR)
    expect(l.integrated).toBeCloseTo(-14, 0)
    expect(l.truePeak).toBeLessThan(-1.4)
    expect(cut).toBeLessThan(0)
  })

  it('leaves silence alone', () => {
    const x = new Float32Array(SR)
    expect(master([x])).toEqual({ out: [x], cut: 0 })
  })
})

describe('filters', () => {
  it('a low shelf cuts under its corner and leaves the top', () => {
    const f = shelf('low', 200, -4)
    const db = (/** @type {number} */ hz) =>
      20 * Math.log10(rms(biquad(sine(hz, 0.5, 1), f), SR / 2) / (0.5 / Math.SQRT2))
    expect(db(40)).toBeCloseTo(-4, 0)
    expect(db(4000)).toBeCloseTo(0, 1)
  })

  it('a high shelf lifts over its corner and leaves the bottom', () => {
    const f = shelf('high', 4000, 6)
    const db = (/** @type {number} */ hz) =>
      20 * Math.log10(rms(biquad(sine(hz, 0.1, 1), f), SR / 2) / (0.1 / Math.SQRT2))
    expect(db(16000)).toBeGreaterThan(5)
    expect(db(100)).toBeCloseTo(0, 1)
  })

  it('a pass is 3 dB down at its corner, at any sample rate', () => {
    for (const sampleRate of [44100, 48000, 96000]) {
      const y = biquad(sine(1000, 0.5, 1, 0, sampleRate), pass('low', 1000, { sampleRate }))
      expect(20 * Math.log10(rms(y, sampleRate / 2) / (0.5 / Math.SQRT2))).toBeCloseTo(-3, 0)
    }
  })

  it("a phone's speaker is mono, loses the bass and keeps the middle", () => {
    const mid = phone([sine(1000, 0.5, 1), sine(1000, 0.5, 1)])
    expect(mid).toHaveLength(1)
    expect(rms(/** @type {Float32Array} */ (mid[0]), SR / 2)).toBeGreaterThan(0.3)
    const low = /** @type {Float32Array} */ (phone([sine(60, 0.5, 1)])[0])
    expect(rms(low, SR / 2)).toBeLessThan(0.02)
  })
})

describe('encodeWav', () => {
  it('writes a 24-bit header and clips at full scale', () => {
    const b = encodeWav([Float32Array.of(0, 2), Float32Array.of(-2, 0.5)], { sampleRate: 44100 })
    expect(b.toString('ascii', 0, 4)).toBe('RIFF')
    expect(b.readUInt16LE(22)).toBe(2)
    expect(b.readUInt32LE(24)).toBe(44100)
    expect(b.readUInt16LE(34)).toBe(24)
    expect(b.readUInt32LE(40)).toBe(12)
    expect(b.readIntLE(44 + 3, 3)).toBe(-8388607)
    expect(b.readIntLE(44 + 6, 3)).toBe(8388607)
  })
})

describe('gain', () => {
  it('moves the level by its dB and leaves the input alone', () => {
    const x = Float32Array.of(0.5)
    expect(gain([x], -6.0206)[0]?.[0]).toBeCloseTo(0.25, 4)
    expect(x[0]).toBe(0.5)
  })
})
