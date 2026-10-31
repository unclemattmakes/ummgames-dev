/**
 * The seam, end to end: a small game built on runtime/board the way a real one would be. It
 * keeps its own runs table, validator and routes; the core gives it the rate limits, blocks,
 * the admin door and the log. Everything runs against the shim with real SQL, and the privacy
 * promises are checked by reading the tables, not the code.
 */
import { createD1 } from '@ummgames/dev/testing'
import { beforeEach, describe, expect, it } from 'vitest'

/** @param {string} rel @returns {Promise<any>} */
const load = (rel) =>
  import(/* @vite-ignore */ new URL(`../../runtime/${rel}`, import.meta.url).href)

const { json, parseJsonObject, refuse: coreRefuse } = await load('board/http.ts')
const { OWNER_KEY_SHAPE, isOwnerHash, ownerHash } = await load('board/digest.ts')
const { newId, idShape } = await load('board/ids.ts')
const { isHandle } = await load('board/handles.ts')
const { perHour } = await load('board/rate.ts')
const { BOARD_CORE_SQL, schemaProblems } = await load('board/schema.ts')
const { defineBoard } = await load('board/board.ts')
const { blockOf, logged, reasonOf } = await load('board/moderation.ts')
const { routeAdmin } = await load('board/admin.ts')
const { admitSubmit, overDailyCap } = await load('board/submit.ts')

// The game's own: its table, its policy, its validator.

const RUNS_SQL = `CREATE TABLE runs (
  id TEXT PRIMARY KEY, score INTEGER NOT NULL, handle TEXT NOT NULL, owner_hash TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);`
const PER_HOUR = 4
const STORED_PER_DAY = 3
const BODY_MAX = 512
const ID = idShape(10)

/** @param {any} db @param {string} column @param {string} value */
const coveredBy = async (db, column, value) => ({
  rows: (
    await db.prepare(`SELECT id, score, handle FROM runs WHERE ${column} = ?`).bind(value).all()
  ).results,
  remove: db.prepare(`DELETE FROM runs WHERE ${column} = ?`).bind(value),
})

const board = defineBoard({
  blockKinds: {
    owner: {
      valid: isOwnerHash,
      resolve: async (/** @type {any} */ body, /** @type {any} */ db) => {
        if (typeof body.run !== 'string') return undefined
        const row = await db
          .prepare('SELECT owner_hash FROM runs WHERE id = ?')
          .bind(body.run)
          .first()
        return row ? row.owner_hash : null
      },
      covers: (/** @type {any} */ db, /** @type {string} */ v) => coveredBy(db, 'owner_hash', v),
    },
    handle: {
      valid: isHandle,
      covers: (/** @type {any} */ db, /** @type {string} */ v) => coveredBy(db, 'handle', v),
    },
  },
})

/**
 * The game's whole Worker, as a function of the request, its env and the clock.
 * @param {Request} request
 * @param {{ DB?: any, IP_SALT?: string, ADMIN_TOKEN?: string }} env
 * @param {number} now
 */
