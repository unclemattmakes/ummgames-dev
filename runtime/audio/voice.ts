/**
 * A player for recorded lines packed in bins: each speaker's takes as mp3 pieces laid end to end
 * in one file, and a cues list giving each piece's offset and length in bytes (`o`, `n`). The kit's
 * `packBins` (`@ummgames/dev/voice`) writes both. A bin is fetched once; a piece is decoded when a
 * line first says it, and the last few dozen stay decoded. One line holds the floor at a time: a
 * new one fades the one before it, a line still decoding when a newer one comes up loses its turn,
 * and a line that would start too late is dropped, so a late joiner never hears a stale line.
 * An `overlap` line talks over the floor and is never cut off by it.
 *
 * `VoiceBins` needs only `fetch`, so a game can start it before the first click. `VoicePlayer`
 * needs a Web Audio context. `voicePlan` and `voiceDue` are pure. Imports nothing.
 */

/** One piece of a bin: its bytes, and optionally the second its speech ends (a tail rings after). */
export interface VoicePiece {
  /** Byte offset in the bin. */
  o: number
  /** Byte length. */
  n: number
  /** Seconds into the piece where its words end. The next spliced piece starts from here. */
  end?: number
}

/** What became of a line: said, dropped as late, lost its turn to a newer line, or failed to load or decode. */
export type VoiceOutcome = 'said' | 'late' | 'cut' | 'failed'

/** Seconds late a line may start; later and it is dropped. */
export const VOICE_LATE = 0.5
/** Seconds a line fades over when a newer one cuts in, or on `hush()`. */
export const VOICE_CUT = 0.06
/** Seconds between one spliced piece's words and the next piece. */
export const VOICE_SPLICE = 0.03
/** Decoded pieces kept for the next time they are said. */
export const VOICE_KEEP = 40

/**
 * The bins' bytes, fetched once each. `url(bin)` is where a bin is served, such as
 * `` (bin) => `${import.meta.env.BASE_URL}voice/${bin}` ``. A bin that will not load is `null`:
 * its lines fail and the game goes on.
 */
export class VoiceBins {
  private readonly bins = new Map<string, Promise<ArrayBuffer | null>>()
  private readonly ready = new Set<string>()

  /**
   * `fetcher` defaults to `fetch`. `onError(bin, reason)` hears a bin that will not load (a
   * status that is not ok, or the fetch failing), such as to warn in the console.
   */
  constructor(
    private readonly url: (bin: string) => string,
    private readonly fetcher: (url: string) => Promise<Response> = (u) => fetch(u),
    private readonly onError?: (bin: string, reason: unknown) => void,
  ) {}

  /** The bin's bytes. The first call starts the fetch; later calls share it. */
  load(bin: string): Promise<ArrayBuffer | null> {
    let b = this.bins.get(bin)
    if (b) return b
    b = this.fetcher(this.url(bin))
      .then((r) => {
        if (r.ok) return r.arrayBuffer()
        this.onError?.(bin, new Error(`${r.status} ${r.statusText}`.trim()))
        return null
      })
      .catch((err: unknown) => {
        this.onError?.(bin, err)
        return null
      })
      .then((bytes) => {
        if (bytes) this.ready.add(bin)
        return bytes
      })
    this.bins.set(bin, b)
    return b
  }

  /** Whether the bin has arrived. */
  has(bin: string): boolean {
    return this.ready.has(bin)
  }
}

/** One source of a line to start: piece `index`, at `at` seconds after the line starts, from `from` seconds into it. */
export interface VoicePart {
  index: number
  at: number
  from: number
}

/**
 * When each piece of a line plays. Pieces follow one another: the next starts where the last
 * one's words end (its `end`, else its whole length) plus `splice`. With `offset` the line is
 * already that many seconds in: a piece wholly past is left out, the one under the offset starts
 * at once, part way in. Times are at playback rate `rate`. Returns the parts and the line's end.
 */
export function voicePlan(
  pieces: readonly { end?: number | undefined; duration: number }[],
  { rate = 1, splice = VOICE_SPLICE, offset = 0 } = {},
): { parts: VoicePart[]; ends: number } {
  const parts: VoicePart[] = []
  let t = 0
  let ends = 0
  pieces.forEach((p, index) => {
    const len = p.duration / rate
    const start = t - offset
    if (start + len > 0)
      parts.push({ index, at: Math.max(0, start), from: Math.max(0, -start) * rate })
    ends = Math.max(ends, start + len)
    t += (p.end ?? p.duration) / rate + splice
  })
  return { parts, ends: Math.max(0, ends) }
}

/**
 * The events a clock passes from `from` (not reached) to `to` (reached), each with how far past
 * it the clock is. For a game that says lines on its own ticks: call it every frame with the last
 * frame's tick and this one's, and pass `late` on (in seconds) to `say`.
 */
export function voiceDue<T extends readonly [number, ...unknown[]]>(
  track: readonly T[],
  from: number,
  to: number,
): { event: T; late: number }[] {
  return track
    .filter((e) => e[0] > from && e[0] <= to)
    .map((event) => ({ event, late: to - event[0] }))
}

