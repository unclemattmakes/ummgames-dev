// Fixed-window rate limits, counted in the `rate` table (schema.ts).
//
// A window is a tag, a length and a limit. A hit counts one in the row
// `<who>:<tag>:<slot>`, where `slot` is `floor(now / ms)`, and `win` holds the ms the window
// starts at, which is what the sweep deletes by. `who` is a sender's salted hash
// (`senderHash`), or `*` for a count over the whole board, such as runs stored per day.
//
// Fixed windows let two bursts land up to one window apart across a boundary; a longer window
// beside a short one bounds the total.
//
// SERVER-SAFE: no imports but the D1 slice's types.

import type { D1Database, D1PreparedStatement, D1Result } from './d1'

export const SECOND_MS = 1000
export const MINUTE_MS = 60 * SECOND_MS
export const HOUR_MS = 60 * MINUTE_MS
export const DAY_MS = 24 * HOUR_MS

export interface RateWindow {
  /** The bucket's tag: `s`, `h` and `d` by habit. Two windows of one sender need two tags. */
  readonly tag: string
  /** The window's length, ms. */
  readonly ms: number
  /** Hits a window takes. The one after it is over. */
  readonly limit: number
}

/** `limit` hits an hour, tag `h`. */
export const perHour = (limit: number): RateWindow => ({ tag: 'h', ms: HOUR_MS, limit })

/** `limit` hits a UTC day, tag `d`. */
export const perDay = (limit: number): RateWindow => ({ tag: 'd', ms: DAY_MS, limit })

/** What a hit found. */
export interface RateHit {
  readonly window: RateWindow
  /** Hits in this window, this one included. */
  readonly count: number
  readonly over: boolean
  /** Seconds until the window ends: a `retry-after`. At least 1. */
  readonly retryAfter: number
}

/** The ms `now`'s window starts at. */
export const windowStart = (w: RateWindow, now: number): number => Math.floor(now / w.ms) * w.ms

/** The `rate` row `who` is counted in for `now`. */
export const rateBucket = (who: string, w: RateWindow, now: number): string =>
  `${who}:${w.tag}:${Math.floor(now / w.ms)}`

/** Seconds from `now` to the end of its window, at least 1. */
export const retryAfter = (w: RateWindow, now: number): number =>
  Math.max(1, Math.ceil((windowStart(w, now) + w.ms - now) / 1000))

/** Count one hit, as a statement to run or batch. It returns the row's new `count`. */
export const countHit = (
  db: D1Database,
  who: string,
  w: RateWindow,
  now: number,
): D1PreparedStatement =>
  db
    .prepare(
      'INSERT INTO rate (bucket, win, count) VALUES (?, ?, 1) ' +
        'ON CONFLICT (bucket) DO UPDATE SET count = count + 1 RETURNING count',
    )
    .bind(rateBucket(who, w, now), windowStart(w, now))

const countOf = (r: D1Result | undefined): number =>
  Number((r?.results?.[0] as { count?: number } | undefined)?.count ?? 1)

/**
 * Count one hit for `who` in every window, in one batch, and say what each found. The count
 * happens whether or not a window is over: a sender that keeps trying keeps paying.
 */
export const hit = async (
  db: D1Database,
  who: string,
  windows: readonly RateWindow[],
  now: number,
): Promise<RateHit[]> => {
  if (windows.length === 0) return []
  const results = await db.batch(windows.map((w) => countHit(db, who, w, now)))
  return windows.map((window, i) => {
    const count = countOf(results[i])
    return { window, count, over: count > window.limit, retryAfter: retryAfter(window, now) }
  })
}

/** The count in `who`'s current window, without adding to it (an audit's "today"). */
export const rateCount = async (
  db: D1Database,
  who: string,
  w: RateWindow,
  now: number,
): Promise<number> => {
  const row = await db
    .prepare('SELECT count FROM rate WHERE bucket = ?')
    .bind(rateBucket(who, w, now))
    .first<{ count: number }>()
  return Number(row?.count ?? 0)
}

/** "this hour", "today", "in 5 s": how a refusal names a window. */
export const windowText = (w: RateWindow): string =>
  w.ms === DAY_MS
    ? 'today'
    : w.ms === HOUR_MS
      ? 'this hour'
      : w.ms === MINUTE_MS
        ? 'this minute'
        : `in ${w.ms / 1000} s`
