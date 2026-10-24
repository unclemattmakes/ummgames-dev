import { describe, expect, it } from 'vitest'
import { createMeter, kWeightingFilters, lufs, measure } from '../../src/audio/meter.mjs'

/**
 * A sine of `peakDb` dBFS at `hz`, `seconds` long.
 * @param {number} peakDb @param {number} hz @param {number} seconds
 */
function sine(peakDb, hz, seconds, sampleRate = 48000, phase = 0) {
  const a = 10 ** (peakDb / 20)
  const out = new Float32Array(Math.round(seconds * sampleRate))
  for (let i = 0; i < out.length; i++)
    out[i] = a * Math.sin((2 * Math.PI * hz * i) / sampleRate + phase)
  return out
}

describe('K-weighting', () => {
  it('reproduces BS.1770-4’s 48 kHz coefficients', () => {
    const [shelf, hp] = kWeightingFilters(48000)
    const close = (/** @type {number} */ a, /** @type {number} */ b) => expect(a).toBeCloseTo(b, 10)
    close(shelf.b0, 1.53512485958697)
    close(shelf.b1, -2.69169618940638)
    close(shelf.b2, 1.19839281085285)
    close(shelf.a1, -1.69065929318241)
    close(shelf.a2, 0.73248077421585)
    expect([hp.b0, hp.b1, hp.b2]).toEqual([1, -2, 1])
    close(hp.a1, -1.99004745483398)
    close(hp.a2, 0.99007225036621)
  })
})

describe('loudness', () => {
  it('reads a 1 kHz sine at -20 dBFS in both channels as -20 LUFS, -20 dBTP', () => {
    const s = sine(-20, 1000, 10)
    const m = measure([s, s], 48000)
    expect(m.integrated).toBeCloseTo(-20, 1)
    expect(m.momentaryMax).toBeCloseTo(-20, 1)
    expect(m.shortTermMax).toBeCloseTo(-20, 1)
    expect(m.truePeak).toBeCloseTo(-20, 1)
    expect(m.seconds).toBe(10)
  })

  it('reads the same sine in one channel 3 dB quieter (BS.1770: -3.01 LKFS at 0 dBFS)', () => {
    expect(measure([sine(0, 1000, 5)], 48000).integrated).toBeCloseTo(-3.01, 1)
    expect(measure([sine(-20, 1000, 5, 44100)], 44100).integrated).toBeCloseTo(-23.01, 1)
  })

  it('reads silence as -inf everywhere', () => {
    const m = measure([new Float32Array(48000 * 2), new Float32Array(48000 * 2)], 48000)
    expect(m.integrated).toBe(Number.NEGATIVE_INFINITY)
    expect(m.momentaryMax).toBe(Number.NEGATIVE_INFINITY)
    expect(m.truePeak).toBe(Number.NEGATIVE_INFINITY)
  })

  it('gates silence out of the integrated reading, but not out of the momentary max', () => {
    const s = new Float32Array(48000 * 20)
    s.set(sine(-20, 1000, 10))
    const m = measure([s, s], 48000)
    // The blocks straddling the edge count too, partly filled, so it reads a shade under -20.
    expect(Math.abs(m.integrated + 20)).toBeLessThan(0.1)
    expect(m.momentaryMax).toBeCloseTo(-20, 1)
    expect(m.seconds).toBe(20)
  })

  it('gates quiet passages 10 LU under the rest out (the relative gate)', () => {
    // 10 s at -20 and 10 s at -40: the quiet half is 20 LU down, so only the loud half counts.
    const s = new Float32Array(48000 * 20)
    s.set(sine(-20, 1000, 10))
    s.set(sine(-40, 1000, 10), 48000 * 10)
    expect(Math.abs(measure([s, s], 48000).integrated + 20)).toBeLessThan(0.1)
  })

  it('finds the true peak between samples', () => {
    // A quarter-rate sine at 45 degrees: every sample is at 0.707 of the crest.
    const s = sine(-6, 12000, 1, 48000, Math.PI / 4)
    const m = measure([s], 48000)
    expect(m.samplePeak).toBeCloseTo(-6 - 3.01, 1)
    expect(m.truePeak).toBeGreaterThan(-6.5)
    expect(m.truePeak).toBeLessThan(-5.5)
  })

  it('gives the same answer however the samples are chunked', () => {
    const s = sine(-14, 440, 3)
    const whole = measure([s], 48000)
    const m = createMeter({ sampleRate: 48000, channels: 1 })
    for (let i = 0; i < s.length; i += 777) m.push(s.subarray(i, i + 777))
    const chunked = m.result()
    expect(chunked.integrated).toBeCloseTo(whole.integrated, 9)
    expect(chunked.truePeak).toBeCloseTo(whole.truePeak, 9)
    expect(() => m.result()).toThrow(/ends a measurement/)
  })

  it('converts mean square to LUFS with the standard’s offset', () => {
    expect(lufs(1)).toBeCloseTo(-0.691, 6)
    expect(lufs(0)).toBe(Number.NEGATIVE_INFINITY)
  })
})
