import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { API, apiKey, call, inPool, transcribe, wordsOf } from '../../src/voice/index.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'umm-dev-voice-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

/** A fetch reply. @param {number} status @param {unknown} body @param {string} [type] */
function reply(status, body, type = 'application/json') {
  const bytes = typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body)
  return new Response(/** @type {BodyInit} */ (bytes), {
    status,
    headers: { 'content-type': type },
  })
}

describe('wordsOf', () => {
  it('compares text asked for with text heard', () => {
    expect(wordsOf("We'll be right back with round 2!")).toBe(
      wordsOf('We’ll be... right back, with round two.'),
    )
    expect(wordsOf("Rock n' roll")).toBe(wordsOf('Rock and roll'))
    expect(wordsOf('Ka-blendo!')).toBe('KABLENDO')
  })

  it('reads a dot before a domain ending as the word', () => {
    expect(wordsOf('Watch it on Example dot TV.')).toBe(wordsOf('Watch it on Example.tv'))
    expect(wordsOf('see site dot com')).toBe(wordsOf('see site.com'))
    // An ordinary full stop between sentences is not a dot.
    expect(wordsOf('It ended. Then')).toBe('ITENDEDTHEN')
  })

  it('keeps numbers of two or more digits as digits', () => {
    expect(wordsOf('Now 20 percent air')).toBe('NOW20PERCENTAIR')
  })
})

describe('inPool', () => {
  it('runs every item, never more than n at once', async () => {
    let now = 0
    let most = 0
    /** @type {number[]} */
    const done = []
    await inPool([1, 2, 3, 4, 5, 6, 7], 3, async (i) => {
      most = Math.max(most, ++now)
      await new Promise((r) => setTimeout(r, 5))
      now--
      done.push(i)
    })
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(most).toBe(3)
  })

  it('rejects when an item throws', async () => {
    await expect(
      inPool([1, 2], 2, async (i) => {
        if (i === 2) throw new Error('two')
      }),
    ).rejects.toThrow('two')
  })
})

describe('apiKey', () => {
  it('takes the environment first, trimmed', () => {
    expect(
      apiKey({ env: { ELEVENLABS_API_KEY: ' sk_env \n' }, root: tmp, platform: 'linux' }),
    ).toBe('sk_env')
  })

  it('then .env.local at the game root, quoted or not', () => {
    const root = fs.mkdtempSync(path.join(tmp, 'root-'))
    fs.writeFileSync(path.join(root, '.env.local'), 'OTHER=1\nELEVENLABS_API_KEY="sk_local"\n')
    expect(apiKey({ env: {}, root, platform: 'linux' })).toBe('sk_local')
    fs.writeFileSync(path.join(root, '.env.local'), 'ELEVENLABS_API_KEY = sk_bare\n')
    expect(apiKey({ env: {}, root, platform: 'linux' })).toBe('sk_bare')
  })

  it('throws without saying any key when there is none', () => {
    const root = fs.mkdtempSync(path.join(tmp, 'none-'))
    expect(() => apiKey({ env: {}, root, platform: 'linux' })).toThrow(
      'No ELEVENLABS_API_KEY in the environment, .env.local or the user variables.',
    )
  })
})

