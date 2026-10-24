// @ts-check
/**
 * A loudness meter after ITU-R BS.1770-4: K-weighted, gated integrated loudness (LUFS), the
 * loudest 400 ms (momentary max) and 3 s (short-term max), and true peak (dBTP, 4x
 * oversampled below 96 kHz).
 *
 * It streams: `push()` takes interleaved float samples in chunks of any size, and memory is a
 * few numbers per 100 ms of audio, so an hour-long file meters in the same space as a second.
 *
 * - **K-weighting** is the standard's two biquads, a high shelf for the head and the RLB
 *   highpass, designed for the actual sample rate; at 48 kHz they are the standard's table.
 * - **Gating**: 400 ms blocks every 100 ms; blocks under -70 LUFS are dropped, then blocks more
 *   than 10 LU under the mean of the rest.
 * - **Channels** weigh 1, except surrounds at 1.41 and the LFE at 0, in the usual order
 *   (L R C LFE Ls Rs).
 * - **True peak** interpolates each sample gap with a 48-tap Hann-windowed sinc per phase.
 */

/** @typedef {{ b0: number, b1: number, b2: number, a1: number, a2: number }} Biquad */

/**
 * BS.1770's K-weighting filters for `sampleRate`, from the analog prototypes the standard's
 * 48 kHz coefficients were made from.
 * @param {number} sampleRate
 * @returns {[Biquad, Biquad]} the high shelf, then the highpass
 */
export function kWeightingFilters(sampleRate) {
  // Stage 1: the head's high shelf.
  let f0 = 1681.974450955533
  const G = 3.999843853973347
  let Q = 0.7071752369554196
  let K = Math.tan((Math.PI * f0) / sampleRate)
  const Vh = 10 ** (G / 20)
  const Vb = Vh ** 0.4996667741545416
  let a0 = 1 + K / Q + K * K
  /** @type {Biquad} */
  const shelf = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  }
  // Stage 2: the RLB highpass.
  f0 = 38.13547087602444
  Q = 0.5003270373238773
  K = Math.tan((Math.PI * f0) / sampleRate)
  a0 = 1 + K / Q + K * K
  /** @type {Biquad} */
  const highpass = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  }
  return [shelf, highpass]
}

/** @param {number} ms mean square @returns {number} LUFS */
export const lufs = (ms) => (ms > 0 ? -0.691 + 10 * Math.log10(ms) : Number.NEGATIVE_INFINITY)

/** @param {number} channels */
function channelWeights(channels) {
  if (channels <= 3) return new Array(channels).fill(1)
  const w = [1, 1, 1, 0, 1.41, 1.41]
  return Array.from({ length: channels }, (_, i) => w[i] ?? 1)
}

/** 48 taps per phase of a Hann-windowed sinc, for `factor`x oversampling. */
export const TRUE_PEAK_TAPS = 48

/** @param {number} factor */
function interpolators(factor) {
  /** @type {Float64Array[]} */
  const phases = []
  for (let p = 1; p < factor; p++) {
    const h = new Float64Array(TRUE_PEAK_TAPS)
    for (let t = 0; t < TRUE_PEAK_TAPS; t++) {
      const x = t - TRUE_PEAK_TAPS / 2 + 1 - p / factor
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)
      const w = 0.5 + 0.5 * Math.cos((Math.PI * x) / (TRUE_PEAK_TAPS / 2))
      h[t] = sinc * w
    }
    phases.push(h)
  }
  return phases
}

/**
 * @typedef {{
 *   integrated: number,
 *   momentaryMax: number,
 *   shortTermMax: number,
 *   truePeak: number,
 *   samplePeak: number,
 *   seconds: number,
 *   sampleRate: number,
 *   channels: number,
 * }} Loudness
 */

/**
 * @param {{ sampleRate: number, channels: number }} p
 */
