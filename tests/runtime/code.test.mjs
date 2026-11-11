/**
 * The runtime files' pure parts, run in node. They are TypeScript, which Vitest transforms; the
 * path is built at run time so this repo's own typecheck (NodeNext, no .ts imports) leaves them
 * to runtime/tsconfig.json.
 */
import { describe, expect, it } from 'vitest'

/** @param {string} rel @returns {Promise<any>} */
const load = (rel) =>
  import(/* @vite-ignore */ new URL(`../../runtime/${rel}`, import.meta.url).href)

describe('dev/perf-recorder', async () => {
  const { createPerfRecorder, HITCH_THRESHOLD_MS } = await load('dev/perf-recorder.ts')

  it('records deltas from the second sample on, and reports over the ring', () => {
    const r = createPerfRecorder(4)
    for (const t of [0, 10, 30, 40, 100]) r.sample(t)
    let s = r.stats()
    expect(s.count).toBe(4)
    expect([s.minMs, s.maxMs, s.p50Ms]).toEqual([10, 60, 15])
    expect(s.hitchCount).toBe(60 > HITCH_THRESHOLD_MS ? 1 : 0)
    r.sample(110) // wraps: the first 10 ms ages out
    s = r.stats()
    expect(s.count).toBe(4)
    expect(r.toCsv().split('\n')).toEqual([
      'frame_index,t_ms,dt_ms',
      '0,30,20',
      '1,40,10',
      '2,100,60',
      '3,110,10',
    ])
  })

  it('takes measured values and its own hitch threshold', () => {
    const r = createPerfRecorder(8, 5)
    for (const v of [4, 6, 8]) r.push(v)
    expect(r.stats()).toMatchObject({ count: 3, hitchCount: 2, avgMs: 6 })
    r.reset()
    expect(r.stats().count).toBe(0)
  })
})

describe('dev/fuzzy and the command bar’s ranking', async () => {
  const { fuzzyScore } = await load('dev/fuzzy.ts')
  const { filterTools } = await load('dev/command-bar.ts')

  it('matches subsequences, best first', () => {
    expect(fuzzyScore('xyz', 'perf hud')).toBeNull()
    expect(fuzzyScore('', 'anything')).toBe(0)
    const tools = [
      { id: 'a', label: 'Respawn player', group: 'Actions', kind: 'action', run() {} },
      { id: 'b', label: 'Perf HUD', group: 'Toggles', kind: 'action', run() {} },
    ]
    expect(filterTools(tools, 'perf').map((/** @type {{ id: string }} */ t) => t.id)).toEqual(['b'])
    expect(filterTools(tools, '  ')).toHaveLength(2)
  })
})

describe('dev/registry', async () => {
  const { buildUrl, urlHas, toolHasState } = await load('dev/registry.ts')

  it('rebuilds a URL, keeping the other params', () => {
    expect(buildUrl({ quality: 'low', perf: null }, 'http://x.test/?perf=1&a=2')).toBe(
      'http://x.test/?a=2&quality=low',
    )
    expect(urlHas('edit', '1', '?edit=1')).toBe(true)
    expect(urlHas('edit', undefined, '?other')).toBe(false)
    expect(toolHasState({ kind: 'param', isOn: () => true })).toBe(true)
    expect(toolHasState({ kind: 'action' })).toBe(false)
  })
})

