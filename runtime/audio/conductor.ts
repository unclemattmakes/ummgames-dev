/**
 * The conductor of a step sequencer: it decides which song plays and how many layers of it, and
 * holds each change until the music can take it. The game says what it wants at any time (`cue`
 * a song, `setLevel` or `setIntensity`); the sequencer asks `at(step)` for every step it queues
 * and plays what the answer says. A song changes on a bar or phrase line, a level rises on a bar
 * line and falls when the game chooses, so the music never lurches mid-phrase.
 *
 * Pure: no clock, no Web Audio, no imports. The same calls give the same plans, so a test or an
 * offline render can replay it exactly. A "song" is whatever the game switches between on bar
 * lines: a track, a variant of one (a boss version), a biome's section.
 */

/** Where a change waits for: the next step queued, the next beat, or the next bar line. */
export type Boundary = 'step' | 'beat' | 'bar'

/**
 * The level for intensity `v`: the highest whose threshold `v` reaches. `thresholds[k]` is where
 * level `k` comes in, rising, with `thresholds[0]` 0. A fall from `prev` waits until `v` is more
 * than `hysteresis` under `prev`'s threshold, so a level never flickers on and off.
 */
export function levelFor(
  v: number,
  prev: number,
  thresholds: readonly number[],
  hysteresis = 0,
): number {
  let level = 0
  for (let k = 1; k < thresholds.length; k++) if (v >= (thresholds[k] as number)) level = k
  const hold = thresholds[prev]
  if (level < prev && hold !== undefined && v >= hold - hysteresis) return prev
  return level
}

export interface ConductorOptions<S extends string> {
  /** The song it starts on. */
  song: S
  /** The level it starts at. Default 0. */
  level?: number
  /** For `setIntensity`: the intensity, 0 to 1, at which each level comes in. Default `[0]`. */
  thresholds?: readonly number[]
  /** For `setIntensity`: how far under its threshold a level holds. Default 0. */
  hysteresis?: number
  /** When a rise is heard. Default `'bar'`. */
  rise?: Boundary
  /** When a fall is heard. Default `'bar'`. */
  fall?: Boundary
  /** Steps in a bar. Default 16. */
  stepsPerBar?: number
  /** Steps in a beat. Default 4. */
  stepsPerBeat?: number
  /** Bars in a phrase, for `cue(song, 'phrase')`. Default 8. */
  phraseBars?: number
}

/** What plays on one step. */
export interface StepPlan<S extends string> {
  /** The step, as given to `at`. */
  step: number
  /** Its bar: `floor(step / stepsPerBar)`. */
  bar: number
  /** The step within its bar. */
  i: number
  /** The song playing. */
  song: S
  /** Bars since this song began (0 on its first bar). */
  songBar: number
  /** The level playing. */
  level: number
  /** A cue changed the song on this step (never on the first step asked for). */
  newSong: boolean
  /** The level now minus the level on the step before: over 0 for a rise, under 0 for a fall. */
  levelChange: number
}

/** A song waiting for its line. */
export interface PendingCue<S extends string> {
  song: S
  on: 'bar' | 'phrase'
}

export class Conductor<S extends string> {
  private readonly thresholds: readonly number[]
  private readonly hysteresis: number
  private readonly rise: Boundary
  private readonly fall: Boundary
  private readonly stepsPerBar: number
  private readonly stepsPerBeat: number
  private readonly phraseBars: number
  private current: S
  private heard: number
  private wanted: number
  private due: Boundary = 'bar'
  private waiting: PendingCue<S> | null = null
  private songStart: number | null = null
  private last: number | null = null
  /** The last plan `at` returned; `null` before the first step. */
  plan: StepPlan<S> | null = null

  constructor(options: ConductorOptions<S>) {
    this.current = options.song
    this.heard = Math.max(0, Math.round(options.level ?? 0))
    this.wanted = this.heard
    this.thresholds = options.thresholds ?? [0]
    this.hysteresis = options.hysteresis ?? 0
    this.rise = options.rise ?? 'bar'
    this.fall = options.fall ?? 'bar'
    this.stepsPerBar = options.stepsPerBar ?? 16
    this.stepsPerBeat = options.stepsPerBeat ?? 4
    this.phraseBars = options.phraseBars ?? 8
    if (!(this.stepsPerBar > 0 && this.stepsPerBeat > 0 && this.phraseBars > 0))
      throw new RangeError('stepsPerBar, stepsPerBeat and phraseBars must be over 0')
  }

  /** The song playing. */
  get song(): S {
    return this.current
  }

  /** The level playing. */
  get level(): number {
    return this.heard
  }

  /** The level the game last asked for: where `level` is heading. */
  get target(): number {
    return this.wanted
  }

  /** The song waiting for its line, if any. */
  get pending(): PendingCue<S> | null {
    return this.waiting
  }

  /**
   * Change to `song` on the next bar line, or the next phrase line with `'phrase'`. A later cue
   * replaces a waiting one; cueing the song already playing cancels it.
   */
  cue(song: S, on: 'bar' | 'phrase' = 'bar'): void {
    this.waiting = song === this.current ? null : { song, on }
  }

  /**
   * Ask for `level` (rounded, 0 or more). It is heard at the options' `rise` or `fall` boundary,
   * or at `when` if given: a hit can knock the music back on the next beat though falls usually
   * wait for the bar.
   */
  setLevel(level: number, when?: Boundary): void {
    const to = Math.max(0, Math.round(level))
    this.wanted = to
    if (to !== this.heard) this.due = when ?? (to > this.heard ? this.rise : this.fall)
  }

  /**
   * Ask for the level that intensity `v` (0 to 1) reaches on the options' `thresholds`, with
   * their `hysteresis` held under the level last asked for. Returns that level.
   */
  setIntensity(v: number, when?: Boundary): number {
    const level = levelFor(v, this.wanted, this.thresholds, this.hysteresis)
    this.setLevel(level, when)
    return level
  }

  /**
   * What plays on `step`. Call it once for every step the sequencer queues, in order. A change
   * lands only on a step that is on its line, so a song or a level never changes mid-bar: after
   * a stall that skipped a bar line, it waits for the next one. The first step asked for, and a
   * step before the last one (a restart), count as on every line. Asking for the same step twice
   * returns the same plan.
   */
  at(step: number): StepPlan<S> {
    const last = this.last
    if (this.plan && step === last) return this.plan
    const fresh = last === null || step < last
    const on = (unit: number) => fresh || step % unit === 0
    const bar = Math.floor(step / this.stepsPerBar)
    const barLine = on(this.stepsPerBar)
    let newSong = false
    const w = this.waiting
    if (w && barLine && (w.on === 'bar' || on(this.stepsPerBar * this.phraseBars))) {
      this.current = w.song
      this.waiting = null
      this.songStart = bar
      newSong = last !== null
    }
    if (this.songStart === null || (fresh && last !== null)) this.songStart = bar
    const before = this.heard
    if (this.wanted !== this.heard) {
      const due = this.due
      if (due === 'step' || (due === 'beat' && on(this.stepsPerBeat)) || barLine)
        this.heard = this.wanted
    }
    this.last = step
    this.plan = {
      step,
      bar,
      i: step - bar * this.stepsPerBar,
      song: this.current,
      songBar: bar - this.songStart,
      level: this.heard,
      newSong,
      levelChange: this.heard - before,
    }
    return this.plan
  }
}
