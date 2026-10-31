# Leaderboard servers: the board core

`runtime/board/` is the part of a leaderboard server that every game's board does the same way:
reading a capped body, hashing owner keys and salted addresses, generated handles, fixed-window
rate limits, blocks, the admin log, and bearer-token admin routes. It runs on a Cloudflare Worker
over D1. It is **copied** into the game (`umm-dev copy board`), like the rest of `runtime/`.

The game keeps what makes its board its own: the runs table, the validator that judges a run,
the board keys (a mode, a course, a day), its public routes and its policy numbers.

`createD1()` from `@ummgames/dev/testing` is a D1 binding over `node:sqlite`, so the game's
unit tests run every statement for real, without wrangler. It is **linked**, not copied.

## Quick start

From the game's root:

```sh
pnpm exec umm-dev copy board --to src/net/board/ --dry-run
pnpm exec umm-dev copy board --to src/net/board/
```

1. **Add the tables.** Put `BOARD_CORE_SQL` (in `schema.ts`) into a migration of the game's own,
   beside its runs table. Every statement is `IF NOT EXISTS`, so on a database that already has
   these tables it does nothing.
2. **Define the board once.** Name the block kinds and how a wipe finds the game's rows:

   ```ts
   import { defineBoard } from './board/board'
   import { isOwnerHash } from './board/digest'
   import { isHandle } from './board/handles'

   const covers = (column: string) => async (db: D1Database, value: string) => ({
     rows: (await db.prepare(`SELECT id, handle FROM runs WHERE ${column} = ?`).bind(value).all())
       .results,
     remove: db.prepare(`DELETE FROM runs WHERE ${column} = ?`).bind(value),
   })

   export const board = defineBoard({
     blockKinds: {
       owner: { valid: isOwnerHash, covers: covers('owner_hash') },
       handle: { valid: isHandle, covers: covers('handle') },
     },
     sweep: (db, now) => [db.prepare('DELETE FROM runs WHERE expires_at < ?').bind(now)],
   })
   ```

3. **Submit through the gate.** The core does the front; the game does the rest:

   ```ts
   const admitted = await admitSubmit(board, request, {
     db: env.BOARD_DB, salt: env.IP_SALT, now, bodyMax: 64 * 1024, windows: [perHour(30)],
   })
   if (!admitted.ok) return admitted.response
   const body = parseJsonObject(admitted.text)            // the game's parse
   // ... the game's identity checks, then:
   if (await blockOf(admitted.db, { owner: await ownerHash(key), handle })) return board.refuse(403, 'blocked', '...')
   // ... the game's validator, then, for a run it will store:
   const full = await overDailyCap(board, admitted.db, now, 5000)
   if (full) return full
   ```

4. **Route the admin door.** Everything under the game's admin prefix:

   ```ts
   if (path.startsWith('/api/admin/')) {
     return routeAdmin(board, request,
       { db: env.BOARD_DB, token: env.ADMIN_TOKEN, now, path: path.slice('/api/admin'.length) },
       gameAdminRoutes)  // the game's own: audit, hide, delete a run; null for "not mine"
   }
   ```

5. **Test against the shim:**

   ```ts
   import { createD1 } from '@ummgames/dev/testing'

   const db = createD1({ migrations: 'migrations' })
   expect(await schemaProblems(db)).toEqual([])
   ```

## The files

`umm-dev copy board` takes them all. Each imports only files in this folder.

| File | Imports | What it holds |
|---|---|---|
| `d1.ts` | nothing | The D1 slice the core uses (types), `isMissingTable(e)`. |
| `http.ts` | nothing | Capped body reads, JSON answers and refusals, CORS by origin pattern. |
| `digest.ts` | nothing | SHA-256, owner keys and hashes, `rateKey`, `senderHash`. |
| `ids.ts` | nothing | `newId(length)`, `idShape(length)`. |
| `handles.ts` | nothing | The generated-handle word lists, `isHandle`, `randomHandle`. |
| `rate.ts` | `d1` | Fixed-window counts in the `rate` table. |
| `schema.ts` | `d1` | `BOARD_CORE_SQL`, `BOARD_CORE_TABLES`, `schemaProblems(db)`. |
| `board.ts` | `d1`, `http`, `rate` | The seam: `defineBoard(config)`. |
| `moderation.ts` | `board`, `d1`, `http`, `rate` | `blockOf`, blocks and the log, `sweepCore`. |
| `admin.ts` | `board`, `d1`, `digest`, `http`, `moderation` | The admin door and the core's admin routes. |
| `submit.ts` | `board`, `d1`, `digest`, `http`, `moderation`, `rate` | `admitSubmit`, `overDailyCap`. |