/** The parts of Web Audio the player uses, so a test can hand it a fake. */
export type VoiceContext = Pick<
  BaseAudioContext,
  'currentTime' | 'createGain' | 'createBufferSource' | 'createBuffer' | 'decodeAudioData'
>

/**
 * A line playing: what fades it, what stops it, and when it ends on the context's clock. A line
 * holds the floor, and is faded by a cut, until `ends`, so a layout whose last sound is not a
 * source of the line (a burst after the words) still goes when the line is cut.
 */
export interface VoiceLine {
  gains: GainNode[]
  sources: AudioBufferSourceNode[]
  ends: number
}

/**
 * Starts a line's buffers at context time `when`, `offset` seconds in. The default splices the
 * pieces into one gain on the line's output; a game with its own layout (bleeps between pieces,
 * a board per speaker) passes its own and keeps the floor, the cache and the late rule. `data`
 * is whatever the game passed to `say` as `data`, such as the line it is laying out.
 */
export type VoiceSchedule = (
  ctx: VoiceContext,
  buffers: readonly AudioBuffer[],
  pieces: readonly VoicePiece[],
  when: number,
  offset: number,
  into: AudioNode,
  data: unknown,
) => VoiceLine

export interface VoicePlayerOptions {
  ctx: VoiceContext
  /** Where lines go unless `say` names another node. */
  out: AudioNode
  bins: VoiceBins
  /** Decoded pieces kept. Default `VOICE_KEEP`. */
  keep?: number
  /** Fade on a cut, seconds. Default `VOICE_CUT`. */
  cut?: number
  /** Seconds late a line may start. Default `VOICE_LATE`. */
  late?: number
  /** Seconds between spliced pieces. Default `VOICE_SPLICE`. */
  splice?: number
  /** Runs once on each decoded piece before it is kept, such as a bit crusher baked into the samples. */
  board?: (ctx: VoiceContext, buffer: AudioBuffer, bin: string) => AudioBuffer
  /** Lays out a line's sources. Default: the pieces spliced, through one gain. */
  schedule?: VoiceSchedule
}

export interface VoiceSayOptions {
  /** How the line is written in `log`. Default `<bin>:<offset>`. */
  label?: string
  /** Seconds the line is already late when asked, such as ticks past its cue. */
  late?: number
  /** Start into the take by how late it is, so it keeps time with the game's clock. Default off: from the top. */
  sync?: boolean
  /** Talk over the floor: neither cuts the line on it nor is cut by a newer one. */
  overlap?: boolean
  /** Where this line goes, instead of `out`, such as a speaker's chain. */
  into?: AudioNode
  /** Playback rate of the default schedule. A game's own `schedule` sets its own. */
  rate?: number
  /** Seconds after it is ready that the line starts. Default 0. */
  delay?: number
  /** Anything, handed to a game's own `schedule` as its last argument. */
  data?: unknown
  /** Called as the line starts, with when it starts and ends on the context's clock. */
  onStart?: (line: { when: number; ends: number }) => void
}

interface Playing extends VoiceLine {
  overlap: boolean
}

/**
 * Says lines from bins on one context. Every outcome goes into `log` as `<outcome>:<label>`, for a
 * game's checks and its debug panel. A line's promise resolves with its outcome; it never rejects.
 */
export class VoicePlayer {
  readonly log: string[] = []
  private readonly decoded = new Map<string, Promise<AudioBuffer>>()
  private readonly playing: Playing[] = []
  private turn = 0
  /** Counts `hush()` calls, so a line still decoding through one never starts, overlap or not. */
  private hushes = 0
  private readonly ctx: VoiceContext
  private readonly custom: VoiceSchedule | undefined
  private readonly opts: {
    out: AudioNode
    bins: VoiceBins
    keep: number
    cut: number
    late: number
    splice: number
    board: VoicePlayerOptions['board']
  }

  constructor(options: VoicePlayerOptions) {
    this.ctx = options.ctx
    this.custom = options.schedule
    this.opts = {
      out: options.out,
      bins: options.bins,
      keep: options.keep ?? VOICE_KEEP,
      cut: options.cut ?? VOICE_CUT,
      late: options.late ?? VOICE_LATE,
      splice: options.splice ?? VOICE_SPLICE,
      board: options.board,
    }
  }

  /** Piece `p` of `bin`, decoded (and through `board`), from the cache when it is there. */
  decode(bin: string, p: VoicePiece): Promise<AudioBuffer> {
    const k = `${bin}:${p.o}:${p.n}`
    let d = this.decoded.get(k)
    if (d) {
      // Most recent last, so the oldest goes first when the cache is full.
      this.decoded.delete(k)
      this.decoded.set(k, d)
      return d
    }
    d = this.opts.bins.load(bin).then((b) => {
      if (!b) throw new Error(`${bin} did not load`)
      // A copy: decoding detaches the bytes it is given.
      return this.ctx
        .decodeAudioData(b.slice(p.o, p.o + p.n))
        .then((buf) => (this.opts.board ? this.opts.board(this.ctx, buf, bin) : buf))
    })
    d.catch(() => this.decoded.delete(k))
    this.decoded.set(k, d)
    for (const old of this.decoded.keys()) {
      if (this.decoded.size <= this.opts.keep) break
      this.decoded.delete(old)
    }
    return d
  }

