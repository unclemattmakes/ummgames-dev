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

  it('takes a game’s own words and timings', () => {
    const words = ['one', 'Games']
    const beats = splashBeats(words, { ...SPLASH_TIMINGS, finalTypeMs: 10, holdMs: 50 })
    expect(beats.at(-1).until - beats.at(-1).typedAt).toBe(50)
    expect(splashFrameAt(0, words, beats)).toEqual({ index: 0, letters: 1 })
  })
})