A game that wants only the helpers (`http`, `digest`, `ids`, `handles`) copies those files one at
a time; they import nothing.

### `http.ts`

| Export | What it does |
|---|---|
| `drainCapped(stream, cap)` | The bytes of a stream, or null once it passes `cap`. It stops reading and cancels the stream there, so memory is bounded by what arrived. |
| `readCapped(request, cap)` | The body as text, or null past `cap` bytes. A `Content-Length` over the cap is refused before a byte is read. No body is `''`. |
| `parseJsonObject(text)` | A JSON object, or null for anything else (an array, `null`, bad JSON). |
| `intParam(url, name, max, fallback)` | A positive integer query parameter, capped at `max`; `fallback` when absent or not one. |
| `json(status, body, headers?)` | A JSON answer with `cache-control: no-store` and `nosniff`. Pass a `cache-control` to replace it. |
| `refuse(status, code, reason, headers?)` | The default refusal: `{ error: code, reason }`. Its type is `Refuse`. |
| `originVerdict(request, pattern, options?)` | `{ ok, headers }`: may this browser origin call the board. See below. |
| `withHeaders(res, headers)` | `res` with headers added, copied so an immutable one can take them. |

**`originVerdict`** is for a board on another origin than its game. `pattern` is a regular
expression matched against the whole `Origin` header. No `Origin` (curl, a script) is admitted
with no CORS headers. A matching origin gets CORS headers and `Vary: Origin`. Anything else is
refused, including no pattern or a broken one. `options.methods` defaults to
`'GET, POST, OPTIONS'`, `options.headers` to `'content-type'`, so a page cannot send
`authorization` to an admin route.

### `digest.ts`

| Export | What it does |
|---|---|
| `sha256Bytes(data)`, `sha256Hex(data)`, `hexOfBytes(bytes)` | SHA-256 of a string (as UTF-8) or bytes, as bytes or lower-case hex. |
| `sameDigest(a, b)` | Equal, comparing every byte whatever the first difference. |
| `OWNER_KEY_SHAPE` | `/^[A-Za-z0-9_-]{22,128}$/`: a device's owner key, made and kept by the client. |
| `OWNER_HASH_SHAPE`, `isOwnerHash(v)` | 64 lower-case hex characters: how a table holds a device. |
| `ownerHash(key)` | `sha256Hex(key)`. |
| `rateKey(address)` | An IPv4 address whole; an IPv6 address by its /64 (`2001:db8:0:0::/64`), however it was spelled. |
| `ADDRESS_HEADER` | `'cf-connecting-ip'`. |
| `senderHash(request, salt, header?)` | `sha256Hex('<salt>:<rateKey(address)>')`, the address from `header` only. |

**`ownerHash` and `senderHash` make stored identifiers.** A block names a device by its owner
hash, and a rate row a sender by its sender hash. Changing how either is made orphans every row
already stored. The tests pin both.

### `ids.ts`

| Export | What it does |
|---|---|
| `newId(length, alphabet?)` | A random id, uniform over `alphabet` (default `BASE62`). Bytes past the largest multiple of the alphabet's size are rerolled. |
| `idShape(length)` | `^[0-9A-Za-z]{length}$`, to check every id a request names. |
| `BASE62` | `0-9A-Za-z`. |

### `handles.ts`

`<Adjective> <Noun> <NN>`, NN from 10 to 99, from two lists of 32 flight and weather words: about
92,000 handles, none of them free text. `isHandle(text)` is the server's only test of a name;
`randomHandle(randomInt)` is the client's picker, given its own randomness. **The lists only
grow.** Removing a word makes every run under it a handle the server refuses to store again. A
game that wants other words keeps its own lists in its copy.

### `rate.ts`

