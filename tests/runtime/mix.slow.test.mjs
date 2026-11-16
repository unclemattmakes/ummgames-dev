// @ts-check
/**
 * runtime/audio/mix.ts in a real browser: the graph built on an OfflineAudioContext renders, the
 * duck dips by what it says, and the limiter holds the peak. The TypeScript is stripped with the
 * compiler this repo already has and run in the page as one module.
 */
import fs from 'node:fs'
import ts from 'typescript'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launchChromium } from '../../src/media/util.mjs'

const strip = (/** @type {string} */ rel) =>
  ts.transpileModule(fs.readFileSync(new URL(`../../runtime/${rel}`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
const SOURCE = `${strip('audio/pitch.ts')}\n${strip('audio/mix.ts').replace(/^import .*$/m, '')}`

/** @type {import('playwright').Browser} */
let browser
/** @type {import('playwright').Page} */
let page

beforeAll(async () => {
  const pw = await import('playwright')
  browser = await launchChromium(pw, { headless: true })
  page = await browser.newPage()
  await page.setContent('<!doctype html><body></body>')
  await page.addScriptTag({
    type: 'module',
    content: `${SOURCE}\nwindow.__mix = { createMix, dbToGain }; window.__ready = true`,
  })
  await page.waitForFunction(() => /** @type {any} */ (window).__ready)
})

afterAll(async () => {
  await browser?.close()
})

describe('audio/mix in Chromium', () => {
  it('renders offline: the duck dips the music by its depth while talk is up', async () => {
    const r = await page.evaluate(async () => {
      const { createMix } = /** @type {any} */ (window).__mix
      const ctx = new OfflineAudioContext(1, 48000 * 3, 48000)
      const mix = createMix(ctx, {
        buses: { music: -6 },
        ducked: ['music'],
        duck: { by: -10, in: 0.03, out: 0.03 },
        glue: null,
        limit: null,
      })
      const osc = ctx.createOscillator()
      osc.connect(mix.buses.music)
      osc.start(0)
      mix.talk(1, true)
      mix.talk(2, false)
      const out = (await ctx.startRendering()).getChannelData(0)
      const rms = (/** @type {number} */ a, /** @type {number} */ b) => {
        let s = 0
        for (let i = a * 48000; i < b * 48000; i++) s += out[i] * out[i]
        return 20 * Math.log10(Math.sqrt(s / ((b - a) * 48000)))
      }
      return { before: rms(0.5, 0.9), during: rms(1.5, 1.9), after: rms(2.5, 2.9) }
    })
    const sine = -6 - 3.01 // a full-scale sine's RMS is -3.01 dB
    expect(r.before).toBeCloseTo(sine, 1)
    expect(r.during).toBeCloseTo(sine - 10, 1)
    expect(r.after).toBeCloseTo(sine, 1)
  })

  it('holds a hot bus under the limiter and the master trim', async () => {
    const peak = await page.evaluate(async () => {
      const { createMix } = /** @type {any} */ (window).__mix
      const ctx = new OfflineAudioContext(2, 48000 * 2, 48000)
      const mix = createMix(ctx, {
        buses: { sfx: 12, music: 0 },
        master: -1,
        verb: { seconds: 0.5, wet: -14 },
      })
      const osc = ctx.createOscillator()
      osc.frequency.value = 220
      osc.connect(mix.buses.sfx)
      osc.connect(/** @type {ConvolverNode} */ (mix.verb))
      osc.start(0)
      const buf = await ctx.startRendering()
      let p = 0
      for (let c = 0; c < 2; c++)
        for (const x of buf.getChannelData(c).subarray(48000)) p = Math.max(p, Math.abs(x))
      return 20 * Math.log10(p)
    })
    // A +12 dB sine would peak at +12 dBFS; the glue and the limiter bring it well under 0.
    expect(peak).toBeLessThan(0)
    expect(peak).toBeGreaterThan(-12)
  })
})
