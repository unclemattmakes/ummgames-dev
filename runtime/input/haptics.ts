/**
 * Rumble with a priority scheduler. A pad's `playEffect` has no mixing: a new call cuts off the one
 * running, so a game that calls it from several places has a light tick cut off a heavy hit at
 * random. This module owns the motors and arbitrates:
 *
 * - A stronger effect cuts in over a weaker one.
 * - A weaker one never cuts off a stronger one still running. It is dropped, not queued: a tick
 *   200 ms after a crash is not worth feeling late.
 * - An effect of equal priority replaces the running one.
 * - An optional hum (`setHum`) runs under every effect, in short refreshed pulses, for something
 *   held (an engine, a boost).
 *
 * Two halves. The scheduler (`createHaptics`) is pure: the game passes the time and its own table
 * of effects, and it writes to a `HapticSink`, so a node test drives it with a fake clock and a
 * recording sink. The sinks (`padSink`, `phoneSink`, `bothSinks`) are the only code that touches a
 * device. They are fire and forget: every call is optional-chained and its promise caught, because
 * a browser may refuse haptics (a permission, a pad without motors) and a rejection must never
 * surface. Never gate play on rumble.
 */

/** One burst: when it starts (ms after the effect), how long it runs, and both motors 0..1. */
export interface HapticSegment {
  readonly at: number
  readonly ms: number
  /** The low-frequency (heavy) motor: a thud. */
  readonly strong: number
  /** The high-frequency (light) motor: a tick. */
  readonly weak: number
}

/** An effect: its rank (higher wins) and its bursts, in order of `at`. */
export interface HapticEffect {
  readonly priority: number
  readonly segments: readonly HapticSegment[]
}

/** The game's effects, by name. */
export type HapticTable<K extends string> = Readonly<Record<K, HapticEffect>>

/** Where a burst goes. The scheduler's only output. */
export interface HapticSink {
  /** Run both motors for `ms`, replacing whatever is running. Must never throw. */
  rumble(strong: number, weak: number, ms: number): void
  /** Stop what is running, if the device can. */
  stop(): void
}

export interface HapticsOptions {
  /** 0..1, scales every burst and the hum. 0 is off. Default 1. */
  strength?: number
  /** The hum is refreshed this often (ms). Default 100. */
  humRefreshMs?: number
  /** Each hum pulse runs this long (ms), longer than the refresh so no gap opens. Default 140. */
  humPulseMs?: number
}

export interface Haptics<K extends string> {
  /** 0..1, a settings slider. 0 stops everything now. */
  setStrength(k: number): void
  readonly strength: number
  /** An on/off switch over the strength: off stops everything now and drops triggers. */
  setEnabled(on: boolean): void
  readonly enabled: boolean
  /** Hold everything while a menu or pause stands over the game: stops and drops triggers. */
  setHeld(held: boolean): void
  /** Start an effect at `now` (ms). False when off, held, or a stronger effect is running. */
  trigger(kind: K, now: number): boolean
  /** The hum under every effect, both motors 0..1. (0, 0) stops it. */
  setHum(strong: number, weak?: number): void
  /** Advance to `now` (ms): start due segments, refresh the hum, retire the finished. */
  update(now: number): void
  /** Which effect is running at `now`: its name, 'hum', or null. */
  active(now: number): K | 'hum' | null
}

interface Running<K extends string> {
  readonly kind: K
  readonly priority: number
  readonly start: number
  readonly end: number
  next: number
}

const unit = (x: number): number => (x > 0 ? (x < 1 ? x : 1) : 0)

/** A scheduler over `effects`, writing to `sink`. */
export function createHaptics<K extends string>(
  effects: HapticTable<K>,
  sink: HapticSink,
  options: HapticsOptions = {},
): Haptics<K> {
  const refresh = options.humRefreshMs ?? 100
  const pulse = options.humPulseMs ?? 140
  let k = unit(options.strength ?? 1)
  let on = true
  let held = false
  let running: Running<K> | null = null
  let hum: [number, number] = [0, 0]
  let humNext = 0
  let humOn = false

  const live = (): boolean => on && k > 0 && !held
  const halt = (): void => {
    running = null
    humOn = false
    sink.stop()
  }

  const update = (now: number): void => {
    if (!live()) return
    const r = running
    if (r) {
      const segments = effects[r.kind].segments
      while (r.next < segments.length) {
        const seg = segments[r.next] as HapticSegment
        if (now < r.start + seg.at) break
        sink.rumble(unit(seg.strong * k), unit(seg.weak * k), seg.ms)
        r.next += 1
      }
      if (now >= r.end) running = null
      else return
    }
    // The hum: only when no effect is running, refreshed in short pulses.
    if ((hum[0] > 0 || hum[1] > 0) && (!humOn || now >= humNext)) {
      sink.rumble(unit(hum[0] * k), unit(hum[1] * k), pulse)
      humOn = true
      humNext = now + refresh
    }
  }

  return {
    get strength() {
      return k
    },
    setStrength(next) {
      const was = live()
      k = unit(next)
      if (was && !live()) halt()
    },
    get enabled() {
      return on
    },
    setEnabled(next) {
      const was = live()
      on = next
      if (was && !live()) halt()
    },
    setHeld(next) {
      if (next === held) return
      const was = live()
      held = next
      if (was && !live()) halt()
    },
    trigger(kind, now) {
      if (!live()) return false
      const effect = effects[kind]
      if (running && now < running.end && running.priority > effect.priority) return false
      const last = effect.segments.at(-1)
      if (!last) return false
      running = {
        kind,
        priority: effect.priority,
        start: now,
        end: now + last.at + last.ms,
        next: 0,
      }
      humOn = false
      update(now)
      return true
    },
    setHum(strong, weak = 0) {
      hum = [unit(strong), unit(weak)]
      if (hum[0] <= 0 && hum[1] <= 0) humOn = false
    },
    update,
    active(now) {
      if (running && now < running.end) return running.kind
      return humOn && (hum[0] > 0 || hum[1] > 0) ? 'hum' : null
    },
  }
}

