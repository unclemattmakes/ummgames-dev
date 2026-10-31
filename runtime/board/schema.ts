// The core's three tables: `rate`, `blocks` and `admin_log`. A game's runs table is its own.
//
// D1 applies migrations from `.sql` files, which `umm-dev copy` cannot stamp, so the SQL lives
// here as text. A game puts `BOARD_CORE_SQL` into a migration of its own, word for word, and
// its tests run `schemaProblems` against its migrations to catch a drift. Every statement is
// `IF NOT EXISTS`, so it is a no-op on a database that already has these tables.
//
// THE PRIVACY LINE these tables keep: `rate` holds salted sender hashes and never a run;
// `blocks` holds owner hashes and handles and never an address; the game's runs table holds
// owner hashes and never an address. So nothing links a run to an address.
//
// SERVER-SAFE: no imports but the D1 slice's types.

import type { D1Database } from './d1'

export const BOARD_CORE_SQL = `-- The board core's tables (runtime/board/schema.ts in @ummgames/dev).

-- Hits counted per sender per window ('<hash>:<tag>:<slot>'), and per board ('*:<tag>:<slot>').
-- A row goes rateKeepMs (two days by default) after its window starts.
CREATE TABLE IF NOT EXISTS rate (
  bucket TEXT    PRIMARY KEY,
  win    INTEGER NOT NULL,                  -- ms the window starts at
  count  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS rate_win ON rate (win);

-- What may not post. The kinds are the game's (defineBoard's blockKinds): 'owner' (an owner
-- hash) and 'handle' by habit. No address kind, on purpose: no table links a run to one.
-- Kept until lifted.
CREATE TABLE IF NOT EXISTS blocks (
  kind       TEXT    NOT NULL,
  value      TEXT    NOT NULL,
  reason     TEXT    NOT NULL,
  created_at INTEGER NOT NULL,              -- ms since the epoch
  PRIMARY KEY (kind, value)
);

-- One row per admin action that changed something, deleted adminLogDays (90 by default)
-- after it was written.
CREATE TABLE IF NOT EXISTS admin_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      INTEGER NOT NULL,                 -- ms since the epoch
  action  TEXT    NOT NULL,                 -- block | unblock, and the game's own
  target  TEXT    NOT NULL,                 -- '<kind>:<value>', or what the game's action names
  count   INTEGER NOT NULL,                 -- rows the action removed or changed
  reason  TEXT    NOT NULL,
  detail  TEXT    NOT NULL                  -- JSON: what was removed, as the audit showed it
);

CREATE INDEX IF NOT EXISTS admin_log_at ON admin_log (at);
`

/** The columns each core table must have, and its primary key in order. */
export const BOARD_CORE_TABLES: Readonly<
  Record<string, { readonly columns: readonly string[]; readonly key: readonly string[] }>
> = {
  rate: { columns: ['bucket', 'win', 'count'], key: ['bucket'] },
  blocks: { columns: ['kind', 'value', 'reason', 'created_at'], key: ['kind', 'value'] },
  admin_log: {
    columns: ['id', 'at', 'action', 'target', 'count', 'reason', 'detail'],
    key: ['id'],
  },
}

/**
 * What a database lacks that the core needs: a missing table, a missing column, another
 * primary key. Empty means the core can run on it. For a game's tests, against its migrations
 * applied to the shim; it reads `PRAGMA table_info`, which D1 also answers.
 */
export const schemaProblems = async (db: D1Database): Promise<string[]> => {
  const problems: string[] = []
  for (const [table, want] of Object.entries(BOARD_CORE_TABLES)) {
    const info = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string; pk: number }>()
    if (info.results.length === 0) {
      problems.push(`no table ${table}`)
      continue
    }
    const names = new Set(info.results.map((c) => c.name))
    for (const c of want.columns) if (!names.has(c)) problems.push(`${table} has no column ${c}`)
    const key = info.results
      .filter((c) => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.name)
    if (key.join(',') !== want.key.join(',')) {
      problems.push(`${table}'s primary key is (${key.join(', ')}), not (${want.key.join(', ')})`)
    }
  }
  return problems
}