A window is `{ tag, ms, limit }`. A hit counts one in row `<who>:<tag>:<floor(now / ms)>`, where
`win` is the ms the window starts at. `who` is a sender hash, or `*` for the whole board.

| Export | What it does |
|---|---|
| `perHour(limit)`, `perDay(limit)` | `{ tag: 'h', ms: HOUR_MS, limit }` and `{ tag: 'd', ms: DAY_MS, limit }`. |
| `hit(db, who, windows, now)` | Count one in each window, in one batch. Each `RateHit` has `count` (this one included), `over` (count past limit) and `retryAfter` (seconds, at least 1). |
| `rateCount(db, who, window, now)` | The count so far, without adding to it. |
| `countHit(db, who, window, now)` | The counting statement, to batch with something else. |
| `rateBucket`, `windowStart`, `retryAfter`, `windowText` | The pieces: the row name, the window's start, seconds left, `'this hour'`. |
| `SECOND_MS`, `MINUTE_MS`, `HOUR_MS`, `DAY_MS` | Lengths in ms. |

### `board.ts`: the seam

`defineBoard(config)` fills in the defaults and freezes the result. Every core function that can
refuse, sweep or touch blocks takes that board first.

| Key | Type | Default | What it does |
|---|---|---|---|
| `blockKinds` | `Record<string, BlockKind>` | required | What a block can name, by the word stored in `blocks.kind`. |
| `sweep` | `(db, now) => D1PreparedStatement[]` | none | The game's housekeeping, batched with the core's on every submit and admin request. |
| `refuse` | `Refuse` | `{ error, reason }` | How a refusal goes on the wire. It gets the core's code and may change the status too. |
| `adminTokenMinLength` | number | `32` | Characters an admin token needs before the admin routes answer. Under 16 throws. |
| `adminLogDays` | number | `90` | Days an `admin_log` row lives. |
| `adminReasonMax` | number | `500` | Characters of an admin's reason kept. |
| `adminListMax` | number | `500` | Rows the block list and the log return at most. |
| `noReason` | string | `''` | The reason stored when an admin gives none. |
| `rateKeepMs` | number | `2 * DAY_MS` | How long a `rate` row lives after its window starts. Under a day throws. |

**A `BlockKind`:**

| Key | Type | What it does |
|---|---|---|
| `valid` | `(value) => boolean` | Whether the kind can hold `value`. Checked before anything else. |
| `resolve` | `(body, db) => Promise<string \| null \| undefined>` | Optional. A value named another way, such as `{ kind: 'owner', run: '<id>' }` for that run's owner hash. `undefined` uses `body.value`; `null` answers 404. |
| `covers` | `(db, value) => Promise<{ rows, remove }>` | Optional. What `wipe: true` deletes: `rows` go into the log, `remove` runs in the same batch. A kind without it refuses `wipe`. |

### `moderation.ts`

| Export | What it does |
|---|---|
| `blockOf(db, names)` | Which of `{ kind: value }` is blocked, in the order given, or null. A database with no `blocks` table reads as no blocks. |
| `sweepCore(board, db, now)` | Deletes `rate` rows past `rateKeepMs` and log rows past `adminLogDays`, plus `board.sweep`'s, in one batch. |
| `logged(db, now, entry)` | One `admin_log` row as a statement, to batch with the change it records. |
| `reasonOf(board, text)` | A reason, trimmed and capped, or `board.noReason`. |
| `addBlock(board, db, now, body)` | The `POST /blocks` route. |
| `liftBlock(board, db, now, kind, value, reason)` | The `DELETE /blocks` route. |
| `listBlocks(board, db)`, `readLog(db, limit)` | Blocks newest first; log rows newest first, `detail` parsed. |

### `admin.ts`

`routeAdmin(board, request, { db, token, now, path }, routes?)` is the door. In order:

1. the token: under `adminTokenMinLength` (or unset) is 503 `unconfigured`; a wrong
   `Authorization: Bearer` is 401 `admin`. Nothing is read before this.
2. no database: 503 `unconfigured`.
3. a probe of `blocks`, then the sweep. A missing table anywhere behind the door is 503
   `unmigrated`.
4. the game's `routes(request, db, path, now)`: an answer, or null for "not mine".
5. the core's routes, then 404 `admin`.

