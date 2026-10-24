/**
 * The developer splash: "Uncle Matt Makes: ___" with the blank typed a word at a time, landing
 * on the last word ("Games"), over a load bar. It is the page's loading screen, on every load.
 *
 * - **It covers the load and adds little to it.** It goes once the game is loaded AND the last
 *   word has been typed and held `holdMs`; a slower load goes at once. A load that finishes
 *   before the words do cuts to the last word: the word on screen deletes and the last one types.
 * - **It lifts on steady frames.** With `waitForSteady` (the default) it also waits for the
 *   app's `steady()` call, so the title's first visible frames are not its slowest.
 * - **A skip counts only once loaded**: a click, a tap, Enter, Space or a pad's A.
 * - **`covering()` is true until it is gone, fade included.** The app should treat every
 *   confirm as already held while it is, so the press that skips is not also a press on the
 *   title underneath.
 * - **`onLift` fires as the fade starts**: open the iris (or start the title) there.
 *
 * It drives markup the page already has, so it is up from the first paint (see
 * `dev-splash.css` beside this file for the styles):
 *
 *   <div id="dev-splash" role="status" aria-label="Uncle Matt Makes: Games. Loading.">
 *     <div class="dev-splash__lockup">
 *       <img class="dev-splash__portrait" alt="" width="384" height="384" decoding="async" />
 *       <h1 class="dev-splash__mark">Uncle Matt Makes:
 *         <span class="dev-splash__blank" aria-hidden="true">
 *           <span class="dev-splash__sizer">…one per word…</span>
 *           <span class="dev-splash__line"><span class="dev-splash__typed"></span><span
 *             class="dev-splash__caret"></span></span>
 *         </span>
 *         <span class="visually-hidden">Games</span>
 *       </h1>
 *     </div>
 *     <div class="dev-splash__bar" aria-hidden="true"><div class="dev-splash__fill"></div></div>
 *   </div>
 *
 * The timing is pure functions of the clock (`splashFrameAt`, `splashFrameCut`, `fadeAt`), so
 * it is unit-testable without a DOM.
 */

/** The blank's words, the last one the label's. A game passes its own through `words`. */
export const SPLASH_WORDS: readonly string[] = [
  'stuff',
  'simulations',
  'automata',
  'critter cams',
  '3d prints',
  'doughnuts',
  'mistakes',
  'Games',
]

export interface SplashTimings {
  /** Per letter, the first word, ms; each next word is quicker, down to `typeFastMs`. */
  typeSlowMs: number
  typeFastMs: number
  /** How long the first and the last-but-one words sit typed before they're deleted, ms. */
  sitSlowMs: number
  sitFastMs: number
  /** A backspace takes this share of the word's letter time. */
  deleteShare: number
  /** The last word, per letter, ms. */
  finalTypeMs: number
  /** The longest the lockup waits for its font and portrait before it shows, ms. */
  faceWaitMs: number
  /** How long the last word holds before the fade may start, ms. */
  holdMs: number
  /** The fade out to the game, ms. */
  fadeMs: number
}

export const SPLASH_TIMINGS: SplashTimings = {
  typeSlowMs: 45,
  typeFastMs: 16,
  sitSlowMs: 220,
  sitFastMs: 60,
  deleteShare: 0.4,
  finalTypeMs: 70,
  faceWaitMs: 600,
  holdMs: 1200,
  fadeMs: 500,
}

/** One word's turn on the clock, ms after the typing starts. */
export interface SplashBeat {
  /** Its first letter goes in. */
  readonly from: number
  /** Its last letter is in: it sits. */
  readonly typedAt: number
  /** It starts being deleted (the last word never is: this is the end of its hold). */
  readonly deleteFrom: number
  readonly until: number
}

