// The admin door: every moderation route behind one bearer token.
//
// `routeAdmin` checks `Authorization: Bearer <token>` FIRST, before the path is matched, the
// body read or the database touched. A token shorter than `adminTokenMinLength`, or none,
// switches the routes OFF (503), never open: a short token is one somebody typed, and one
// somebody typed can be guessed. The token is compared as SHA-256 digests, every byte, so the
// time a wrong guess takes says nothing about how much of it was right. It is a Worker secret,
// in no file, and never in a URL, which access logs keep.
//
// Behind the door, in order: the database, the core's tables (a database without them answers
// 503 `unmigrated`), the sweep, the game's own admin routes, then the core's:
//
//   GET    <prefix>/blocks                              every block, newest first
//   POST   <prefix>/blocks  { kind, value, reason?, wipe? }   block a value (or what the kind resolves)
//   DELETE <prefix>/blocks?kind=&value=[&reason=]       lift a block
//   GET    <prefix>/log[?limit=]                        the admin log, newest first
//
// SERVER-SAFE: no imports but this folder's.

import type { Board } from './board'
import { type D1Database, isMissingTable } from './d1'
import { sameDigest, sha256Bytes } from './digest'
import { intParam, json, parseJsonObject, readCapped } from './http'
import { addBlock, liftBlock, listBlocks, readLog, sweepCore } from './moderation'

/** Bytes an admin body may have: a block, a reason. */
export const ADMIN_BODY_MAX = 16 * 1024

/** Why this request may NOT use an admin route, or null when it may. The whole of the check. */
export const adminRefusal = async (
  board: Board,
  request: Request,
  token: string | undefined,
): Promise<Response | null> => {
  const secret = token ?? ''
  if (secret.length < board.adminTokenMinLength) {
    return board.refuse(
      503,
      'unconfigured',
      `the admin routes are off: the admin token is unset or shorter than ${board.adminTokenMinLength} characters`,
    )
  }
  const given = /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '')?.[1] ?? ''
  if (!sameDigest(await sha256Bytes(given), await sha256Bytes(secret))) {
    return board.refuse(401, 'admin', 'not authorised', { 'www-authenticate': 'Bearer' })
  }
  return null
}

/** What one admin request needs from the Worker. */
export interface AdminCall {
  readonly db: D1Database | undefined
  readonly token: string | undefined
  readonly now: number
  /** The path after the game's admin prefix: `/blocks`, `/audit`. */
  readonly path: string
}

/**
 * The game's own admin routes: an answer, or null for "not mine" (the core's routes are tried
 * next). Called only after the token, the tables and the sweep.
 */
export type AdminRoutes = (
  request: Request,
  db: D1Database,
  path: string,
  now: number,
) => Promise<Response | null>

/** The core's routes, or null when `path` is none of them. Called behind the door. */
export const coreAdminRoute = async (
  board: Board,
  request: Request,
  db: D1Database,
  path: string,
  now: number,
): Promise<Response | null> => {
  const m = request.method
  const url = new URL(request.url)
  if (path === '/blocks' && m === 'GET') {
    return json(200, { blocks: await listBlocks(board, db) })
  }
  if (path === '/blocks' && m === 'POST') {
    const text = await readCapped(request, ADMIN_BODY_MAX)
    if (text === null) return board.refuse(413, 'size', `the body is over ${ADMIN_BODY_MAX} bytes`)
    const body = parseJsonObject(text)
    if (!body) return board.refuse(400, 'body', 'the body is not a JSON object')
    return addBlock(board, db, now, body)
  }
  if (path === '/blocks' && m === 'DELETE') {
    const q = url.searchParams
    return liftBlock(board, db, now, q.get('kind') ?? '', q.get('value') ?? '', q.get('reason'))
  }
  if (path === '/log' && m === 'GET') {
    const limit = intParam(url, 'limit', board.adminListMax, 100)
    return json(200, { log: await readLog(db, limit) })
  }
  return null
}

/** One admin request, through the door. Answers 404 `admin` for a path nobody routes. */
export const routeAdmin = async (
  board: Board,
  request: Request,
  call: AdminCall,
  routes?: AdminRoutes,
): Promise<Response> => {
  const refused = await adminRefusal(board, request, call.token)
  if (refused) return refused
  const db = call.db
  if (!db) return board.refuse(503, 'unconfigured', 'the board has no database bound')
  try {
    await db.prepare('SELECT 1 FROM blocks LIMIT 1').all()
    await sweepCore(board, db, call.now)
    return (
      (await routes?.(request, db, call.path, call.now)) ??
      (await coreAdminRoute(board, request, db, call.path, call.now)) ??
      board.refuse(404, 'admin', 'no such admin route')
    )
  } catch (e) {
    if (!isMissingTable(e)) throw e
    return board.refuse(
      503,
      'unmigrated',
      'this database lacks a table the board needs: apply the migrations',
    )
  }
}
