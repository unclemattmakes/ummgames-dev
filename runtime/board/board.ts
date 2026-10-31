// The seam between the core and a game's board: one `defineBoard(config)` per game.
//
// The core owns the `rate`, `blocks` and `admin_log` tables and every route that touches only
// them. The game owns its runs table, its validator, its board keys and its public routes. The
// two meet in three places, all here:
//
//   - blockKinds: what a block can name. Each kind says which values are valid, how a block
//     body names a value some other way (by one of its runs), and which of the game's rows a
//     `wipe` deletes. The core never reads the game's runs table except through these.
//   - sweep: the game's own housekeeping (expired runs, old dailies, nonces), batched with the
//     core's on every submit and admin request.
//   - refuse: the shape a refusal takes on the wire, when the game's client parses another.
//
// SERVER-SAFE: no imports but the D1 slice's types and the default refusal.

import type { D1Database, D1PreparedStatement } from './d1'
import { refuse as defaultRefuse, type Refuse } from './http'
import { DAY_MS } from './rate'

/** One kind of block: `owner` (a device) and `handle` (a name) by habit. */
export interface BlockKind {
  /** Whether `value` is one this kind can hold. Checked on every block, before anything else. */
  readonly valid: (value: string) => boolean
  /**
   * The value a block body names another way: `{ kind: 'owner', run: '<id>' }` is that run's
   * owner hash. Return `undefined` to use `body.value`, or `null` when the body names a row
   * that is not there (a 404).
   */
  readonly resolve?: (
    body: Readonly<Record<string, unknown>>,
    db: D1Database,
  ) => Promise<string | null | undefined>
  /**
   * The game's rows a block of `value` covers: what `wipe: true` deletes. `rows` go into the
   * log's detail as they are; `remove` is batched with the block and the log row.
   */
  readonly covers?: (
    db: D1Database,
    value: string,
  ) => Promise<{ readonly rows: readonly unknown[]; readonly remove: D1PreparedStatement }>
}

export interface BoardConfig {
  /** The kinds a block can name, by the word stored in `blocks.kind`. */
  readonly blockKinds: Readonly<Record<string, BlockKind>>
  /** The game's housekeeping, batched with the core's sweep. Default: none. */
  readonly sweep?: (db: D1Database, now: number) => D1PreparedStatement[]
  /** How a refusal goes on the wire. Default: `{ error, reason }`. */
  readonly refuse?: Refuse
  /** Characters an admin token needs before the admin routes answer at all. Default 32. */
  readonly adminTokenMinLength?: number
  /** Days an `admin_log` row is kept. Default 90. */
  readonly adminLogDays?: number
  /** Characters of an admin's reason that are kept. Default 500. */
  readonly adminReasonMax?: number
  /** Rows an admin listing returns at most. Default 500. */
  readonly adminListMax?: number
  /** The reason stored when an admin gives none. Default `''`. */
  readonly noReason?: string
  /** ms a `rate` row is kept after its window starts. Default two days. */
  readonly rateKeepMs?: number
}

/** A board's config with every default filled in. */
export interface Board {
  readonly blockKinds: Readonly<Record<string, BlockKind>>
  readonly sweep: (db: D1Database, now: number) => D1PreparedStatement[]
  readonly refuse: Refuse
  readonly adminTokenMinLength: number
  readonly adminLogDays: number
  readonly adminReasonMax: number
  readonly adminListMax: number
  readonly noReason: string
  readonly rateKeepMs: number
}

/**
 * Fill in the defaults. Call it once, at module level, and pass the result to the core's
 * functions. A `rateKeepMs` shorter than the game's longest rate window would delete a count
 * before its window ends, so it is refused here.
 */
export const defineBoard = (config: BoardConfig): Board => {
  const board: Board = {
    blockKinds: config.blockKinds,
    sweep: config.sweep ?? (() => []),
    refuse: config.refuse ?? defaultRefuse,
    adminTokenMinLength: config.adminTokenMinLength ?? 32,
    adminLogDays: config.adminLogDays ?? 90,
    adminReasonMax: config.adminReasonMax ?? 500,
    adminListMax: config.adminListMax ?? 500,
    noReason: config.noReason ?? '',
    rateKeepMs: config.rateKeepMs ?? 2 * DAY_MS,
  }
  if (board.rateKeepMs < DAY_MS) {
    throw new RangeError('defineBoard: rateKeepMs under a day would delete a daily count early')
  }
  if (board.adminTokenMinLength < 16) {
    throw new RangeError('defineBoard: adminTokenMinLength under 16 makes a guessable token')
  }
  return Object.freeze(board)
}
