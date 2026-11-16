/**
 * runtime/audio/mix.ts, run in node against a fake audio context. The file is TypeScript, which
 * Vitest transforms; the path is built at run time so this repo's own typecheck leaves it to
 * runtime/tsconfig.json. The real graph is rendered in tests/runtime/mix.slow.test.mjs.
 */
import { describe, expect, it } from 'vitest'

/** @param {string} rel @returns {Promise<any>} */
const load = (rel) =>
  import(/* @vite-ignore */ new URL(`../../runtime/${rel}`, import.meta.url).href)

const { createMix, room, GLUE, LIMIT, DUCK } = await load('audio/mix.ts')
const { dbToGain } = await load('audio/pitch.ts')

/** A stand-in for a BaseAudioContext: every node and connection, and each param's events. */
function fakeContext(sampleRate = 8000) {
  /** @type {any[]} */
  const nodes = []
  const param = (/** @type {number} */ value = 0) => {
    /** @type {any[]} */
    const events = []
    return {
      value,
      events,
      setTargetAtTime: (
        /** @type {number} */ v,
        /** @type {number} */ t,
        /** @type {number} */ tc,
      ) => events.push(['target', v, t, tc]),
    }
  }
  const node = (/** @type {string} */ kind, /** @type {Record<string, any>} */ extra = {}) => {
    const n = {
      kind,
      out: /** @type {any[]} */ ([]),
      connect(/** @type {any} */ to) {
        n.out.push(to)
        return to
      },
      ...extra,
    }
    nodes.push(n)
    return n
  }
  const compressor = () =>
    node('compressor', {
      threshold: param(-24),
      knee: param(30),
      ratio: param(12),
      attack: param(0.003),
      release: param(0.25),
    })
  const destination = node('destination')
  const ctx = {
    sampleRate,
    nodes,
    destination,
    createBuffer: (
      /** @type {number} */ ch,
      /** @type {number} */ len,
      /** @type {number} */ rate,
    ) => {
      const data = Array.from({ length: ch }, () => new Float32Array(len))
      return {
        numberOfChannels: ch,
        length: len,
        sampleRate: rate,
        getChannelData: (/** @type {number} */ c) => data[c],
      }
    },
    createGain: () => node('gain', { gain: param(1) }),
    createDynamicsCompressor: compressor,
    createConvolver: () => node('convolver', { buffer: null }),
    createWaveShaper: () => node('shaper', { curve: null }),
  }
  return ctx
}

/** The chain of nodes from `n` to the destination, by kind. */
function path(/** @type {any} */ n) {
  const kinds = []
  for (let at = n; at; at = at.out[0]) kinds.push(at.kind)
  return kinds
}

