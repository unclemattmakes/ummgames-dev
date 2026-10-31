// Blocks and the admin log: what may not post, and what an admin changed and why.
//
// The submit path reads one thing here, `blockOf`. Everything else is behind the admin door
// (admin.ts). Each admin change is batched with its log row, so a change and its record land
// together or not at all.
//
// SERVER-SAFE: no imports but this folder's.

import type { Board } from './board'
import { type D1Database, type D1PreparedStatement, isMissingTable } from './d1'
import { json } from './http'
import { DAY_MS } from './rate'

/**
 * Which of `names` is blocked, in the order given: `{ owner: hash, handle }` answers `'owner'`
 * when both are. Null when none is. A database without a `blocks` table reads as no blocks
 * (there can be none without it), so a deploy that lands before its migration still takes runs.
 */
export const blockOf = async (
  db: D1Database,
  names: Readonly<Record<string, string>>,
): Promise<string | null> => {
  const pairs = Object.entries(names)
  if (pairs.length === 0) return null
  try {
    const rows = await db
      .prepare(
        `SELECT kind FROM blocks WHERE ${pairs.map(() => '(kind = ? AND value = ?)').join(' OR ')}`,
      )
      .bind(...pairs.flat())
      .all<{ kind: string }>()
    const hit = new Set(rows.results.map((r) => r.kind))
    return pairs.find(([kind]) => hit.has(kind))?.[0] ?? null
  } catch (e) {
    if (isMissingTable(e)) return null
    throw e
  }
}

/** An admin's reason, trimmed and capped; `board.noReason` when none was given. */
export const reasonOf = (board: Board, text: unknown): string => {
  const r = typeof text === 'string' ? text.trim().slice(0, board.adminReasonMax) : ''
  return r || board.noReason
}

/** One `admin_log` row. `detail` is stored as JSON. */
export interface AdminLogEntry {
  readonly action: string
  readonly target: string
  readonly count: number
  readonly reason: string
  readonly detail: unknown
}

