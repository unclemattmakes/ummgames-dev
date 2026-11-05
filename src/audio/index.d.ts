/**
 * `@ummgames/dev/audio`: the BS.1770-4 loudness meter behind `umm-dev loudness`, and a mix bus
 * for a game's own tools. See docs/audio.md.
 */

/** BS.1770 loudness of one measurement. LUFS and dB values are -Infinity for silence. */
export interface Loudness {
  /**
   * Integrated LUFS, gated: blocks under -70 LUFS, then blocks 10 LU under the rest, are
   * dropped. -Infinity for silence and for anything under 400 ms.
   */
  integrated: number
  /** The loudest 400 ms block, LUFS. */
  momentaryMax: number
  /** The loudest 3 s block, LUFS. */
  shortTermMax: number
  /** Loudness range, LU: the gated 3 s blocks, 10th to 95th percentile. 0 under 3 s. */
  range: number
  /** True peak, dBTP: 4x oversampled below 96 kHz, 2x below 192 kHz, else the sample peak. */
  truePeak: number
  /** The largest sample, dBFS. */
  samplePeak: number
  /** Length, seconds. */
  seconds: number
  sampleRate: number
  channels: number
}

/** One biquad's coefficients; `a0` is 1 and not stored. */
export interface Biquad {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

export interface Meter {
  /** Interleaved float samples, in chunks of any size. */
  push(interleaved: Float32Array | Float64Array | number[]): void
  /** Ends the measurement. Call it once; a second call throws. */
  result(): Loudness
}

/**
 * The `loudness` section of a game's `umm-dev.config.mjs`: defaults for `umm-dev loudness`.
 * Each command-line flag overrides its key. Values are numbers, not strings.
 *
 *   export default defineConfig({ loudness: { target: -16, tolerance: 1, maxPeak: -1 } })
 */
export interface LoudnessConfig {
  /** The integrated LUFS each file must be near (`--target`). Default `null`: not checked. */
  target?: number | null
  /** LU either side of `target` that count as in range (`--tolerance`). Default 1. */
  tolerance?: number
  /** The highest true peak allowed, dBTP (`--max-peak`). Default `null`: not checked. */
  maxPeak?: number | null
}

/**
 * A streaming meter. Up to 3 channels each weigh 1; from 4 the order is taken as
 * L R C LFE Ls Rs, the LFE weighing 0 and the surrounds 1.41.
 */
export declare function createMeter(p: { sampleRate: number; channels: number }): Meter
/** Meter whole buffers at once: one Float32Array per channel. */
export declare function measure(chans: Float32Array[], sampleRate: number): Loudness
/**
 * Decode a media file's first audio stream with ffmpeg, at its own rate and channel count, and
 * meter it. `bins` names the executables (default `ffmpeg` and `ffprobe` on PATH). Rejects
 * when ffprobe or ffmpeg fails, or the file has no audio stream.
 */
export declare function meterFile(
  file: string,
  bins?: { ffmpeg?: string; ffprobe?: string },
): Promise<Loudness>
/** The first audio stream's sample rate and channel count, from ffprobe. */
export declare function probe(
  file: string,
  bins?: { ffprobe?: string },
): Promise<{ sampleRate: number; channels: number }>
/** The high shelf, then the highpass, for any sample rate. */
export declare function kWeightingFilters(sampleRate: number): [Biquad, Biquad]
/** LUFS from a mean square: `-0.691 + 10 * log10(ms)`, -Infinity for 0. */
export declare function lufs(ms: number): number
/** Taps per phase of the true-peak interpolator, a Hann-windowed sinc: 48. */
export declare const TRUE_PEAK_TAPS: number

/** dB to a linear gain. */
export declare function dbToGain(db: number): number
/** A copy of `chans`, `db` louder. */
export declare function gain(chans: Float32Array[], db: number): Float32Array[]
/** One biquad over a channel. */
export declare function biquad(x: Float32Array, f: Biquad): Float32Array
/** An RBJ high- or lowpass at `hz`. `q` defaults to 0.7071, `sampleRate` to 48000. */
export declare function pass(
  kind: 'high' | 'low',
  hz: number,
  options?: { q?: number; sampleRate?: number },
): Biquad
/** An RBJ shelf of slope 1: `db` below `hz` (`low`) or above it (`high`). */
export declare function shelf(
  kind: 'low' | 'high',
  hz: number,
  db: number,
  options?: { sampleRate?: number },
): Biquad
/** The true peak in dBTP (-Infinity for silence) and when it is, in seconds. */
export declare function peakAt(
  chans: Float32Array[],
  options?: { sampleRate?: number },
): { db: number; at: number }
/**
 * A look-ahead true-peak limiter at `ceiling` dBTP, one gain for all channels. `lookahead`
 * defaults to 0.005 s, `release` to 0.12 s. `cut` is the deepest cut in dB, 0 or below.
 */
export declare function limit(
  chans: Float32Array[],
  ceiling: number,
  options?: { lookahead?: number; release?: number; sampleRate?: number },
): { out: Float32Array[]; cut: number }
/**
 * A sidechain duck: `key` over `threshold` dBFS cuts by `ratio` (default 0.6) of each dB, at most
 * `depth` dB. `attack` defaults to 0.01 s, `release` to 0.3 s. Multiply the ducked stem by
 * `gain`, a linear gain per sample. `ducked` is the share of time cut by over 1 dB; `deepest` is
 * in dB, 0 or above.
 */
export declare function duck(
  key: Float32Array[],
  options: {
    threshold: number
    depth: number
    ratio?: number
    attack?: number
    release?: number
    sampleRate?: number
  },
): { gain: Float32Array; ducked: number; deepest: number }
/**
 * Gain to `target` LUFS (default -14), limit at `ceiling` dBTP (default -1.5), and again until both
 * hold, at most `passes` times (default 4). Silence comes back unchanged.
 */
export declare function master(
  chans: Float32Array[],
  options?: { target?: number; ceiling?: number; passes?: number; sampleRate?: number },
): { out: Float32Array[]; cut: number }
/** A phone's speaker: one channel, nothing under 300 Hz, rolled off over 8 kHz. */
export declare function phone(
  chans: Float32Array[],
  options?: { sampleRate?: number },
): Float32Array[]
/** A 24-bit PCM WAV, clipped at full scale. */
export declare function encodeWav(chans: Float32Array[], options?: { sampleRate?: number }): Buffer
