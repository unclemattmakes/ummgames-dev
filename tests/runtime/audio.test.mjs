/**
 * runtime/audio, run in node. The files are TypeScript, which Vitest transforms; the path is
 * built at run time so this repo's own typecheck leaves them to runtime/tsconfig.json.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

/** @param {string} rel @returns {Promise<any>} */
const load = (rel) =>
  import(/* @vite-ignore */ new URL(`../../runtime/${rel}`, import.meta.url).href)

describe('audio/pitch', async () => {
  const {
    note,
    dbToGain,
    degree,
    chordTones,
    MINOR,
    MAJOR,
    PENTATONIC_MINOR,
    DORIAN,
    HARMONIC_MINOR,
    LYDIAN,
    MIXOLYDIAN,
    PHRYGIAN,
    PHRYGIAN_DOMINANT,
  } = await load('audio/pitch.ts')

  it('tunes from A4 = 440 in equal temperament', () => {
    expect(note(0)).toBe(440)
    expect(note(12)).toBe(880)
    expect(note(-12)).toBe(220)
    expect(note(3)).toBeCloseTo(523.2511, 3) // C5
  })

  it('turns decibels into gain', () => {
    expect(dbToGain(0)).toBe(1)
    expect(dbToGain(20)).toBeCloseTo(10)
    expect(dbToGain(-6)).toBeCloseTo(0.5012, 4)
  })

  it('wraps degrees into the octaves above and below, negative degrees included', () => {
    expect([0, 1, 2, 6].map((d) => degree(MINOR, d))).toEqual([0, 2, 3, 10])
    expect(degree(MINOR, 7)).toBe(12)
    expect(degree(MINOR, 9)).toBe(15)
    expect(degree(MINOR, -1)).toBe(-2)
    expect(degree(MINOR, -7)).toBe(-12)
    expect(degree(MINOR, -8)).toBe(-14)
    expect(degree(MAJOR, 14)).toBe(24)
    expect(degree(PENTATONIC_MINOR, 5)).toBe(12)
    expect(degree(PENTATONIC_MINOR, -1)).toBe(-2)
  })

  it('has seven-note modes that differ from their parents where they should', () => {
    for (const s of [MINOR, MAJOR, DORIAN, HARMONIC_MINOR, LYDIAN, MIXOLYDIAN, PHRYGIAN_DOMINANT])
      expect(s).toHaveLength(7)
    expect(DORIAN[5]).toBe(MINOR[5] + 1)
    expect(HARMONIC_MINOR[6]).toBe(MINOR[6] + 1)
    expect(LYDIAN[3]).toBe(MAJOR[3] + 1)
    expect(MIXOLYDIAN[6]).toBe(MAJOR[6] - 1)
    expect(PHRYGIAN_DOMINANT[2]).toBe(PHRYGIAN[2] + 1)
  })

  it('builds chords in thirds on any degree', () => {
    expect(chordTones(MAJOR, 0)).toEqual([0, 4, 7])
    expect(chordTones(MINOR, 5)).toEqual([8, 12, 15]) // VI in minor
    expect(chordTones(MAJOR, 4, 4)).toEqual([7, 11, 14, 17]) // V7
    expect(chordTones(MINOR, -1)).toEqual([-2, 2, 5]) // VII below the tonic
  })
})