// The sinks: the only code that touches a device.

interface DualRumbleActuator {
  playEffect?: (
    type: 'dual-rumble',
    params: {
      startDelay?: number
      duration: number
      weakMagnitude: number
      strongMagnitude: number
    },
  ) => Promise<unknown> | undefined
  reset?: () => Promise<unknown> | undefined
}
interface PulseActuator {
  pulse?: (value: number, duration: number) => Promise<unknown> | undefined
}
/** The parts of a `Gamepad` (or an XR input source's gamepad) this file uses. */
export interface HapticPad {
  vibrationActuator?: DualRumbleActuator | null
  hapticActuators?: readonly PulseActuator[] | null
}

type Pads = HapticPad | null | undefined | readonly (HapticPad | null | undefined)[]

/** Swallow a rejected haptics promise: never an unhandled rejection. */
function swallow(r: unknown): void {
  if (r && typeof (r as Promise<unknown>).catch === 'function')
    (r as Promise<unknown>).catch(() => {})
}

function list(p: Pads): HapticPad[] {
  if (!p) return []
  return (Array.isArray(p) ? p : [p]).filter((x): x is HapticPad => !!x)
}

/** One pad, dual-rumble first, then the older pulse path. Never throws. */
function buzz(pad: HapticPad, strong: number, weak: number, ms: number): void {
  try {
    const va = pad.vibrationActuator
    if (va?.playEffect) {
      swallow(
        va.playEffect('dual-rumble', {
          startDelay: 0,
          duration: ms,
          weakMagnitude: weak,
          strongMagnitude: strong,
        }),
      )
      return
    }
    const act = pad.hapticActuators?.[0]
    if (act?.pulse) swallow(act.pulse(Math.max(strong, weak * 0.8), ms))
  } catch {
    // A device that throws is a device without haptics.
  }
}

/**
 * A sink for whichever pads `getPads` names at the moment of each burst: one pad, a list (both XR
 * controllers, say), or null for none. Read fresh each time, so a pad plugged in later is felt.
 */
export function padSink(getPads: () => Pads): HapticSink {
  return {
    rumble(strong, weak, ms) {
      for (const pad of list(getPads())) buzz(pad, strong, weak, ms)
    },
    stop() {
      for (const pad of list(getPads())) {
        try {
          swallow(pad.vibrationActuator?.reset?.())
        } catch {
          // as above
        }
      }
    },
  }
}

/**
 * A phone's buzzer. `navigator.vibrate` has one motor and no strength, so only bursts with some
 * weight (`min`, default 0.35, against the stronger motor or 0.7 of the lighter) get through, as a
 * buzz of their length, and only while `enabled()` says so (a touch device in use, say). Android
 * browsers have it; iOS Safari does not.
 */
export function phoneSink(enabled: () => boolean = () => true, min = 0.35): HapticSink {
  const vibrate = (ms: number): void => {
    try {
      if (enabled()) globalThis.navigator?.vibrate?.(ms)
    } catch {
      // as above
    }
  }
  return {
    rumble(strong, weak, ms) {
      if (Math.max(strong, weak * 0.7) >= min) vibrate(Math.round(ms))
    },
    stop() {
      vibrate(0)
    },
  }
}

/** Sends every burst to all of `sinks`. */
export function bothSinks(...sinks: HapticSink[]): HapticSink {
  return {
    rumble(strong, weak, ms) {
      for (const s of sinks) s.rumble(strong, weak, ms)
    },
    stop() {
      for (const s of sinks) s.stop()
    },
  }
}

/** A sink that does nothing: a keyboard seat, an autopilot. */
export const NO_HAPTICS: HapticSink = { rumble() {}, stop() {} }
