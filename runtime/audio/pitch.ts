/** Pitch helpers: equal temperament, decibels, scales, scale degrees, chords. Pure, no imports. */

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
/** Lydian: major with a raised fourth, airy and floating. */
export const LYDIAN: readonly number[] = [0, 2, 4, 6, 7, 9, 11]
/** Mixolydian: major with a flat seventh, bright but not resolved. */
export const MIXOLYDIAN: readonly number[] = [0, 2, 4, 5, 7, 9, 10]
/** Phrygian dominant: phrygian with a major third. */
export const PHRYGIAN_DOMINANT: readonly number[] = [0, 1, 4, 5, 7, 8, 10]
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

/**
 * The chord built in thirds on scale degree `root`, as semitones above the tonic: `size` notes,
 * each two degrees above the last. Size 3 is a triad, 4 adds the seventh. With `MINOR`,
 * `chordTones(MINOR, 5)` is `[8, 12, 15]`, the VI chord.
 */
export function chordTones(scale: readonly number[], root: number, size = 3): number[] {
  const out: number[] = []
  for (let k = 0; k < size; k++) out.push(degree(scale, root + 2 * k))
  return out
}