describe('audio/mix', () => {
  it('builds each bus at its level into glue, limiter and master trim', () => {
    const ctx = fakeContext()
    const mix = createMix(ctx, { buses: { music: -21, sfx: -11, voice: 0 }, master: -1 })
    expect(Object.keys(mix.buses)).toEqual(['music', 'sfx', 'voice'])
    expect(mix.buses.music.gain.value).toBeCloseTo(dbToGain(-21), 9)
    expect(mix.buses.voice.gain.value).toBe(1)
    expect(mix.out.gain.value).toBeCloseTo(dbToGain(-1), 9)
    expect(path(mix.buses.sfx)).toEqual(['gain', 'compressor', 'compressor', 'gain', 'destination'])
    expect(mix.glue.threshold.value).toBe(GLUE.threshold)
    expect(mix.limit.ratio.value).toBe(LIMIT.ratio)
    expect(mix.verb).toBeNull()
  })

  it('takes compressor settings over the defaults, and drops either stage for null', () => {
    const ctx = fakeContext()
    const mix = createMix(ctx, { buses: { a: 0 }, glue: { ratio: 2 }, limit: null })
    expect(mix.glue.ratio.value).toBe(2)
    expect(mix.glue.knee.value).toBe(GLUE.knee)
    expect(mix.limit).toBeNull()
    expect(path(mix.buses.a)).toEqual(['gain', 'compressor', 'gain', 'destination'])
    const bare = createMix(fakeContext(), { buses: { a: 0 }, glue: null, limit: null })
    expect(path(bare.buses.a)).toEqual(['gain', 'gain', 'destination'])
  })

  it('puts a clip after the limiter, and goes into the node it is given', () => {
    const ctx = fakeContext()
    const into = { kind: 'into', out: [], connect: () => into }
    const curve = new Float32Array([-0.9, 0, 0.9])
    const mix = createMix(ctx, { buses: { a: 0 }, clip: curve, into })
    expect(path(mix.buses.a)).toEqual([
      'gain',
      'compressor',
      'compressor',
      'shaper',
      'gain',
      'into',
    ])
    expect(ctx.nodes.find((n) => n.kind === 'shaper').curve).toBe(curve)
  })

  it('sends a bypass bus past the glue, straight to the limiter', () => {
    const ctx = fakeContext()
    const mix = createMix(ctx, { buses: { music: 0, sfx: 0 }, bypass: ['sfx'] })
    expect(mix.buses.sfx.out[0]).toBe(mix.limit)
    expect(mix.buses.music.out[0]).toBe(mix.glue)
    const loose = createMix(fakeContext(), { buses: { sfx: 0 }, bypass: ['sfx'], limit: null })
    expect(path(loose.buses.sfx)).toEqual(['gain', 'gain', 'destination'])
  })

  it('ducks only the ducked buses under talk, down and back on their own time constants', () => {
    const ctx = fakeContext()
    const mix = createMix(ctx, {
      buses: { music: -21, bed: -36, voice: 0 },
      ducked: ['music', 'bed'],
    })
    expect(Object.keys(mix.ducks)).toEqual(['music', 'bed'])
    expect(path(mix.buses.music)).toEqual([
      'gain',
      'gain',
      'compressor',
      'compressor',
      'gain',
      'destination',
    ])
    mix.talk(2, true)
    mix.talk(5, false)
    const low = dbToGain(DUCK.by)
    for (const b of ['music', 'bed'])
      expect(mix.ducks[b].gain.events).toEqual([
        ['target', low, 2, DUCK.in / 3],
        ['target', 1, 5, DUCK.out / 3],
      ])
    expect(mix.buses.voice.gain.events).toEqual([])
    const quick = createMix(fakeContext(), {
      buses: { m: 0 },
      ducked: ['m'],
      duck: { by: -12, in: 0.03 },
    })
    quick.talk(1, true)
    expect(quick.ducks.m.gain.events[0]).toEqual(['target', dbToGain(-12), 1, 0.01])
  })

  it('refuses a ducked or bypass name that is not a bus', () => {
    expect(() => createMix(fakeContext(), { buses: { music: 0 }, ducked: ['muzak'] })).toThrow(
      'mix: muzak is not a bus',
    )
    expect(() => createMix(fakeContext(), { buses: { music: 0 }, bypass: ['sfx'] })).toThrow(
      'mix: sfx is not a bus',
    )
  })

  it('sets a level, solos stems, and brings each back at its own level', () => {
    const mix = createMix(fakeContext(), { buses: { music: -21, sfx: -11, bed: -36 } })
    mix.set('sfx', -6)
    expect(mix.buses.sfx.gain.value).toBeCloseTo(dbToGain(-6), 9)
    mix.solo('music')
    expect([mix.buses.music, mix.buses.sfx, mix.buses.bed].map((g) => g.gain.value)).toEqual([
      dbToGain(-21),
      0,
      0,
    ])
    mix.solo('music', 'sfx', 'bed')
    expect(mix.buses.sfx.gain.value).toBeCloseTo(dbToGain(-6), 9)
    expect(mix.buses.bed.gain.value).toBeCloseTo(dbToGain(-36), 9)
  })

  it('has a room: the same impulse every time, decaying to nothing, its return into the glue', () => {
    const ctx = fakeContext(8000)
    const mix = createMix(ctx, { buses: { sfx: 0 }, verb: { seconds: 0.5, wet: -14 } })
    const b = mix.verb.buffer
    expect([b.numberOfChannels, b.length]).toEqual([2, 4000])
    expect(path(mix.verb)).toEqual([
      'convolver',
      'gain',
      'compressor',
      'compressor',
      'gain',
      'destination',
    ])
    expect(mix.verb.out[0].gain.value).toBeCloseTo(dbToGain(-14), 9)
    const again = room(fakeContext(8000), 0.5)
    expect(again.getChannelData(0)).toEqual(b.getChannelData(0))
    expect(b.getChannelData(0)).not.toEqual(b.getChannelData(1))
    const d = b.getChannelData(0)
    expect(d.every((/** @type {number} */ x) => x >= -1 && x <= 1)).toBe(true)
    expect(Math.abs(d[3999])).toBeLessThan(1e-9)
    const slow = room(fakeContext(8000), 0.5, 1).getChannelData(0)
    expect(Math.abs(slow[3000])).toBeGreaterThan(Math.abs(d[3000]))
  })
})
