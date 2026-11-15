/**
 * runtime/audio/voice.ts, run in node against a fake audio context. The file is TypeScript, which
 * Vitest transforms; the path is built at run time so this repo's own typecheck leaves it to
 * runtime/tsconfig.json.
 */
import { describe, expect, it } from 'vitest'

/** @param {string} rel @returns {Promise<any>} */
const load = (rel) =>
  import(/* @vite-ignore */ new URL(`../../runtime/${rel}`, import.meta.url).href)

const { VoiceBins, VoicePlayer, voicePlan, voiceDue, VOICE_LATE } = await load('audio/voice.ts')

/** A promise the test resolves by hand. */
function later() {
  /** @type {(v?: any) => void} */
  let resolve = () => {}
  /** @type {(e?: any) => void} */
  let reject = () => {}
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/**
 * A fake context: a clock the test moves, gains and sources that record what was asked of them,
 * and a decoder that makes a buffer a tenth of a second per byte. With `hold`, each decode waits
 * for the test to release it.
 */
function fakeContext({ hold = false } = {}) {
  /** @type {any[]} */
  const sources = []
  /** @type {any[]} */
  const gains = []
  /** @type {{ bytes: ArrayBuffer, go: () => void }[]} */
  const decodes = []
  const ctx = {
    currentTime: 0,
    createGain() {
      const g = {
        ramps: /** @type {number[][]} */ ([]),
        gain: {
          value: 1,
          cancelScheduledValues() {},
          setValueAtTime() {},
          /** @param {number} v @param {number} t */
          linearRampToValueAtTime(v, t) {
            g.ramps.push([v, t])
          },
        },
        to: /** @type {any} */ (null),
        /** @param {any} n */
        connect(n) {
          g.to = n
          return n
        },
        disconnect() {},
      }
      gains.push(g)
      return g
    },
    createBufferSource() {
      const s = {
        buffer: null,
        playbackRate: { value: 1 },
        started: /** @type {number[] | null} */ (null),
        stopped: /** @type {number | null} */ (null),
        to: /** @type {any} */ (null),
        onended: /** @type {null | (() => void)} */ (null),
        /** @param {any} n */
        connect(n) {
          s.to = n
          return n
        },
        /** @param {number} when @param {number} from */
        start(when, from) {
          s.started = [when, from]
        },
        /** @param {number} t */
        stop(t) {
          s.stopped = t
        },
      }
      sources.push(s)
      return s
    },
    /** @param {ArrayBuffer} bytes */
    decodeAudioData(bytes) {
      const buf = { duration: bytes.byteLength / 10, bytes: new Uint8Array(bytes) }
      if (!hold) return Promise.resolve(buf)
      const d = later()
      decodes.push({ bytes, go: () => d.resolve(buf) })
      return d.promise
    },
  }
  return { ctx, sources, gains, decodes }
}

/** Bins served from memory: `a.bin` holds bytes 0 to 99. Counts each fetch. */
function memoryBins(files = { 'a.bin': Uint8Array.from({ length: 100 }, (_, i) => i) }) {
  const fetched = /** @type {string[]} */ ([])
  /** @type {Record<string, Uint8Array>} */
  const all = files
  const bins = new VoiceBins(
    /** @param {string} b */ (b) => `/voice/${b}`,
    /** @param {string} url */ async (url) => {
      fetched.push(url)
      const f = all[url.replace('/voice/', '')]
      return /** @type {any} */ ({
        ok: !!f,
        arrayBuffer: async () => f?.slice().buffer,
      })
    },
  )
  return { bins, fetched }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('audio/voice voicePlan', () => {
  it('plays one piece from the top', () => {
    expect(voicePlan([{ duration: 2 }])).toEqual({ parts: [{ index: 0, at: 0, from: 0 }], ends: 2 })
  })

  it("splices each piece in where the last one's words end", () => {
    const p = voicePlan(
      [{ duration: 1.5, end: 1.2 }, { duration: 0.8, end: 0.6 }, { duration: 1 }],
      { splice: 0.05 },
    )
    expect(p.parts.map((/** @type {any} */ x) => x.at)).toEqual([0, 1.25, expect.closeTo(1.9, 9)])
    expect(p.ends).toBeCloseTo(2.9, 9)
  })

  it('starts part way in when the line is late, leaving out what is past', () => {
    const p = voicePlan([{ duration: 1, end: 1 }, { duration: 2 }], { splice: 0, offset: 1.5 })
    expect(p.parts).toEqual([{ index: 1, at: 0, from: 0.5 }])
    expect(p.ends).toBe(1.5)
  })

  it("times a faster rate in real seconds and offsets in the take's seconds", () => {
    const p = voicePlan([{ duration: 2 }], { rate: 2, offset: 0.25 })
    expect(p.parts).toEqual([{ index: 0, at: 0, from: 0.5 }])
    expect(p.ends).toBe(0.75)
  })
})

describe('audio/voice voiceDue', () => {
  it('gives the events passed since the last frame, each with how late it is', () => {
    const track = /** @type {[number, string][]} */ ([
      [5, 'a'],
      [10, 'b'],
      [12, 'c'],
    ])
    expect(voiceDue(track, 5, 11)).toEqual([{ event: [10, 'b'], late: 1 }])
    expect(voiceDue(track, 0, 12).map((/** @type {any} */ d) => d.late)).toEqual([7, 2, 0])
  })
})

describe('audio/voice VoiceBins', () => {
  it('fetches a bin once, and a missing one is null', async () => {
    const { bins, fetched } = memoryBins()
    const [a, b] = await Promise.all([bins.load('a.bin'), bins.load('a.bin')])
    expect(a).toBe(b)
    expect(fetched).toEqual(['/voice/a.bin'])
    expect(bins.has('a.bin')).toBe(true)
    expect(await bins.load('gone.bin')).toBeNull()
    expect(bins.has('gone.bin')).toBe(false)
  })

  it('treats a failed fetch as missing', async () => {
    const bins = new VoiceBins(
      (/** @type {string} */ b) => b,
      () => Promise.reject(new Error('offline')),
    )
    expect(await bins.load('a.bin')).toBeNull()
  })
})

describe('audio/voice VoicePlayer', () => {
  it('says a piece: its own bytes, decoded, into the output', async () => {
    const { ctx, sources, gains } = fakeContext()
    const { bins } = memoryBins()
    const out = { name: 'out' }
    const v = new VoicePlayer({ ctx, out, bins })
    expect(await v.say('a.bin', { o: 10, n: 20 }, { label: 'hello' })).toBe('said')
    expect([...sources[0].buffer.bytes]).toEqual(Array.from({ length: 20 }, (_, i) => 10 + i))
    expect(sources[0].started).toEqual([0, 0])
    expect(sources[0].to).toBe(gains[0])
    expect(gains[0].to).toBe(out)
    expect(v.until()).toBe(2)
    expect(v.log).toEqual(['said:hello'])
  })

  it('decodes a piece once, keeps the last few, and drops the oldest', async () => {
    const { ctx } = fakeContext()
    const { bins } = memoryBins()
    let decoded = 0
    const real = ctx.decodeAudioData
    ctx.decodeAudioData = (b) => {
      decoded++
      return real(b)
    }
    const v = new VoicePlayer({ ctx, out: {}, bins, keep: 2 })
    const a = await v.decode('a.bin', { o: 0, n: 10 })
    expect(await v.decode('a.bin', { o: 0, n: 10 })).toBe(a)
    await v.decode('a.bin', { o: 10, n: 10 })
    await v.decode('a.bin', { o: 0, n: 10 }) // used again: now the newest
    await v.decode('a.bin', { o: 20, n: 10 }) // drops o: 10
    expect(decoded).toBe(3)
    await v.decode('a.bin', { o: 0, n: 10 })
    expect(decoded).toBe(3)
    await v.decode('a.bin', { o: 10, n: 10 })
    expect(decoded).toBe(4)
  })

  it('runs the board once on each decoded piece', async () => {
    const { ctx, sources } = fakeContext()
    const { bins } = memoryBins()
    const seen = /** @type {string[]} */ ([])
    const v = new VoicePlayer({
      ctx,
      out: {},
      bins,
      /** @type {(c: any, buf: any, bin: string) => any} */
      board: (_c, buf, bin) => {
        seen.push(bin)
        return { ...buf, boarded: true }
      },
    })
    await v.say('a.bin', { o: 0, n: 10 })
    await v.say('a.bin', { o: 0, n: 10 })
    expect(seen).toEqual(['a.bin'])
    expect(sources[1].buffer.boarded).toBe(true)
  })

  it('fades the line on the floor when a new one starts', async () => {
    const { ctx, sources, gains } = fakeContext()
    const { bins } = memoryBins()
    const v = new VoicePlayer({ ctx, out: {}, bins, cut: 0.1 })
    await v.say('a.bin', { o: 0, n: 30 })
    ctx.currentTime = 1
    await v.say('a.bin', { o: 30, n: 10 })
    expect(gains[0].ramps).toEqual([[0, 1.1]])
    expect(sources[0].stopped).toBeCloseTo(1.12, 9)
    expect(gains[1].ramps).toEqual([])
    expect(v.until()).toBe(2)
  })

  it('gives the floor to the newest line: one still decoding is cut', async () => {
    const { ctx, decodes } = fakeContext({ hold: true })
    const { bins } = memoryBins()
    const v = new VoicePlayer({ ctx, out: {}, bins })
    const first = v.say('a.bin', { o: 0, n: 10 }, { label: 'first' })
    const second = v.say('a.bin', { o: 10, n: 10 }, { label: 'second' })
    await tick()
    for (const d of decodes) d.go()
    expect(await second).toBe('said')
    expect(await first).toBe('cut')
  })

  it('lets an overlap line talk over the floor, uncut and not cutting', async () => {
    const { ctx, gains } = fakeContext()
    const { bins } = memoryBins()
    const v = new VoicePlayer({ ctx, out: {}, bins })
    await v.say('a.bin', { o: 0, n: 30 })
    await v.say('a.bin', { o: 30, n: 10 }, { overlap: true })
    expect(gains[0].ramps).toEqual([])
    await v.say('a.bin', { o: 40, n: 10 })
    expect(gains[0].ramps.length).toBe(1)
    expect(gains[1].ramps).toEqual([])
    expect(v.sounding).toBe(2)
  })

  it('drops a line already too late when asked, without loading it', async () => {
    const { ctx } = fakeContext()
    const { bins, fetched } = memoryBins()
    const v = new VoicePlayer({ ctx, out: {}, bins })
    expect(await v.say('a.bin', { o: 0, n: 10 }, { late: VOICE_LATE + 0.01, label: 'x' })).toBe(
      'late',
    )
    expect(fetched).toEqual([])
    expect(v.log).toEqual(['late:x'])
  })

  it('drops a line whose decode took it past the limit', async () => {
    const { ctx, decodes } = fakeContext({ hold: true })
    const { bins } = memoryBins()
    const v = new VoicePlayer({ ctx, out: {}, bins, late: 0.5 })
    const said = v.say('a.bin', { o: 0, n: 10 }, { late: 0.3 })
    await tick()
    ctx.currentTime = 0.3
    decodes[0]?.go()
    expect(await said).toBe('late')
  })

  it('with sync, starts as far into the take as the line is late', async () => {
    const { ctx, sources, decodes } = fakeContext({ hold: true })
    const { bins } = memoryBins()
    const v = new VoicePlayer({ ctx, out: {}, bins })
    const said = v.say('a.bin', { o: 0, n: 20 }, { late: 0.2, sync: true })
    await tick()
    ctx.currentTime = 0.1
    decodes[0]?.go()
    expect(await said).toBe('said')
    expect(sources[0].started[0]).toBe(0.1)
    expect(sources[0].started[1]).toBeCloseTo(0.3, 9)
    expect(v.until()).toBeCloseTo(1.8, 9)
  })

  it('splices several pieces as one line, at a rate, after a delay', async () => {
    const { ctx, sources } = fakeContext()
    const { bins } = memoryBins()
    const v = new VoicePlayer({ ctx, out: {}, bins, splice: 0 })
    await v.say(
      'a.bin',
      [
        { o: 0, n: 10, end: 0.8 },
        { o: 10, n: 10 },
      ],
      { rate: 2, delay: 0.02 },
    )
    expect(sources.map((s) => s.started[0])).toEqual([0.02, expect.closeTo(0.42, 9)])
    expect(sources.every((s) => s.playbackRate.value === 2)).toBe(true)
  })

  it('fails a line whose bin will not load, and the next one still plays', async () => {
    const { ctx } = fakeContext()
    const { bins } = memoryBins()
    const v = new VoicePlayer({ ctx, out: {}, bins })
    expect(await v.say('gone.bin', { o: 0, n: 10 }, { label: 'gone' })).toBe('failed')
    expect(await v.say('a.bin', { o: 0, n: 10 }, { label: 'here' })).toBe('said')
    expect(v.log).toEqual(['failed:gone', 'said:here'])
  })

  it('hushes everything, overlaps too, and takes the turn from a line decoding', async () => {
    const { ctx, gains, decodes } = fakeContext({ hold: true })
    const { bins } = memoryBins()
    const v = new VoicePlayer({ ctx, out: {}, bins })
    const a = v.say('a.bin', { o: 0, n: 10 })
    await tick()
    decodes[0]?.go()
    await a
    const b = v.say('a.bin', { o: 10, n: 10 }, { overlap: true })
    await tick()
    decodes[1]?.go()
    await b
    const c = v.say('a.bin', { o: 20, n: 10 })
    await tick()
    v.hush(0.2)
    expect(gains.map((g) => g.ramps)).toEqual([[[0, 0.2]], [[0, 0.2]]])
    decodes[2]?.go()
    expect(await c).toBe('cut')
    expect(v.until()).toBe(0)
  })

  it("takes a game's own schedule and keeps the floor around it", async () => {
    const { ctx, gains } = fakeContext()
    const { bins } = memoryBins()
    const calls = /** @type {any[]} */ ([])
    const v = new VoicePlayer({
      ctx,
      out: { name: 'out' },
      bins,
      /** @type {(c: any, buffers: any[], pieces: any[], when: number, offset: number, into: any) => any} */
      schedule: (c, buffers, pieces, when, offset, into) => {
        calls.push({ n: buffers.length, pieces, when, offset, into })
        const g = c.createGain()
        const s = c.createBufferSource()
        return { gains: [g], sources: [s], ends: when + 5 }
      },
    })
    const into = { name: 'chain' }
    await v.say('a.bin', { o: 0, n: 10 }, { into })
    expect(calls[0]).toMatchObject({ n: 1, when: 0, offset: 0, into })
    expect(v.until()).toBe(5)
    await v.say('a.bin', { o: 10, n: 10 })
    expect(gains[0].ramps.length).toBe(1)
  })
})
