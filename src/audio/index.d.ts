/** BS.1770 loudness of one measurement. LUFS and dB values are -Infinity for silence. */
export interface Loudness {
  integrated: number
  momentaryMax: number
  shortTermMax: number
  truePeak: number
  samplePeak: number
  seconds: number
  sampleRate: number
  channels: number
}

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
  /** Ends the measurement. */
  result(): Loudness
}

export declare function createMeter(p: { sampleRate: number; channels: number }): Meter
/** Meter whole buffers at once: one Float32Array per channel. */
export declare function measure(chans: Float32Array[], sampleRate: number): Loudness
/** Decode a media file's first audio stream with ffmpeg and meter it. */
export declare function meterFile(
  file: string,
  bins?: { ffmpeg?: string; ffprobe?: string },
): Promise<Loudness>
export declare function probe(
  file: string,
  bins?: { ffprobe?: string },
): Promise<{ sampleRate: number; channels: number }>
/** The high shelf, then the highpass, for any sample rate. */
export declare function kWeightingFilters(sampleRate: number): [Biquad, Biquad]
/** LUFS from a mean square. */
export declare function lufs(ms: number): number
export declare const TRUE_PEAK_TAPS: number