const route = async (request, env, now) => {
  const path = new URL(request.url).pathname
  if (path.startsWith('/api/admin/')) {
    return routeAdmin(
      board,
      request,
      { db: env.DB, token: env.ADMIN_TOKEN, now, path: path.slice('/api/admin'.length) },
      async (/** @type {Request} */ req, /** @type {any} */ db, /** @type {string} */ p) => {
        if (p !== '/hide' || req.method !== 'POST') return null
        const body = parseJsonObject(await req.text())
        const id = body?.id
        if (typeof id !== 'string' || !ID.test(id)) return board.refuse(400, 'body', 'no run `id`')
        const row = await db
          .prepare('SELECT id, score, handle FROM runs WHERE id = ?')
          .bind(id)
          .first()
        if (!row) return board.refuse(404, 'gone', 'no such run')
        await db.batch([
          db.prepare('UPDATE runs SET hidden = 1 WHERE id = ?').bind(id),
          logged(db, now, {
            action: 'hide',
            target: id,
            count: 1,
            reason: reasonOf(board, body?.reason),
            detail: row,
          }),
        ])
        return json(200, { id, hidden: true })
      },
    )
  }
  if (path === '/api/runs' && request.method === 'POST') {
    const admitted = await admitSubmit(board, request, {
      db: env.DB,
      salt: env.IP_SALT,
      now,
      bodyMax: BODY_MAX,
      windows: [perHour(PER_HOUR)],
    })
    if (!admitted.ok) return admitted.response
    const { db } = admitted
    const body = parseJsonObject(admitted.text)
    if (!body) return board.refuse(400, 'body', 'the body is not a JSON object')
    if (
      !isHandle(body.handle) ||
      typeof body.owner !== 'string' ||
      !OWNER_KEY_SHAPE.test(body.owner)
    )
      return board.refuse(400, 'body', 'no handle or owner key')
    const owner = await ownerHash(body.owner)
    const blocked = await blockOf(db, { owner, handle: body.handle })
    if (blocked) return board.refuse(403, 'blocked', `this ${blocked} may not post`)
    // The game's validator.
    if (!Number.isInteger(body.score) || body.score < 0 || body.score > 1000)
      return board.refuse(422, 'score', 'not a score this game can make')
    const full = await overDailyCap(board, db, now, STORED_PER_DAY)
    if (full) return full
    const id = newId(10)
    await db
      .prepare(
        'INSERT INTO runs (id, score, handle, owner_hash, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(id, body.score, body.handle, owner, now)
      .run()
    return json(201, { id })
  }
  if (path === '/api/board' && request.method === 'GET') {
    const db = env.DB
    const rows = await db
      .prepare(
        'SELECT id, score, handle FROM runs WHERE hidden = 0 ORDER BY score DESC, created_at, id',
      )
      .all()
    return json(200, { entries: rows.results })
  }
  return coreRefuse(404, 'route', 'no such route')
}

// The test bench.

const NOW = Date.UTC(2026, 9, 30, 12, 0, 0)
const SALT = 'test-salt'
const TOKEN = 'a-test-admin-token-that-is-long-enough-000'
const ADDRESS = '203.0.113.7'
const OWNER = 'owner-key-aaaaaaaaaaaaaaaaaaaaaaaa'
const HANDLE = 'Swift Kestrel 42'

/** @type {any} */
let db
/** @type {{ DB?: any, IP_SALT?: string, ADMIN_TOKEN?: string }} */
let env
beforeEach(() => {
  db = createD1({ sql: [BOARD_CORE_SQL, RUNS_SQL] })
  env = { DB: db, IP_SALT: SALT, ADMIN_TOKEN: TOKEN }
})

/**
 * @param {string} method
 * @param {string} url
 * @param {{ json?: unknown, body?: string, headers?: Record<string, string>, now?: number, ip?: string, admin?: boolean }} [o]
 */
const call = async (method, url, o = {}) => {
  const body = o.body ?? (o.json !== undefined ? JSON.stringify(o.json) : null)
  const res = await route(
    new Request(`https://game.test${url}`, {
      method,
      body,
      headers: {
        'cf-connecting-ip': o.ip ?? ADDRESS,
        ...(o.admin ? { authorization: `Bearer ${TOKEN}` } : {}),
        ...o.headers,
      },
    }),
    env,
    o.now ?? NOW,
  )
  return { status: res.status, headers: res.headers, body: /** @type {any} */ (await res.json()) }
}

/** @param {Record<string, unknown>} [over] */
const run = (over = {}) => ({ score: 500, handle: HANDLE, owner: OWNER, ...over })

describe('a game on the core: submits', () => {
  it('stores a run under the owner hash, and keeps every address out of every table', async () => {
    const r = await call('POST', '/api/runs', { json: run() })
    expect(r.status).toBe(201)
    expect(r.body.id).toMatch(ID)
    expect((await call('GET', '/api/board')).body.entries).toEqual([
      { id: r.body.id, score: 500, handle: HANDLE },
    ])
    const everything = JSON.stringify(
      ['runs', 'rate', 'blocks', 'admin_log'].map((t) =>
        db.sqlite.prepare(`SELECT * FROM ${t}`).all(),
      ),
    )
    expect(everything).not.toContain(ADDRESS)
    expect(everything).not.toContain(OWNER)
    expect(everything).toContain(await ownerHash(OWNER))
  })

  it('counts a sender before reading the body, so garbage and oversize bodies cost the same', async () => {
    expect((await call('POST', '/api/runs', { body: 'not json' })).status).toBe(400)
    expect((await call('POST', '/api/runs', { body: 'x'.repeat(BODY_MAX + 1) })).status).toBe(413)
    expect((await call('POST', '/api/runs', { json: run({ score: -1 }) })).status).toBe(422)
    expect((await call('POST', '/api/runs', { json: run() })).status).toBe(201)
    const fifth = await call('POST', '/api/runs', { json: run() })
    expect(fifth.status).toBe(429)
    expect(fifth.body).toEqual({ error: 'rate', reason: `more than ${PER_HOUR} submits this hour` })
    expect(fifth.headers.get('retry-after')).toBe('3600')
    // Another sender is not limited; the same one is, an hour later, not.
    expect((await call('POST', '/api/runs', { json: run(), ip: '198.51.100.1' })).status).toBe(201)
    expect((await call('POST', '/api/runs', { json: run(), now: NOW + 3_600_000 })).status).toBe(
      201,
    )
  })

  it('takes nothing without a salt or a database, rather than count raw addresses', async () => {
    env = { DB: db }
    expect((await call('POST', '/api/runs', { json: run() })).body.error).toBe('unconfigured')
    env = { IP_SALT: SALT }
    expect((await call('POST', '/api/runs', { json: run() })).status).toBe(503)
  })

  it('caps the runs stored per day, and charges refusals to their senders, not the cap', async () => {
    for (let i = 0; i < 3; i++) {
      expect((await call('POST', '/api/runs', { body: '{}', ip: `198.51.100.${i}` })).status).toBe(
        400,
      )
    }
    for (let i = 0; i < STORED_PER_DAY; i++) {
      expect((await call('POST', '/api/runs', { json: run(), ip: `192.0.2.${i}` })).status).toBe(
        201,
      )
    }
    const full = await call('POST', '/api/runs', { json: run(), ip: '192.0.2.99' })
    expect(full.status).toBe(503)
    expect(full.body.error).toBe('full')
    expect(Number(full.headers.get('retry-after'))).toBe(12 * 3600)
    const tomorrow = NOW + 86_400_000
    expect(
      (await call('POST', '/api/runs', { json: run(), ip: '192.0.2.99', now: tomorrow })).status,
    ).toBe(201)
  })

  it('sweeps rate rows two days on, on the next submit, whoever sends it', async () => {
    await call('POST', '/api/runs', { json: run() })
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM rate').get().n).toBe(2)
    await call('POST', '/api/runs', { body: '{}', ip: '192.0.2.1', now: NOW + 3 * 86_400_000 })
    // Only the new sender's hour row is left: the old hour and the old day are gone.
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM rate').get().n).toBe(1)
  })
})

describe('a game on the core: the admin door', () => {
  it('is off without a long enough token, and closed to a wrong one, before reading anything', async () => {
    env = { DB: db, IP_SALT: SALT }
    expect((await call('GET', '/api/admin/blocks', { admin: true })).status).toBe(503)
    env = { DB: db, IP_SALT: SALT, ADMIN_TOKEN: 'short' }
    expect(
      (await call('GET', '/api/admin/blocks', { headers: { authorization: 'Bearer short' } }))
        .status,
    ).toBe(503)
    env = { DB: db, IP_SALT: SALT, ADMIN_TOKEN: TOKEN }
    const wrong = await call('POST', '/api/admin/blocks', {
      body: 'not json',
      headers: { authorization: `Bearer ${TOKEN.slice(0, -1)}x` },
    })
    expect(wrong.status).toBe(401)
    expect(wrong.headers.get('www-authenticate')).toBe('Bearer')
    expect(
      (await call('GET', '/api/admin/blocks', { headers: { authorization: TOKEN } })).status,
    ).toBe(401)
    expect((await call('GET', '/api/admin/blocks', { admin: true })).body).toEqual({ blocks: [] })
  })

  it('blocks a device by one of its runs, wipes its runs, logs them, and refuses its next submit', async () => {
    const mine = (await call('POST', '/api/runs', { json: run({ score: 900 }) })).body.id
    await call('POST', '/api/runs', {
      json: run({
        handle: 'Calm Heron 11',
        owner: 'other-key-bbbbbbbbbbbbbbbbbbbbbbb',
        score: 100,
      }),
    })
    const blocked = await call('POST', '/api/admin/blocks', {
      admin: true,
      json: { kind: 'owner', run: mine, reason: 'impossible score', wipe: true },
    })
    expect(blocked.status).toBe(201)
    expect(blocked.body).toEqual({ kind: 'owner', value: await ownerHash(OWNER), wiped: 1 })
    expect(
      (await call('GET', '/api/board')).body.entries.map((/** @type {any} */ e) => e.score),
    ).toEqual([100])
    const again = await call('POST', '/api/runs', { json: run({ handle: 'Bold Wren 77' }) })
    expect(again.status).toBe(403)
    expect(again.body.reason).toBe('this owner may not post')
    const log = (await call('GET', '/api/admin/log', { admin: true })).body.log
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ action: 'block', count: 1, reason: 'impossible score' })
    expect(log[0].detail.wiped).toEqual([{ id: mine, score: 900, handle: HANDLE }])
  })

  it('retires a handle and lifts it again, logging both', async () => {
    const add = await call('POST', '/api/admin/blocks', {
      admin: true,
      json: { kind: 'handle', value: HANDLE },
    })
    expect(add.body.wiped).toBe(0)
    expect((await call('POST', '/api/runs', { json: run() })).status).toBe(403)
    const list = (await call('GET', '/api/admin/blocks', { admin: true })).body.blocks
    expect(list).toEqual([{ kind: 'handle', value: HANDLE, reason: '', createdAt: NOW }])
    const q = `?kind=handle&value=${encodeURIComponent(HANDLE)}&reason=appeal`
    const lift = await call('DELETE', `/api/admin/blocks${q}`, { admin: true })
    expect(lift.body.lifted).toMatchObject({ kind: 'handle', value: HANDLE })
    expect((await call('DELETE', `/api/admin/blocks${q}`, { admin: true })).status).toBe(404)
    expect((await call('POST', '/api/runs', { json: run() })).status).toBe(201)
    const log = (await call('GET', '/api/admin/log', { admin: true })).body.log
    expect(log.map((/** @type {any} */ r) => [r.action, r.reason])).toEqual([
      ['unblock', 'appeal'],
      ['block', ''],
    ])
  })

  it('checks a block body against the game’s kinds', async () => {
    const post = (/** @type {unknown} */ json) =>
      call('POST', '/api/admin/blocks', { admin: true, json })
    expect((await post({ kind: 'address', value: ADDRESS })).body.error).toBe('kind')
    expect((await post({ kind: 'toString', value: 'x' })).body.error).toBe('kind')
    expect((await post({ kind: 'handle', value: 'Rude Word 42' })).body.error).toBe('value')
    expect((await post({ kind: 'owner', value: OWNER })).body.error).toBe('value')
    expect((await post({ kind: 'owner', run: 'AAAAAAAAAA' })).status).toBe(404)
    expect((await call('POST', '/api/admin/blocks', { admin: true, body: '[1]' })).body.error).toBe(
      'body',
    )
  })

  it('routes the game’s own admin routes behind the same door, and 404s the rest', async () => {
    const id = (await call('POST', '/api/runs', { json: run() })).body.id
    expect((await call('POST', '/api/admin/hide', { json: { id } })).status).toBe(401)
    expect(
      (await call('POST', '/api/admin/hide', { admin: true, json: { id, reason: 'odd' } })).body,
    ).toEqual({ id, hidden: true })
    expect((await call('GET', '/api/board')).body.entries).toEqual([])
    expect((await call('GET', '/api/admin/log', { admin: true })).body.log[0]).toMatchObject({
      action: 'hide',
      target: id,
    })
    expect((await call('GET', '/api/admin/nothing', { admin: true })).status).toBe(404)
  })

  it('answers unmigrated on a database without the core tables, and still takes no submits there', async () => {
    env = { DB: createD1({ sql: RUNS_SQL }), IP_SALT: SALT, ADMIN_TOKEN: TOKEN }
    const r = await call('GET', '/api/admin/blocks', { admin: true })
    expect(r.status).toBe(503)
    expect(r.body.error).toBe('unmigrated')
    await expect(call('POST', '/api/runs', { json: run() })).rejects.toThrow(/no such table/)
  })
})