describe('audio/step-clock', async () => {
  const { advanceSteps, createTicker } = await load('audio/step-clock.ts')
  const STEP = 0.125
  const LOOK = 0.1

  /** Run advanceSteps at each time, and record every step it queues. */
  function drive(/** @type {number[]} */ times, start = 0) {
    const cursor = { step: 0, next: start }
    /** @type {[number, number][]} */
    const played = []
    const counts = times.map((now) =>
      advanceSteps(cursor, now, STEP, LOOK, (/** @type {number} */ s, /** @type {number} */ at) =>
        played.push([s, at]),
      ),
    )
    return { cursor, played, counts }
  }

  it('queues each step exactly once across calls, at its own time, and returns the counts', () => {
    const times = Array.from({ length: 100 }, (_, i) => i * 0.025) // a 25 ms timer for 2.5 s
    const { played, counts, cursor } = drive(times)
    const steps = played.map(([s]) => s)
    expect(steps).toEqual(steps.map((_, i) => i))
    for (const [s, at] of played) expect(at).toBeCloseTo(s * STEP, 9)
    expect(counts.reduce((a, b) => a + b, 0)).toBe(played.length)
    expect(counts[0]).toBe(1) // only step 0 starts before 0.1
    expect(Math.max(...counts)).toBe(1)
    // Every step that starts before the last horizon was queued, and none after it.
    const horizon = (times.at(-1) ?? 0) + LOOK
    expect(played.length).toBe(Math.ceil(horizon / STEP))
    expect(cursor.next).toBeGreaterThanOrEqual(horizon)
  })

  it('queues a step on the call where it enters the look-ahead, not before', () => {
    const cursor = { step: 0, next: 1 }
    const at = /** @type {number[]} */ ([])
    expect(advanceSteps(cursor, 0.85, STEP, LOOK, () => at.push(0))).toBe(0)
    expect(advanceSteps(cursor, 0.95, STEP, LOOK, () => at.push(0))).toBe(1)
    expect(cursor).toEqual({ step: 1, next: 1.125 })
  })

  it('skips onto the grid after a stall, without a burst of missed steps', () => {
    const { cursor, played, counts } = drive([0, 0.05, 2.0, 2.025])
    // At 2.0 the cursor (0.25) is 1.75 s behind: steps 2 to 15 are skipped, not played.
    expect(counts).toEqual([1, 1, 1, 0])
    expect(played.map(([s]) => s)).toEqual([0, 1, 16])
    const last = /** @type {[number, number]} */ (played.at(-1))
    expect(last[1]).toBeCloseTo(2.0, 9) // on the grid: 16 * 0.125
    expect(last[1]).toBeGreaterThanOrEqual(2.0)
    expect(cursor.step).toBe(17)
  })

  it('lands on the next grid step when a stall ends between steps', () => {
    const { played } = drive([0, 1.05])
    // 1.05 is past step 8 (1.0), so the first step played is 9, at 1.125.
    expect(played.map(([s]) => s)).toEqual([0, 9])
    expect(/** @type {[number, number]} */ (played.at(-1))[1]).toBeCloseTo(1.125, 9)
  })

  it('does not skip a cursor that is late by less than stallSkip', () => {
    const cursor = { step: 4, next: 0.5 }
    const steps = /** @type {number[]} */ ([])
    advanceSteps(cursor, 0.54, STEP, LOOK, (/** @type {number} */ s) => steps.push(s))
    expect(steps).toEqual([4, 5]) // 4 plays late, 5 is at 0.625 < 0.64
    const skipped = { step: 4, next: 0.5 }
    const none = /** @type {number[]} */ ([])
    advanceSteps(skipped, 0.54, STEP, LOOK, (/** @type {number} */ s) => none.push(s), 0.01)
    expect(none).toEqual([5])
  })

  it('refuses a step length that would never advance', () => {
    expect(() => advanceSteps({ step: 0, next: 0 }, 0, 0, LOOK, () => {})).toThrow(RangeError)
    expect(() =>
      advanceSteps(
        { step: 0, next: 0 },
        0,
        () => 0,
        LOOK,
        () => {},
      ),
    ).toThrow(RangeError)
  })

  it('takes a step length per step, read after that step is queued', () => {
    // Two bars: 0.125 s steps, then the tempo doubles on the bar line at step 16.
    let fast = false
    const cursor = { step: 0, next: 0 }
    /** @type {[number, number][]} */
    const played = []
    const len = () => (fast ? 0.0625 : 0.125)
    advanceSteps(cursor, 0, len, 3, (/** @type {number} */ s, /** @type {number} */ at) => {
      if (s === 16) fast = true // the sequencer changes tempo as it queues the bar line
      played.push([s, at])
    })
    expect(/** @type {[number, number]} */ (played[16])[1]).toBeCloseTo(2, 9)
    expect(/** @type {[number, number]} */ (played[17])[1]).toBeCloseTo(2.0625, 9)
    expect(played.length).toBe(32) // 16 steps in 2 s, then 16 more in the next 1 s
    expect(cursor.next).toBeCloseTo(3, 9)
  })

  it('skips a stall step by step when the length is a function', () => {
    const cursor = { step: 0, next: 0 }
    const steps = /** @type {number[]} */ ([])
    const len = (/** @type {number} */ s) => (s < 8 ? 0.125 : 0.25)
    advanceSteps(cursor, 2.2, len, LOOK, (/** @type {number} */ s) => steps.push(s))
    // Steps 0 to 7 take 1 s, 8 to 11 the next; 12 starts at 2.0 (missed), 13 at 2.25 (queued).
    expect(steps).toEqual([13])
    expect(cursor).toEqual({ step: 14, next: 2.5 })
  })

  it('renders offline in one call', () => {
    const cursor = { step: 0, next: 0 }
    const n = advanceSteps(cursor, 0, STEP, 4, () => {}, Number.POSITIVE_INFINITY)
    expect(n).toBe(32)
  })

  describe('createTicker', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('starts once, stops, and starts again', () => {
      vi.useFakeTimers()
      const fn = vi.fn()
      const t = createTicker(fn, 25)
      expect(t.running).toBe(false)
      t.start()
      t.start() // a second start adds no second interval
      expect(t.running).toBe(true)
      vi.advanceTimersByTime(100)
      expect(fn).toHaveBeenCalledTimes(4)
      t.stop()
      expect(t.running).toBe(false)
      vi.advanceTimersByTime(100)
      expect(fn).toHaveBeenCalledTimes(4)
      t.stop()
      t.start()
      vi.advanceTimersByTime(50)
      expect(fn).toHaveBeenCalledTimes(6)
      t.stop()
    })
  })
})

