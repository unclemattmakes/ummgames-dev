// Play stats: the shape of a batch, shared by the page that sends it (client.ts), the Worker that
// keeps it (worker.ts) and the game's report, which reads the kept objects back.
//
// SERVER-SAFE and PAGE-SAFE: no DOM, no imports. A Worker, node 22 and a browser all run it.
//
// The kit owns the envelope (`v`, `sid`, `seq`, `build`) and the two fields every event carries
// (`t`, `dev`). The game owns everything else: its own batch fields (a renderer, a tier) and its
// events, through the two parsers in a `StatsSpec`. A batch is rebuilt from the fields the spec
// names and nothing else, so a field a client adds is never kept.
//
// Nothing here can identify a player. The session id is random per page load and never stored,
// so two sessions cannot be linked: no install id, no portal user id, no IP.

/** The most events one batch carries; the queue splits a longer one. */
export const MAX_EVENTS = 200
/** The most bytes the Worker reads. `sendBeacon` allows 64 KiB in flight per page. */
export const MAX_BYTES = 64 * 1024
/** The longest a page's clock may read, in seconds: a week. */
export const MAX_T = 7 * 86_400

/** The input device a player used last. */
export const DEVICES = ['keyboard', 'mouse', 'gamepad', 'touch'] as const
export type Device = (typeof DEVICES)[number]

/** What every batch carries, whatever the game. */
export interface Envelope {
  /** The game's batch version (`StatsSpec.version`). */
  v: number
  /** 32 hex characters, random per page load, never stored. */
  sid: string
  /** This session's batches, counted from 0. */
  seq: number
  /** The build, such as a git short hash. */
  build: string
}

/** What every event carries, whatever the game. */
export interface EventBase {
  /** The event's name. */
  e: string
  /** Seconds since the page loaded, to a tenth. Orders a session's events. */
  t: number
  /** The device last used. */
  dev: Device
}

/** A whole batch: the envelope, the game's own fields `M`, and its events `E`. */
export type Batch<M, E extends EventBase> = Envelope & M & { events: E[] }

/** A batch as the Worker keeps it: what it was sent, plus when, from where and in what browser. */
export type StoredBatch<M, E extends EventBase> = Batch<M, E> & {
  /** When the Worker took it, ISO 8601. */
  at: string
  /** The site the Worker matched its origin to (`SiteRule.site`). */
  site: string
  /** The browser family (`browserFamily`). */
  browser: Browser
}

/** A game's half of the batch: its version, its own batch fields and its events. */
export interface StatsSpec<M, E extends EventBase> {
  /** Bump when an event changes meaning; the Worker refuses any other. */
  readonly version: number
  /**
   * The game's own batch fields, rebuilt from the raw batch, or null to refuse it. Return `{}`
   * for none. Return only the fields you name: the result is what is kept.
   */
  readonly meta: (raw: Readonly<Record<string, unknown>>) => M | null
  /**
   * One event's own fields, rebuilt, or null to refuse the whole batch. `e` is already a string
   * and `t` and `dev` are already checked; return the event with its `e` and its own fields, and
   * the parser adds `t` and `dev`.
   */
  readonly event: (raw: Readonly<Record<string, unknown>>) => Omit<E, 't' | 'dev'> | null
}

// Checks a game's parsers use.

/** A plain object, not an array or null. */
export const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
/** One of a fixed list of strings. */
export const oneOf = <T extends string>(v: unknown, of: readonly T[]): v is T =>
  typeof v === 'string' && (of as readonly string[]).includes(v)
/** A finite number from `lo` to `hi`, both included. */
export const num = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi
/** A whole number from `lo` to `hi`, both included. */
export const int = (v: unknown, lo: number, hi: number): v is number =>
  Number.isInteger(v) && num(v, lo, hi)
/** A short id: lower-case letters, digits and `-`, 1 to 40 of them. A level, a room, a kind. */
export const isSlug = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-z0-9-]{1,40}$/.test(v)
/** Like `isSlug`, but camelCase too: `latticeCore`, `wyrmHead`. */
export const isName = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v)

/** A position as whole numbers, `[x, y]` or `[x, y, z]`, each within 100 km of the origin; or null. */
export function parsePos(p: unknown, dims: 2 | 3 = 3): number[] | null {
  if (!Array.isArray(p) || p.length !== dims) return null
  if (!p.every((c) => int(c, -100_000, 100_000))) return null
  return [...p] as number[]
}

