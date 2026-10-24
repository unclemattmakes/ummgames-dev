// @ts-check
/**
 * The virtual clock: an init script that owns the page's time, so a capture is frame-exact
 * however slowly the machine draws.
 *
 * It replaces `requestAnimationFrame`, `performance.now` and `Date.now` before any game code
 * runs, and seeds `Math.random`. rAF callbacks run only from the clock's own pump, which runs on
 * the real rAF and moves through three phases:
 *
 *   boot  one virtual frame per real frame, so loading screens animate as usual. On the first
 *         frame at or past `bootFrames` where the ready predicate holds (or the moment the game
 *         assigns its debug global, with `hold: 'assign'`), the clock enters hold.
 *   hold  time FREEZES. rAF callbacks still run (the game keeps rendering, a fixed-step sim
 *         gains no ticks), so code that awaits a frame still finishes. The harness hides
 *         overlays and runs prep hooks here, at a known tick: tick 0.
 *   run   each pumped frame advances exactly 1/fps s. Scheduled events (keys, pointer events,
 *         lines of JS) fire on their exact frame, before that frame's callbacks. Frames in
 *         (lo, hi] are grabbed, and the pump WAITS until Node has written each one. After hi
 *         the clock holds again, so the last frame is still on screen for the `expect` check.
 *
 * Each virtual frame is 1000/fps ms plus 1e-6 ms. Without that lead, float error in
 * `base + n * 16.666...` puts about half the frame deltas a hair under 1/fps, and a fixed-step
 * accumulator steps 0 then 2 ticks: the sim stutters though the clock is perfect.
 */

/**
 * @typedef {object} ClockConfig
 * @property {number} fps
 * @property {number | null} seed        Math.random seed; null leaves Math.random alone
 * @property {number} skip               real frames per virtual frame while recording
 * @property {number} bootFrames         earliest boot frame that can become tick 0
 * @property {string | null} debugGlobal the game's debug handle on window, passed to hooks
 * @property {'ready' | 'assign'} hold   what ends boot
 * @property {string | null} ready       page function source: (debug, vt) => boolean
 * @property {string | null} state       page function source: (debug) => JSON, logged per frame
 * @property {'window' | 'document' | 'canvas'} keyTarget
 * @property {string} canvas             selector of the canvas to grab
 * @property {'canvas' | 'page'} grab    copy the canvas, or let Node screenshot the page
 * @property {'jpeg' | 'png'} format
 * @property {number} quality            JPEG quality, 0 to 1
 * @property {string} binding            the exposed Node function frames go to
 */

/**
 * Runs in the page. Kept free of anything outside its own body: it is serialised.
 * @param {ClockConfig} cfg
 */