/**
 * A stand-in for a BaseAudioContext: enough of Web Audio for the kit to build its graph, with
 * every node, connection, start, stop and param event recorded.
 */
function fakeContext(sampleRate = 8000) {
  /** @type {any[]} */
  const nodes = []
  const param = (/** @type {number} */ value = 0) => {
    /** @type {any[]} */
    const events = []
    const p = {
      value,
      events,
      setValueAtTime: (/** @type {number} */ v, /** @type {number} */ t) =>
        events.push(['set', v, t]),
      linearRampToValueAtTime: (/** @type {number} */ v, /** @type {number} */ t) =>
        events.push(['lin', v, t]),
      exponentialRampToValueAtTime: (/** @type {number} */ v, /** @type {number} */ t) => {
        if (v <= 0) throw new RangeError('exponential ramp to 0')
        events.push(['exp', v, t])
      },
    }
    return p
  }
  const node = (/** @type {string} */ kind, /** @type {Record<string, any>} */ extra = {}) => {
    const n = {
      kind,
      out: /** @type {any[]} */ ([]),
      disconnected: false,
      connect(/** @type {any} */ to) {
        n.out.push(to)
        return to
      },
      disconnect() {
        n.disconnected = true
      },
      ...extra,
    }
    nodes.push(n)
    return n
  }
  const source = (/** @type {string} */ kind, /** @type {Record<string, any>} */ extra) =>
    node(kind, {
      startAt: /** @type {number | null} */ (null),
      stopAt: /** @type {number | null} */ (null),
      onended: /** @type {(() => void) | null} */ (null),
      start(/** @type {number} */ t) {
        this.startAt = t
      },
      stop(/** @type {number} */ t) {
        this.stopAt = t
      },
      ...extra,
    })
  const ctx = {
    sampleRate,
    nodes,
    createBuffer: (
      /** @type {number} */ ch,
      /** @type {number} */ len,
      /** @type {number} */ rate,
    ) => {
      const data = Array.from({ length: ch }, () => new Float32Array(len))
      return {
        numberOfChannels: ch,
        length: len,
        duration: len / rate,
        getChannelData: (/** @type {number} */ c) => data[c],
      }
    },
    createGain: () => node('gain', { gain: param(1) }),
    createBiquadFilter: () =>
      node('filter', { type: 'lowpass', frequency: param(350), Q: param(1) }),
    createStereoPanner: () => node('pan', { pan: param(0) }),
    createOscillator: () =>
      source('osc', { type: 'sine', frequency: param(440), detune: param(0) }),
    createBufferSource: () => source('noise', { buffer: null, loop: false }),
  }
  return ctx
}