/** Every word's turn for `words`, in order. The last one's `until` is the end of the hold. */
export const splashBeats = (
  words: readonly string[],
  t: SplashTimings = SPLASH_TIMINGS,
): readonly SplashBeat[] => {
  const beats: SplashBeat[] = []
  const ramp = words.length - 1
  const step = (slow: number, fast: number, i: number): number =>
    slow * (fast / slow) ** (i / Math.max(1, ramp - 1))
  let clock = 0
  for (let i = 0; i < ramp; i++) {
    const letters = (words[i] as string).length
    const type = step(t.typeSlowMs, t.typeFastMs, i)
    const typedAt = clock + (letters - 1) * type
    const deleteFrom = typedAt + step(t.sitSlowMs, t.sitFastMs, i)
    const until = deleteFrom + letters * type * t.deleteShare
    beats.push({ from: clock, typedAt, deleteFrom, until })
    clock = until
  }
  const typedAt = clock + ((words[ramp] as string).length - 1) * t.finalTypeMs
  beats.push({ from: clock, typedAt, deleteFrom: typedAt + t.holdMs, until: typedAt + t.holdMs })
  return beats
}

/** What the blank shows at one moment: a word, and how many of its letters. */
export interface SplashFrame {
  readonly index: number
  readonly letters: number
}

/** The blank at `ms` after the typing starts. */
export const splashFrameAt = (
  ms: number,
  words: readonly string[] = SPLASH_WORDS,
  beats: readonly SplashBeat[] = splashBeats(words),
): SplashFrame => {
  const last = beats.length - 1
  let i = 0
  while (i < last && ms >= (beats[i] as SplashBeat).until) i++
  const b = beats[i] as SplashBeat
  const n = (words[i] as string).length
  const t = Math.max(0, ms - b.from)
  if (ms < b.typedAt)
    return { index: i, letters: Math.min(n, Math.floor((t / (b.typedAt - b.from)) * (n - 1)) + 1) }
  if (i === last || ms < b.deleteFrom) return { index: i, letters: n }
  const gone = Math.floor(((ms - b.deleteFrom) / (b.until - b.deleteFrom)) * n) + 1
  return { index: i, letters: Math.max(0, n - gone) }
}

/** How long the word on screen at `ms` takes to delete when the load cuts to the name, ms. */
const cutDeleteMs = (
  ms: number,
  words: readonly string[],
  beats: readonly SplashBeat[],
  t: SplashTimings,
): number => splashFrameAt(ms, words, beats).letters * t.typeFastMs * t.deleteShare

/**
 * When the last word is typed in full if the load is done at `loadedAt` (ms after the typing
 * starts): on the usual clock if the words were already at it, else after the cut.
 */
export const landedAfterLoad = (
  loadedAt: number | null,
  words: readonly string[] = SPLASH_WORDS,
  beats: readonly SplashBeat[] = splashBeats(words),
  t: SplashTimings = SPLASH_TIMINGS,
): number => {
  const last = beats.at(-1) as SplashBeat
  if (loadedAt === null || loadedAt >= last.from) return last.typedAt
  return (
    loadedAt +
    cutDeleteMs(loadedAt, words, beats, t) +
    ((words.at(-1) as string).length - 1) * t.finalTypeMs
  )
}

/**
 * The blank at `ms` when the load was done at `loadedAt`: the usual words till then; from
 * there, if the last word had not started, the word on screen deletes quickly and it types.
 */
export const splashFrameCut = (
  ms: number,
  loadedAt: number | null,
  words: readonly string[] = SPLASH_WORDS,
  beats: readonly SplashBeat[] = splashBeats(words),
  t: SplashTimings = SPLASH_TIMINGS,
): SplashFrame => {
  const last = beats.at(-1) as SplashBeat
  if (loadedAt === null || ms < loadedAt || loadedAt >= last.from)
    return splashFrameAt(ms, words, beats)
  const at = splashFrameAt(loadedAt, words, beats)
  const del = cutDeleteMs(loadedAt, words, beats, t)
  if (ms < loadedAt + del) {
    const gone = Math.floor(((ms - loadedAt) / del) * at.letters) + 1
    return { index: at.index, letters: Math.max(0, at.letters - gone) }
  }
  const n = (words.at(-1) as string).length
  const typed = Math.floor((ms - loadedAt - del) / t.finalTypeMs) + 1
  return { index: words.length - 1, letters: Math.min(n, typed) }
}

