// @ts-check
/**
 * `@ummgames/dev/stats`: the shared half of a game's play stats report. Days and ranges, pulling
 * a stats bucket's days with rclone, reading them back, and grouping kept batches into sessions.
 * The game's own sums (rooms, levels, deaths) stay in the game. See docs/stats.md.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const DAY = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 86_400_000

/** @param {Date} d */
const iso = (d) => d.toISOString().slice(0, 10)

/**
 * @param {readonly string[]} argv
 * @returns {import('./index.d.ts').ReportArgs}
 */
export function parseReportArgs(argv) {
  /** @type {import('./index.d.ts').ReportArgs} */
  const out = { range: null, days: null, sites: [], all: false, pull: true, json: false, rest: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = /** @type {string} */ (argv[i])
    if (a === '--days') out.days = Number(argv[++i])
    else if (a === '--site') out.sites.push(argv[++i] ?? '')
    else if (a === '--all') out.all = true
    else if (a === '--no-pull') out.pull = false
    else if (a === '--json') out.json = true
    else if (a.startsWith('--')) out.rest.push(a)
    else out.range = a
  }
  return out
}

/**
 * @param {{ range?: string | null, days?: number | null, today?: Date }} [o]
 * @returns {string[]}
 */
export function daysOf(o = {}) {
  const today = o.today ?? new Date()
  if (o.days !== null && o.days !== undefined) {
    if (!Number.isInteger(o.days) || o.days < 1)
      throw new Error('--days takes a whole number of days')
    const n = o.days
    return Array.from({ length: n }, (_, i) =>
      iso(new Date(today.getTime() - i * DAY_MS)),
    ).reverse()
  }
  if (!o.range) return [iso(today)]
  const [from, to = from] = /** @type {[string, string?]} */ (o.range.split('..'))
  if (!DAY.test(from) || !DAY.test(to))
    throw new Error(`a day is YYYY-MM-DD, a range from..to (got ${o.range})`)
  /** @type {string[]} */
  const out = []
  for (let t = Date.parse(from); t <= Date.parse(to); t += DAY_MS) out.push(iso(new Date(t)))
  return out
}

/**
 * @param {{ remote: string, cache: string, days: readonly string[], run?: (cmd: string, args: string[]) => string }} o
 * @returns {string[]}
 */
export function pullDays(o) {
  const run =
    o.run ??
    ((cmd, args) =>
      execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }))
  // Only the days that are there: copying a missing prefix is an error to rclone.
  const present = new Set(
    run('rclone', ['lsf', o.remote, '--dirs-only'])
      .split('\n')
      .map((l) => l.replace(/\/$/, '').trim()),
  )
  const pulled = o.days.filter((d) => present.has(d))
  for (const d of pulled) run('rclone', ['copy', `${o.remote}/${d}`, path.join(o.cache, d)])
  return pulled
}

/**
 * @param {string} cache
 * @param {readonly string[]} days
 * @returns {unknown[]}
 */
export function readDays(cache, days) {
  /** @type {unknown[]} */
  const raw = []
  for (const d of days) {
    const dir = path.join(cache, d)
    if (!fs.existsSync(dir)) continue
    for (const sid of fs.readdirSync(dir).sort()) {
      const sdir = path.join(dir, sid)
      if (!fs.statSync(sdir).isDirectory()) continue
      for (const f of fs.readdirSync(sdir).sort())
        if (f.endsWith('.json')) raw.push(JSON.parse(fs.readFileSync(path.join(sdir, f), 'utf8')))
    }
  }
  return raw
}

/**
 * @template {import('./index.d.ts').KeptBatch} B
 * @param {readonly unknown[]} raw
 * @param {{ parse: (raw: unknown) => B | null, sites: ReadonlySet<string> | readonly string[] | null }} o
 * @returns {{ sessions: import('./index.d.ts').Session<B>[], rejected: number }}
 */
export function sessionsOf(raw, o) {
  const sites = o.sites === null ? null : new Set(o.sites)
  /** @type {Map<string, B[]>} */
  const bySid = new Map()
  let rejected = 0
  for (const r of raw) {
    const b = o.parse(r)
    if (!b) {
      rejected++
      continue
    }
    if (sites && !sites.has(b.site)) continue
    const list = bySid.get(b.sid) ?? []
    list.push(b)
    bySid.set(b.sid, list)
  }
  const sessions = [...bySid.values()].map((batches) => {
    batches.sort((a, b) => a.seq - b.seq)
    const first = /** @type {B} */ (batches[0])
    const events = batches.flatMap((b) => b.events).sort((a, b) => a.t - b.t)
    return {
      sid: first.sid,
      site: first.site,
      build: first.build,
      browser: first.browser,
      device: events.at(-1)?.dev ?? 'keyboard',
      first,
      events: /** @type {B['events']} */ (events),
    }
  })
  return { sessions, rejected }
}

/**
 * @param {readonly number[]} xs
 * @returns {number | null}
 */
export function median(xs) {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  const hi = s[mid] ?? 0
  const lo = s[mid - 1] ?? hi
  return s.length % 2 ? hi : (lo + hi) / 2
}

/**
 * @param {Iterable<string>} keys
 * @returns {Record<string, number>}
 */
export function tally(keys) {
  /** @type {Record<string, number>} */
  const out = {}
  for (const k of keys) out[k] = (out[k] ?? 0) + 1
  return out
}

/**
 * @param {readonly string[]} head
 * @param {readonly (readonly (string | number | null)[])[]} rows
 * @returns {string}
 */
export function table(head, rows) {
  const cells = [head, ...rows].map((r) => r.map((c) => (c === null ? '-' : String(c))))
  const widths = head.map((_, i) => Math.max(...cells.map((r) => (r[i] ?? '').length)))
  const line = (/** @type {string[]} */ r) =>
    r
      .map((c, i) => (i === 0 ? c.padEnd(widths[i] ?? 0) : c.padStart(widths[i] ?? 0)))
      .join('  ')
      .trimEnd()
  return cells.map(line).join('\n')
}