describe('a game on the core: its own refusal shape', () => {
  it('lets the game rename codes and keep the shape its client parses', async () => {
    const codes = /** @type {Record<string, string>} */ ({
      rate: 'rate-limited',
      admin: 'unauthorized',
    })
    const shaped = defineBoard({
      blockKinds: {},
      refuse: (
        /** @type {number} */ status,
        /** @type {string} */ code,
        /** @type {string} */ detail,
        /** @type {any} */ headers,
      ) => json(status, { ok: false, error: codes[code] ?? code, detail }, headers),
    })
    const admitted = await admitSubmit(
      shaped,
      new Request('https://game.test/', { method: 'POST', body: '{}' }),
      {
        db,
        salt: SALT,
        now: NOW,
        bodyMax: 100,
        windows: [{ tag: 's', ms: 5000, limit: 0 }],
      },
    )
    expect(admitted.ok).toBe(false)
    expect(await admitted.response.json()).toEqual({
      ok: false,
      error: 'rate-limited',
      detail: 'more than 0 submits in 5 s',
    })
    const door = await routeAdmin(shaped, new Request('https://game.test/'), {
      db,
      token: TOKEN,
      now: NOW,
      path: '/log',
    })
    expect(await door.json()).toEqual({
      ok: false,
      error: 'unauthorized',
      detail: 'not authorised',
    })
  })
})

describe('a game on the core: its migrations', () => {
  it('has every table and column the core needs', async () => {
    expect(await schemaProblems(db)).toEqual([])
  })
})
