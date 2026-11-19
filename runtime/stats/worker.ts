// Play stats: the Worker that keeps batches. `POST /` takes one batch, checks it with the game's
// spec (batch.ts) and keeps it as one JSON object in an R2 bucket, at `batchKey`. It keeps what
// the batch says, the site its origin matched and the browser family, nothing else: no IP and no
// full user agent. Turn the Worker's request logs off in its wrangler.toml, since they would hold
// both.
//
// SERVER-SAFE: web platform only. Imports only batch.ts.
//
// A game's Worker is a few lines: its default export is `statsWorker({ name, spec, sites })`, with
// the game's own spec and site rules. docs/stats.md in @ummgames/dev has the whole file.

import {
  batchKey,
  browserFamily,
  type EventBase,
  MAX_BYTES,
  parseBatch,
  type SiteRule,
  type StatsSpec,
  siteOf,
} from './batch'

/** The slice of a Workers R2 binding this file uses, so it needs no workers-types dependency. */
export interface StatsBucket {
  put(
    key: string,
    body: string,
    opts?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>
}

export interface StatsEnv {
  /** The bucket, bound as `STATS` in wrangler.toml. */
  STATS: StatsBucket
}

export interface StatsWorkerOptions<M, E extends EventBase> {
  /** What a GET of `/` answers, before `stats: ok`. */
  readonly name: string
  readonly spec: StatsSpec<M, E>
  /** The origins it takes batches from; any other gets a 403. */
  readonly sites: readonly SiteRule[]
  /** The clock, for tests. */
  readonly now?: () => Date
}

const cors = (origin: string): Record<string, string> => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'POST',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
})

/**
 * The Worker's handler. Answers: GET `/` 200 `<name> stats: ok`; any other path 404; an origin
 * not in `sites` 403; OPTIONS 204 with CORS; a body over `MAX_BYTES` 413; not JSON or refused by
 * the spec 400 with the reason; a kept batch 204.
 */
export function statsWorker<M, E extends EventBase>(
  o: StatsWorkerOptions<M, E>,
): { fetch(req: Request, env: StatsEnv): Promise<Response> } {
  const now = o.now ?? (() => new Date())
  return {
    async fetch(req, env) {
      const url = new URL(req.url)
      if (url.pathname !== '/') return new Response('not found', { status: 404 })
      if (req.method === 'GET') return new Response(`${o.name} stats: ok`)
      const origin = req.headers.get('Origin')
      const site = siteOf(origin, o.sites)
      if (!site || !origin) return new Response('origin not allowed', { status: 403 })
      if (req.method === 'OPTIONS')
        return new Response(null, { status: 204, headers: cors(origin) })
      if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })
      const reply = (status: number, text?: string) =>
        new Response(text ?? null, { status, headers: cors(origin) })

      if (Number(req.headers.get('Content-Length') ?? 0) > MAX_BYTES) return reply(413, 'too big')
      const text = await req.text()
      if (text.length > MAX_BYTES) return reply(413, 'too big')
      let json: unknown
      try {
        json = JSON.parse(text)
      } catch {
        return reply(400, 'not json')
      }
      const batch = parseBatch(o.spec, json)
      if (typeof batch === 'string') return reply(400, batch)
      const at = now()
      const stored = {
        ...batch,
        at: at.toISOString(),
        site,
        browser: browserFamily(req.headers.get('User-Agent')),
      }
      await env.STATS.put(batchKey(batch, at), JSON.stringify(stored), {
        httpMetadata: { contentType: 'application/json' },
      })
      return reply(204)
    },
  }
}
