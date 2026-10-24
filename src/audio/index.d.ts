/**
 * `@ummgames/dev/audio`: the BS.1770-4 loudness meter behind `umm-dev loudness`. See
 * docs/audio.md.
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
