/**
 * runtime/audio's sequencer core (form, conductor, and the three with the step clock), run in
 * node. The files are TypeScript, which Vitest transforms; the path is built at run time so this
 * repo's own typecheck leaves them to runtime/tsconfig.json.
 */
import { describe, expect, it } from 'vitest'

/** @param {string} rel @returns {Promise<any>} */
const load = (rel) =>
  import(/* @vite-ignore */ new URL(`../../runtime/${rel}`, import.meta.url).href)

describe('audio/form', async () => {
  const {
    position,
    sectionAt,
    lineAt,
    holdSteps,
    hitAt,
    swingOffset,
    stepsToGrid,
    snapToGrid,
    resumeBar,
    FORM,
    STEPS_PER_BAR,
  } = await load('audio/form.ts')

  it('places a step in its bar, beat and phrase', () => {
    expect(position(0, 8)).toEqual({
      step: 0,
      bar: 0,
      i: 0,
      beat: 0,
      onBeat: true,
      inPhrase: 0,
      pass: 0,
      firstBar: true,
      lastBar: false,
    })
    expect(position(127, 8)).toMatchObject({ bar: 7, i: 15, beat: 3, onBeat: false, lastBar: true })
    expect(position(128, 8)).toMatchObject({ bar: 8, pass: 1, inPhrase: 0, firstBar: true })
    expect(position(70, 4)).toMatchObject({ bar: 4, i: 6, beat: 1, pass: 1, inPhrase: 0 })
    // A pickup before the downbeat is the last bar of phrase -1.
    expect(position(-1, 4)).toMatchObject({ bar: -1, i: 15, pass: -1, inPhrase: 3, lastBar: true })
    expect(position(13, 2, 12)).toMatchObject({ bar: 1, i: 1, beat: 0 }) // 3/4 in sixteenths
    expect(STEPS_PER_BAR).toBe(16)
  })

  it('walks the form a phrase per section, and round again', () => {
    const at = (/** @type {number} */ bar) => sectionAt(FORM, bar, 8)
    expect([0, 7, 8, 16, 24, 31, 32].map(at)).toEqual(['A', 'A', 'B', 'A2', 'D', 'D', 'A'])
    expect(at(-3)).toBe('A')
    expect(sectionAt(['A', 'B', 'A2', 'B'], 31, 8)).toBe('B') // a form with no breakdown
    expect(sectionAt(FORM, 4, 4)).toBe('B')
    expect(() => sectionAt([], 0, 8)).toThrow(RangeError)
  })

  it('reads a line written a bar at a time, played round', () => {
    const two = Array.from({ length: 32 }, (_, k) => k)
    expect(lineAt(two, 0, 3)).toBe(3)
    expect(lineAt(two, 1, 3)).toBe(19)
    expect(lineAt(two, 2, 3)).toBe(3)
    expect(lineAt(two, -1, 0)).toBe(16)
    const one = Array.from({ length: 16 }, (_, k) => k)
    expect(lineAt(one, 5, 15)).toBe(15)
    const half = [1, 2, 3, 4, 5, 6, 7, 8]
    expect(lineAt(half, 0, 9)).toBe(2) // shorter than a bar: it repeats within the bar
    expect(lineAt([], 0, 0)).toBeUndefined()
  })

  it('holds a note up to the next one, the line end or the cap', () => {
    const _ = null
    const line = [0, _, _, 3, _, _, _, _, _, _, _, _, _, _, 5, _]
    expect(holdSteps(line, 0, 8)).toBe(3)
    expect(holdSteps(line, 3, 4)).toBe(4) // capped
    expect(holdSteps(line, 3, 16)).toBe(11)
    expect(holdSteps(line, 14, 8)).toBe(2) // the line ends
    expect(holdSteps(line, 14, 8, true)).toBe(2) // wraps: step 15 rests, the 0 at the start plays
    expect(holdSteps([_, _, 2, _], 2, 8, true)).toBe(4) // round to itself
    expect(holdSteps([_, _, 2, _], 2, 8)).toBe(2)
    expect(holdSteps([undefined, 1], 1, 4, true)).toBe(2) // undefined is a rest too
  })

  it('reads drum strings, repeating, with weights of its own or the game’s', () => {
    expect([0, 1, 2, 3, 4].map((i) => hitAt('X.x.o...', i))).toEqual([1, 0, 0.75, 0, 0.35])
    expect(hitAt('X.x.o...', 8)).toBe(1)
    expect(hitAt('', 3)).toBe(0)
    const weights = { x: 1, o: 0.45 }
    expect([0, 1, 2].map((i) => hitAt('xo.', i, weights))).toEqual([1, 0.45, 0])
    expect(hitAt('X', 0, weights)).toBe(0)
  })

  it('swings the off steps', () => {
    expect(swingOffset(4, 0.125, 0.2)).toBe(0)
    expect(swingOffset(5, 0.125, 0.2)).toBeCloseTo(0.025, 12)
    expect(swingOffset(-1, 0.125, 0.2)).toBeCloseTo(0.025, 12)
  })

  it('finds the next grid step and the nearest grid time', () => {
    expect([5, 8, 15, -1].map((s) => stepsToGrid(s, 4))).toEqual([3, 0, 1, 1])
    expect(snapToGrid(1.3, 0.1, 0.5, 'nearest')).toBeCloseTo(1.1, 12)
    expect(snapToGrid(1.3, 0.1, 0.5, 'next')).toBeCloseTo(1.6, 12)
    expect(snapToGrid(1.1, 0.1, 0.5, 'next')).toBeCloseTo(1.1, 12)
  })

  it('carries a song on from the next bar or phrase line', () => {
    expect(resumeBar(5.3, 4, 'top')).toBe(0)
    expect(resumeBar(5.1, 4, 'bar')).toBe(5) // a hair past bar 5 still lands on it
    expect(resumeBar(5.3, 4, 'bar')).toBe(6)
    expect(resumeBar(5.3, 4, 'phrase')).toBe(8)
    expect(resumeBar(-2, 4, 'bar')).toBe(0)
  })
})

