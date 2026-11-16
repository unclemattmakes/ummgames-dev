/**
 * A game's mixer on Web Audio: named buses into a glue compressor, a limiter, an optional soft
 * clip and a master trim. Every level is in dB, in one table the game passes in, so a mix is tuned
 * in one place. Chosen buses dip under talk. Works on a live `AudioContext` or an
 * `OfflineAudioContext` alike, so a render tool drives the same graph the page plays.
 */
import { dbToGain } from './pitch'

/** A `DynamicsCompressorNode`'s settings: dB, ratio, seconds. */
export interface Compressor {
  threshold: number
  knee: number
  ratio: number
  attack: number
  release: number
}

/** The glue's default: gentle, slow enough to let each hit's transient through. */
export const GLUE: Readonly<Compressor> = {
  threshold: -18,
  knee: 8,
  ratio: 3,
  attack: 0.01,
  release: 0.25,
}

/** The limiter's default: a hard knee at -3 dB, fast. */
export const LIMIT: Readonly<Compressor> = {
  threshold: -3,
  knee: 0,
  ratio: 20,
  attack: 0.002,
  release: 0.1,
}

/** The duck's default: down 7 dB over 0.25 s while anyone talks, back over 0.9 s. */
export const DUCK: Readonly<DuckOptions> = { by: -7, in: 0.25, out: 0.9 }

export interface DuckOptions {
  /** How far a ducked bus dips while talk is up, dB. */
  by: number
  /** Seconds to go down, and to come back. Each is about three time constants. */
  in: number
  out: number
}

export interface VerbOptions {
  /** The room's length, seconds. */
  seconds: number
  /** How fast it dies: the impulse falls as `(1 - t) ** decay`. Default 3. */
  decay?: number
  /** The wet return's level, dB. */
  wet: number
}

export interface MixOptions<B extends string> {
  /** Each bus's level, dB, by name. The keys are the buses. */
  buses: Readonly<Record<B, number>>
  /** The trim after the limiter, dB: the ceiling. Default 0. */
  master?: number
  /** The buses that dip under talk. Default none. */
  ducked?: readonly B[]
  /** How the ducked buses dip. Default `DUCK`. */
  duck?: Partial<DuckOptions>
  /** The buses that skip the glue and go straight to the limiter, so they never press the rest down. Default none. */
  bypass?: readonly B[]
  /** The glue's settings over `GLUE`, or `null` for no glue. */
  glue?: Partial<Compressor> | null
  /** The limiter's settings over `LIMIT`, or `null` for none. */
  limit?: Partial<Compressor> | null
  /** A curve for a `WaveShaperNode` after the limiter, such as `softClipCurve()` from `synth.ts`. Default none. */
  clip?: Float32Array<ArrayBuffer>
  /** A shared room: its send is `mix.verb`, its return joins the glue. Default none. */
  verb?: VerbOptions
  /** Where the mix goes. Default `ctx.destination`. */
  into?: AudioNode
}

export interface Mix<B extends string> {
  ctx: BaseAudioContext
  /** Each bus's input, at its level. Connect a voice to `mix.buses.music`. */
  buses: Record<B, GainNode>
  /** Each ducked bus's dip, after its level. */
  ducks: Partial<Record<B, GainNode>>
  /** The room's send, when `verb` was given. */
  verb: ConvolverNode | null
  glue: DynamicsCompressorNode | null
  limit: DynamicsCompressorNode | null
  /** The master trim, the last node before `into`. */
  out: GainNode
  /** Talk starts (`true`) or ends (`false`) at `at` on the context's clock: the ducked buses go down or come back. */
  talk(at: number, talking: boolean): void
  /** Sets a bus's level now, dB. */
  set(bus: B, db: number): void
  /** Silences every bus but these: one stem alone, for a level check. */
  solo(...keep: B[]): void
}

/** A room's impulse: decaying noise from a fixed seed, so every page and render hears the same room. */
export function room(ctx: BaseAudioContext, seconds: number, decay = 3): AudioBuffer {
  const n = Math.max(1, Math.round(ctx.sampleRate * seconds))
  const b = ctx.createBuffer(2, n, ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c)
    let x = 1234567 + c * 7654321
    for (let i = 0; i < n; i++) {
      x = (x * 1103515245 + 12345) >>> 0
      d[i] = ((x / 4294967296) * 2 - 1) * (1 - i / n) ** decay
    }
  }
  return b
}

function compressor(ctx: BaseAudioContext, s: Compressor): DynamicsCompressorNode {
  const k = ctx.createDynamicsCompressor()
  k.threshold.value = s.threshold
  k.knee.value = s.knee
  k.ratio.value = s.ratio
  k.attack.value = s.attack
  k.release.value = s.release
  return k
}

export function createMix<B extends string>(ctx: BaseAudioContext, o: MixOptions<B>): Mix<B> {
  const gain = (db: number): GainNode => {
    const g = ctx.createGain()
    g.gain.value = dbToGain(db)
    return g
  }
  const names = Object.keys(o.buses) as B[]
  const levels: Record<string, number> = { ...o.buses }
  const duck = { ...DUCK, ...o.duck }
  const ducked = new Set(o.ducked ?? [])
  const bypass = new Set(o.bypass ?? [])
  for (const b of [...ducked, ...bypass])
    if (!(b in levels)) throw new Error(`mix: ${b} is not a bus`)

  // The tail: glue, limiter, clip, master trim, out.
  const out = gain(o.master ?? 0)
  out.connect(o.into ?? ctx.destination)
  let tail: AudioNode = out
  let clip: WaveShaperNode | null = null
  if (o.clip) {
    clip = ctx.createWaveShaper()
    clip.curve = o.clip
    clip.connect(tail)
    tail = clip
  }
  const limit = o.limit === null ? null : compressor(ctx, { ...LIMIT, ...o.limit })
  if (limit) {
    limit.connect(tail)
    tail = limit
  }
  const post = tail
  const glue = o.glue === null ? null : compressor(ctx, { ...GLUE, ...o.glue })
  if (glue) {
    glue.connect(tail)
    tail = glue
  }

  const buses = {} as Record<B, GainNode>
  const ducks: Partial<Record<B, GainNode>> = {}
  for (const b of names) {
    const g = gain(levels[b] ?? 0)
    const to = bypass.has(b) ? post : tail
    if (ducked.has(b)) {
      const d = ctx.createGain()
      g.connect(d).connect(to)
      ducks[b] = d
    } else g.connect(to)
    buses[b] = g
  }

  let verb: ConvolverNode | null = null
  if (o.verb) {
    verb = ctx.createConvolver()
    verb.buffer = room(ctx, o.verb.seconds, o.verb.decay)
    verb.connect(gain(o.verb.wet)).connect(tail)
  }

  const low = dbToGain(duck.by)
  return {
    ctx,
    buses,
    ducks,
    verb,
    glue,
    limit,
    out,
    talk(at, talking) {
      for (const b of names) {
        const d = ducks[b]
        if (!d) continue
        if (talking) d.gain.setTargetAtTime(low, at, duck.in / 3)
        else d.gain.setTargetAtTime(1, at, duck.out / 3)
      }
    },
    set(bus, db) {
      levels[bus] = db
      buses[bus].gain.value = dbToGain(db)
    },
    solo(...keep) {
      for (const b of names) buses[b].gain.value = keep.includes(b) ? dbToGain(levels[b] ?? 0) : 0
    },
  }
}