/**
 * When the fade starts, ms after the typing starts, or null while it may not: loaded and
 * steady, then a skip or the last word typed and held, whichever is first. Steady defaults to
 * the load (a caller that does not gate on frames).
 */
export const fadeAt = (
  loadedAt: number | null,
  skippedAt: number | null,
  landedMs: number,
  steadyAt: number | null = loadedAt,
  holdMs: number = SPLASH_TIMINGS.holdMs,
): number | null => {
  if (loadedAt === null || steadyAt === null) return null
  const go =
    skippedAt !== null ? Math.max(loadedAt, skippedAt) : Math.max(loadedAt, landedMs + holdMs)
  return Math.max(go, steadyAt)
}

export interface DevSplash {
  /** How far the load is, 0..1 (only ever forward). */
  progress(fraction: number): void
  /** Loaded: the words cut to the last one. */
  ready(): void
  /** The frames under it are steady: once loaded too, it may go. */
  steady(): void
  /** The boot failed: down at once, so an error under it is readable. */
  fail(): void
  /** On screen, up or fading. */
  covering(): boolean
}

export interface DevSplashOptions {
  /** The `#dev-splash` element. Null, or markup missing its parts, removes it and does nothing. */
  root: HTMLElement | null
  /** Where the brand portrait is served. Null leaves the wordmark on its own. */
  portraitUrl?: string | null
  /** The blank's words; the last is the one it lands on. */
  words?: readonly string[]
  timings?: Partial<SplashTimings>
  /** Wait for `steady()` as well as `ready()` before going. Default true. */
  waitForSteady?: boolean
  /** Called as the fade starts: open the iris, start the title. */
  onLift?: () => void
  /** Called once it is gone from the page. */
  onGone?: () => void
  /** The face the lockup waits for (a `FontFaceSet.load` spec), or null not to. */
  font?: string | null
  /** A `performance.mark` set as it lifts, or null for none. Default `boot:title`. */
  mark?: string | null
  /** `KeyboardEvent.key` values that skip. Default Enter and Space. */
  skipKeys?: readonly string[]
  /** Whether a pad's A (button 0) skips. Default true. */
  padSkip?: boolean
  now?: () => number
}

const NO_SPLASH: DevSplash = {
  progress: () => {},
  ready: () => {},
  steady: () => {},
  fail: () => {},
  covering: () => false,
}

const padA = (): boolean => {
  for (const pad of globalThis.navigator?.getGamepads?.() ?? [])
    if (pad?.buttons[0]?.pressed) return true
  return false
}