| Route (under the game's prefix) | Body or query | Answer |
|---|---|---|
| `GET /blocks` | | 200 `{ blocks: [{ kind, value, reason, createdAt }] }`, newest first |
| `POST /blocks` | `{ kind, value \| <resolved>, reason?, wipe? }` | 201 `{ kind, value, wiped }`. Logs `block`, with the wiped rows. A block already there takes the new reason. |
| `DELETE /blocks` | `?kind=&value=[&reason=]` | 200 `{ lifted }`, or 404 `gone`. Logs `unblock`. |
| `GET /log` | `?limit=` (default 100) | 200 `{ log: [{ id, at, action, target, count, reason, detail }] }`, newest first |

`adminRefusal(board, request, token)` is step 1 alone, and `coreAdminRoute(...)` step 5 alone,
for a game that routes its own paths.

### `submit.ts`

`admitSubmit(board, request, call)` is the front of a submit. `call` is
`{ db, salt, now, bodyMax, windows, addressHeader? }`. It answers `{ ok: true, db, text, sender }`
or `{ ok: false, response }`:

1. no database or no salt: 503 `unconfigured`. Without a salt it would count raw addresses.
2. the sweep.
3. one hit for the sender in every window, before the body is read. Over any: 429 `rate`, with
   `retry-after`.
4. the body under `bodyMax` bytes, as text: 413 `size` past it.

`overDailyCap(board, db, now, limit)` counts one stored run in `*:d:<day>` and answers 503 `full`
(with `retry-after`) once the day is over `limit`, or null. Call it only for a run the game will
store, so refusals are charged to their senders, not to everybody. `DAILY_STORED` is its window,
for `rateCount` in an audit.

## `createD1(options?)` in `@ummgames/dev/testing`

A D1 binding over `node:sqlite` (node 22.13 or later; loaded on the first call). Pass it wherever
the Worker passes `env.<DB>`.

| Option | Type | Default | What it does |
|---|---|---|---|
| `migrations` | string | none | A folder of `.sql` files, applied in name order, as wrangler does. A failure names the file. |
| `sql` | string or string[] | none | SQL run after the migrations: seed rows, or a schema as text. |
| `file` | string | `':memory:'` | A database file instead. |

It answers `prepare`, `bind`, `first(column?)`, `all`, `run`, `raw({ columnNames })`, `batch`,
`exec` and `close`, and `sqlite`, the `DatabaseSync` underneath, for reading tables directly. It
keeps the parts of D1 a test could otherwise pass without:

| D1 does | So the shim does |
|---|---|
| Compiles SQL when a statement runs | Bad SQL fails at `first`, `all` or `run`, not `prepare`. |
| Refuses `undefined` and objects at `bind` | Throws `D1_TYPE_ERROR`. Booleans bind as 1 and 0. |
| Fails a statement with the wrong number of bindings | Counts `?` and `?NNN` (`parameterCount(sql)`) and throws `D1_ERROR: Wrong number of parameter bindings`. |
| Counts `meta.changes` per statement | 0 for a SELECT, even right after a write. |
| Returns plain rows, blobs as number arrays | The same. |
| Runs a batch as one transaction | `BEGIN`, then `COMMIT`, or `ROLLBACK` and rethrow. A statement from another database throws. |
| Frames errors | `D1_ERROR: <SQLite's message>`, so `isMissingTable` reads both. |

It does not model D1's limits (statement time, row size, a database's size) or its replicas.

## File formats

### The core's tables

`BOARD_CORE_SQL` creates them. `schemaProblems(db)` lists what a database lacks; empty means the
core can run on it.

| Table | Columns | Key | Rows live |
|---|---|---|---|
| `rate` | `bucket`, `win` (ms the window starts), `count` | `bucket` | `rateKeepMs` after `win` |
| `blocks` | `kind`, `value`, `reason`, `created_at` (ms) | `(kind, value)` | until lifted |
| `admin_log` | `id`, `at` (ms), `action`, `target`, `count`, `reason`, `detail` (JSON) | `id` | `adminLogDays` after `at` |

**The privacy line.** `rate` holds salted sender hashes and never a run. `blocks` holds owner
hashes and handles; there is no address kind. The game's runs table holds owner hashes and never
an address. So no table links a run to an address. A game that writes a privacy page can rest
"an address hash lives two days" on `rateKeepMs` and the sweep.