/* c8 ignore start */
export function installClock(cfg) {
  /** @type {any} */
  const w = window
  const realRaf = w.requestAnimationFrame.bind(w)
  const realNow = performance.now.bind(performance)
  const FRAME_MS = 1000 / cfg.fps
  const EPS_MS = 1e-6
  const vt = {
    mode: 'boot',
    frames: 0,
    base: Math.round(realNow()),
    dateBase: Date.now(),
    count: 0,
    busy: false,
    tick0: 0,
    lo: 0,
    hi: 0,
    /** @type {[number, string, ...unknown[]][]} */
    events: [],
    recording: false,
    grabbed: 0,
    heldAt: -1,
    pumps: 0,
    /** @type {OffscreenCanvas | null} */
    off: null,
    /** @type {string | null} */
    error: null,
    /** @type {(lo: number, hi: number, events: any[]) => void} */
    run: () => {},
  }
  w.__ummClock = vt
  const vnow = () => vt.base + vt.frames * (FRAME_MS + EPS_MS)
  performance.now = vnow
  Date.now = () => Math.floor(vt.dateBase + (vnow() - vt.base))
  if (cfg.seed != null) {
    // mulberry32: render-side randomness (particles, sparkles) repeats run to run.
    let s = cfg.seed >>> 0
    Math.random = () => {
      s = (s + 0x6d2b79f5) >>> 0
      let t = s
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  /** @type {Map<number, FrameRequestCallback>} */
  let pending = new Map()
  let id = 0
  w.requestAnimationFrame = (/** @type {FrameRequestCallback} */ cb) => {
    const h = ++id
    pending.set(h, cb)
    return h
  }
  w.cancelAnimationFrame = (/** @type {number} */ h) => {
    pending.delete(h)
  }
  const compile = (/** @type {string | null} */ src) =>
    src ? new Function(`return (${src})`)() : null
  const ready = compile(cfg.ready)
  const state = compile(cfg.state)
  const debug = () => (cfg.debugGlobal ? w[cfg.debugGlobal] : undefined)
  const hold = () => {
    if (vt.mode === 'boot') {
      vt.mode = 'hold'
      vt.heldAt = vt.frames
    }
  }
  if (cfg.hold === 'assign' && cfg.debugGlobal) {
    let value = w[cfg.debugGlobal]
    Object.defineProperty(w, cfg.debugGlobal, {
      configurable: true,
      get: () => value,
      set: (v) => {
        value = v
        hold()
      },
    })
  }
  const keyTarget = () =>
    cfg.keyTarget === 'document'
      ? document
      : cfg.keyTarget === 'canvas'
        ? (document.querySelector(cfg.canvas) ?? w)
        : w
  /** @param {[number, string, ...unknown[]]} ev */
  const fire = (ev) => {
    const [, type, a, b, c] = ev
    if (type === 'keydown' || type === 'keyup') {
      const code = String(a)
      keyTarget().dispatchEvent(
        new KeyboardEvent(type, { code, key: code, bubbles: true, cancelable: true }),
      )
    } else if (type === 'run') {
      let f
      try {
        f = new Function('debug', `return (${a})`)
      } catch {
        f = new Function('debug', String(a))
      }
      f(debug())
    } else if (type === 'pointer') {
      const el = document.querySelector(cfg.canvas) ?? document.body
      const r = el.getBoundingClientRect()
      const init = {
        clientX: r.left + Number(b),
        clientY: r.top + Number(c),
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        button: 0,
        buttons: a === 'pointerup' || a === 'pointermove' ? 0 : 1,
      }
      el.dispatchEvent(new PointerEvent(String(a), init))
      const mouse = { pointerdown: 'mousedown', pointerup: 'mouseup', pointermove: 'mousemove' }
      const m = mouse[/** @type {keyof typeof mouse} */ (String(a))]
      if (m) el.dispatchEvent(new MouseEvent(m, init))
      if (a === 'pointerup') el.dispatchEvent(new MouseEvent('click', init))
    }
  }
  const ok = (/** @type {() => unknown} */ f) => {
    try {
      return Boolean(f())
    } catch {
      return false
    }
  }
  /** @param {number} n @param {unknown} st */
  const send = (n, st) => {
    vt.busy = true
    /** @type {Promise<string | null>} */
    let data = Promise.resolve(null)
    if (cfg.grab === 'canvas') {
      const c = /** @type {HTMLCanvasElement | null} */ (document.querySelector(cfg.canvas))
      if (!c) {
        vt.error = `no element matches ${cfg.canvas}`
        vt.busy = false
        return
      }
      if (!vt.off || vt.off.width !== c.width || vt.off.height !== c.height)
        vt.off = new OffscreenCanvas(c.width, c.height)
      const ctx = /** @type {OffscreenCanvasRenderingContext2D} */ (vt.off.getContext('2d'))
      ctx.clearRect(0, 0, c.width, c.height)
      ctx.drawImage(c, 0, 0)
      const type = cfg.format === 'png' ? 'image/png' : 'image/jpeg'
      data = vt.off.convertToBlob({ type, quality: cfg.quality }).then(
        (blob) =>
          new Promise((res) => {
            const r = new FileReader()
            r.onload = () => res(String(r.result).split(',')[1])
            r.readAsDataURL(blob)
          }),
      )
    }
    data
      .then((b64) => w[cfg.binding](n, b64, st))
      .then(
        () => {
          vt.grabbed++
          vt.busy = false
        },
        (/** @type {unknown} */ e) => {
          vt.error = String(e)
          vt.busy = false
        },
      )
  }
  vt.run = (/** @type {number} */ lo, /** @type {number} */ hi, /** @type {any[]} */ events) => {
    vt.tick0 = vt.frames
    vt.lo = lo
    vt.hi = hi
    vt.events = [...events].sort((x, y) => x[0] - y[0])
    vt.grabbed = 0
    vt.recording = true
    vt.mode = 'run'
  }
  const pump = () => {
    realRaf(pump)
    vt.pumps++
    if (vt.busy) return
    if (vt.mode === 'run' && ++vt.count % cfg.skip) return
    if (vt.mode === 'boot') vt.frames++
    else if (vt.mode === 'run') {
      if (vt.frames - vt.tick0 >= vt.hi) {
        vt.mode = 'hold'
        vt.recording = false
      } else {
        vt.frames++
        const f = vt.frames - vt.tick0
        while (vt.events.length && vt.events[0][0] <= f) {
          const ev = /** @type {[number, string, ...unknown[]]} */ (vt.events.shift())
          try {
            fire(ev)
          } catch (e) {
            console.error(e)
          }
        }
      }
    }
    const t = vnow()
    const cbs = pending
    pending = new Map()
    for (const cb of cbs.values()) {
      try {
        cb(t)
      } catch (e) {
        console.error(e)
      }
    }
    if (vt.mode === 'boot' && vt.frames >= cfg.bootFrames && cfg.hold === 'ready') {
      if (!ready || ok(() => ready(debug(), vt))) hold()
      return
    }
    if (vt.mode !== 'run') return
    const f = vt.frames - vt.tick0
    if (f <= vt.lo || f > vt.hi) return
    let st = null
    if (state) {
      try {
        st = state(debug())
      } catch (e) {
        st = { error: String(e) }
      }
    }
    send(f - vt.lo - 1, st)
  }
  realRaf(pump)
}
/* c8 ignore stop */

/**
 * The init script's source for a config.
 * @param {ClockConfig} cfg
 */
export function clockScript(cfg) {
  return `(${installClock.toString()})(${JSON.stringify(cfg)});`
}
