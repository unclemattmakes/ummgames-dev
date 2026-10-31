// @ts-check
/**
 * `createD1`: the behaviours of D1 a test against the shim could otherwise pass without. Each
 * test names the D1 behaviour it holds the shim to.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createD1, parameterCount } from '@ummgames/dev/testing'
import { afterAll, describe, expect, it } from 'vitest'

const SCHEMA = `
CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, n INTEGER, b BLOB);
`

/** @type {string[]} */
const dirs = []
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
})

describe('createD1 statements', () => {
  it('answers first, all, run and raw as D1 does', async () => {
    const db = createD1({ sql: SCHEMA })
    const ins = await db.prepare('INSERT INTO t (name, n) VALUES (?, ?)').bind('a', 1).run()
    expect(ins.success).toBe(true)
    expect(ins.meta).toMatchObject({ changes: 1, last_row_id: 1, changed_db: true })
    await db.prepare('INSERT INTO t (name, n) VALUES (?, ?)').bind('b', 2).run()

    const all = await db.prepare('SELECT name, n FROM t ORDER BY id').all()
    expect(all.results).toStrictEqual([
      { name: 'a', n: 1 },
      { name: 'b', n: 2 },
    ])
    expect(await db.prepare('SELECT name FROM t WHERE n = ?').bind(2).first()).toStrictEqual({
      name: 'b',
    })
    expect(await db.prepare('SELECT n FROM t WHERE name = ?').bind('a').first('n')).toBe(1)
    expect(await db.prepare('SELECT n FROM t WHERE name = ?').bind('zz').first()).toBeNull()
    await expect(db.prepare('SELECT n FROM t').first('nope')).rejects.toThrow(/Column not found/)
    expect(await db.prepare('SELECT name, n FROM t ORDER BY id').raw()).toEqual([
      ['a', 1],
      ['b', 2],
    ])
    expect(await db.prepare('SELECT name FROM t ORDER BY id').raw({ columnNames: true })).toEqual([
      ['name'],
      ['a'],
      ['b'],
    ])
  })

  it('counts changes per statement: a SELECT after a write changed nothing', async () => {
    const db = createD1({ sql: SCHEMA })
    await db.prepare("INSERT INTO t (name) VALUES ('a'), ('b'), ('c')").run()
    const sel = await db.prepare('SELECT * FROM t').run()
    expect(sel.meta.changes).toBe(0)
    expect(sel.meta.changed_db).toBe(false)
    const del = await db.prepare('DELETE FROM t WHERE name != ?').bind('a').run()
    expect(del.meta.changes).toBe(2)
    const none = await db.prepare('DELETE FROM t WHERE name = ?').bind('zz').run()
    expect(none.meta.changes).toBe(0)
  })

  it('returns RETURNING rows from run and from a batch', async () => {
    const db = createD1({ sql: SCHEMA })
    const up = (/** @type {string} */ name) =>
      db
        .prepare(
          'INSERT INTO t (name, n) VALUES (?, 1) ON CONFLICT (name) DO UPDATE SET n = n + 1 RETURNING n',
        )
        .bind(name)
    expect((await up('a').run()).results).toEqual([{ n: 1 }])
    const [first, second] = await db.batch([up('a'), up('b')])
    expect(first?.results).toEqual([{ n: 2 }])
    expect(second?.results).toEqual([{ n: 1 }])
  })

  it('binds as D1 does: booleans as 1 and 0, bytes as blobs read back as number arrays', async () => {
    const db = createD1({ sql: SCHEMA })
    await db
      .prepare('INSERT INTO t (name, n, b) VALUES (?, ?, ?)')
      .bind('a', true, new Uint8Array([1, 2, 255]))
      .run()
    expect(await db.prepare('SELECT n, b FROM t').first()).toStrictEqual({ n: 1, b: [1, 2, 255] })
    await db.prepare('UPDATE t SET n = ?').bind(false).run()
    expect(await db.prepare('SELECT n FROM t').first('n')).toBe(0)
  })

  it('refuses undefined and objects at bind, as D1_TYPE_ERROR', () => {
    const db = createD1({ sql: SCHEMA })
    const s = db.prepare('SELECT ?')
    expect(() => s.bind(undefined)).toThrow(/D1_TYPE_ERROR: Type 'undefined'/)
    expect(() => s.bind({ a: 1 })).toThrow(/D1_TYPE_ERROR: Type 'object'/)
  })

  it('fails a statement run with the wrong number of bindings', async () => {
    const db = createD1({ sql: SCHEMA })
    await expect(
      db.prepare('SELECT * FROM t WHERE name = ? AND n = ?').bind('a').all(),
    ).rejects.toThrow(/D1_ERROR: Wrong number of parameter bindings/)
    await expect(db.prepare('SELECT 1').bind('extra').all()).rejects.toThrow(/wanted 0, got 1/)
  })

  it('compiles SQL when it runs, not when it is prepared, and frames errors as D1_ERROR', async () => {
    const db = createD1()
    const bad = db.prepare('SELEKT nonsense')
    await expect(bad.all()).rejects.toThrow(/^D1_ERROR: .*syntax error/)
    await expect(db.prepare('SELECT * FROM missing').all()).rejects.toThrow(
      /D1_ERROR: no such table: missing/,
    )
  })

  it('makes each bind a new statement, leaving the first unchanged', async () => {
    const db = createD1({ sql: SCHEMA })
    await db.prepare("INSERT INTO t (name, n) VALUES ('a', 1), ('b', 2)").run()
    const q = db.prepare('SELECT name FROM t WHERE n = ?')
    const one = q.bind(1)
    const two = q.bind(2)
    expect(await one.first('name')).toBe('a')
    expect(await two.first('name')).toBe('b')
    await expect(q.all()).rejects.toThrow(/wanted 1, got 0/)
  })
})