describe('call', () => {
  /** @type {import('vitest').Mock} */
  let fetch
  beforeEach(() => {
    fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('sends JSON with the key and parses a JSON reply', async () => {
    fetch.mockResolvedValue(reply(200, { tier: 'creator' }))
    const r = await call('POST', '/v1/text-to-voice', { a: 1 }, { key: 'sk_test' })
    expect(r).toEqual({ tier: 'creator' })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(`${API}/v1/text-to-voice`)
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'xi-api-key': 'sk_test', 'content-type': 'application/json' })
    expect(init.body).toBe('{"a":1}')
  })

  it('returns audio as a Buffer, and sends no body or content type on a GET', async () => {
    fetch.mockResolvedValue(reply(200, new Uint8Array([1, 2, 3]), 'audio/mpeg'))
    const r = await call('GET', '/v1/x', undefined, { key: 'k' })
    expect(Buffer.isBuffer(r)).toBe(true)
    expect([...r]).toEqual([1, 2, 3])
    expect(fetch.mock.calls[0][1].headers).toEqual({ 'xi-api-key': 'k' })
    expect(fetch.mock.calls[0][1].body).toBeUndefined()
  })

  it('reads the key from the game root when none is passed', async () => {
    const root = fs.mkdtempSync(path.join(tmp, 'call-'))
    fs.writeFileSync(path.join(root, '.env.local'), 'ELEVENLABS_API_KEY=sk_root\n')
    vi.stubEnv('ELEVENLABS_API_KEY', '')
    fetch.mockResolvedValue(reply(200, {}))
    await call('GET', '/v1/x', undefined, { root })
    expect(fetch.mock.calls[0][1].headers['xi-api-key']).toBe('sk_root')
    vi.unstubAllEnvs()
  })

  it('waits out a 429, doubling from 2 s', async () => {
    vi.useFakeTimers()
    fetch
      .mockResolvedValueOnce(reply(429, 'busy', 'text/plain'))
      .mockResolvedValueOnce(reply(429, 'busy', 'text/plain'))
      .mockResolvedValueOnce(reply(200, { ok: true }))
    const p = call('GET', '/v1/x', undefined, { key: 'k' })
    await vi.advanceTimersByTimeAsync(1999)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(4000)
    await expect(p).resolves.toEqual({ ok: true })
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('throws on an error status with the reply, and never the key', async () => {
    fetch.mockResolvedValue(reply(401, 'invalid api key', 'text/plain'))
    const err = await call('GET', '/v1/x', undefined, { key: 'sk_secret' }).catch((e) => e)
    expect(err.message).toBe('GET /v1/x: 401 invalid api key')
    expect(err.message).not.toContain('sk_secret')
  })
})

describe('transcribe', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends the take to Scribe and keeps only the words', async () => {
    const take = path.join(tmp, 'take.mp3')
    fs.writeFileSync(take, Buffer.from([0xff, 0xfb]))
    const fetch = vi.fn().mockResolvedValue(
      reply(200, {
        text: ' Hello there. ',
        words: [
          { text: 'Hello', type: 'word', start: 0.1, end: 0.4 },
          { text: ' ', type: 'spacing', start: 0.4, end: 0.5 },
          { text: 'there.', type: 'word', start: 0.5, end: 0.9 },
          { text: '(laughs)', type: 'audio_event', start: 0.9, end: 1.4 },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetch)
    const r = await transcribe(take, { key: 'k' })
    expect(r).toEqual({
      heard: 'Hello there.',
      speechEnds: 0.9,
      words: [
        { text: 'Hello', start: 0.1, end: 0.4 },
        { text: 'there.', start: 0.5, end: 0.9 },
      ],
    })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(`${API}/v1/speech-to-text`)
    expect(init.body).toBeInstanceOf(FormData)
    expect(init.body.get('model_id')).toBe('scribe_v2')
    expect(init.body.get('language_code')).toBe('eng')
    expect(init.headers['content-type']).toBeUndefined()
  })
})

describe('wordList and misses', async () => {
  const { misses, wordList } = await import('../../src/voice/index.mjs')

  it('reads words by the rules of wordsOf', () => {
    expect(wordList("We'll be right back with round 2!")).toEqual([
      'WELL',
      'BE',
      'RIGHT',
      'BACK',
      'WITH',
      'ROUND',
      'TWO',
    ])
    expect(wordList('see site.com')).toEqual(wordList('see site dot com'))
    expect(wordList('Ka-blendo')).toEqual(['KA', 'BLENDO'])
    expect(wordList('Mr Grey', { GREY: 'GRAY' })).toEqual(['MR', 'GRAY'])
  })

  it('counts the words a take got wrong', () => {
    expect(misses('The clock stopped at nine forty.', 'The clock, stopped at nine forty!')).toBe(0)
    expect(misses('Hold on', 'Old on')).toBe(1)
    expect(misses('a b c', 'a c')).toBe(1)
    expect(misses('a b', 'a b c d')).toBe(2)
    expect(misses('', 'hello')).toBe(1)
    expect(misses('Gray House', 'Grey House', { alike: { GREY: 'GRAY' } })).toBe(0)
  })
})

describe('takeKey, bestTake, packBins and writeBins', async () => {
  const { bestTake, packBins, takeKey, writeBins } = await import('../../src/voice/index.mjs')

  it('keys a take by everything that made it', () => {
    const k = takeKey('voice', 'eleven_v3', { stability: 0.5 }, 'Hello.', 101)
    expect(k).toMatch(/^[0-9a-f]{16}$/)
    expect(takeKey('voice', 'eleven_v3', { stability: 0.5 }, 'Hello.', 101)).toBe(k)
    expect(takeKey('voice', 'eleven_v3', { stability: 0.5 }, 'Hello.', 102)).not.toBe(k)
  })

  it('stops at the first clean take', async () => {
    const made = /** @type {number[]} */ ([])
    const best = await bestTake(
      [101, 202, 303],
      async (seed) => {
        made.push(seed)
        return `take-${seed}`
      },
      (_t, seed) => (seed === 202 ? 0 : 2),
    )
    expect(made).toEqual([101, 202])
    expect(best).toMatchObject({ seed: 202, made: 'take-202', miss: 0 })
    expect(best.tried.length).toBe(2)
  })

  it('keeps the closest take when none is clean, the earliest on a tie', async () => {
    const miss = /** @type {Record<number, number>} */ ({ 1: 3, 2: 1, 3: 1 })
    const best = await bestTake(
      [1, 2, 3],
      async (s) => s,
      (s) => miss[s] ?? 9,
    )
    expect(best.seed).toBe(2)
    expect(best.tried.map((t) => t.seed)).toEqual([1, 2, 3])
    await expect(
      bestTake(
        [],
        async () => 0,
        () => 0,
      ),
    ).rejects.toThrow('at least one seed')
  })

  it('packs pieces one bin a speaker, with offsets and the rest kept', () => {
    const { bins, cues } = packBins([
      { bin: 'host.bin', key: 'host|Hello.', bytes: Buffer.from('aaa'), ticks: 12 },
      { bin: 'guest.bin', key: 'guest|Sir.', bytes: Buffer.from('bb'), ticks: 4 },
      { bin: 'host.bin', key: 'host|Noted.', bytes: Buffer.from('cccc'), ticks: 9 },
    ])
    expect(bins['host.bin']?.toString()).toBe('aaacccc')
    expect(bins['guest.bin']?.toString()).toBe('bb')
    expect(cues).toEqual({
      'host|Hello.': { bin: 'host.bin', o: 0, n: 3, ticks: 12 },
      'guest|Sir.': { bin: 'guest.bin', o: 0, n: 2, ticks: 4 },
      'host|Noted.': { bin: 'host.bin', o: 3, n: 4, ticks: 9 },
    })
    const cue = cues['host|Noted.']
    const o = cue?.o ?? 0
    expect(bins['host.bin']?.subarray(o, o + (cue?.n ?? 0)).toString()).toBe('cccc')
    expect(
      packBins([{ bin: 'host.bin', key: 'k', bytes: Buffer.from('ab'), ticks: 2 }], { bin: false })
        .cues,
    ).toEqual({ k: { o: 0, n: 2, ticks: 2 } })
    expect(() =>
      packBins([
        { bin: 'a.bin', key: 'k', bytes: Buffer.from('a') },
        { bin: 'a.bin', key: 'k', bytes: Buffer.from('b') },
      ]),
    ).toThrow('given twice')
  })

  it('writes bins and clears stale ones on request', () => {
    const dir = path.join(tmp, 'bins')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'old.bin'), 'x')
    fs.writeFileSync(path.join(dir, 'keep.txt'), 'x')
    writeBins(dir, { 'a.bin': Buffer.from('a') })
    expect(fs.existsSync(path.join(dir, 'old.bin'))).toBe(true)
    const written = writeBins(dir, { 'a.bin': Buffer.from('ab') }, { clear: true })
    expect(written).toEqual([path.join(dir, 'a.bin')])
    expect(fs.readdirSync(dir).sort()).toEqual(['a.bin', 'keep.txt'])
    expect(fs.readFileSync(path.join(dir, 'a.bin'), 'utf8')).toBe('ab')
  })
})
