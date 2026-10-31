// @ts-check
/**
 * A Cloudflare D1 binding over `node:sqlite`, for a game's unit tests: the SQL is real SQLite,
 * the transport is not. It keeps the behaviours of D1 a test could otherwise pass without:
 *
 * - statements compile when they run, not when they are prepared, so bad SQL fails at
 *   `first`/`all`/`run`, as on D1;
 * - `bind` refuses `undefined` and objects (`D1_TYPE_ERROR`), turns booleans into 1 and 0, and
 *   a statement run with the wrong number of bindings fails;
 * - `meta.changes` counts only what the statement itself changed (0 for a SELECT);
 * - blobs come back as arrays of numbers, rows as plain objects;
 * - `batch` is one transaction, rolled back whole when a statement fails;
 * - errors read `D1_ERROR: <SQLite's message>`.
 *
 * `node:sqlite` is loaded when `createD1` is first called, so importing `@ummgames/dev/testing`
 * on a node without it costs nothing until a test asks for a database.
 */
import fs from 'node:fs'
import path from 'node:path'

/** @typedef {import('node:sqlite').DatabaseSync} DatabaseSync */
/** @typedef {import('node:sqlite').SQLInputValue} SQLInputValue */

/**
 * @typedef {object} D1Meta
 * @property {number} changes
 * @property {number} last_row_id
 * @property {boolean} changed_db
 * @property {number} duration
 */

/**
 * @template [T=Record<string, unknown>]
 * @typedef {{ results: T[], success: true, meta: D1Meta }} D1Result
 */

/** @type {typeof import('node:sqlite') | undefined} */
let sqliteModule

/** @returns {typeof import('node:sqlite')} */
function loadSqlite() {
  if (sqliteModule) return sqliteModule
  try {
    sqliteModule = /** @type {typeof import('node:sqlite')} */ (
      process.getBuiltinModule('node:sqlite')
    )
  } catch {
    sqliteModule = undefined
  }
  if (!sqliteModule) {
    throw new Error(`createD1: node:sqlite is not available in node ${process.version}`)
  }
  return sqliteModule
}

/**
 * The `?` parameters `sql` takes, as SQLite counts them: `?` is one more than the highest so
 * far, `?NNN` is NNN. Quoted text and comments are skipped. Named parameters are not counted
 * (D1 does not take them).
 * @param {string} sql
 * @returns {number}
 */
export function parameterCount(sql) {
  let highest = 0
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]
    if (c === "'" || c === '"' || c === '`') {
      const end = sql.indexOf(c, i + 1)
      i = end < 0 ? sql.length : end
    } else if (c === '[') {
      const end = sql.indexOf(']', i + 1)
      i = end < 0 ? sql.length : end
    } else if (c === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i)
      i = end < 0 ? sql.length : end
    } else if (c === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2)
      i = end < 0 ? sql.length : end + 1
    } else if (c === '?') {
      const digits = /^\d+/.exec(sql.slice(i + 1))?.[0]
      if (digits) {
        highest = Math.max(highest, Number(digits))
        i += digits.length
      } else highest += 1
    }
  }
  return highest
}

/**
 * @param {unknown} e
 * @returns {Error}
 */
function d1Error(e) {
  const message = e instanceof Error ? e.message : String(e)
  return new Error(`D1_ERROR: ${message}`, { cause: e })
}

/**
 * A value as D1 binds it.
 * @param {unknown} v
 * @returns {SQLInputValue}
 */
function bindable(v) {
  if (v === null || typeof v === 'number' || typeof v === 'string' || typeof v === 'bigint') {
    return v
  }
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v instanceof ArrayBuffer) return new Uint8Array(v)
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
  const type = v === undefined ? 'undefined' : typeof v
  throw new TypeError(`D1_TYPE_ERROR: Type '${type}' not supported for value '${String(v)}'`)
}

/**
 * A row as D1 returns it: a plain object, blobs as arrays of numbers.
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
function plainRow(row) {
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const [k, v] of Object.entries(row)) out[k] = v instanceof Uint8Array ? Array.from(v) : v
  return out
}

/**
 * A D1 binding over a fresh SQLite database.
 * @param {{ migrations?: string, sql?: string | string[], file?: string }} [options]
 */
