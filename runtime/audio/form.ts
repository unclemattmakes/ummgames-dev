/**
 * Where a step sequencer is in its song: the step's bar, beat, phrase and section of the form,
 * and the small reads every sequencer makes of its patterns (a melody line by bar, how long a
 * note holds, a drum string's hit, swing, the next beat). Pure: no clock, no Web Audio, no
 * imports. Times are in steps, a sixteenth each by default; the sequencer turns them into seconds.
 */

/** Sixteenth steps in a bar of 4/4. */
export const STEPS_PER_BAR = 16
/** Sixteenth steps in a beat. */
export const STEPS_PER_BEAT = 4

/** A section of the form: the tune, its answer, the tune with a harmony, a breakdown. */
export type Section = 'A' | 'B' | 'A2' | 'D'
/** The usual form: one trip round the chord progression per section. */
export const FORM: readonly Section[] = ['A', 'B', 'A2', 'D']

/** Where step `step` falls. Every count starts at 0. */
export interface Position {
  /** The step, as given. */
  step: number
  /** The bar. */
  bar: number
  /** The step within its bar. */
  i: number
  /** The beat within its bar. */
  beat: number
  /** Whether the step starts a beat. */
  onBeat: boolean
  /** The bar within its phrase (one trip round the progression). */
  inPhrase: number
  /** The phrase: how many times the progression has come round. */
  pass: number
  /** The first bar of its phrase. */
  firstBar: boolean
  /** The last bar of its phrase, where a turnaround or fill goes. */
  lastBar: boolean
}

/**
 * Where `step` falls, in a song whose phrase is `phraseBars` bars (the progression's length).
 * Negative steps count back from bar 0, so a pickup before the downbeat has bar -1.
 */
export function position(step: number, phraseBars: number, stepsPerBar = STEPS_PER_BAR): Position {
  const bar = Math.floor(step / stepsPerBar)
  const i = step - bar * stepsPerBar
  const pass = Math.floor(bar / phraseBars)
  const inPhrase = bar - pass * phraseBars
  return {
    step,
    bar,
    i,
    beat: Math.floor(i / STEPS_PER_BEAT),
    onBeat: i % STEPS_PER_BEAT === 0,
    inPhrase,
    pass,
    firstBar: inPhrase === 0,
    lastBar: inPhrase === phraseBars - 1,
  }
}

/**
 * The section bar `bar` is in: each section lasts one phrase, and the form repeats. Bars before
 * 0 count as bar 0. With `FORM` and an 8 bar phrase, bars 0 to 7 are `A` and 24 to 31 are `D`.
 */
export function sectionAt<S>(form: readonly S[], bar: number, phraseBars: number): S {
  if (form.length === 0) throw new RangeError('form is empty')
  const pass = Math.floor(Math.max(0, bar) / phraseBars)
  return form[pass % form.length] as S
}

/**
 * Step `i` of bar `bar` of a line written a bar at a time and played round: a line of 32 steps
 * plays its first 16 on even bars and its second on odd ones. A line shorter than a bar repeats
 * within it. `undefined` for an empty line.
 */
export function lineAt<T>(
  line: readonly T[],
  bar: number,
  i: number,
  stepsPerBar = STEPS_PER_BAR,
): T | undefined {
  const n = line.length
  if (n === 0) return undefined
  const bars = Math.max(1, Math.floor(n / stepsPerBar))
  const at = (((bar % bars) + bars) % bars) * stepsPerBar + i
  return line[((at % n) + n) % n]
}

/**
 * How many steps the note at `pos` of `line` holds: up to the next note, at most `max`. A rest is
 * `null` or `undefined`. Without `wrap` the line's end stops it; with `wrap` the count runs round
 * to the line's start.
 */
export function holdSteps(
  line: readonly (number | null | undefined)[],
  pos: number,
  max: number,
  wrap = false,
): number {
  const n = line.length
  let len = 1
  while (len < max && (wrap || pos + len < n) && line[(pos + len) % n] == null) len++
  return len
}

/** How hard each character of a drum string hits, 0 to 1. Characters missing here are rests. */
export type DrumWeights = Readonly<Record<string, number>>
/** `X` an accent, `x` a hit, `o` a ghost; anything else (`.`, say) a rest. */
export const DRUM_WEIGHTS: DrumWeights = { X: 1, x: 0.75, o: 0.35 }

/**
 * The hit at step `i` of a drum string, a character a step (`'X...x...X...x...'`), 0 for none.
 * The string repeats, so a 16 character string is one bar. An empty string never hits.
 */
export function hitAt(pattern: string, i: number, weights: DrumWeights = DRUM_WEIGHTS): number {
  const n = pattern.length
  if (n === 0) return 0
  return weights[pattern[((i % n) + n) % n] as string] ?? 0
}

/** How late step `step` plays, seconds: the off steps (odd ones) by `swing` of a step. */
export function swingOffset(step: number, stepLen: number, swing: number): number {
  return Math.abs(step % 2) === 1 ? swing * stepLen : 0
}

/** Steps from `step` to the next multiple of `grid`: 0 when `step` is on it. */
export function stepsToGrid(step: number, grid: number): number {
  return (((grid - (step % grid)) % grid) + grid) % grid
}

/**
 * Time `t` on a grid of `len` seconds counted from `origin` (the time of step 0): the nearest
 * grid line, or the next at or after `t`.
 */
export function snapToGrid(t: number, origin: number, len: number, to: 'nearest' | 'next'): number {
  const round = to === 'nearest' ? Math.round : Math.ceil
  return origin + round((t - origin) / len) * len
}

/**
 * The bar to carry a song on from when it restarts `bars` bars after its bar 0 (fractional):
 * `'top'` is bar 0, `'bar'` the nearest bar line ahead (a quarter bar behind still counts as
 * this one), `'phrase'` the start of the next phrase.
 */
export function resumeBar(
  bars: number,
  phraseBars: number,
  from: 'top' | 'bar' | 'phrase',
): number {
  if (from === 'top') return 0
  const bar = Math.max(0, Math.ceil(bars - 0.25))
  return from === 'phrase' ? Math.ceil(bar / phraseBars) * phraseBars : bar
}
