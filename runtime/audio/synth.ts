/**
 * A sequencer's instruments on Web Audio: kick, snare, clap, hats, crash, toms,
 * a riser, the saw bass, pads, arp plucks, the lead and chord stabs. All
 * synthesised from oscillators and one shared noise buffer, so nothing is
 * sampled and nothing needs a licence.
 *
 * Every voice stops its sources at a fixed time and disconnects its own nodes
 * when the last source ends, so nothing piles up in the graph.
 */
import { note } from './pitch'

/** One note: semitones from A4, a start time, seconds, a level. */
export interface Note {
  semi: number
  at: number
  dur: number
  vol: number
}

export interface Kit {
  kick(at: number, vol: number, out: AudioNode): void
  snare(at: number, vol: number, out: AudioNode): void
  clap(at: number, vol: number, out: AudioNode): void
  hat(at: number, vol: number, out: AudioNode, open?: boolean): void
  crash(at: number, vol: number, out: AudioNode): void
  tom(semi: number, at: number, vol: number, out: AudioNode): void
  /** Filtered noise sweeping up over `dur`, growing louder: the build into a drop. */
  riser(at: number, dur: number, vol: number, out: AudioNode): void
  bass(n: Note, out: AudioNode, wave: OscillatorType, cutoff: number): void
  /** A held chord of detuned saws, spread left and right by `width` (0 to 1). */
  pad(
    semis: readonly number[],
    at: number,
    dur: number,
    vol: number,
    out: AudioNode,
    cutoff: number,
    width: number,
  ): void
  pluck(n: Note, out: AudioNode, wave: OscillatorType, cutoff: number, pan: number): void
  lead(n: Note, out: AudioNode, wave: OscillatorType, cutoff: number): void
  stab(semis: readonly number[], at: number, dur: number, vol: number, out: AudioNode): void
}

/** The smallest level an exponential ramp can reach (it cannot reach zero). */
export const FLOOR = 0.0001

/** One second of white noise, made once per context and shared by every voice. */
export function noiseBuffer(ctx: BaseAudioContext, seconds = 1): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  return buf
}

/** A stereo reverb impulse: decaying noise, different in each ear so it sounds wide. */
export function impulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay
  }
  return buf
}

const curves = new Map<number, Float32Array<ArrayBuffer>>()

/**
 * A soft-clip curve for a WaveShaper: `amount` 0 is nearly clean, 1 is heavy.
 * tanh, scaled so full input still maps to plus or minus 1. Cached per amount.
 */
export function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const key = Math.round(Math.min(1, Math.max(0, amount)) * 100) / 100
  const hit = curves.get(key)
  if (hit) return hit
  const k = 1 + key * 12
  const n = 1024
  const c = new Float32Array(n)
  const norm = Math.tanh(k)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    c[i] = Math.tanh(k * x) / norm
  }
  curves.set(key, c)
  return c
}

/**
 * One sample through a soft clip: `x` itself up to `knee` either side of 0,
 * then a tanh shoulder that bends toward 1. The same shape as `softClipCurve`,
 * for a game that builds its own curve (one fed at half level, say, to reach 1
 * at twice full scale).
 */
export function softClip(x: number, knee = 0.7): number {
  const a = Math.abs(x)
  if (a <= knee) return x
  return Math.sign(x) * (knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)))
}

/**
 * The output's safety clipper: straight through below 0.7, then a smooth knee
 * that never passes 0.93. The limiter catches nearly everything; this rounds
 * off whatever slips past its attack instead of letting it hard clip.
 */
export function softClipCurve(n = 2048): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n)
  const knee = 0.7
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    const a = Math.abs(x)
    const y = a <= knee ? a : knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee))
    c[i] = Math.sign(x) * y
  }
  return c
}

/**
 * Build the kit on a context. `noise` is the shared noise buffer; no voice
 * allocates a buffer of its own.
 */
