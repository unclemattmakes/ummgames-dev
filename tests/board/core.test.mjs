/**
 * runtime/board, piece by piece, in node. The files are TypeScript, which Vitest transforms;
 * the path is built at run time so this repo's own typecheck leaves them to
 * runtime/tsconfig.json. The database is the kit's own shim, so every statement runs.
 */
import { createD1 } from '@ummgames/dev/testing'
import { describe, expect, it } from 'vitest'

/** @param {string} rel @returns {Promise<any>} */
const load = (rel) =>
  import(/* @vite-ignore */ new URL(`../../runtime/${rel}`, import.meta.url).href)

const http = await load('board/http.ts')
const digest = await load('board/digest.ts')
const ids = await load('board/ids.ts')
const handles = await load('board/handles.ts')
const rate = await load('board/rate.ts')
const schema = await load('board/schema.ts')
const { defineBoard } = await load('board/board.ts')
const moderation = await load('board/moderation.ts')
const d1 = await load('board/d1.ts')

const NOW = Date.UTC(2026, 9, 30, 12, 30, 0)
const core = () => createD1({ sql: schema.BOARD_CORE_SQL })

/**
 * `n` zero bytes in chunks, saying whether it was cancelled and how much it sent.
 * @param {number} n
 * @returns {ReadableStream<Uint8Array> & { wasCancelled(): boolean, sentSoFar(): number }}
 */
const streamOf = (n, chunk = 1000) => {
  let sent = 0
  let cancelled = false
  /** @type {ReadableStream<Uint8Array>} */
  const s = new ReadableStream({
    pull(c) {
      if (sent >= n) return c.close()
      const size = Math.min(chunk, n - sent)
      sent += size
      c.enqueue(new Uint8Array(size))
    },
    cancel() {
      cancelled = true
    },
  })
  return Object.assign(s, { wasCancelled: () => cancelled, sentSoFar: () => sent })
}

describe('board/http', () => {
  it('stops reading past the cap and cancels the stream', async () => {
    const s = streamOf(1_000_000)
    expect(await http.drainCapped(s, 2500)).toBeNull()
    expect(s.wasCancelled()).toBe(true)
    expect(s.sentSoFar()).toBeLessThan(10_000)
    expect((await http.drainCapped(streamOf(2500), 2500))?.byteLength).toBe(2500)
  })

  it('refuses a declared length over the cap before reading, and reads none as empty', async () => {
    const big = new Request('https://x.test/', {
      method: 'POST',
      body: 'x'.repeat(10),
      headers: { 'content-length': '999999' },
    })
    expect(await http.readCapped(big, 100)).toBeNull()
    expect(await http.readCapped(new Request('https://x.test/'), 100)).toBe('')
    const ok = new Request('https://x.test/', { method: 'POST', body: 'héllo' })
    expect(await http.readCapped(ok, 6)).toBe('héllo') // 6 bytes as UTF-8
    const over = new Request('https://x.test/', { method: 'POST', body: 'héllo!' })
    expect(await http.readCapped(over, 6)).toBeNull()
  })

  it('parses only JSON objects, and reads ?limit= within bounds', () => {
    expect(http.parseJsonObject('{"a":1}')).toEqual({ a: 1 })
    for (const t of ['[1]', 'null', '3', 'nope']) expect(http.parseJsonObject(t)).toBeNull()
    const url = (/** @type {string} */ q) => new URL(`https://x.test/?${q}`)
    expect(http.intParam(url('limit=5'), 'limit', 100, 25)).toBe(5)
    expect(http.intParam(url('limit=500'), 'limit', 100, 25)).toBe(100)
    for (const q of ['', 'limit=0', 'limit=-2', 'limit=1.5', 'limit=x']) {
      expect(http.intParam(url(q), 'limit', 100, 25)).toBe(25)
    }
  })

  it('answers JSON that is not cached or sniffed, unless the caller says', async () => {
    const r = http.json(200, { a: 1 })
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await r.json()).toEqual({ a: 1 })
    expect(http.json(200, {}, { 'cache-control': 'max-age=30' }).headers.get('cache-control')).toBe(
      'max-age=30',
    )
    const no = http.refuse(429, 'rate', 'slow down', { 'retry-after': '5' })
    expect(no.status).toBe(429)
    expect(no.headers.get('retry-after')).toBe('5')
    expect(await no.json()).toEqual({ error: 'rate', reason: 'slow down' })
  })

  it('admits origins by a whole-string pattern, fails closed, and lets scripts through', () => {
    const from = (/** @type {string | null} */ origin) =>
      new Request('https://board.test/', origin ? { headers: { origin } } : {})
    const pattern = 'https://(www\\.)?game\\.test'
    const yes = http.originVerdict(from('https://www.game.test'), pattern)
    expect(yes.ok && yes.headers['access-control-allow-origin']).toBe('https://www.game.test')
    expect(yes.ok && yes.headers.vary).toBe('Origin')
    // Anchored: a prefix or suffix of an admitted origin is another origin.
    expect(http.originVerdict(from('https://game.test.evil.test'), pattern).ok).toBe(false)
    expect(http.originVerdict(from('https://game.test'), undefined).ok).toBe(false)
    expect(http.originVerdict(from('https://game.test'), '(').ok).toBe(false)
    expect(http.originVerdict(from(null), undefined)).toEqual({ ok: true, headers: {} })
    const custom = http.originVerdict(from('https://game.test'), pattern, { methods: 'GET' })
    expect(custom.ok && custom.headers['access-control-allow-methods']).toBe('GET')
  })

  it('adds headers to an immutable response by copying it', async () => {
    const res = http.withHeaders(Response.json({ a: 1 }), { 'x-a': '1' })
    expect(res.headers.get('x-a')).toBe('1')
    expect(await res.json()).toEqual({ a: 1 })
  })
})