describe('input/pad-profiles', async () => {
  const { normalizeGamepad, parseGamepadVendorProduct, selectActiveGamepad } =
    await load('input/pad-profiles.ts')
  const btn = (pressed = false) => ({ pressed, value: pressed ? 1 : 0 })

  it('reads vendor and product from either browser’s id', () => {
    expect(parseGamepadVendorProduct('Steam Controller (Vendor: 28de Product: 1302)')).toEqual({
      vendor: '28de',
      product: '1302',
    })
    expect(parseGamepadVendorProduct('28DE-1205-Steam Deck')).toEqual({
      vendor: '28de',
      product: '1205',
    })
    expect(parseGamepadVendorProduct('Xbox pad')).toBeNull()
  })

  it('remaps a raw Steam pad to standard order, and passes standard pads through', () => {
    const buttons = Array.from({ length: 24 }, (_, i) => btn(i === 3 || i === 16))
    const axes = [0.5, -0.5, 0, 0, 0, 0, 0, 0, 1, -1]
    const n = normalizeGamepad({ id: 'x (Vendor: 28de Product: 1205)', mapping: '', axes, buttons })
    expect(n.layout).toBe('steam-raw')
    expect(n.buttons[0].pressed).toBe(true) // A, from raw 3
    expect(n.buttons[12].pressed).toBe(true) // D-pad up, from raw 16
    expect(n.buttons[7]).toEqual({ pressed: true, value: 1 }) // RT, from axis 8 at full pull
    expect(n.buttons[6]).toEqual({ pressed: false, value: 0 }) // LT at rest (-1)
    expect(n.axes).toEqual([0.5, -0.5, 0, 0])

    const std = normalizeGamepad({ mapping: 'standard', axes: [0.1], buttons: [btn(true)] })
    expect(std.layout).toBe('standard')
    expect(std.buttons).toEqual([{ pressed: true, value: 1 }])
  })

  it('picks the pad used last, skipping holes and phantoms', () => {
    const a = { axes: [], buttons: [btn()], timestamp: 5 }
    const b = { axes: [], buttons: [btn()], timestamp: 9 }
    const phantom = { axes: [], buttons: [], timestamp: 99 }
    expect(selectActiveGamepad([null, a, phantom, b])).toBe(b)
    expect(selectActiveGamepad([null])).toBeNull()
  })
})

describe('input/stick', async () => {
  const { shapeStick, clampUnit, MOVE_STICK, CAMERA_STICK } = await load('input/stick.ts')
  const out = () => ({ x: Number.NaN, y: Number.NaN })

  it('reads zero inside the round dead zone, whatever the direction', () => {
    for (const [x, y] of [
      [0.17, 0],
      [0, -0.17],
      [0.12, 0.12],
      [Number.NaN, 0],
    ]) {
      expect(shapeStick(x, y, MOVE_STICK, out())).toEqual({ x: 0, y: 0 })
    }
    // A per-axis dead zone would zero x here; a round one keeps the diagonal.
    const d = shapeStick(0.15, 0.6, MOVE_STICK, out())
    expect(d.x).toBeGreaterThan(0)
    expect(d.x / d.y).toBeCloseTo(0.25, 12)
  })

  it('rescales inner..outer onto 0..1 and keeps the direction', () => {
    const mid = (MOVE_STICK.inner + MOVE_STICK.outer) / 2
    const r = shapeStick(mid * 0.6, mid * 0.8, MOVE_STICK, out())
    expect(Math.hypot(r.x, r.y)).toBeCloseTo(0.5, 12)
    expect(r.y / r.x).toBeCloseTo(0.8 / 0.6, 12)
    const full = shapeStick(1, 0, MOVE_STICK, out())
    expect(full).toEqual({ x: 1, y: 0 })
    expect(shapeStick(MOVE_STICK.outer, 0, MOVE_STICK, out()).x).toBeCloseTo(1, 12)
  })

  it('bends the middle with the curve', () => {
    const mid = (CAMERA_STICK.inner + CAMERA_STICK.outer) / 2
    expect(shapeStick(mid, 0, CAMERA_STICK, out()).x).toBeCloseTo(0.5 ** 1.6, 12)
    expect(MOVE_STICK).toEqual({ inner: 0.18, outer: 0.92, curve: 1 })
    expect(CAMERA_STICK).toEqual({ inner: 0.2, outer: 0.95, curve: 1.6 })
  })

  it('writes into the object it is given, and clamps a digital diagonal to length 1', () => {
    const o = out()
    expect(shapeStick(0.5, 0.5, MOVE_STICK, o)).toBe(o)
    const k = clampUnit({ x: 1, y: -1 })
    expect(k.x).toBeCloseTo(Math.SQRT1_2, 12)
    expect(k.y).toBeCloseTo(-Math.SQRT1_2, 12)
    expect(clampUnit({ x: 0.3, y: 0 })).toEqual({ x: 0.3, y: 0 })
  })
})