### Buckets and log actions

| Row | Means |
|---|---|
| `<sender>:<tag>:<slot>` | A sender's hits in one window. |
| `*:d:<day>` | Runs stored that UTC day (`overDailyCap`). |
| `block`, `unblock` | The core's log actions. `target` is `<kind>:<value>`. |
| anything else | The game's own actions (`hide`, `delete-run`), logged with `logged`. |

## How it works

- **The clock comes in.** Every function takes `now`. The Worker reads `Date.now()` once and
  passes it down, so a test can be exact about windows and retention.
- **Counting comes before reading.** A sender is charged before its body is read, so garbage
  costs the same as a run. The daily cap is charged after the game's checks, so garbage cannot
  close the board for everybody.
- **The admin door is checked first.** The token check needs no database, no body and no path.
  The token is compared as SHA-256 digests, every byte, so timing says nothing about a guess.
- **Each change is batched with its log row.** A block, its wipe and its log entry land together
  or not at all.
- **Housekeeping runs on every submit and admin request,** refused or not. There is no cron.
- **`rateKey` folds IPv6 to its /64.** An IPv4-mapped address (`::ffff:1.2.3.4`) folds to
  `0:0:0:0::/64`, one bucket for all of them. Cloudflare sends IPv4 senders in dotted form, so
  this does not arise behind it.

## Moving a game's own board onto the core

A game that already runs a board server swaps pieces for the core one at a time:

1. **Copy the folder beside its own files**, with `--to`. Nothing switches over yet.
2. **Check the schema.** In a test, apply the game's migrations to `createD1` and run
   `schemaProblems`. A `blocks` table keyed by handle alone, or a missing `admin_log`, needs a new
   migration that moves the rows over: the core's tables are not created over an old one.
3. **Swap the helpers** (`http`, `digest`, `handles`, `ids`). These are drop-in when the game's
   are the same code; the stored hashes do not change.
4. **Swap the submit's front for `admitSubmit`,** and the daily count for `overDailyCap`.
   **The rate buckets change** if the game's rows were `<sender>:<hour>` with `win` in hours:
   the first sweep deletes them (an hour number is far older than two days in ms), so every
   sender's count starts again once. Nothing else is lost.
5. **Route admin through `routeAdmin`,** keeping the game's own routes (audit, hide, delete a
   run) as its `routes`. The core's answers are camelCase views (`createdAt`); an admin script
   that read raw column names changes with it.
6. **Keep the refusal shape** the game's client parses by passing `refuse` to `defineBoard`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Admin routes answer 503 `unconfigured` | No admin token, or one under `adminTokenMinLength`. | Set the secret: `openssl rand -base64 32` makes 44 characters. |
| Admin routes answer 503 `unmigrated` | The database lacks `blocks`, `rate` or `admin_log`, or a game table the route reads. | Apply the migrations. `schemaProblems` says which. |
| A submit answers 503 `unconfigured` | No database bound, or no salt secret. | Bind both. The board takes nothing without a salt. |
| Every submit is 429 | A window's `limit` is 0, or every sender shares one address. | Check the windows. Behind a proxy that is not Cloudflare, pass `addressHeader`. |
| `defineBoard` throws `RangeError` | `rateKeepMs` under a day, or `adminTokenMinLength` under 16. | Raise it. |
| A test passes on the shim and fails on D1 | A D1 limit the shim does not model, or a binding of a type D1 takes and node:sqlite reads differently. | Run the route under `wrangler dev --local` once, and add what you find to [known-issues.md](known-issues.md). |
| `createD1: node:sqlite is not available` | Node older than 22.13. | Use node 22.13 or later. |

## For agents

- **Never change how `ownerHash`, `senderHash` or `rateKey` makes a value.** Each is stored; a
  changed byte orphans every block and rate row.
- **Never remove a word from `handles.ts`.** Add only.
- **Never touch a live database to test.** Use `createD1` with the game's migrations.
- **Count before you read, cap after you judge.** Keep `admitSubmit` first in a submit and
  `overDailyCap` last before the write.
- **Log every admin change with `logged`, in the same batch as the change.**
- **Edit the copy below line 1, and run `umm-dev drift` after.** See [runtime.md](runtime.md).
