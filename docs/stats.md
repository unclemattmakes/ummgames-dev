# Play stats

A game's own play telemetry: a handful of events from the page, batched and posted to a
Cloudflare Worker of the game's, kept as JSON objects in an R2 bucket, and summed by a report
the game runs. It answers what a portal's dashboard cannot: where players stop, what ends their
runs, which device they use.

The kit owns everything that is the same in every game:
- the batch envelope and its checks;
- the page's queue and when it sends;
- the Worker;
- pulling and grouping the kept days for a report.

The game owns its events and its sums.

| Part | Where | How a game takes it |
|---|---|---|
| `runtime/stats/batch.ts` | The batch shape, its check, origins, keys | `umm-dev copy stats` |
| `runtime/stats/client.ts` | The page's queue and sender | the same copy |
| `runtime/stats/worker.ts` | The Worker's handler | the same copy |
| `@ummgames/dev/stats` | Days, rclone pulls, sessions, tables | `import` in the game's report tool |

## Quick start

1. Copy the runtime folder: `umm-dev copy stats --to src/stats/`.
2. Write the game's spec beside it, `src/stats/events.ts`: its version, its batch fields and
   its events (see `StatsSpec` below).
3. In the game, make a queue with `createStatsQueue`, start it with `startStats` when the build
   has an endpoint, and `push` events from what the game already hears.
4. Write the Worker, `worker/stats/index.ts`:

   ```ts
   import { CRAZYGAMES } from '../../src/stats/batch'
   import { SPEC } from '../../src/stats/events'
   import { statsWorker } from '../../src/stats/worker'

   export default statsWorker({
     name: 'my-game',
     spec: SPEC,
     sites: [CRAZYGAMES, { site: 'site', hosts: ['example.com'] }],
   })
   ```

   Its `wrangler.toml` binds the bucket as `STATS` and turns request logs off:

   ```toml
   name = "my-game-stats"
   main = "index.ts"
   compatibility_date = "2025-09-01"
   workers_dev = true

   [observability]
   enabled = false

   [[r2_buckets]]
   binding = "STATS"
   bucket_name = "my-game-stats"
   ```

5. Make the bucket with a 12-month expiry, then deploy:

   ```sh
   npx wrangler r2 bucket create my-game-stats
   npx wrangler r2 bucket lifecycle add my-game-stats expire-12-months --expire-days 365
   npx wrangler deploy --config worker/stats/wrangler.toml
   ```

6. Write the report tool with `@ummgames/dev/stats` (below) and an rclone remote that can read
   the bucket.

## `runtime/stats/batch.ts`

Server-safe and page-safe: no DOM, no imports.

| Export | What it is |
|---|---|
| `MAX_EVENTS` | 200: the most events in one batch |
| `MAX_BYTES` | 65536: the most bytes the Worker reads |
| `MAX_T` | 604800: the latest an event's `t` may be, in seconds |
| `DEVICES` | `keyboard`, `mouse`, `gamepad`, `touch` |
| `StatsSpec<M, E>` | The game's half: `version`, `meta(raw)` and `event(raw)` |
| `Unstamped<E>` | An event without `t` and `dev`, per member of a union: what `event(raw)` returns and `push` takes |
| `parseBatch(spec, raw)` | The batch rebuilt from known fields only, or a reason string |
| `parseStored(spec, raw)` | A kept object read back, with `at`, `site` and `browser`; or null |
| `isObj`, `oneOf`, `num`, `int`, `isSlug`, `isName`, `parsePos` | Checks for the game's parsers |
| `SiteRule`, `siteOf(origin, rules)` | Which site an https origin is, or null |
| `CRAZYGAMES` | A `SiteRule` for CrazyGames' game hosts and regional domains |
| `browserFamily(ua)` | `edge`, `chrome`, `firefox`, `safari` or `other` |
| `batchKey(batch, at)` | `<UTC day>/<sid>/<seq, 4 digits>.json` |

**The spec.** `meta(raw)` returns the game's own batch fields (return `{}` for none), or null to
refuse the batch. `event(raw)` gets each event after `e` is known to be a string and `t` and
`dev` are checked; it returns the event's `e` and its own fields, or null to refuse the whole
batch. Return only the fields you checked: the result is what the Worker keeps.