describe('input/haptics', async () => {
  const { createHaptics, padSink, phoneSink } = await load('input/haptics.ts')
  const table = {
    tick: { priority: 1, segments: [{ at: 0, ms: 40, strong: 0, weak: 0.5 }] },
    hit: { priority: 5, segments: [{ at: 0, ms: 150, strong: 0.8, weak: 0.6 }] },
    crash: {
      priority: 9,
      segments: [
        { at: 0, ms: 200, strong: 1, weak: 1 },
        { at: 200, ms: 300, strong: 0.5, weak: 0.2 },
      ],
    },
  }
  const recorder = () => {
    const out = {
      /** @type {number[][]} */ log: [],
      stops: 0,
      /** @param {number} s @param {number} w @param {number} ms */
      rumble(s, w, ms) {
        out.log.push([s, w, ms])
      },
      stop() {
        out.stops += 1
      },
    }
    return out
  }

  it('a stronger effect cuts in; a weaker one is dropped while it runs', () => {
    const h = createHaptics(table, recorder())
    expect(h.trigger('tick', 0)).toBe(true)
    expect(h.trigger('hit', 10)).toBe(true)
    expect(h.trigger('tick', 50)).toBe(false)
    expect(h.active(50)).toBe('hit')
    expect(h.trigger('tick', 400)).toBe(true)
  })

  it('plays segments on the clock, scaled by strength', () => {
    const s = recorder()
    const h = createHaptics(table, s, { strength: 0.5 })
    h.trigger('crash', 0)
    expect(s.log).toEqual([[0.5, 0.5, 200]])
    h.update(250)
    expect(s.log[1]).toEqual([0.25, 0.1, 300])
    h.update(600)
    expect(h.active(600)).toBeNull()
  })

  it('off, zero strength or held stops what runs and drops triggers', () => {
    const s = recorder()
    const h = createHaptics(table, s)
    h.trigger('hit', 0)
    h.setHeld(true)
    expect(s.stops).toBe(1)
    expect(h.trigger('hit', 10)).toBe(false)
    h.setHeld(false)
    h.setEnabled(false)
    expect(h.trigger('hit', 20)).toBe(false)
    h.setEnabled(true)
    h.setStrength(0)
    expect(h.trigger('hit', 30)).toBe(false)
  })

  it('hums under the effects, refreshed in pulses', () => {
    const s = recorder()
    const h = createHaptics(table, s)
    h.setHum(0.3)
    h.update(0)
    expect(s.log).toEqual([[0.3, 0, 140]])
    h.update(50)
    expect(s.log).toHaveLength(1)
    h.update(100)
    expect(s.log).toHaveLength(2)
    h.trigger('tick', 110)
    expect(h.active(120)).toBe('tick')
    h.update(200)
    expect(h.active(200)).toBe('hum')
  })

  it('pads get dual-rumble; a rejection or a missing pad never escapes', async () => {
    /** @type {unknown[]} */
    const calls = []
    const pad = {
      vibrationActuator: {
        /** @param {string} _t @param {unknown} p */
        playEffect: (_t, p) => {
          calls.push(p)
          return Promise.reject(new Error('no motors'))
        },
      },
    }
    padSink(() => [pad, null]).rumble(0.5, 0.25, 80)
    padSink(() => null).rumble(1, 1, 10)
    await Promise.resolve()
    expect(calls).toEqual([
      { startDelay: 0, duration: 80, weakMagnitude: 0.25, strongMagnitude: 0.5 },
    ])
  })

  it('a phone buzzes only for bursts with weight, and only while enabled', () => {
    /** @type {number[]} */
    const buzzes = []
    const nav = globalThis.navigator
    Object.defineProperty(globalThis, 'navigator', {
      value: { vibrate: (/** @type {number} */ ms) => buzzes.push(ms) },
      configurable: true,
    })
    try {
      let on = true
      const s = phoneSink(() => on)
      s.rumble(0, 0.45, 45)
      s.rumble(0.8, 0.6, 150)
      on = false
      s.rumble(1, 1, 200)
      expect(buzzes).toEqual([150])
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true })
    }
  })
})

