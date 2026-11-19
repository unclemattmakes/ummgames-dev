/**
 * runtime/stats in node: a game's spec, the batch check, the Worker against a fake bucket, and
 * the page's queue. The files are TypeScript, which Vitest transforms; the path is built at run
 * time so this repo's own typecheck leaves them to runtime/tsconfig.json.
 */
import { describe, expect, it } from 'vitest'

/** @param {string} rel @returns {Promise<any>} */
const load = (rel) =>
  import(/* @vite-ignore */ new URL(`../../runtime/${rel}`, import.meta.url).href)

const batch = await load('stats/batch.ts')
const { statsWorker } = await load('stats/worker.ts')
const { createStatsQueue, MAX_QUEUE } = await load('stats/client.ts')

/** A small game: a renderer field, and `start` (a level) and `death` (a level and a spot) events. */
const SPEC = {
  version: 3,
  /** @param {Record<string, unknown>} r */
  meta: (r) => (batch.oneOf(r.backend, ['webgl2', 'webgpu']) ? { backend: r.backend } : null),
  /** @param {Record<string, unknown>} r */
  event: (r) => {
    if (!batch.isSlug(r.level)) return null
    if (r.e === 'start') return { e: 'start', level: r.level }
    if (r.e === 'death') {
      const pos = batch.parsePos(r.pos, 2)
      return pos ? { e: 'death', level: r.level, pos } : null
    }
    return null
  },
}

const SID = 'a'.repeat(32)
/** @param {Record<string, unknown>} [over] */
const good = (over = {}) => ({
  v: 3,
  sid: SID,
  seq: 0,
  build: 'abc1234',
  backend: 'webgl2',
  events: [
    { e: 'start', level: 'one', t: 1.5, dev: 'keyboard' },
    { e: 'death', level: 'one', t: 9, dev: 'gamepad', pos: [3, -4] },
  ],
  ...over,
})

describe('parseBatch', () => {
  it('rebuilds a good batch from the fields it knows', () => {
    const b = batch.parseBatch(SPEC, { ...good(), ip: '1.2.3.4', extra: 1 })
    expect(b).toEqual(good())
    expect(b).not.toHaveProperty('ip')
  })

  it('drops an event field the spec does not name', () => {
    const raw = good({ events: [{ e: 'start', level: 'one', t: 1, dev: 'touch', name: 'x' }] })
    expect(batch.parseBatch(SPEC, raw).events[0]).toEqual({
      e: 'start',
      level: 'one',
      t: 1,
      dev: 'touch',
    })
  })

  it.each([
    ['another version', { v: 2 }, 'bad version'],
    ['a short sid', { sid: 'abc' }, 'bad sid'],
    ['a negative seq', { seq: -1 }, 'bad seq'],
    ['a build with a space', { build: 'a b' }, 'bad build'],
    ['no events', { events: [] }, 'bad events'],
    ['too many events', { events: Array(201).fill(good().events[0]) }, 'bad events'],
    ['a meta the game refuses', { backend: 'canvas' }, 'bad meta'],
    [
      'an unknown event',
      { events: [{ e: 'jump', level: 'one', t: 1, dev: 'mouse' }] },
      'bad event',
    ],
    ['a bad device', { events: [{ e: 'start', level: 'one', t: 1, dev: 'wheel' }] }, 'bad event'],
    [
      'a clock past a week',
      { events: [{ e: 'start', level: 'one', t: 1e9, dev: 'mouse' }] },
      'bad event',
    ],
    [
      'a fractional spot',
      { events: [{ e: 'death', level: 'one', t: 1, dev: 'mouse', pos: [1.5, 2] }] },
      'bad event',
    ],
  ])('refuses %s', (_, over, why) => {
    expect(batch.parseBatch(SPEC, good(over))).toBe(why)
  })

  it('refuses an event whose name the spec changed', () => {
    const lying = { ...SPEC, event: () => ({ e: 'start' }) }
    expect(batch.parseBatch(lying, good())).toBe('bad event')
  })
})

describe('parseStored', () => {
  it('keeps the Worker fields and refuses an object with no site', () => {
    const kept = { ...good(), at: '2026-11-19T00:00:00.000Z', site: 'portal', browser: 'firefox' }
    expect(batch.parseStored(SPEC, kept)).toEqual(kept)
    expect(batch.parseStored(SPEC, good())).toBeNull()
    expect(batch.parseStored(SPEC, { ...kept, browser: 'netscape' }).browser).toBe('other')
  })
})

describe('siteOf', () => {
  const RULES = [
    batch.CRAZYGAMES,
    { site: 'site', hosts: ['example.com'], suffixes: ['my-game.example.net'] },
    { site: 'playtest', hosts: ['playtest.example.net'] },
  ]
  it.each([
    ['https://foo.game-files.crazygames.com', 'crazygames'],
    ['https://www.crazygames.fr', 'crazygames'],
    ['https://www.crazygames.com.br', 'crazygames'],
    ['https://example.com', 'site'],
    ['https://my-game.example.net', 'site'],
    ['https://abc123.my-game.example.net', 'site'],
    ['https://playtest.example.net', 'playtest'],
    ['http://example.com', null],
    ['https://notcrazygames.com', null],
    ['https://crazygames.com.evil.net', null],
    ['https://evil-my-game.example.net', null],
    ['null', null],
    [null, null],
  ])('%s is %s', (origin, site) => {
    expect(batch.siteOf(origin, RULES)).toBe(site)
  })
})