describe('audio/conductor', async () => {
  const { Conductor, levelFor } = await load('audio/conductor.ts')
  const LEVELS = [0, 0.2, 0.4, 0.6]

  it('picks a level from intensity, holding within the hysteresis under it', () => {
    expect(levelFor(0.45, 0, LEVELS, 0.05)).toBe(2)
    expect(levelFor(0.38, 2, LEVELS, 0.05)).toBe(2)
    expect(levelFor(0.34, 2, LEVELS, 0.05)).toBe(1)
    expect(levelFor(0.38, 1, LEVELS, 0.05)).toBe(1) // hysteresis never lifts a level
    expect(levelFor(1, 0, LEVELS)).toBe(3)
    expect(levelFor(0.5, 9, LEVELS, 0.05)).toBe(2) // no threshold for 9: nothing to hold
  })

  /** @param {any} c @param {number} from @param {number} to */
  const run = (c, from, to) => {
    const plans = []
    for (let s = from; s < to; s++) plans.push(c.at(s))
    return plans
  }

  it('changes song on the next bar line, never mid-bar', () => {
    const c = new Conductor({ song: 'meadow' })
    expect(c.at(0)).toMatchObject({ song: 'meadow', bar: 0, songBar: 0, newSong: false })
    c.cue('boss')
    expect(c.pending).toEqual({ song: 'boss', on: 'bar' })
    expect(run(c, 1, 16).every((/** @type {any} */ p) => p.song === 'meadow')).toBe(true)
    expect(c.at(16)).toMatchObject({ song: 'boss', bar: 1, i: 0, songBar: 0, newSong: true })
    expect(c.at(17).newSong).toBe(false)
    expect(c.at(32).songBar).toBe(1)
    expect(c.pending).toBeNull()
  })

  it('waits for a phrase line when asked', () => {
    const c = new Conductor({ song: 'a', phraseBars: 4 })
    run(c, 0, 20)
    c.cue('b', 'phrase')
    const plans = run(c, 20, 80)
    const first = plans.find((/** @type {any} */ p) => p.song === 'b')
    expect(first).toMatchObject({ step: 64, bar: 4, newSong: true })
  })

  it('cancels a waiting cue when the song playing is cued again, and the last cue wins', () => {
    const c = new Conductor({ song: 'a' })
    c.at(0)
    c.cue('b')
    c.cue('a')
    expect(c.pending).toBeNull()
    expect(c.at(16).song).toBe('a')
    c.cue('b')
    c.cue('c')
    expect(c.at(32).song).toBe('c')
  })

  it('starts on a song cued before the first step, without calling it new', () => {
    const c = new Conductor({ song: 'title' })
    c.cue('run')
    expect(c.at(0)).toMatchObject({ song: 'run', newSong: false, songBar: 0 })
  })

  it('raises a level on the bar line and drops it at the boundary the options give', () => {
    const c = new Conductor({ song: 'a', rise: 'bar', fall: 'step' })
    run(c, 0, 5)
    c.setLevel(3)
    expect(c.target).toBe(3)
    expect(run(c, 5, 16).every((/** @type {any} */ p) => p.level === 0)).toBe(true)
    expect(c.at(16)).toMatchObject({ level: 3, levelChange: 3 })
    expect(c.at(17).levelChange).toBe(0)
    run(c, 18, 21)
    c.setLevel(1)
    expect(c.at(21)).toMatchObject({ level: 1, levelChange: -2 })
  })

  it('lets one change wait for a different boundary', () => {
    const c = new Conductor({ song: 'a', level: 3 }) // falls wait for the bar by default
    run(c, 0, 18)
    c.setLevel(0, 'beat') // a hit: knocked back on the next beat
    expect(c.at(18).level).toBe(3)
    expect(c.at(19).level).toBe(3)
    expect(c.at(20)).toMatchObject({ level: 0, levelChange: -3 })
  })

  it('cancels a rise that falls back before its bar line', () => {
    const c = new Conductor({ song: 'a', level: 2 })
    c.at(0)
    c.setLevel(4)
    c.setLevel(2)
    expect(run(c, 1, 33).every((/** @type {any} */ p) => p.level === 2)).toBe(true)
  })

  it('maps intensity through its thresholds and hysteresis', () => {
    const c = new Conductor({ song: 'a', thresholds: LEVELS, hysteresis: 0.05, rise: 'step' })
    c.at(0)
    expect(c.setIntensity(0.45)).toBe(2)
    expect(c.at(1).level).toBe(2)
    expect(c.setIntensity(0.38)).toBe(2) // within the hysteresis: held
    expect(c.setIntensity(0.3)).toBe(1)
    expect(c.at(2).level).toBe(2) // falls wait for the bar
    expect(c.at(16).level).toBe(1)
  })

  it('holds a change past a stall that skipped its line, to the next line queued', () => {
    const c = new Conductor({ song: 'a' })
    c.at(0)
    c.cue('b')
    c.setLevel(2)
    // The step clock skipped steps 1 to 36: bar lines 16 and 32 were never queued.
    expect(c.at(37)).toMatchObject({ song: 'a', level: 0 })
    run(c, 38, 48)
    expect(c.at(48)).toMatchObject({ song: 'b', level: 2, bar: 3, songBar: 0, newSong: true })
  })

  it('answers the same step twice with the same plan, and starts over on a step back', () => {
    const c = new Conductor({ song: 'a' })
    run(c, 0, 40)
    const p = c.at(40)
    expect(c.at(40)).toBe(p)
    expect(c.at(0)).toMatchObject({ bar: 0, songBar: 0 })
  })

  it('refuses a bar, beat or phrase of no steps', () => {
    expect(() => new Conductor({ song: 'a', stepsPerBar: 0 })).toThrow(RangeError)
  })
})

