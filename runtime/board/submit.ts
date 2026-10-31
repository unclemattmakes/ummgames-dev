// The front of a submit, which every board does the same way, and the per-board daily cap.
//
// `admitSubmit` runs before the game reads a byte of the run:
//
//   1. no database or no salt: 503 `unconfigured`. Without a salt the board would have to count
//      raw addresses, so it takes nothing instead;
//   2. the sweep (core and game), on every submit, refused or not;
//   3. one hit for the sender in every window, BEFORE the body is read, so a stream of garbage
//      costs its sender the same as a stream of runs. Over any window: 429 `rate`;
//   4. the body, read under `bodyMax` bytes: 413 `size` past it.
//
// Then the game parses, checks blocks (`blockOf`), validates, and decides whether the run
// places. Only once it would store it does it call `overDailyCap`: counted earlier, a few
// senders posting `{}` would fill the day's budget and close the board for everybody.
//
// SERVER-SAFE: no imports but this folder's.

import type { Board } from './board'
import type { D1Database } from './d1'
import { ADDRESS_HEADER, senderHash } from './digest'
import { readCapped } from './http'
import { sweepCore } from './moderation'
import { DAY_MS, hit, type RateWindow, windowText } from './rate'

/** What `admitSubmit` needs from the Worker. */
export interface SubmitCall {
  readonly db: D1Database | undefined
  /** The secret that salts sender hashes. */
  readonly salt: string | undefined
  readonly now: number
  /** Bytes the body may have. */
  readonly bodyMax: number
  /** The sender's windows, all counted on every submit. */
  readonly windows: readonly RateWindow[]
  /** Where the sender's address is read from. Default `cf-connecting-ip`. */
  readonly addressHeader?: string
}

export type Admitted =
  | {
      readonly ok: true
      readonly db: D1Database
      /** The body as text, under `bodyMax` bytes. Not parsed: the game parses. */
      readonly text: string
      /** The sender's salted hash, for a game that audits submits. */
      readonly sender: string
    }
  | { readonly ok: false; readonly response: Response }

/** The front of a submit: steps 1 to 4 at the top of this file. */
export const admitSubmit = async (
  board: Board,
  request: Request,
  call: SubmitCall,
): Promise<Admitted> => {
  const { db, salt, now } = call
  if (!db || !salt) {
    return {
      ok: false,
      response: board.refuse(503, 'unconfigured', 'the board has no database or no salt bound'),
    }
  }
  await sweepCore(board, db, now)
  const sender = await senderHash(request, salt, call.addressHeader ?? ADDRESS_HEADER)
  const over = (await hit(db, sender, call.windows, now)).find((h) => h.over)
  if (over) {
    return {
      ok: false,
      response: board.refuse(
        429,
        'rate',
        `more than ${over.window.limit} submit${over.window.limit === 1 ? '' : 's'} ${windowText(over.window)}`,
        { 'retry-after': String(over.retryAfter) },
      ),
    }
  }
  const text = await readCapped(request, call.bodyMax)
  if (text === null) {
    return {
      ok: false,
      response: board.refuse(413, 'size', `the body is over ${call.bodyMax} bytes`),
    }
  }
  return { ok: true, db, text, sender }
}

/** The whole board's window: what `overDailyCap` counts in, as `*:d:<day>`. */
export const DAILY_STORED: Omit<RateWindow, 'limit'> = { tag: 'd', ms: DAY_MS }

/**
 * Count one stored run against the board's budget for the UTC day, and answer 503 `full` once
 * it is over `limit`, or null while it is not. Call it only for a run the game is about to
 * store. `rateCount(db, '*', { ...DAILY_STORED, limit }, now)` reads the count for an audit.
 */
export const overDailyCap = async (
  board: Board,
  db: D1Database,
  now: number,
  limit: number,
): Promise<Response | null> => {
  const [today] = await hit(db, '*', [{ ...DAILY_STORED, limit }], now)
  if (!today?.over) return null
  return board.refuse(503, 'full', 'the board has stored all it will take today', {
    'retry-after': String(today.retryAfter),
  })
}
