// @ts-check
/**
 * The GPU lease: one holder at a time on this machine, in the order they asked.
 *
 * Parallel agent sessions share one GPU. A headed browser run from one session lands inside
 * another's and contaminates it: perf readings go red (or green for the wrong reason), frame
 * captures land on a different tick, a game that measures itself drops a quality tier. Nothing
 * in the stored artefact says a peer had the box. So a run that needs the GPU takes this lease.
 *
 * Everything lives in one directory per machine (see `leaseDir`), never per repository: a lock
 * inside each repository excludes nobody outside it.
 *
 *   <dir>/gpu.lock/          the lock. `mkdir` is the atomic primitive; it exists while held.
 *   <dir>/gpu.lock/holder    who holds it (format below)
 *   <dir>/gpu.queue/<n>-<p>  one ticket per waiter; names sort by the time they were filed
 *   <dir>/gpu-lease.log      one line per acquire, release, sweep and reclaim
 *
 * The format is the one bash-era lease scripts use, so they and this exclude each other when
 * pointed at the same directory (docs/agent.md, "Sharing a lock with older scripts"):
 *
 *   holder: name / epoch seconds taken / minutes booked / pid a shell can check / marker
 *   ticket: name / pid a shell can check / epoch seconds filed / marker
 *
 * Older readers read only the first three or four lines; the marker line
 * (`umm-dev/1 <node pid> [<child pid> <token>]`) is what this kit reads to judge its own entries.
 *
 * Rules it keeps:
 * - Only the OLDEST live ticket may take the lock, so the order is the order of asking.
 * - A booking is a promise, not a timer: nothing takes the lock from a live holder, even one
 *   past its booking. A waiter says so and keeps waiting.
 * - A lock is STALE only when every process it names is provably gone: the umm-dev process and
 *   the command it ran. Then the head of the queue reclaims it, after a grace period. A holder
 *   that names no checkable process (an old script's `acquire`) is never reclaimed: release it
 *   by hand with `umm-dev gpu release <name>`.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openBridge } from './msys.mjs'
import { pidAlive, sleep, WIN } from './proc.mjs'

export const MARK = 'umm-dev/1'
/** A ticket older than this is dead whatever its pid says. */
export const TICKET_MAX_AGE_S = 6 * 3600
/** A lock dir with no holder file for this long is a crashed writer. */
const HOLDERLESS_GRACE_MS = 60_000
/** A ticket with no pid yet may be mid-write by a script that writes in place. */
const PIDLESS_GRACE_MS = 5_000
/** The signals a lease user answers by cleaning up. */
export const SIGNALS = /** @type {NodeJS.Signals[]} */ (['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'])