export function createMeter({ sampleRate, channels }) {
  if (!(sampleRate > 0) || !(channels >= 1)) throw new Error('meter: bad sample rate or channels')
  const [s1, s2] = kWeightingFilters(sampleRate)
  const weights = channelWeights(channels)
  // Per-channel filter state: x1 x2 y1 y2 for each stage.
  const st = Array.from({ length: channels }, () => new Float64Array(8))
  const segLen = Math.round(0.1 * sampleRate)
  /** @type {number[]} weighted K-filtered energy of each finished 100 ms segment */
  const segments = []
  let segEnergy = 0
  let segFill = 0
  let frames = 0

  const factor = sampleRate < 96000 ? 4 : sampleRate < 192000 ? 2 : 1
  const phases = interpolators(factor)
  const N = TRUE_PEAK_TAPS
  // History ring per channel, doubled so a window is always contiguous.
  const hist = Array.from({ length: channels }, () => new Float64Array(2 * N))
  let hpos = 0
  let truePeak = 0
  let samplePeak = 0
  let done = false

  /** True peak: the sample itself, then each interpolated phase over the last N samples.
   *  @param {number} c @param {number} v */
  const peak = (c, v) => {
    const h = /** @type {Float64Array} */ (hist[c])
    h[hpos] = v
    h[hpos + N] = v
    const a = Math.abs(v)
    if (a > samplePeak) samplePeak = a
    if (a > truePeak) truePeak = a
    for (const ph of phases) {
      let acc = 0
      // h[hpos + N - t] is the sample t steps back.
      for (let t = 0; t < N; t++)
        acc += /** @type {number} */ (ph[t]) * /** @type {number} */ (h[hpos + N - t])
      const m = Math.abs(acc)
      if (m > truePeak) truePeak = m
    }
  }

  /** One frame of `channels` samples. @param {ArrayLike<number>} x @param {number} o */
  const frame = (x, o) => {
    let e = 0
    for (let c = 0; c < channels; c++) {
      const v = /** @type {number} */ (x[o + c])
      const s = /** @type {Float64Array} */ (st[c])
      // Stage 1.
      const y1 =
        s1.b0 * v +
        s1.b1 * /** @type {number} */ (s[0]) +
        s1.b2 * /** @type {number} */ (s[1]) -
        s1.a1 * /** @type {number} */ (s[2]) -
        s1.a2 * /** @type {number} */ (s[3])
      s[1] = s[0]
      s[0] = v
      s[3] = s[2]
      s[2] = y1
      // Stage 2.
      const y2 =
        s2.b0 * y1 +
        s2.b1 * /** @type {number} */ (s[4]) +
        s2.b2 * /** @type {number} */ (s[5]) -
        s2.a1 * /** @type {number} */ (s[6]) -
        s2.a2 * /** @type {number} */ (s[7])
      s[5] = s[4]
      s[4] = y1
      s[7] = s[6]
      s[6] = y2
      e += /** @type {number} */ (weights[c]) * y2 * y2

      peak(c, v)
    }
    hpos = (hpos + 1) % N
    segEnergy += e
    segFill++
    frames++
    if (segFill === segLen) {
      segments.push(segEnergy / segLen)
      segEnergy = 0
      segFill = 0
    }
  }

  return {
    /** @param {Float32Array | Float64Array | number[]} interleaved */
    push(interleaved) {
      const n = interleaved.length - (interleaved.length % channels)
      for (let o = 0; o < n; o += channels) frame(interleaved, o)
    },
    /** @returns {Loudness} */
    result() {
      if (done) throw new Error('meter: result() ends a measurement; make a new meter')
      done = true
      // Flush the interpolator: half a window of silence lets the last sample gaps be measured.
      for (let i = 0; i < N / 2; i++) {
        for (let c = 0; c < channels; c++) peak(c, 0)
        hpos = (hpos + 1) % N
      }

      /** @param {number} len segments per block */
      const blocks = (len) => {
        /** @type {number[]} */
        const out = []
        let sum = 0
        for (let i = 0; i < segments.length; i++) {
          sum += /** @type {number} */ (segments[i])
          if (i >= len) sum -= /** @type {number} */ (segments[i - len])
          if (i >= len - 1) out.push(sum / len)
        }
        return out
      }
      const momentary = blocks(4)
      const short = blocks(30)
      const abs = momentary.filter((b) => lufs(b) > -70)
      const mean = (/** @type {number[]} */ bs) => bs.reduce((t, b) => t + b, 0) / bs.length
      let integrated = Number.NEGATIVE_INFINITY
      if (abs.length) {
        const rel = lufs(mean(abs)) - 10
        const gated = abs.filter((b) => lufs(b) > rel)
        if (gated.length) integrated = lufs(mean(gated))
      }
      const db = (/** @type {number} */ a) =>
        a > 0 ? 20 * Math.log10(a) : Number.NEGATIVE_INFINITY
      return {
        integrated,
        momentaryMax: lufs(momentary.reduce((a, b) => Math.max(a, b), 0)),
        shortTermMax: lufs(short.reduce((a, b) => Math.max(a, b), 0)),
        truePeak: db(truePeak),
        samplePeak: db(samplePeak),
        seconds: frames / sampleRate,
        sampleRate,
        channels,
      }
    },
  }
}

/**
 * Meter whole buffers at once: one Float32Array per channel.
 * @param {Float32Array[]} chans
 * @param {number} sampleRate
 * @returns {Loudness}
 */
export function measure(chans, sampleRate) {
  const channels = chans.length
  const n = chans[0]?.length ?? 0
  const m = createMeter({ sampleRate, channels })
  const chunk = 4096
  const buf = new Float32Array(chunk * channels)
  for (let i = 0; i < n; i += chunk) {
    const len = Math.min(chunk, n - i)
    for (let k = 0; k < len; k++)
      for (let c = 0; c < channels; c++)
        buf[k * channels + c] = /** @type {number} */ (
          /** @type {Float32Array} */ (chans[c])[i + k]
        )
    m.push(len === chunk ? buf : buf.subarray(0, len * channels))
  }
  return m.result()
}