describe('board/digest', () => {
  it('hashes the published SHA-256 vectors, as stored identifiers must stay', async () => {
    expect(await digest.sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(await digest.sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
    expect(await digest.sha256Hex(new Uint8Array([0x61, 0x62, 0x63]))).toBe(
      await digest.sha256Hex('abc'),
    )
    expect(await digest.ownerHash('abc')).toBe(await digest.sha256Hex('abc'))
  })

  it('makes a sender hash of salt, colon and the rate key, from cf-connecting-ip only', async () => {
    const req = new Request('https://x.test/', {
      headers: { 'cf-connecting-ip': '2001:DB8:0:0:1::5', 'x-forwarded-for': '9.9.9.9' },
    })
    expect(await digest.senderHash(req, 'salt')).toBe(
      await digest.sha256Hex('salt:2001:db8:0:0::/64'),
    )
    const none = new Request('https://x.test/', { headers: { 'x-forwarded-for': '9.9.9.9' } })
    expect(await digest.senderHash(none, 'salt')).toBe(await digest.sha256Hex('salt:unknown'))
  })

  it('counts an IPv6 sender by its /64, however it is spelled, and IPv4 whole', () => {
    const k = digest.rateKey
    expect(k('203.0.113.7')).toBe('203.0.113.7')
    expect(k('2001:db8::1')).toBe('2001:db8:0:0::/64')
    expect(k('2001:0DB8:0000:0000:ffff::2')).toBe('2001:db8:0:0::/64')
    expect(k('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2::/64')
    expect(k('::ffff:1.2.3.4')).toBe('0:0:0:0::/64')
    expect(k('::1')).toBe('0:0:0:0::/64')
    expect(k('not:an:address')).toBe('not:an:address')
    expect(k('1::2::3')).toBe('1::2::3')
  })

  it('compares digests in full', () => {
    const a = new Uint8Array([1, 2, 3])
    expect(digest.sameDigest(a, new Uint8Array([1, 2, 3]))).toBe(true)
    expect(digest.sameDigest(a, new Uint8Array([1, 2, 4]))).toBe(false)
    expect(digest.sameDigest(a, new Uint8Array([1, 2]))).toBe(false)
  })

  it('knows an owner key and an owner hash by shape', () => {
    expect(digest.OWNER_KEY_SHAPE.test('a'.repeat(22))).toBe(true)
    expect(digest.OWNER_KEY_SHAPE.test('a'.repeat(21))).toBe(false)
    expect(digest.OWNER_KEY_SHAPE.test(`${'a'.repeat(22)}=`)).toBe(false)
    expect(digest.isOwnerHash('f'.repeat(64))).toBe(true)
    expect(digest.isOwnerHash('F'.repeat(64))).toBe(false)
  })
})

describe('board/ids', () => {
  it('makes ids of the length and alphabet asked, matching idShape', () => {
    const shape = ids.idShape(10)
    for (let i = 0; i < 200; i++) expect(ids.newId(10)).toMatch(shape)
    expect(ids.newId(6, 'ab')).toMatch(/^[ab]{6}$/)
    expect(() => ids.newId(4, 'a')).toThrow(RangeError)
  })

  it('is near uniform over base62 (no byte-modulo bias)', () => {
    /** @type {Map<string, number>} */
    const seen = new Map()
    const n = 62 * 400
    for (const c of ids.newId(n)) seen.set(c, (seen.get(c) ?? 0) + 1)
    expect(seen.size).toBe(62)
    // A biased `% 62` over 256 byte values would favour the first 8 characters by about 25%.
    const firsts = [...'01234567'].reduce((s, c) => s + (seen.get(c) ?? 0), 0) / 8
    const rest = [...'ABCDEFGH'].reduce((s, c) => s + (seen.get(c) ?? 0), 0) / 8
    expect(firsts / rest).toBeLessThan(1.15)
  })
})

describe('board/handles', () => {
  it('generates only handles it accepts, and accepts nothing else', () => {
    let seed = 7
    const rnd = (/** @type {number} */ n) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      return seed % n
    }
    for (let i = 0; i < 500; i++) expect(handles.isHandle(handles.randomHandle(rnd))).toBe(true)
    expect(handles.randomHandle(() => 0)).toBe('Amber Albatross 10')
    for (const bad of [
      'Amber Albatross 9',
      'Amber Albatross 100',
      'amber Albatross 10',
      'Rude Word 42',
      'Amber  Albatross 10',
      42,
      null,
    ]) {
      expect(handles.isHandle(bad)).toBe(false)
    }
  })

  it('keeps its word lists: removing a word orphans every run posted under it', () => {
    expect(handles.HANDLE_ADJECTIVES).toHaveLength(32)
    expect(handles.HANDLE_NOUNS).toHaveLength(32)
    expect(new Set(handles.HANDLE_ADJECTIVES).size).toBe(32)
    expect(new Set(handles.HANDLE_NOUNS).size).toBe(32)
    expect(handles.HANDLE_NOUNS.at(-1)).toBe('Skylark')
  })
})

describe('board/rate', () => {
  it('counts hits in fixed windows, per sender, and says when one is over', async () => {
    const db = core()
    const hour = rate.perHour(2)
    const five = { tag: 's', ms: 5000, limit: 1 }
    let [h, s] = await rate.hit(db, 'who', [hour, five], NOW)
    expect([h.count, h.over, s.count, s.over]).toEqual([1, false, 1, false])
    ;[h, s] = await rate.hit(db, 'who', [hour, five], NOW + 1000)
    expect([h.count, s.over]).toEqual([2, true])
    expect(s.retryAfter).toBe(4) // NOW sits on a 5 s boundary
    ;[h, s] = await rate.hit(db, 'who', [hour, five], NOW + 5000)
    expect([h.over, s.over]).toEqual([true, false])
    expect(h.retryAfter).toBe(30 * 60 - 5)
    const [other] = await rate.hit(db, 'else', [hour], NOW)
    expect(other.count).toBe(1)
    expect(await rate.rateCount(db, 'who', hour, NOW)).toBe(3)
    expect(await rate.rateCount(db, 'nobody', hour, NOW)).toBe(0)
  })

  it('stores bucket <who>:<tag>:<slot> with the window start in ms', async () => {
    const db = core()
    await rate.hit(db, '*', [rate.perDay(10)], NOW)
    const day = Math.floor(NOW / rate.DAY_MS)
    expect(await db.prepare('SELECT bucket, win, count FROM rate').all()).toMatchObject({
      results: [{ bucket: `*:d:${day}`, win: day * rate.DAY_MS, count: 1 }],
    })
    expect(rate.windowText(rate.perDay(1))).toBe('today')
    expect(rate.windowText(rate.perHour(1))).toBe('this hour')
    expect(rate.windowText({ tag: 's', ms: 5000, limit: 1 })).toBe('in 5 s')
  })
})

describe('board/schema', () => {
  it('creates the core tables, again without error, and finds nothing wrong with them', async () => {
    const db = core()
    await db.exec(schema.BOARD_CORE_SQL)
    expect(await schema.schemaProblems(db)).toEqual([])
  })

  it('names what an older schema lacks', async () => {
    const db = createD1({
      sql: `CREATE TABLE rate (bucket TEXT PRIMARY KEY, win INTEGER NOT NULL, count INTEGER NOT NULL);
            CREATE TABLE blocks (handle TEXT PRIMARY KEY, reason TEXT NOT NULL, created_at INTEGER NOT NULL);`,
    })
    expect(await schema.schemaProblems(db)).toEqual([
      'blocks has no column kind',
      'blocks has no column value',
      "blocks's primary key is (handle), not (kind, value)",
      'no table admin_log',
    ])
  })
})

describe('board/moderation', () => {
  const board = defineBoard({
    blockKinds: { owner: { valid: digest.isOwnerHash }, handle: { valid: handles.isHandle } },
  })

  it('finds a block by kind and value, in the order asked, and none in a database without the table', async () => {
    const db = core()
    const owner = 'a'.repeat(64)
    expect(await moderation.blockOf(db, { owner, handle: 'Amber Albatross 10' })).toBeNull()
    await db.prepare("INSERT INTO blocks VALUES ('handle', 'Amber Albatross 10', 'r', 1)").run()
    expect(await moderation.blockOf(db, { owner, handle: 'Amber Albatross 10' })).toBe('handle')
    await db.prepare("INSERT INTO blocks VALUES ('owner', ?, 'r', 1)").bind(owner).run()
    expect(await moderation.blockOf(db, { owner, handle: 'Amber Albatross 10' })).toBe('owner')
    expect(await moderation.blockOf(db, { handle: 'Amber Albatross 10', owner })).toBe('handle')
    // The value must match under its own kind.
    expect(await moderation.blockOf(db, { handle: owner })).toBeNull()
    expect(await moderation.blockOf(db, {})).toBeNull()
    expect(await moderation.blockOf(createD1(), { owner })).toBeNull()
  })

  it('caps and trims a reason, and stores the default when none is given', () => {
    expect(moderation.reasonOf(board, '  spam  ')).toBe('spam')
    expect(moderation.reasonOf(board, 'x'.repeat(600))).toHaveLength(500)
    expect(moderation.reasonOf(board, 42)).toBe('')
    const polite = defineBoard({ blockKinds: {}, noReason: 'no reason given' })
    expect(moderation.reasonOf(polite, '   ')).toBe('no reason given')
  })

  it('sweeps rate rows past their keep, log rows past their days, and the game’s own', async () => {
    const db = createD1({
      sql: [schema.BOARD_CORE_SQL, 'CREATE TABLE runs (id TEXT, expires INTEGER)'],
    })
    const swept = defineBoard({
      blockKinds: {},
      sweep: (/** @type {any} */ d, /** @type {number} */ now) => [
        d.prepare('DELETE FROM runs WHERE expires < ?').bind(now),
      ],
    })
    const keep = 2 * rate.DAY_MS
    await db.batch([
      db
        .prepare("INSERT INTO rate VALUES ('old', ?, 1), ('new', ?, 1)")
        .bind(NOW - keep - 1, NOW - keep),
      db
        .prepare(
          'INSERT INTO admin_log (at, action, target, count, reason, detail) VALUES (?, ?, ?, 0, ?, ?)',
        )
        .bind(NOW - 91 * rate.DAY_MS, 'a', 't', '', '{}'),
      db
        .prepare(
          'INSERT INTO admin_log (at, action, target, count, reason, detail) VALUES (?, ?, ?, 0, ?, ?)',
        )
        .bind(NOW - 89 * rate.DAY_MS, 'b', 't', '', '{}'),
      db.prepare("INSERT INTO runs VALUES ('gone', ?), ('kept', ?)").bind(NOW - 1, NOW + 1),
    ])
    await moderation.sweepCore(swept, db, NOW)
    expect((await db.prepare('SELECT bucket FROM rate').all()).results).toEqual([{ bucket: 'new' }])
    expect((await db.prepare('SELECT action FROM admin_log').all()).results).toEqual([
      { action: 'b' },
    ])
    expect((await db.prepare('SELECT id FROM runs').all()).results).toEqual([{ id: 'kept' }])
  })

  it('reads the log newest first with its detail parsed', async () => {
    const db = core()
    await db.batch([
      moderation.logged(db, NOW, {
        action: 'block',
        target: 'handle:x',
        count: 0,
        reason: 'r',
        detail: { a: 1 },
      }),
      moderation.logged(db, NOW + 1, {
        action: 'unblock',
        target: 'handle:x',
        count: 0,
        reason: '',
        detail: [],
      }),
    ])
    await db
      .prepare(
        "INSERT INTO admin_log (at, action, target, count, reason, detail) VALUES (0, 'old', 't', 0, '', 'plain text')",
      )
      .run()
    const log = await moderation.readLog(db, 10)
    expect(log.map((/** @type {any} */ r) => r.action)).toEqual(['unblock', 'block', 'old'])
    expect(log[1].detail).toEqual({ a: 1 })
    expect(log[2].detail).toBe('plain text')
    expect(await moderation.readLog(db, 1)).toHaveLength(1)
  })
})

describe('board/board', () => {
  it('fills the defaults and refuses settings that would break a promise', () => {
    const b = defineBoard({ blockKinds: {} })
    expect([b.adminTokenMinLength, b.adminLogDays, b.adminReasonMax, b.adminListMax]).toEqual([
      32, 90, 500, 500,
    ])
    expect(b.rateKeepMs).toBe(2 * rate.DAY_MS)
    expect(Object.isFrozen(b)).toBe(true)
    expect(() => defineBoard({ blockKinds: {}, rateKeepMs: rate.HOUR_MS })).toThrow(RangeError)
    expect(() => defineBoard({ blockKinds: {}, adminTokenMinLength: 8 })).toThrow(RangeError)
  })
})

describe('board/d1', () => {
  it('knows a missing table by SQLite’s message, as D1 frames it', async () => {
    const e = await createD1()
      .prepare('SELECT 1 FROM blocks')
      .all()
      .catch((/** @type {unknown} */ x) => x)
    expect(d1.isMissingTable(e)).toBe(true)
    expect(d1.isMissingTable(new Error('D1_ERROR: no such table: blocks: SQLITE_ERROR'))).toBe(true)
    expect(d1.isMissingTable(new Error('UNIQUE constraint failed'))).toBe(false)
    expect(d1.isMissingTable('no such table')).toBe(false)
  })
})