export function createD1(options = {}) {
  const { DatabaseSync } = loadSqlite()
  const sqlite = new DatabaseSync(options.file ?? ':memory:')
  const totals = sqlite.prepare('SELECT total_changes() AS total, changes() AS last')
  const lastRow = sqlite.prepare('SELECT last_insert_rowid() AS id')

  /**
   * Run one statement the way D1 does, and say what it did.
   * @param {string} sql
   * @param {SQLInputValue[]} params
   * @returns {D1Result}
   */
  function execute(sql, params) {
    const started = performance.now()
    const want = parameterCount(sql)
    if (params.length !== want) {
      throw d1Error(
        new Error(
          `Wrong number of parameter bindings for SQL query: wanted ${want}, got ${params.length}`,
        ),
      )
    }
    /** @type {Record<string, unknown>[]} */
    let rows
    const before = Number(/** @type {{ total: number }} */ (totals.get()).total)
    try {
      rows = /** @type {Record<string, unknown>[]} */ (sqlite.prepare(sql).all(...params))
    } catch (e) {
      throw d1Error(e)
    }
    const after = /** @type {{ total: number, last: number }} */ (totals.get())
    const changed = Number(after.total) !== before
    return {
      results: rows.map(plainRow),
      success: true,
      meta: {
        changes: changed ? Number(after.last) : 0,
        last_row_id: Number(/** @type {{ id: number }} */ (lastRow.get()).id),
        changed_db: changed,
        duration: performance.now() - started,
      },
    }
  }

  /** @type {WeakSet<object>} */
  const own = new WeakSet()
  /** @type {WeakMap<object, () => D1Result>} */
  const runners = new WeakMap()

  /**
   * @param {string} sql
   * @param {SQLInputValue[]} params
   */
  function statement(sql, params) {
    const s = {
      /** @param {...unknown} values */
      bind: (...values) => statement(sql, values.map(bindable)),
      /**
       * @param {string} [column]
       * @returns {Promise<any>}
       */
      first: async (column) => {
        const row = execute(sql, params).results[0]
        if (row === undefined) return null
        if (column === undefined) return row
        if (!Object.hasOwn(row, column)) throw d1Error(new Error(`Column not found: ${column}`))
        return row[column]
      },
      /** @returns {Promise<D1Result<any>>} */
      all: async () => execute(sql, params),
      /** @returns {Promise<D1Result<any>>} */
      run: async () => execute(sql, params),
      /**
       * @param {{ columnNames?: boolean }} [opts]
       * @returns {Promise<unknown[][]>}
       */
      raw: async (opts = {}) => {
        const { results } = execute(sql, params)
        const names = results[0] ? Object.keys(results[0]) : []
        const rows = results.map((r) => Object.values(r))
        return opts.columnNames ? [names, ...rows] : rows
      },
    }
    own.add(s)
    runners.set(s, () => execute(sql, params))
    return s
  }

  const db = {
    /** The node:sqlite database underneath, for a test that reads tables directly. */
    sqlite,
    /** @param {string} sql */
    prepare: (sql) => statement(sql, []),
    /**
     * Every statement in one transaction; on a failure, none of them.
     * @param {object[]} statements
     * @returns {Promise<D1Result<any>[]>}
     */
    batch: async (statements) => {
      const run = statements.map((s) => {
        const runner = own.has(s) ? runners.get(s) : undefined
        if (!runner) throw d1Error(new Error('batch: a statement from another database'))
        return runner
      })
      sqlite.exec('BEGIN')
      try {
        const out = run.map((r) => r())
        sqlite.exec('COMMIT')
        return out
      } catch (e) {
        sqlite.exec('ROLLBACK')
        throw e
      }
    },
    /**
     * Several statements as one script, as `wrangler d1 execute --file` or D1's `exec`.
     * @param {string} sql
     */
    exec: async (sql) => {
      const started = performance.now()
      try {
        sqlite.exec(sql)
      } catch (e) {
        throw d1Error(e)
      }
      const count = sql.split(';').filter((part) => part.replace(/--.*$/gm, '').trim()).length
      return { count, duration: performance.now() - started }
    },
    /** Close the database. */
    close: () => sqlite.close(),
  }

  for (const file of migrationFiles(options.migrations)) {
    try {
      sqlite.exec(fs.readFileSync(file, 'utf8'))
    } catch (e) {
      throw new Error(`createD1: ${path.basename(file)}: ${e instanceof Error ? e.message : e}`)
    }
  }
  for (const text of [options.sql ?? []].flat()) sqlite.exec(text)
  return db
}

/**
 * A migrations folder's `.sql` files, in the order wrangler applies them: by name.
 * @param {string | undefined} dir
 * @returns {string[]}
 */
function migrationFiles(dir) {
  if (dir === undefined) return []
  if (!fs.existsSync(dir)) throw new Error(`createD1: no migrations folder at ${dir}`)
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => path.join(dir, f))
}