/** A batch rebuilt from its known fields only, or a short reason it was refused. */
export function parseBatch<M, E extends EventBase>(
  spec: StatsSpec<M, E>,
  raw: unknown,
): Batch<M, E> | string {
  if (!isObj(raw) || raw.v !== spec.version) return 'bad version'
  const { sid, seq, build, events } = raw
  if (typeof sid !== 'string' || !/^[0-9a-f]{32}$/.test(sid)) return 'bad sid'
  if (!int(seq, 0, 100_000)) return 'bad seq'
  if (typeof build !== 'string' || !/^[\w.-]{1,40}$/.test(build)) return 'bad build'
  if (!Array.isArray(events) || events.length === 0 || events.length > MAX_EVENTS)
    return 'bad events'
  const meta = spec.meta(raw)
  if (meta === null) return 'bad meta'
  const out: E[] = []
  for (const ev of events) {
    if (!isObj(ev) || typeof ev.e !== 'string') return 'bad event'
    const { t, dev } = ev
    if (!num(t, 0, MAX_T) || !oneOf(dev, DEVICES)) return 'bad event'
    const own = spec.event(ev)
    if (!own || own.e !== ev.e) return 'bad event'
    out.push({ ...own, t, dev } as E)
  }
  return { ...meta, v: spec.version, sid, seq, build, events: out }
}

/**
 * A stored object read back: the batch checked as the Worker checked it, and the Worker's own
 * three fields. Null when it fails the check or has no site (a stale or hand-made object).
 */
export function parseStored<M, E extends EventBase>(
  spec: StatsSpec<M, E>,
  raw: unknown,
): StoredBatch<M, E> | null {
  const b = parseBatch(spec, raw)
  if (typeof b === 'string' || !isObj(raw) || typeof raw.site !== 'string') return null
  return {
    ...b,
    at: typeof raw.at === 'string' ? raw.at : '',
    site: raw.site,
    browser: oneOf(raw.browser, BROWSERS) ? raw.browser : 'other',
  }
}

// Where a batch came from.

/**
 * One site the Worker takes batches from, by the page's origin (https only). A host matches when
 * it is in `hosts`, or is one of `suffixes` or a subdomain of one, or matches `pattern`.
 */
export interface SiteRule {
  /** The label kept with each batch: `site`, `portal`, `playtest`. */
  readonly site: string
  readonly hosts?: readonly string[]
  /** `preview.example` matches it and `abc.preview.example`. */
  readonly suffixes?: readonly string[]
  readonly pattern?: RegExp
}

/** CrazyGames: its games run on `*.game-files.crazygames.com`, and its site has regional domains. */
export const CRAZYGAMES: SiteRule = {
  site: 'crazygames',
  pattern: /(^|\.)crazygames\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/,
}

/** The first rule an origin matches, by its label; null for any other origin, or none. */
export function siteOf(origin: string | null, rules: readonly SiteRule[]): string | null {
  if (!origin) return null
  let host: string
  try {
    const u = new URL(origin)
    if (u.protocol !== 'https:') return null
    host = u.hostname
  } catch {
    return null
  }
  for (const r of rules) {
    if (r.hosts?.includes(host)) return r.site
    if (r.suffixes?.some((s) => host === s || host.endsWith(`.${s}`))) return r.site
    if (r.pattern?.test(host)) return r.site
  }
  return null
}

export const BROWSERS = ['edge', 'chrome', 'firefox', 'safari', 'other'] as const
export type Browser = (typeof BROWSERS)[number]

/** A user agent to its browser family, no more: no version, no OS. */
export function browserFamily(ua: string | null): Browser {
  if (!ua) return 'other'
  if (/Edg\//.test(ua)) return 'edge'
  if (/Firefox\//.test(ua)) return 'firefox'
  if (/Chrome\/|CriOS\//.test(ua)) return 'chrome'
  if (/Safari\//.test(ua)) return 'safari'
  return 'other'
}

/** Where a batch is kept: `<UTC day>/<sid>/<seq, 4 digits>.json`. */
export function batchKey(b: Pick<Envelope, 'sid' | 'seq'>, at: Date): string {
  return `${at.toISOString().slice(0, 10)}/${b.sid}/${String(b.seq).padStart(4, '0')}.json`
}