  /** Drops every decoded piece, such as after the board changes. */
  forget(): void {
    this.decoded.clear()
  }

  /** Says the pieces of `bin` as one line, in order. */
  say(
    bin: string,
    pieces: VoicePiece | readonly VoicePiece[],
    options: VoiceSayOptions = {},
  ): Promise<VoiceOutcome> {
    const list: readonly VoicePiece[] = Array.isArray(pieces) ? pieces : [pieces as VoicePiece]
    const label = options.label ?? `${bin}:${list[0]?.o ?? 0}`
    const done = (o: VoiceOutcome): VoiceOutcome => {
      this.log.push(`${o}:${label}`)
      return o
    }
    const late = options.late ?? 0
    const overlap = options.overlap === true
    if (list.length === 0) return Promise.resolve(done('failed'))
    if (late > this.opts.late) return Promise.resolve(done('late'))
    const turn = overlap ? this.turn : ++this.turn
    const hushes = this.hushes
    const asked = this.ctx.currentTime
    return Promise.all(list.map((p) => this.decode(bin, p)))
      .then((buffers) => {
        if (hushes !== this.hushes || (!overlap && turn !== this.turn)) return done('cut')
        const at = this.ctx.currentTime
        const behind = late + (at - asked)
        if (behind > this.opts.late) return done('late')
        if (!overlap) this.fadeFloor(at)
        const into = options.into ?? this.opts.out
        const offset = options.sync ? behind : 0
        const when = at + (options.delay ?? 0)
        const line = this.custom
          ? this.custom(this.ctx, buffers, list, when, offset, into, options.data)
          : splice(this.ctx, buffers, list, when, offset, into, options.rate ?? 1, this.opts.splice)
        this.prune(at)
        this.playing.push({ ...line, overlap })
        options.onStart?.({ when, ends: line.ends })
        return done('said')
      })
      .catch(() => done('failed'))
  }

  /** Fades every line, the overlapping ones too, and takes the turn from any line still decoding. */
  hush(fade = this.opts.cut): void {
    this.turn++
    this.hushes++
    const now = this.ctx.currentTime
    for (const p of this.playing.splice(0)) fadeLine(p, now, fade)
  }

  /** When the line on the floor ends, on the context's clock; 0 when nothing holds it. */
  until(): number {
    const now = this.ctx.currentTime
    this.prune(now)
    let t = 0
    for (const p of this.playing) if (!p.overlap && p.ends > now) t = Math.max(t, p.ends)
    return t
  }

  /** Lines still sounding, the overlapping ones too. */
  get sounding(): number {
    const now = this.ctx.currentTime
    this.prune(now)
    return this.playing.length
  }

  /** Lets go of lines whose time is up. */
  private prune(now: number): void {
    for (let i = this.playing.length - 1; i >= 0; i--)
      if ((this.playing[i]?.ends ?? 0) <= now) this.playing.splice(i, 1)
  }

  private fadeFloor(now: number): void {
    this.prune(now)
    for (let i = this.playing.length - 1; i >= 0; i--) {
      const p = this.playing[i]
      if (!p || p.overlap) continue
      fadeLine(p, now, this.opts.cut)
      this.playing.splice(i, 1)
    }
  }
}

function fadeLine(p: VoiceLine, now: number, fade: number): void {
  for (const g of p.gains) {
    g.gain.cancelScheduledValues(now)
    g.gain.setValueAtTime(g.gain.value, now)
    g.gain.linearRampToValueAtTime(0, now + fade)
  }
  for (const s of p.sources) {
    try {
      s.stop(now + fade + 0.02)
    } catch {}
  }
  p.ends = Math.min(p.ends, now + fade)
}

/** The default layout: the pieces one after another through one gain into `into`. */
function splice(
  ctx: VoiceContext,
  buffers: readonly AudioBuffer[],
  pieces: readonly VoicePiece[],
  when: number,
  offset: number,
  into: AudioNode,
  rate: number,
  gap: number,
): VoiceLine {
  const plan = voicePlan(
    buffers.map((b, i) => ({ end: pieces[i]?.end, duration: b.duration })),
    { rate, splice: gap, offset },
  )
  const gain = ctx.createGain()
  gain.connect(into)
  const sources = plan.parts.map((part) => {
    const src = ctx.createBufferSource()
    src.buffer = buffers[part.index] ?? null
    src.playbackRate.value = rate
    src.connect(gain)
    src.start(when + part.at, part.from)
    return src
  })
  return { gains: [gain], sources, ends: when + plan.ends }
}
