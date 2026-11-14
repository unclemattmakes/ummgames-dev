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