describe('browserFamily and batchKey', () => {
  it('names only the family', () => {
    const chrome =
      'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'
    expect(batch.browserFamily(chrome)).toBe('chrome')
    expect(batch.browserFamily(`${chrome} Edg/140.0`)).toBe('edge')
    expect(batch.browserFamily('Mozilla/5.0 Gecko/20100101 Firefox/140.0')).toBe('firefox')
    expect(batch.browserFamily('Mozilla/5.0 (iPhone) Version/18.0 Safari/604.1')).toBe('safari')
    expect(batch.browserFamily(null)).toBe('other')
  })
  it('files by UTC day, session and padded seq', () => {
    const at = new Date(Date.UTC(2026, 10, 19, 23, 59))
    expect(batch.batchKey({ sid: SID, seq: 7 }, at)).toBe(`2026-11-19/${SID}/0007.json`)
  })
})

describe('statsWorker', () => {
  const AT = new Date(Date.UTC(2026, 10, 19, 6, 13))
  const make = () => {
    /** @type {Map<string, string>} */
    const kept = new Map()
    const env = {
      STATS: {
        /** @param {string} k @param {string} body */
        put: async (k, body) => void kept.set(k, body),
      },
    }
    const w = statsWorker({
      name: 'my-game',
      spec: SPEC,
      sites: [batch.CRAZYGAMES, { site: 'site', hosts: ['example.com'] }],
      now: () => AT,
    })
    /** @param {string} method @param {Record<string, string>} headers @param {string} [body] @param {string} [path] */
    const ask = (method, headers, body, path = '/') =>
      w.fetch(new Request(`https://stats.example.dev${path}`, { method, headers, body }), env)
    return { kept, ask }
  }
  const ORIGIN = { Origin: 'https://x.game-files.crazygames.com' }

  it('keeps a good batch with its site and browser family, and nothing of the request', async () => {
    const { kept, ask } = make()
    const res = await ask(
      'POST',
      {
        ...ORIGIN,
        'User-Agent': 'Mozilla/5.0 Gecko/20100101 Firefox/140.0',
        'CF-Connecting-IP': '1.2.3.4',
      },
      JSON.stringify(good()),
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN.Origin)
    const body = kept.get(`2026-11-19/${SID}/0000.json`)
    expect(JSON.parse(body ?? '')).toEqual({
      ...good(),
      at: AT.toISOString(),
      site: 'crazygames',
      browser: 'firefox',
    })
    expect(body).not.toContain('1.2.3.4')
  })

  it('answers GET, and refuses a stranger, a wrong path, a big body and a bad batch', async () => {
    const { kept, ask } = make()
    expect(await (await ask('GET', {})).text()).toBe('my-game stats: ok')
    expect((await ask('GET', {}, undefined, '/x')).status).toBe(404)
    expect((await ask('POST', { Origin: 'https://evil.net' }, JSON.stringify(good()))).status).toBe(
      403,
    )
    expect((await ask('OPTIONS', ORIGIN)).status).toBe(204)
    expect((await ask('PUT', ORIGIN, '{}')).status).toBe(405)
    expect((await ask('POST', ORIGIN, 'x'.repeat(70_000))).status).toBe(413)
    expect((await ask('POST', ORIGIN, 'nope')).status).toBe(400)
    const bad = await ask('POST', ORIGIN, JSON.stringify(good({ v: 1 })))
    expect([bad.status, await bad.text()]).toEqual([400, 'bad version'])
    expect(kept.size).toBe(0)
  })
})

describe('createStatsQueue', () => {
  it('stamps time and device, splits at 200 events and counts seq', () => {
    /** @type {any[]} */
    const sent = []
    let now = 0
    const q = createStatsQueue({
      version: 3,
      meta: { sid: SID, build: 'b1', backend: 'webgl2' },
      now: () => now,
      send: (/** @type {string} */ s) => sent.push(JSON.parse(s)),
    })
    now = 1.26
    q.push({ e: 'start', level: 'one' })
    q.device = 'touch'
    for (let i = 0; i < 250; i++) q.push({ e: 'start', level: 'one' })
    expect(q.size).toBe(251)
    q.flush()
    expect(q.size).toBe(0)
    expect(sent.map((b) => [b.seq, b.events.length])).toEqual([
      [0, 200],
      [1, 51],
    ])
    expect(sent[0].events[0]).toEqual({ e: 'start', level: 'one', t: 1.3, dev: 'keyboard' })
    expect(sent[1].events[0].dev).toBe('touch')
    // What the queue sends, the Worker's check takes.
    for (const b of sent) expect(typeof batch.parseBatch(SPEC, b)).toBe('object')
  })

  it('drops past MAX_QUEUE', () => {
    const q = createStatsQueue({
      version: 3,
      meta: { sid: SID, build: 'b' },
      now: () => 0,
      send: () => {},
    })
    for (let i = 0; i < MAX_QUEUE + 5; i++) q.push({ e: 'start', level: 'one' })
    expect(q.size).toBe(MAX_QUEUE)
  })
})

describe('the copy', () => {
  it('names no import outside the folder, comments included', async () => {
    const fs = await import('node:fs')
    for (const f of ['batch.ts', 'client.ts', 'worker.ts']) {
      const text = fs.readFileSync(new URL(`../../runtime/stats/${f}`, import.meta.url), 'utf8')
      for (const m of text.matchAll(/from '([^']+)'/g)) expect(m[1], f).toMatch(/^\.\/[a-z-]+$/)
    }
  })
})