describe('createD1 batch', () => {
  it('rolls the whole batch back when one statement fails', async () => {
    const db = createD1({ sql: SCHEMA })
    await expect(
      db.batch([
        db.prepare("INSERT INTO t (name) VALUES ('a')"),
        db.prepare("INSERT INTO t (name) VALUES ('a')"), // UNIQUE
      ]),
    ).rejects.toThrow(/D1_ERROR: UNIQUE constraint failed/)
    expect(await db.prepare('SELECT COUNT(*) AS n FROM t').first('n')).toBe(0)
    // And the database is usable after it.
    await db.batch([db.prepare("INSERT INTO t (name) VALUES ('b')")])
    expect(await db.prepare('SELECT COUNT(*) AS n FROM t').first('n')).toBe(1)
  })

  it('refuses a statement from another database', async () => {
    const a = createD1({ sql: SCHEMA })
    const b = createD1({ sql: SCHEMA })
    await expect(a.batch([b.prepare('SELECT 1')])).rejects.toThrow(/another database/)
  })
})

describe('createD1 setup', () => {
  it('applies a migrations folder in name order, then sql', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'umm-d1-'))
    dirs.push(dir)
    fs.writeFileSync(path.join(dir, '0002_more.sql'), 'ALTER TABLE t ADD COLUMN extra TEXT;')
    fs.writeFileSync(path.join(dir, '0001_t.sql'), SCHEMA)
    fs.writeFileSync(path.join(dir, 'README.md'), 'not a migration')
    const db = createD1({ migrations: dir, sql: "INSERT INTO t (name, extra) VALUES ('a', 'x')" })
    expect(await db.prepare('SELECT extra FROM t').first('extra')).toBe('x')
  })

  it('names the migration that failed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'umm-d1-'))
    dirs.push(dir)
    fs.writeFileSync(path.join(dir, '0001_bad.sql'), 'CREATE TABLE (;')
    expect(() => createD1({ migrations: dir })).toThrow(/createD1: 0001_bad\.sql:/)
    expect(() => createD1({ migrations: path.join(dir, 'none') })).toThrow(/no migrations folder/)
  })

  it('runs a script through exec, and exposes node:sqlite underneath', async () => {
    const db = createD1()
    const r = await db.exec(`${SCHEMA}\nINSERT INTO t (name) VALUES ('a'); -- a comment\n`)
    expect(r.count).toBe(2)
    expect(db.sqlite.prepare('SELECT name FROM t').get()).toMatchObject({ name: 'a' })
    db.close()
  })
})

describe('parameterCount', () => {
  it('counts as SQLite does, skipping quoted text and comments', () => {
    expect(parameterCount('SELECT ?, ?')).toBe(2)
    expect(parameterCount('SELECT ?2, ?1, ?')).toBe(3)
    expect(parameterCount("SELECT '?' || ?")).toBe(1)
    expect(parameterCount('SELECT "a?" FROM t -- ?\nWHERE x = ? /* ? */')).toBe(1)
    expect(parameterCount('SELECT 1')).toBe(0)
  })
})