/** One log row, as a statement to batch with the change it records. */
export const logged = (db: D1Database, now: number, entry: AdminLogEntry): D1PreparedStatement =>
  db
    .prepare(
      'INSERT INTO admin_log (at, action, target, count, reason, detail) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(now, entry.action, entry.target, entry.count, entry.reason, JSON.stringify(entry.detail))

/**
 * Housekeeping, on every submit and admin request before anything else: rate rows past
 * `rateKeepMs`, log rows past `adminLogDays`, and the game's own (`board.sweep`), in one batch.
 * What a privacy page says about how long a sender hash and a log row live rests on this
 * running on the next request, whoever sends it.
 */
export const sweepCore = async (board: Board, db: D1Database, now: number): Promise<void> => {
  await db.batch([
    db.prepare('DELETE FROM rate WHERE win < ?').bind(now - board.rateKeepMs),
    db.prepare('DELETE FROM admin_log WHERE at < ?').bind(now - board.adminLogDays * DAY_MS),
    ...board.sweep(db, now),
  ])
}

// Blocks, as the admin routes change them.

interface BlockRow {
  kind: string
  value: string
  reason: string
  created_at: number
}

export interface BlockView {
  readonly kind: string
  readonly value: string
  readonly reason: string
  readonly createdAt: number
}

const blockView = (r: BlockRow): BlockView => ({
  kind: r.kind,
  value: r.value,
  reason: r.reason,
  createdAt: r.created_at,
})

/** Every block, newest first, at most `board.adminListMax`. */
export const listBlocks = async (board: Board, db: D1Database): Promise<BlockView[]> => {
  const rows = await db
    .prepare(
      'SELECT kind, value, reason, created_at FROM blocks ORDER BY created_at DESC, kind, value LIMIT ?',
    )
    .bind(board.adminListMax)
    .all<BlockRow>()
  return rows.results.map(blockView)
}

/**
 * Block a value: `{ kind, value | <what the kind resolves>, reason?, wipe? }`. A block that is
 * already there keeps its time and takes the new reason. `wipe: true` also deletes every row
 * the kind `covers`, in the same batch, and logs them. Answers 201 `{ kind, value, wiped }`.
 */
export const addBlock = async (
  board: Board,
  db: D1Database,
  now: number,
  body: Readonly<Record<string, unknown>>,
): Promise<Response> => {
  const kindName = typeof body.kind === 'string' ? body.kind : ''
  const kind = Object.hasOwn(board.blockKinds, kindName) ? board.blockKinds[kindName] : undefined
  if (!kind) {
    const names = Object.keys(board.blockKinds).join(', ')
    return board.refuse(400, 'kind', `\`kind\` is one of: ${names}`)
  }
  let value = typeof body.value === 'string' ? body.value : ''
  if (kind.resolve) {
    const resolved = await kind.resolve(body, db)
    if (resolved === null) return board.refuse(404, 'gone', 'the block names nothing that exists')
    if (resolved !== undefined) value = resolved
  }
  if (!kind.valid(value)) return board.refuse(400, 'value', `not a ${kindName} this board stores`)
  const wipe = body.wipe === true
  if (wipe && !kind.covers) return board.refuse(400, 'wipe', `a ${kindName} block cannot wipe`)
  const reason = reasonOf(board, body.reason)
  const covered = wipe && kind.covers ? await kind.covers(db, value) : null
  const wiped = covered?.rows.length ?? 0
  await db.batch([
    db
      .prepare(
        'INSERT INTO blocks (kind, value, reason, created_at) VALUES (?, ?, ?, ?) ' +
          'ON CONFLICT (kind, value) DO UPDATE SET reason = excluded.reason',
      )
      .bind(kindName, value, reason, now),
    ...(covered ? [covered.remove] : []),
    logged(db, now, {
      action: 'block',
      target: `${kindName}:${value}`,
      count: wiped,
      reason,
      detail: { wiped: covered?.rows ?? [] },
    }),
  ])
  return json(201, { kind: kindName, value, wiped })
}

/** Lift a block. 404 when there is none; 200 `{ lifted }`, the block as it was. */
export const liftBlock = async (
  board: Board,
  db: D1Database,
  now: number,
  kind: string,
  value: string,
  reasonText: unknown,
): Promise<Response> => {
  const row = await db
    .prepare('SELECT kind, value, reason, created_at FROM blocks WHERE kind = ? AND value = ?')
    .bind(kind, value)
    .first<BlockRow>()
  if (!row) return board.refuse(404, 'gone', 'no such block')
  await db.batch([
    db.prepare('DELETE FROM blocks WHERE kind = ? AND value = ?').bind(kind, value),
    logged(db, now, {
      action: 'unblock',
      target: `${kind}:${value}`,
      count: 0,
      reason: reasonOf(board, reasonText),
      detail: blockView(row),
    }),
  ])
  return json(200, { lifted: blockView(row) })
}

// The log.

export interface LogView {
  readonly id: number
  readonly at: number
  readonly action: string
  readonly target: string
  readonly count: number
  readonly reason: string
  readonly detail: unknown
}

/** The newest `limit` log rows, newest first, `detail` parsed back from JSON. */
export const readLog = async (db: D1Database, limit: number): Promise<LogView[]> => {
  const rows = await db
    .prepare(
      'SELECT id, at, action, target, count, reason, detail FROM admin_log ORDER BY at DESC, id DESC LIMIT ?',
    )
    .bind(limit)
    .all<Omit<LogView, 'detail'> & { detail: string }>()
  return rows.results.map((r) => {
    let detail: unknown = r.detail
    try {
      detail = JSON.parse(r.detail)
    } catch {
      // A row some other tool wrote as plain text: shown as it is.
    }
    return { ...r, detail }
  })
}