export function createKit(ctx: BaseAudioContext, noise: AudioBuffer): Kit {
  /** Disconnect `nodes` once `src` (the voice's last source) has ended. */
  const cleanup = (src: AudioScheduledSourceNode, nodes: AudioNode[]) => {
    src.onended = () => {
      for (const n of nodes) n.disconnect()
    }
  }

  const noiseSrc = (at: number, dur: number): AudioBufferSourceNode => {
    const s = ctx.createBufferSource()
    s.buffer = noise
    s.loop = true
    s.start(at, Math.random() * noise.duration)
    s.stop(at + dur)
    return s
  }

  const filter = (type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode => {
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    return f
  }

  /** A percussive gain: a 2 ms attack to `vol`, then an exponential fall over `decay`. */
  const perc = (at: number, vol: number, decay: number): GainNode => {
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, at)
    g.gain.linearRampToValueAtTime(vol, at + 0.002)
    g.gain.exponentialRampToValueAtTime(FLOOR, at + decay)
    return g
  }

  const osc = (type: OscillatorType, freq: number, detune = 0): OscillatorNode => {
    const o = ctx.createOscillator()
    o.type = type
    o.frequency.value = freq
    o.detune.value = detune
    return o
  }

  /** Noise through one filter and a percussive envelope. */
  const noiseHit = (
    at: number,
    vol: number,
    decay: number,
    type: BiquadFilterType,
    freq: number,
    q: number,
    out: AudioNode,
  ) => {
    const s = noiseSrc(at, decay + 0.01)
    const f = filter(type, freq, q)
    const g = perc(at, vol, decay)
    s.connect(f).connect(g).connect(out)
    cleanup(s, [s, f, g])
  }

  return {
    kick(at, vol, out) {
      const o = osc('sine', 160)
      o.frequency.setValueAtTime(160, at)
      o.frequency.exponentialRampToValueAtTime(52, at + 0.08)
      o.frequency.exponentialRampToValueAtTime(38, at + 0.4)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, at)
      g.gain.linearRampToValueAtTime(vol, at + 0.002)
      g.gain.setValueAtTime(vol, at + 0.04)
      g.gain.exponentialRampToValueAtTime(FLOOR, at + 0.42)
      o.connect(g).connect(out)
      o.start(at)
      o.stop(at + 0.45)
      cleanup(o, [o, g])
      // The beater's click, so the kick reads on small speakers.
      noiseHit(at, vol * 0.3, 0.012, 'highpass', 2500, 0.7, out)
    },
    snare(at, vol, out) {
      noiseHit(at, vol * 0.8, 0.16, 'bandpass', 1900, 0.7, out)
      const o = osc('triangle', 200)
      o.frequency.setValueAtTime(200, at)
      o.frequency.exponentialRampToValueAtTime(160, at + 0.06)
      const g = perc(at, vol * 0.6, 0.09)
      o.connect(g).connect(out)
      o.start(at)
      o.stop(at + 0.1)
      cleanup(o, [o, g])
    },
    clap(at, vol, out) {
      // Three quick slaps then a short tail: what makes a clap a clap.
      const s = noiseSrc(at, 0.24)
      const f = filter('bandpass', 1150, 1.4)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, at)
      for (const t of [0, 0.011, 0.022]) {
        g.gain.setValueAtTime(vol, at + t)
        g.gain.linearRampToValueAtTime(vol * 0.15, at + t + 0.009)
      }
      g.gain.setValueAtTime(vol, at + 0.031)
      g.gain.exponentialRampToValueAtTime(FLOOR, at + 0.22)
      s.connect(f).connect(g).connect(out)
      cleanup(s, [s, f, g])
    },
    hat(at, vol, out, open = false) {
      noiseHit(at, vol, open ? 0.26 : 0.04, 'highpass', open ? 6500 : 7800, 0.9, out)
    },
    crash(at, vol, out) {
      noiseHit(at, vol, 1.6, 'highpass', 3800, 0.5, out)
    },
    tom(semi, at, vol, out) {
      const f = note(semi)
      const o = osc('sine', f)
      o.frequency.setValueAtTime(f, at)
      o.frequency.exponentialRampToValueAtTime(f * 0.6, at + 0.25)
      const g = perc(at, vol, 0.3)
      o.connect(g).connect(out)
      o.start(at)
      o.stop(at + 0.32)
      cleanup(o, [o, g])
    },
    riser(at, dur, vol, out) {
      const s = noiseSrc(at, dur + 0.02)
      const f = filter('bandpass', 400, 3)
      f.frequency.setValueAtTime(400, at)
      f.frequency.exponentialRampToValueAtTime(7000, at + dur)
      const g = ctx.createGain()
      g.gain.setValueAtTime(FLOOR, at)
      g.gain.exponentialRampToValueAtTime(vol, at + dur)
      g.gain.linearRampToValueAtTime(0, at + dur + 0.02)
      s.connect(f).connect(g).connect(out)
      cleanup(s, [s, f, g])
    },
    bass(n, out, wave, cutoff) {
      const f = note(n.semi)
      const end = n.at + Math.max(0.03, n.dur)
      const lp = filter('lowpass', cutoff, 5)
      lp.frequency.setValueAtTime(Math.min(12000, cutoff * 5), n.at)
      lp.frequency.exponentialRampToValueAtTime(cutoff, n.at + 0.1)
      const g = ctx.createGain()
      // Two saws and a sine sum to nearly 3x one oscillator: trim so `vol` means what it says.
      const vol = n.vol * 0.4
      g.gain.setValueAtTime(0, n.at)
      g.gain.linearRampToValueAtTime(vol, n.at + 0.005)
      g.gain.setValueAtTime(vol, end)
      g.gain.linearRampToValueAtTime(0, end + 0.025)
      const a = osc(wave, f, -7)
      const b = osc(wave, f, 7)
      // A sine at the fundamental keeps the low end solid under the filter.
      const sub = osc('sine', f)
      const subG = ctx.createGain()
      subG.gain.value = 0.7
      a.connect(lp)
      b.connect(lp)
      sub.connect(subG).connect(g)
      lp.connect(g).connect(out)
      for (const o of [a, b, sub]) {
        o.start(n.at)
        o.stop(end + 0.03)
      }
      cleanup(sub, [a, b, sub, subG, lp, g])
    },
    pad(semis, at, dur, vol, out, cutoff, width) {
      const end = at + dur
      const lp = filter('lowpass', cutoff, 0.8)
      const g = ctx.createGain()
      const peak = vol / Math.max(1, semis.length)
      g.gain.setValueAtTime(0, at)
      g.gain.linearRampToValueAtTime(peak, at + Math.min(0.3, dur * 0.3))
      g.gain.setValueAtTime(peak, end)
      g.gain.linearRampToValueAtTime(0, end + 0.5)
      const left = ctx.createStereoPanner()
      const right = ctx.createStereoPanner()
      left.pan.value = -0.8 * width
      right.pan.value = 0.8 * width
      left.connect(lp)
      right.connect(lp)
      lp.connect(g).connect(out)
      const nodes: AudioNode[] = [left, right, lp, g]
      let last: OscillatorNode | null = null
      for (const semi of semis) {
        for (const [side, cents] of [
          [left, -12],
          [right, 12],
        ] as const) {
          const o = osc('sawtooth', note(semi), cents)
          o.connect(side)
          o.start(at)
          o.stop(end + 0.55)
          nodes.push(o)
          last = o
        }
      }
      if (last) cleanup(last, nodes)
    },
    pluck(n, out, wave, cutoff, pan) {
      const len = Math.max(0.12, n.dur)
      const o = osc(wave, note(n.semi))
      const lp = filter('lowpass', cutoff, 3)
      lp.frequency.setValueAtTime(Math.min(14000, cutoff * 3), n.at)
      lp.frequency.exponentialRampToValueAtTime(cutoff, n.at + 0.08)
      const g = perc(n.at, n.vol, len)
      const p = ctx.createStereoPanner()
      p.pan.value = pan
      o.connect(lp).connect(g).connect(p).connect(out)
      o.start(n.at)
      o.stop(n.at + len + 0.02)
      cleanup(o, [o, lp, g, p])
    },
    lead(n, out, wave, cutoff) {
      const f = note(n.semi)
      const end = n.at + Math.max(0.05, n.dur)
      const a = osc(wave, f, -8)
      const b = osc(wave, f, 8)
      // Vibrato that waits a moment, so short notes stay straight and held ones sing.
      const lfo = osc('sine', 5.5)
      const depth = ctx.createGain()
      depth.gain.setValueAtTime(0, n.at)
      depth.gain.setValueAtTime(0, n.at + 0.16)
      depth.gain.linearRampToValueAtTime(16, n.at + 0.4)
      lfo.connect(depth)
      depth.connect(a.detune)
      depth.connect(b.detune)
      const lp = filter('lowpass', cutoff, 1.5)
      lp.frequency.setValueAtTime(cutoff * 1.8, n.at)
      lp.frequency.exponentialRampToValueAtTime(cutoff, n.at + 0.15)
      // Attack, decay to 75%, hold, release. The hold never lands before the decay ends.
      const decayEnd = n.at + 0.12
      const holdEnd = Math.max(decayEnd, end)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, n.at)
      g.gain.linearRampToValueAtTime(n.vol, n.at + 0.008)
      g.gain.linearRampToValueAtTime(n.vol * 0.75, decayEnd)
      g.gain.setValueAtTime(n.vol * 0.75, holdEnd)
      g.gain.linearRampToValueAtTime(0, holdEnd + 0.08)
      a.connect(lp)
      b.connect(lp)
      lp.connect(g).connect(out)
      for (const o of [a, b, lfo]) {
        o.start(n.at)
        o.stop(holdEnd + 0.1)
      }
      cleanup(lfo, [a, b, lfo, depth, lp, g])
    },
    stab(semis, at, dur, vol, out) {
      const lp = filter('lowpass', 6000, 2)
      lp.frequency.setValueAtTime(6000, at)
      lp.frequency.exponentialRampToValueAtTime(700, at + dur)
      const g = perc(at, vol / Math.max(1, semis.length), dur + 0.08)
      lp.connect(g).connect(out)
      const nodes: AudioNode[] = [lp, g]
      let last: OscillatorNode | null = null
      for (const semi of semis) {
        for (const cents of [-10, 10]) {
          const o = osc('sawtooth', note(semi), cents)
          o.connect(lp)
          o.start(at)
          o.stop(at + dur + 0.1)
          nodes.push(o)
          last = o
        }
      }
      if (last) cleanup(last, nodes)
    },
  }
}