describe('audio/synth', async () => {
  const { createKit, noiseBuffer, impulse, driveCurve, softClipCurve, softClip, FLOOR } =
    await load('audio/synth.ts')

  it('makes noise and reverb buffers of the asked length, inside -1..1', () => {
    const ctx = fakeContext(8000)
    const n = noiseBuffer(ctx)
    expect(n.length).toBe(8000)
    expect(noiseBuffer(ctx, 2).length).toBe(16000)
    const d = n.getChannelData(0)
    expect(d.every((/** @type {number} */ x) => x >= -1 && x < 1)).toBe(true)
    const r = impulse(ctx, 0.5, 2)
    expect([r.numberOfChannels, r.length]).toEqual([2, 4000])
    expect(r.getChannelData(0)[3999]).toBeCloseTo(0, 6) // decayed to nothing at the end
  })

  it('shapes curves: drive is odd and full scale, soft clip passes the middle and stays under 0.93', () => {
    const c = driveCurve(0.5)
    expect(c.length).toBe(1024)
    expect(c[0]).toBeCloseTo(-1, 6)
    expect(c[1023]).toBeCloseTo(1, 6)
    expect(driveCurve(0.5)).toBe(c) // cached
    expect(driveCurve(2)).toBe(driveCurve(1)) // clamped to 0..1
    const s = softClipCurve(2001)
    expect(s[1000]).toBe(0)
    expect(s[1500]).toBeCloseTo(0.5, 6)
    expect(Math.max(...s)).toBeLessThan(0.93)
    expect(s[2000]).toBeCloseTo(-s[0], 6)
  })

  it('softClip is the curve’s shape, one sample at a time', () => {
    const n = 2048
    const curve = softClipCurve(n)
    for (let i = 0; i < n; i++) {
      expect(Math.fround(softClip((i / (n - 1)) * 2 - 1))).toBe(curve[i])
    }
    expect(softClip(0.5)).toBe(0.5)
    expect(softClip(-0.69)).toBe(-0.69)
    expect(softClip(2)).toBeLessThan(1)
    expect(softClip(0.5, 0.4)).toBeGreaterThan(0.4)
    expect(softClip(0.5, 0.4)).toBeLessThan(0.5)
  })

  it('plays every voice, stops every source, and disconnects every node when the last ends', () => {
    const ctx = fakeContext()
    const kit = createKit(ctx, noiseBuffer(ctx))
    const out = { kind: 'out', connect: () => out }
    const n = { semi: -12, at: 1, dur: 0.25, vol: 0.5 }
    kit.kick(1, 0.8, out)
    kit.snare(1, 0.8, out)
    kit.clap(1, 0.8, out)
    kit.hat(1, 0.5, out)
    kit.hat(1, 0.5, out, true)
    kit.crash(1, 0.5, out)
    kit.tom(-5, 1, 0.5, out)
    kit.riser(1, 2, 0.4, out)
    kit.bass(n, out, 'sawtooth', 400)
    kit.pad([0, 3, 7], 1, 2, 0.4, out, 1200, 0.5)
    kit.pluck(n, out, 'square', 2000, -0.3)
    kit.lead(n, out, 'sawtooth', 1800)
    kit.stab([0, 4, 7], 1, 0.2, 0.4, out)

    const sources = ctx.nodes.filter((x) => x.kind === 'osc' || x.kind === 'noise')
    expect(sources.length).toBeGreaterThan(20)
    for (const s of sources) {
      expect(s.startAt, s.kind).toBeGreaterThanOrEqual(1)
      expect(s.stopAt, s.kind).toBeGreaterThan(s.startAt)
    }
    // Every exponential ramp ends at FLOOR or above: none can reach 0.
    for (const x of ctx.nodes) {
      for (const p of ['gain', 'frequency']) {
        for (const e of x[p]?.events ?? [])
          if (e[0] === 'exp') expect(e[1]).toBeGreaterThanOrEqual(FLOOR)
      }
    }
    // The last-ending source of each voice carries the cleanup; firing them frees the graph.
    for (const s of sources) s.onended?.()
    const live = ctx.nodes.filter((x) => !x.disconnected && x.kind !== 'out')
    expect(live).toEqual([])
  })
})