describe('boot/dev-splash timing', async () => {
  const {
    SPLASH_WORDS,
    SPLASH_TIMINGS,
    splashBeats,
    splashFrameAt,
    splashFrameCut,
    fadeAt,
    landedAfterLoad,
  } = await load('boot/dev-splash.ts')

  it('types each word quicker than the last, and holds the last one', () => {
    const beats = splashBeats(SPLASH_WORDS)
    expect(beats).toHaveLength(SPLASH_WORDS.length)
    const last = beats.at(-1)
    expect(last.until - last.typedAt).toBe(SPLASH_TIMINGS.holdMs)
    expect(splashFrameAt(0)).toEqual({ index: 0, letters: 1 })
    expect(splashFrameAt(last.typedAt)).toEqual({
      index: SPLASH_WORDS.length - 1,
      letters: SPLASH_WORDS.at(-1).length,
    })
  })

  it('cuts to the last word when the load beats the words', () => {
    const loaded = 100
    const landed = landedAfterLoad(loaded)
    expect(landed).toBeLessThan(splashBeats(SPLASH_WORDS).at(-1).typedAt)
    expect(splashFrameCut(landed + 1, loaded)).toEqual({
      index: SPLASH_WORDS.length - 1,
      letters: SPLASH_WORDS.at(-1).length,
    })
  })

  it('fades only once loaded and steady, after a skip or the hold', () => {
    expect(fadeAt(null, null, 1000)).toBeNull()
    expect(fadeAt(500, null, 1000, null)).toBeNull()
    expect(fadeAt(500, null, 1000)).toBe(1000 + SPLASH_TIMINGS.holdMs)
    expect(fadeAt(500, 700, 1000)).toBe(700)
    expect(fadeAt(500, 700, 1000, 900)).toBe(900)
  })

  it('builds a game’s words, the same way the Vite plugin does', async () => {
    const { splashWords } = await load('boot/dev-splash.ts')
    const vite = await import('../../src/vite/index.mjs')
    expect(vite.SPLASH_WORDS).toEqual(SPLASH_WORDS)
    expect(splashWords('My Game')).toEqual([...SPLASH_WORDS.slice(0, -1), 'My Game', 'Games'])
    expect(splashWords('My Game')).toEqual(vite.splashWords('My Game'))
  })

  it('reads the words from the markup’s sizers', async () => {
    const { splashWordsIn } = await load('boot/dev-splash.ts')
    const vite = await import('../../src/vite/index.mjs')
    const html = vite.splashMarkup({ words: vite.splashWords('A & B') })
    // A stand-in for the DOM: the sizers' text as the browser decodes it.
    const texts = [...html.matchAll(/class="dev-splash__sizer">([^<]*)</g)].map((m) =>
      (m[1] ?? '').replace(/&amp;/g, '&'),
    )
    const root = { querySelectorAll: () => texts.map((t) => ({ textContent: `  ${t}\n` })) }
    expect(splashWordsIn(root)).toEqual([...SPLASH_WORDS.slice(0, -1), 'A & B', 'Games'])
    expect(splashWordsIn({ querySelectorAll: () => [] })).toEqual([])
  })

  it('calls frames steady after a quick run, or after the give-up time', async () => {
    const { createSteadyWatch, STEADY_WATCH } = await load('boot/dev-splash.ts')
    expect(STEADY_WATCH).toEqual({ frameMs: 34, frames: 20, giveUpMs: 3000 })
    const quick = createSteadyWatch()
    const run = Array.from({ length: 20 }, () => quick.step(16))
    expect(run.indexOf(true)).toBe(19)
    expect(quick.step(500)).toBe(true) // once steady, it stays so
    const broken = createSteadyWatch()
    for (let i = 0; i < 19; i++) broken.step(16)
    expect(broken.step(50)).toBe(false) // a slow frame restarts the run
    const slow = createSteadyWatch({ giveUpMs: 200 })
    expect([slow.step(100), slow.step(99), slow.step(1)]).toEqual([false, false, true])
  })

  it('takes a game’s own words and timings', () => {
    const words = ['one', 'Games']
    const beats = splashBeats(words, { ...SPLASH_TIMINGS, finalTypeMs: 10, holdMs: 50 })
    expect(beats.at(-1).until - beats.at(-1).typedAt).toBe(50)
    expect(splashFrameAt(0, words, beats)).toEqual({ index: 0, letters: 1 })
  })
})