```ts
export const SPEC: StatsSpec<{ backend: 'webgl2' | 'webgpu' }, MyEvent> = {
  version: 1,
  meta: (r) => (oneOf(r.backend, ['webgl2', 'webgpu']) ? { backend: r.backend } : null),
  event: (r) => {
    if (r.e === 'start' && isSlug(r.level)) return { e: 'start', level: r.level }
    return null
  },
}
```

## `runtime/stats/client.ts`

Page-safe. Imports only `batch.ts`.

| Export | What it does |
|---|---|
| `createStatsQueue(options)` | A queue with no DOM: `push(ev)` stamps `t` (a tenth of a second) and `dev`; `flush()` sends batches of at most 200 with a rising `seq`. Past `MAX_QUEUE` (2000) unsent events, more are dropped. |
| `startStats(options)` | Listens on the page. The first key, pointer press or `used(dev)` arms sending; then it flushes every `flushMs` (default `FLUSH_MS`, 30000) and, after calling `leave()`, when the page hides or closes. `back()` runs when it shows again. |
| `post(url, body)` | `sendBeacon`, or a keepalive `no-cors` fetch. Never throws. |
| `sessionId()` | 32 random hex characters. |

| `createStatsQueue` option | Value |
|---|---|
| `version` | The spec's version |
| `meta` | `{ sid, build, ...the game's batch fields }` |
| `now` | Seconds since the page loaded |
| `send` | Gets each batch's JSON text; usually `(body) => post(url, body)` |
| `log` | Optional: sees each event as it is queued |

A gamepad has no DOM event: call `page.used('gamepad')` when the game's input takes a pad.

## `runtime/stats/worker.ts`

Server-safe. `statsWorker({ name, spec, sites, now? })` returns `{ fetch(req, env) }`. The bucket
is `env.STATS`.

| Request | Answer |
|---|---|
| GET `/` | 200 `<name> stats: ok` |
| any other path | 404 |
| an origin no rule matches, or none | 403 |
| OPTIONS | 204 with CORS for that origin |
| a method other than POST | 405 |
| a body over `MAX_BYTES` | 413 |
| not JSON, or refused by the spec | 400 with the reason |
| a good batch | 204, kept at `batchKey` |

It keeps the rebuilt batch plus `at`, `site` and `browser`. It never reads the IP.

## `@ummgames/dev/stats`

For the game's report tool, run in node.

| Export | What it does |
|---|---|
| `parseReportArgs(argv)` | `[day \| from..to] [--days N] [--site S]... [--all] [--no-pull] [--json]`; other `--flags` go to `rest` |
| `daysOf({ range, days, today })` | The UTC days, oldest first; today by default |
| `pullDays({ remote, cache, days })` | `rclone copy <remote>/<day> <cache>/<day>` for each day the bucket has; returns those days |
| `readDays(cache, days)` | Every kept object of those days, parsed |
| `sessionsOf(raw, { parse, sites })` | Objects to sessions by `sid`, events in time order; counts what `parse` refused |
| `median`, `tally`, `table` | Sums and a plain-text table |

## File formats

One object per batch, at `<UTC day>/<sid>/<seq>.json`:

```json
{ "v": 1, "sid": "…32 hex…", "seq": 0, "build": "abc1234", "backend": "webgl2",
  "events": [{ "e": "start", "level": "one", "t": 3.2, "dev": "keyboard" }],
  "at": "2026-11-19T06:13:00.000Z", "site": "crazygames", "browser": "chrome" }
```

## How it works

The page queues events in memory and sends them as `text/plain` beacons, which need no CORS
preflight. The Worker matches the `Origin` header to a site, rebuilds the batch through the
game's spec, so it keeps nothing a client added, and writes one object. The session id is made
per page load and never stored, so sessions cannot be linked to each other or to a person.

## Troubleshooting

- **Nothing arrives.** The page sends nothing before the first input. Check the build has the
  endpoint, then look for a 403 (the origin is not in `sites`) or a 400 (the spec refused it)
  in the Worker's tail.
- **A 400 `bad event`.** An event's name, `t` or `dev` failed, or the spec's `event` returned
  another `e`. Every event in a batch must pass.

## For agents

- The spec is the privacy promise: a field the spec does not return is never kept. Keep the
  game's privacy page in step with it.
- Bump the spec's `version` when an event changes meaning; the Worker refuses the old version,
  so deploy the Worker with the game.
- Test the spec with `parseBatch` on a batch the game's own queue made.