/**
 * The lease directory: `GPU_LEASE_DIR`, else `<home>/.umm-dev/gpu`. Never per repository.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function leaseDir(env = process.env) {
  let dir = env.GPU_LEASE_DIR
  if (!dir) return path.join(os.homedir(), '.umm-dev', 'gpu')
  // An MSYS path (/c/...) reaches Node unconverted when set by something other than Git Bash.
  const msys = WIN ? /^\/([a-zA-Z])(\/.*)?$/.exec(dir) : null
  if (msys) dir = `${msys[1]}:${msys[2] ?? '/'}`
  return path.resolve(dir)
}

/** @param {Date} [d] */
export function stamp(d = new Date()) {
  /** @param {number} n */
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** @param {number} epochS */
function hhmmss(epochS) {
  return stamp(new Date(epochS * 1000)).slice(11)
}

const nowS = () => Math.floor(Date.now() / 1000)

/** Microseconds since the epoch, 16 digits: the ticket name's prefix. */
function usec() {
  return String(Math.floor((performance.timeOrigin + performance.now()) * 1000))
}

/**
 * @typedef {{ pid: number, child: number | null, token: string }} Marker
 * @typedef {{ raw: string, who: string, since: number, asked: number | null, pid: number | null, node: Marker | null, mtimeMs: number }} Holder
 * @typedef {{ name: string, file: string, raw: string, who: string, pid: number | null, born: number, node: Marker | null, mtimeMs: number }} Ticket
 * @typedef {'alive' | 'dead' | 'unknown'} Liveness
 */

/** @param {string | undefined} s */
function int(s) {
  const n = Number((s ?? '').trim())
  return Number.isInteger(n) && n > 0 ? n : null
}

/** @param {string[]} lines @returns {Marker | null} */
function marker(lines) {
  const m = lines.find((l) => l.startsWith(`${MARK} `))
  if (!m) return null
  const [, pid, child, token] = m.trim().split(/\s+/)
  const p = int(pid)
  return p ? { pid: p, child: int(child), token: token ?? '' } : null
}

/**
 * @param {string} raw
 * @param {number} [mtimeMs]
 * @returns {Holder}
 */
export function parseHolder(raw, mtimeMs = Date.now()) {
  const L = raw.split(/\r?\n/)
  const asked = Number((L[2] ?? '').trim())
  return {
    raw,
    who: (L[0] ?? '').trim(),
    since: Number((L[1] ?? '').trim()) || nowS(),
    asked: Number.isFinite(asked) && (L[2] ?? '').trim() !== '' ? asked : null,
    pid: int(L[3]),
    node: marker(L),
    mtimeMs,
  }
}

/**
 * @param {string} name
 * @param {string} file
 * @param {string} raw
 * @param {number} [mtimeMs]
 * @returns {Ticket}
 */
export function parseTicket(name, file, raw, mtimeMs = Date.now()) {
  const L = raw.split(/\r?\n/)
  return {
    name,
    file,
    raw,
    who: (L[0] ?? '').trim(),
    pid: int(L[1]),
    born: Number((L[2] ?? '').trim()) || 0,
    node: marker(L),
    mtimeMs,
  }
}

/**
 * Write a file whole: a temp name beside it, then a rename, so no reader sees half of it.
 * @param {string} file
 * @param {string} text
 */
function writeWhole(file, text) {
  const tmp = path.join(path.dirname(file), `.new-${process.pid}-${path.basename(file)}`)
  fs.writeFileSync(tmp, text)
  fs.renameSync(tmp, file)
}

/** @param {string} file */
function readMaybe(file) {
  try {
    return { text: fs.readFileSync(file, 'utf8'), mtimeMs: fs.statSync(file).mtimeMs }
  } catch {
    return null
  }
}

/**
 * An open lease directory: paths, and the bridge that lets a Windows Node process be seen by Git
 * Bash and see it back.
 */
export class Lease {
  /**
   * @param {string} dir
   * @param {import('./msys.mjs').Bridge | null} bridge
   */
  constructor(dir, bridge) {
    this.dir = dir
    this.lock = path.join(dir, 'gpu.lock')
    this.holderFile = path.join(this.lock, 'holder')
    this.queue = path.join(dir, 'gpu.queue')
    this.logFile = path.join(dir, 'gpu-lease.log')
    this.bridge = bridge
    /** The pid a shell checks with `kill -0`: the bridge's MSYS pid on Windows, else ours. */
    this.shellPid = bridge?.pid ?? process.pid
  }

  /**
   * @param {{ dir?: string, bridge?: boolean }} [o]  bridge: false skips starting one
   */
  static async open(o = {}) {
    const dir = o.dir ?? leaseDir()
    fs.mkdirSync(dir, { recursive: true })
    const bridge = WIN && o.bridge !== false ? await openBridge() : null
    return new Lease(dir, bridge)
  }

  close() {
    this.bridge?.close()
    this.bridge = null
  }

  /** @param {string} msg */
  log(msg) {
    try {
      fs.mkdirSync(this.dir, { recursive: true })
      fs.appendFileSync(this.logFile, `${stamp()} ${msg}\n`)
    } catch {}
  }

  held() {
    return fs.existsSync(this.lock)
  }

  /** @returns {Holder | null} */
  holder() {
    const r = readMaybe(this.holderFile)
    return r ? parseHolder(r.text, r.mtimeMs) : null
  }

  /** @returns {Ticket[]} oldest first */
  tickets() {
    let names
    try {
      names = fs.readdirSync(this.queue).filter((n) => /^[0-9]/.test(n))
    } catch {
      return []
    }
    names.sort()
    /** @type {Ticket[]} */
    const out = []
    for (const name of names) {
      const file = path.join(this.queue, name)
      const r = readMaybe(file)
      if (r) out.push(parseTicket(name, file, r.text, r.mtimeMs))
    }
    return out
  }

  /**
   * Is a pid written by someone else alive? A marked entry is Node's (native pid); an unmarked
   * one came from a shell, which on Windows means an MSYS pid only the bridge can check.
   * @param {number} pid
   * @returns {Promise<Liveness>}
   */
  async shellPidState(pid) {
    if (!WIN) return pidAlive(pid) ? 'alive' : 'dead'
    if (!this.bridge) return 'unknown'
    return (await this.bridge.alive(pid)) ? 'alive' : 'dead'
  }

  /** @param {Ticket} t @returns {Promise<Liveness>} */
  async ticketState(t) {
    if (t.born && nowS() - t.born >= TICKET_MAX_AGE_S) return 'dead'
    if (t.node) return pidAlive(t.node.pid) ? 'alive' : 'dead'
    if (!t.pid) return Date.now() - t.mtimeMs < PIDLESS_GRACE_MS ? 'alive' : 'dead'
    return this.shellPidState(t.pid)
  }

  /**
   * A holder is alive while any process it names lives. One that names none is unknown.
   * @param {Holder | null} h
   * @returns {Promise<Liveness>}
   */
  async holderState(h) {
    if (!h) {
      let age = 0
      try {
        age = Date.now() - fs.statSync(this.lock).mtimeMs
      } catch {
        return 'dead'
      }
      return age > HOLDERLESS_GRACE_MS ? 'dead' : 'unknown'
    }
    if (h.node) return pidAlive(h.node.pid) || pidAlive(h.node.child) ? 'alive' : 'dead'
    if (!h.pid) return 'unknown'
    return this.shellPidState(h.pid)
  }

  /**
   * The oldest live ticket's name, sweeping dead ones on the way. An unknown ticket counts as
   * live: never sweep what cannot be checked.
   * @returns {Promise<string | null>}
   */
  async head() {
    for (const t of this.tickets()) {
      if ((await this.ticketState(t)) !== 'dead') return t.name
      this.sweep(t, 'pid gone or too old')
    }
    return null
  }

  /** @param {Ticket} t @param {string} why */
  sweep(t, why) {
    try {
      fs.unlinkSync(t.file)
      this.log(`SWEEP stale ticket '${t.who}' (${why})`)
    } catch {}
  }

  /**
   * @param {{ who: string, since: number, asked: number, child: number | null, token: string }} h
   */
  writeHolder(h) {
    writeWhole(
      this.holderFile,
      `${h.who}\n${h.since}\n${h.asked}\n${this.shellPid}\n${MARK} ${process.pid} ${h.child ?? '-'} ${h.token}\n`,
    )
  }

  /**
   * Move a stale lock aside, but only if it still holds what was judged stale.
   * @param {Holder | null} judged
   */
  reclaim(judged) {
    const grave = `${this.lock}.stale-${process.pid}-${Date.now()}`
    try {
      fs.renameSync(this.lock, grave)
    } catch {
      return false
    }
    const now = readMaybe(path.join(grave, 'holder'))
    if ((now?.text ?? '') !== (judged?.raw ?? '')) {
      try {
        fs.renameSync(grave, this.lock)
      } catch {
        this.log(`RECLAIM raced: moved a fresh lease aside by mistake, left at ${grave}`)
      }
      return false
    }
    fs.rmSync(grave, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    return true
  }

  /**
   * Remove the lock if its holder is the one with this token.
   * @param {string} token
   */
  releaseOwn(token) {
    const h = this.holder()
    if (!h || h.node?.token !== token) return false
    this.log(`RELEASE ${h.who} after ${Math.floor((nowS() - h.since) / 60)}m`)
    fs.rmSync(this.lock, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    return true
  }

  /**
   * The state of the lease, sweeping dead tickets as it reads.
   */
  async status() {
    const held = this.held()
    const h = held ? this.holder() : null
    const hs = held ? await this.holderState(h) : null
    const queue = []
    for (const t of this.tickets()) {
      const st = await this.ticketState(t)
      if (st === 'dead') {
        this.sweep(t, 'from status')
        continue
      }
      queue.push({ who: t.who, pid: t.node?.pid ?? t.pid, born: t.born, state: st })
    }
    return { dir: this.dir, held, holder: h, holderState: hs, queue }
  }
}

/**
 * @typedef {object} AcquireOptions
 * @property {string} name
 * @property {number} minutes       booked, already capped
 * @property {number} waitLimitMs
 * @property {number} pollMs
 * @property {number} staleGraceMs
 * @property {number} [speakMs]     how often a waiter reports, default 60 s
 * @property {(line: string) => void} say
 */

/**
 * Queue, wait for the head of the line, take the lock.
 * @param {Lease} L
 * @param {AcquireOptions} o
 * @returns {Promise<{ ok: true, token: string, adopted: boolean } | { ok: false, code: number }>}
 */
export async function acquire(L, o) {
  const token = crypto.randomBytes(6).toString('hex')
  const take = () => {
    L.writeHolder({ who: o.name, since: nowS(), asked: o.minutes, child: null, token })
    L.log(`ACQUIRE ${o.name} (asked for ${o.minutes}m)`)
    o.say(`GPU LEASE ACQUIRED by ${o.name} at ${stamp()} for ~${o.minutes}m.`)
  }

  // Already ours: an old script's `acquire` under this name, or a lease left by a run of ours
  // that died. A live process under the same name is someone else: wait like anyone.
  if (L.held()) {
    const h0 = L.holder()
    if (h0 && h0.who === o.name) {
      if ((await L.holderState(h0)) !== 'alive') {
        o.say(`GPU LEASE: already held by ${o.name} (since ${hhmmss(h0.since)}). Carrying on.`)
        take()
        return { ok: true, token, adopted: true }
      }
      o.say(`GPU LEASE: '${o.name}' is held by another live process; waiting like anyone else.`)
    }
  }

  fs.mkdirSync(L.queue, { recursive: true })
  const name = `${usec()}-${process.pid}`
  const ticket = path.join(L.queue, name)
  const body = `${o.name}\n${L.shellPid}\n${nowS()}\n${MARK} ${process.pid}\n`
  const file = () => {
    const tmp = path.join(L.queue, `.new-${process.pid}`)
    fs.writeFileSync(tmp, body)
    fs.renameSync(tmp, ticket)
  }
  file()
  const drop = () => {
    try {
      fs.unlinkSync(ticket)
    } catch {}
  }
  // A waiter stopped by a signal takes its ticket with it ('exit' does not run on a signal).
  const onSignal = () => {
    drop()
    process.exit(130)
  }
  process.on('exit', drop)
  for (const s of SIGNALS) process.on(s, onSignal)
  const done = () => {
    drop()
    process.off('exit', drop)
    for (const s of SIGNALS) process.off(s, onSignal)
  }

  const deadline = Date.now() + o.waitLimitMs
  const speakMs = o.speakMs ?? 60_000
  let spoke = 0
  /** @type {{ raw: string, at: number } | null} */
  let stale = null
  for (;;) {
    if (!fs.existsSync(ticket)) {
      // Swept by a reader that could not see our pid: file it again under the same name.
      L.log(`REFILE ticket '${o.name}' (it was swept while this waiter lived)`)
      file()
    }
    const head = await L.head()
    if (head === name) {
      try {
        fs.mkdirSync(L.lock)
        done()
        take()
        return { ok: true, token, adopted: false }
      } catch (e) {
        if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'EEXIST') throw e
      }
      const h = L.holder()
      if ((await L.holderState(h)) === 'dead') {
        const raw = h?.raw ?? ''
        if (!stale || stale.raw !== raw) stale = { raw, at: Date.now() }
        else if (Date.now() - stale.at >= o.staleGraceMs && L.reclaim(h)) {
          L.log(`RECLAIM stale lease of '${h?.who ?? '?'}' (every process it named is gone)`)
          o.say(
            `GPU LEASE: reclaimed a stale lease of '${h?.who ?? '?'}' (its processes are gone).`,
          )
          stale = null
          continue
        }
      } else stale = null
    }
    if (spoke === 0 || Date.now() - spoke >= speakMs) {
      spoke = Date.now()
      await report(L, name, o)
    }
    if (Date.now() > deadline) {
      done()
      o.say(
        `GPU LEASE: gave up after ${Math.round(o.waitLimitMs / 60_000)} minutes. Tell whoever runs the fleet; do not run on the GPU.`,
      )
      return { ok: false, code: 2 }
    }
    await sleep(o.pollMs)
  }
}

/**
 * One waiting line, and the warnings a waiter owes the room.
 * @param {Lease} L
 * @param {string} mine
 * @param {AcquireOptions} o
 */
async function report(L, mine, o) {
  const names = L.tickets().map((t) => t.name)
  const place = names.indexOf(mine) + 1 || '?'
  const h = L.held() ? L.holder() : null
  if (!L.held()) {
    o.say(
      `${stamp()} waiting, place ${place} in the queue: the lease is free, the line ahead goes first`,
    )
    return
  }
  const age = h ? Math.floor((nowS() - h.since) / 60) : 0
  o.say(
    `${stamp()} waiting, place ${place} in the queue: held by '${h?.who || 'nobody yet'}' for ${age}m (asked ${h?.asked ?? '?'}m)`,
  )
  if (h?.asked != null && age > h.asked) {
    o.say('  !! the holder is past its booking. Do NOT steal it; tell whoever runs the fleet.')
  }
  const st = await L.holderState(h)
  if (h?.node && !pidAlive(h.node.pid) && st === 'alive') {
    o.say(
      `  !! the holder's umm-dev process is gone but its command (pid ${h.node.child}) still runs: the lease stays held until it ends.`,
    )
  } else if (st === 'dead') {
    o.say(
      `  !! every process the holder named is gone: the head of the queue reclaims it after ${Math.round(o.staleGraceMs / 1000)}s.`,
    )
  } else if (h && !h.node && h.pid && st === 'unknown') {
    o.say(`  (the holder's pid ${h.pid} cannot be checked from here)`)
  }
}

/**
 * Format a status for people.
 * @param {Awaited<ReturnType<Lease['status']>>} s
 */
export function formatStatus(s) {
  const lines = [`lease dir: ${s.dir}`]
  if (s.held) {
    const h = s.holder
    if (!h) lines.push('HELD (the holder file is not written yet, or was lost)')
    else {
      const age = Math.floor((nowS() - h.since) / 60)
      let note = ''
      if (h.asked != null && age > h.asked) note += ` PAST ITS ${h.asked}m BOOKING`
      if (s.holderState === 'dead') note += ' (STALE: every process it named is gone)'
      if (h.node && !pidAlive(h.node.pid) && s.holderState === 'alive')
        note += ` (umm-dev process gone; its command pid ${h.node.child} still runs)`
      lines.push(
        `HELD by '${h.who}' since ${hhmmss(h.since)} (${age}m of ${h.asked ?? '?'}m)${note}`,
      )
    }
  } else lines.push('FREE')
  s.queue.forEach((q, i) => {
    const waited = q.born ? Math.floor((nowS() - q.born) / 60) : 0
    const st = q.state === 'unknown' ? ', pid not checkable here' : ''
    lines.push(`  queue ${i + 1}: '${q.who}' (pid ${q.pid ?? '?'}${st}) waiting ${waited}m`)
  })
  return lines.join('\n')
}