describe('audio: the step clock, conductor and form together', async () => {
  const { advanceSteps } = await load('audio/step-clock.ts')
  const { Conductor } = await load('audio/conductor.ts')
  const { position, sectionAt, FORM } = await load('audio/form.ts')

  /**
   * A scripted session on a 25 ms timer: the game's intensity climbs, a boss turns up, a stall
   * drops a second and a half of timer ticks. Returns every queued step's plan, as plain data.
   */
  function session() {
    const c = new Conductor({ song: 'run', thresholds: [0, 0.3, 0.6], hysteresis: 0.05 })
    const cursor = { step: 0, next: 0.05 }
    /** @type {any[]} */
    const out = []
    for (let tick = 0; tick < 800; tick++) {
      const now = tick * 0.025
      if (tick >= 260 && tick < 330) continue // the tab was hidden
      c.setIntensity(Math.min(1, now / 8))
      if (tick === 250) c.cue('boss', 'phrase')
      advanceSteps(
        cursor,
        now,
        0.125,
        0.1,
        (/** @type {number} */ step, /** @type {number} */ at) => {
          const plan = c.at(step)
          const pos = position(step, 4)
          out.push({ ...plan, at, section: sectionAt(FORM, pos.bar, 4) })
        },
      )
    }
    return out
  }

  it('replays the same session exactly', () => {
    expect(session()).toEqual(session())
  })

  it('changes level and song only on bar or phrase lines, even across the stall', () => {
    const plans = session()
    const steps = plans.map((p) => p.step)
    expect(steps.some((s, k) => k > 0 && s !== (steps[k - 1] ?? 0) + 1)).toBe(true) // it skipped
    const changes = plans.filter((p, k) => k > 0 && p.levelChange !== 0)
    expect(changes.map((p) => p.level)).toEqual([1, 2])
    for (const p of changes) expect(p.i).toBe(0)
    const boss = plans.find((p) => p.song === 'boss')
    expect(boss).toMatchObject({ newSong: true, i: 0, songBar: 0 })
    expect((boss?.bar ?? 1) % 8).toBe(0) // the default 8 bar phrase line
    expect(plans.find((p) => p.bar === 4)?.section).toBe('B')
  })
})
