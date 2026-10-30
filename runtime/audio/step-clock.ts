/**
 * A look-ahead step clock for a Web Audio sequencer. A timer wakes every few tens of milliseconds
 * and queues every step that starts before `now + lookahead` at its exact audio time, so timing
 * comes from the audio clock, not from the timer. The sequencer writes only its own
 * `queue(step, at)`. Pure apart from `createTicker`; imports nothing.
 */

/** Where a sequencer is: the next step to queue, and the audio time it starts at, seconds. */
export interface StepCursor {
  step: number
  next: number
}

/**
 * Queue every step that starts before `now + lookahead`, calling `onStep(step, at)` for each, and
 * move the cursor past them. Returns how many steps it queued.
 *
 * When the cursor has fallen more than `stallSkip` seconds behind `now` (a throttled background
 * timer, a long stall), it first jumps forward onto the grid, to the first step at or after
 * `now`, without queuing the steps it missed. The music skips instead of playing a burst of late
 * notes. The step count still advances, so bar and phrase positions stay right.
 *
 * Times are seconds on one clock, such as `AudioContext.currentTime`. `stepLen` must be over 0.
 */
export function advanceSteps(
  cursor: StepCursor,
  now: number,
  stepLen: number,
  lookahead: number,
  onStep: (step: number, at: number) => void,
  stallSkip = 0.05,
): number {
  if (!(stepLen > 0)) throw new RangeError(`stepLen must be over 0, not ${stepLen}`)
  if (cursor.next < now - stallSkip) {
    const missed = Math.ceil((now - cursor.next) / stepLen)
    cursor.step += missed
    cursor.next += missed * stepLen
  }
  const horizon = now + lookahead
  let played = 0
  while (cursor.next < horizon) {
    onStep(cursor.step, cursor.next)
    cursor.step++
    cursor.next += stepLen
    played++
  }
  return played
}

/** A repeating timer that can be started and stopped any number of times. */
export interface Ticker {
  /** Start calling `fn` every `ms`. Does nothing while already running. */
  start(): void
  /** Stop. Does nothing while stopped. */
  stop(): void
  /** Whether it is running. */
  readonly running: boolean
}

/** Wrap `setInterval(fn, ms)` so a sequencer can start and stop its tick without tracking ids. */
export function createTicker(fn: () => void, ms: number): Ticker {
  let id: ReturnType<typeof setInterval> | null = null
  return {
    start() {
      if (id === null) id = setInterval(fn, ms)
    },
    stop() {
      if (id !== null) clearInterval(id)
      id = null
    },
    get running() {
      return id !== null
    },
  }
}
