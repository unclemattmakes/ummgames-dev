/** Pitch helpers: equal temperament, decibels, scales and scale degrees. Pure, no imports. */

/** The frequency, Hz, of a note `semi` semitones from A4 (440 Hz), in equal temperament. */
export const note = (semi: number): number => 440 * 2 ** (semi / 12)

/** A gain factor from decibels: 0 dB is 1, -6 dB is about 0.5. */
export const dbToGain = (db: number): number => 10 ** (db / 20)

/** Natural minor (Aeolian). */
export const MINOR: readonly number[] = [0, 2, 3, 5, 7, 8, 10]
/** Harmonic minor: natural minor with a raised seventh, for a stronger pull to the tonic. */
export const HARMONIC_MINOR: readonly number[] = [0, 2, 3, 5, 7, 8, 11]
/** Phrygian: minor with a flat second, darker and more tense. */
export const PHRYGIAN: readonly number[] = [0, 1, 3, 5, 7, 8, 10]
/** Dorian: minor with a raised sixth, brighter than natural minor. */
export const DORIAN: readonly number[] = [0, 2, 3, 5, 7, 9, 10]
/** Major (Ionian). */
export const MAJOR: readonly number[] = [0, 2, 4, 5, 7, 9, 11]
/** Minor pentatonic: five notes with no half steps, so any two sound together. */
export const PENTATONIC_MINOR: readonly number[] = [0, 3, 5, 7, 10]

/**
 * Scale degree `d` as semitones above the tonic. `d` is any integer: 0 is the tonic, and degrees
 * past the scale's length, or below 0, wrap into the octaves above and below. With `MINOR`,
 * degree 7 is 12 and degree -1 is -2.
 */
export function degree(scale: readonly number[], d: number): number {
  const n = scale.length
  const octave = Math.floor(d / n)
  return (scale[((d % n) + n) % n] ?? 0) + 12 * octave
}