/** Drive the page's `#dev-splash`. */
export function startDevSplash(options: DevSplashOptions): DevSplash {
  const { root } = options
  const typed = root?.querySelector<HTMLElement>('.dev-splash__typed') ?? null
  const fill = root?.querySelector<HTMLElement>('.dev-splash__fill') ?? null
  const portrait = root?.querySelector<HTMLImageElement>('.dev-splash__portrait') ?? null
  if (!root || !typed || !fill) {
    root?.remove()
    return NO_SPLASH
  }
  const now = options.now ?? (() => performance.now())
  const words = options.words ?? SPLASH_WORDS
  const timing: SplashTimings = { ...SPLASH_TIMINGS, ...options.timings }
  const beats = splashBeats(words, timing)
  const waitForSteady = options.waitForSteady ?? true
  const skipKeys = options.skipKeys ?? ['Enter', ' ']
  const padSkip = options.padSkip ?? true
  const mark = options.mark === undefined ? 'boot:title' : options.mark
  const font = options.font === undefined ? '700 1em Bitter' : options.font
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  let t0 = now()
  let last = t0
  let loadedAt: number | null = null
  let steadyAt: number | null = null
  let skippedAt: number | null = null
  let phase: 'up' | 'fading' | 'gone' = 'up'
  let target = 0
  let drawn = 0
  let frame = 0

  let drawnKey = ''
  const render = (f: SplashFrame): void => {
    const key = `${f.index}:${f.letters}`
    if (key === drawnKey) return
    drawnKey = key
    typed.textContent = (words[f.index] as string).slice(0, f.letters)
  }
  const LANDED: SplashFrame = { index: words.length - 1, letters: (words.at(-1) as string).length }
  render(reduced ? LANDED : splashFrameAt(0, words, beats))

  const skip = (): void => {
    if (phase !== 'up' || loadedAt === null || skippedAt !== null) return
    skippedAt = now() - t0
    render(LANDED)
  }
  // Capture phase, never consumed: the same press can unlock the game's audio.
  const onKey = (e: KeyboardEvent): void => {
    if (skipKeys.includes(e.key)) skip()
  }
  const onPointer = (): void => skip()
  globalThis.addEventListener('keydown', onKey, true)
  globalThis.addEventListener('pointerdown', onPointer, true)

  const finish = (): void => {
    globalThis.removeEventListener('keydown', onKey, true)
    globalThis.removeEventListener('pointerdown', onPointer, true)
    cancelAnimationFrame(frame)
    phase = 'gone'
    root.remove()
    options.onGone?.()
  }
  const startFade = (): void => {
    if (phase !== 'up') return
    if (mark) performance.mark(mark)
    phase = 'fading'
    options.onLift?.()
    root.style.transition = `opacity ${timing.fadeMs}ms ease`
    root.style.opacity = '0'
    root.style.pointerEvents = 'none'
    // Not on transitionend: a hidden tab runs no transitions.
    setTimeout(finish, timing.fadeMs)
  }

  // The typing's clock starts once the lockup can show in its face with its portrait (or it
  // stops waiting), so nothing changes face or pops in mid-word.
  let faced = false
  const showFace = (): void => {
    if (faced || phase === 'gone') return
    faced = true
    t0 = now()
    last = t0
    root.classList.add('is-faced')
  }
  const faceReady = font
    ? document.fonts?.load(font).then(
        () => {},
        () => {},
      )
    : undefined
  const portraitReady = new Promise<void>((resolve) => {
    if (!portrait) return resolve()
    if (!options.portraitUrl) {
      portrait.remove()
      return resolve()
    }
    portrait.addEventListener('load', () => {
      portrait.classList.add('is-loaded')
      resolve()
    })
    // A portrait that cannot load leaves the wordmark on its own.
    portrait.addEventListener('error', () => {
      portrait.remove()
      resolve()
    })
    portrait.src = options.portraitUrl
  })
  void Promise.all([faceReady, portraitReady]).then(showFace)
  setTimeout(showFace, timing.faceWaitMs)

  let padWasDown = padSkip && padA()
  const tick = (): void => {
    const t = now()
    const ms = t - t0
    if (phase === 'up' && faced) {
      const loaded = loadedAt === null ? null : Math.max(0, loadedAt - t0)
      if (!reduced && skippedAt === null) render(splashFrameCut(ms, loaded, words, beats, timing))
      if (padSkip) {
        const pad = padA()
        if (pad && !padWasDown) skip()
        padWasDown = pad
      }
      const steady = waitForSteady
        ? steadyAt === null
          ? null
          : Math.max(0, steadyAt - t0)
        : loaded
      const at = fadeAt(
        loaded,
        skippedAt,
        landedAfterLoad(loaded, words, beats, timing),
        steady,
        timing.holdMs,
      )
      if (at !== null && ms >= at) startFade()
    }
    // The bar eases toward the load rather than jumping step to step.
    const dt = Math.min(0.1, (t - last) / 1000)
    last = t
    drawn += (target - drawn) * (1 - Math.exp(-dt * 8))
    fill.style.transform = `scaleX(${drawn.toFixed(4)})`
    if (phase !== 'gone') frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)

  return {
    progress(f) {
      target = Math.max(target, Math.min(1, f))
    },
    ready() {
      target = 1
      if (loadedAt === null) loadedAt = now()
    },
    steady() {
      if (steadyAt === null) steadyAt = now()
    },
    fail() {
      if (phase !== 'gone') finish()
    },
    covering: () => phase !== 'gone',
  }
}
