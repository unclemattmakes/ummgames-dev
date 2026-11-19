// Play stats in the page: a queue of events, batched and posted to the game's stats Worker
// (worker.ts) with `navigator.sendBeacon`. The game decides what to record; this file decides
// when and how it goes.
//
// - Never on the load path. Nothing is sent before the player's first input; then every
//   `flushMs` and when the page hides or closes. A send is fire and forget: a down endpoint is
//   invisible to the player.
// - Nothing personal. A random id per page load, never stored (no localStorage, no cookie), the
//   build, the game's own batch fields and the device last used.
//
// PAGE-SAFE. `createStatsQueue` has no DOM, so a unit test drives it; `startStats` listens on the
// page. Imports only batch.ts.

import { type Batch, type Device, type EventBase, MAX_EVENTS, type Unstamped } from './batch'

/** Past this many unsent events, more are dropped: an endpoint cannot keep a runaway session. */
export const MAX_QUEUE = 2000
/** How often a batch goes while playing, by default. */
export const FLUSH_MS = 30_000

/** An event as the game pushes it: the queue adds `t` and `dev`. */
export type Pushed<E extends EventBase> = Unstamped<E>

export interface StatsQueue<E extends EventBase> {
  /** Events waiting to go. */
  readonly size: number
  /** The device last used; each event carries it. */
  device: Device
  /** Queue one event, stamped with the clock and the device. Dropped past `MAX_QUEUE`. */
  push(ev: Pushed<E>): void
  /** Send what is queued, at most `MAX_EVENTS` a batch. */
  flush(): void
}

export interface StatsQueueOptions<M> {
  /** The game's batch version (`StatsSpec.version`). */
  version: number
  /** The session id (`sessionId()`), the build and the game's own batch fields. */
  meta: { sid: string; build: string } & M
  /** Seconds since the page loaded. */
  now: () => number
  /** Where a batch goes, as its JSON text. */
  send: (body: string) => void
  /** Sees every event as it is queued (a console log). */
  log?: (ev: EventBase) => void
}

/** A queue apart from the page: what to send and in what batches. */
export function createStatsQueue<M, E extends EventBase>(o: StatsQueueOptions<M>): StatsQueue<E> {
  const queue: E[] = []
  let seq = 0
  let device: Device = 'keyboard'
  return {
    get size() {
      return queue.length
    },
    get device() {
      return device
    },
    set device(d: Device) {
      device = d
    },
    push(ev) {
      if (queue.length >= MAX_QUEUE) return
      const full = { ...ev, t: Math.round(o.now() * 10) / 10, dev: device } as E
      queue.push(full)
      o.log?.(full)
    },
    flush() {
      while (queue.length > 0) {
        const events = queue.splice(0, MAX_EVENTS)
        const batch = { ...o.meta, v: o.version, seq: seq++, events } as Batch<M, E>
        o.send(JSON.stringify(batch))
      }
    },
  }
}

/** Fire and forget: a beacon, or a keepalive fetch where there is no beacon or it was refused. */
export function post(url: string, body: string): void {
  try {
    // A string goes as text/plain: a simple request, so no CORS preflight.
    if (navigator.sendBeacon?.(url, body)) return
  } catch {
    // Fall through to fetch.
  }
  try {
    // no-cors: the answer is never read, and a refusal logs nothing.
    void fetch(url, {
      method: 'POST',
      body,
      keepalive: true,
      mode: 'no-cors',
      credentials: 'omit',
    }).catch(() => {})
  } catch {
    // Nothing: the player must never notice.
  }
}

/** 32 random hex characters: a session id, made per page load and never stored. */
export function sessionId(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

export interface StatsPage {
  /** The player has pressed something, so batches may go. */
  readonly armed: boolean
  /**
   * A device the page cannot see was used: call with `gamepad` when the game's input takes a
   * pad (the DOM has no event for one). Arms sending like any first input.
   */
  used(d: Device): void
}

export interface StartStatsOptions {
  /** The queue to flush. */
  queue: StatsQueue<EventBase>
  /** Called as the page hides or closes, before the flush: push the game's quit event here. */
  leave?: () => void
  /** Called as the page shows again after hiding. */
  back?: () => void
  /** How often to flush once armed. Default `FLUSH_MS`. */
  flushMs?: number
}

/**
 * Listen on the page: the first key, pointer press or `used()` arms sending and sets the
 * device; a mouse move after that says mouse (pointer-lock aiming moves without a press);
 * every `flushMs` it flushes; on `visibilitychange` to hidden and on `pagehide` it calls `leave`
 * and flushes.
 */
export function startStats(o: StartStatsOptions): StatsPage {
  const { queue } = o
  let armed = false
  const flush = () => {
    if (armed) queue.flush()
  }
  const used = (d: Device) => {
    queue.device = d
    if (armed) return
    armed = true
    setInterval(flush, o.flushMs ?? FLUSH_MS)
  }
  const opts = { capture: true, passive: true }
  window.addEventListener('keydown', () => used('keyboard'), opts)
  window.addEventListener(
    'pointerdown',
    (e) => used(e.pointerType === 'mouse' ? 'mouse' : 'touch'),
    opts,
  )
  window.addEventListener(
    'pointermove',
    (e) => {
      if (armed && e.pointerType === 'mouse') queue.device = 'mouse'
    },
    opts,
  )
  const leave = () => {
    o.leave?.()
    flush()
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') leave()
    else o.back?.()
  })
  window.addEventListener('pagehide', leave)
  return {
    get armed() {
      return armed
    },
    used,
  }
}
