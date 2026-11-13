// @ts-check
/**
 * `runPortalCheck` in Chrome against a portal build of the fixture game: a clean build passes
 * both default runs, and a play step that reaches out fails it the ways a portal would. Drawn in
 * software (`cpu`), so it needs no GPU, but take the lease anyway: it starts a browser.
 */
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runPortalCheck } from '../../src/testing/index.mjs'
import {
  NO_SELECT_CSS,
  PORTAL_MODE,
  portalCheck,
  portalNoSelect,
  portalPrune,
  portalSdk,
  portalSiteOnly,
} from '../../src/vite/index.mjs'
import { buildFixture, cleanUp, REPO, tempDir } from '../vite/build-fixture.mjs'

/** @type {string} */
let dist

beforeAll(async () => {
  const built = await buildFixture({
    root: path.join(REPO, 'tests/vite/fixtures/portal-game'),
    mode: PORTAL_MODE,
    base: './',
    publicDir: false,
    plugins: [
      portalSdk(),
      portalNoSelect(),
      portalPrune({ log: false }),
      portalSiteOnly(),
      portalCheck({ log: false }),
    ],
  })
  dist = built.out
})

afterAll(cleanUp)

const ready = () => /** @type {any} */ (window).__game?.ready === true

describe('runPortalCheck', () => {
  it('passes a clean build in both default runs, with stills and a report', async () => {
    const out = tempDir()
    /** @type {string[]} */
    const lines = []
    /** @type {string[]} */
    const selects = []
    const result = await runPortalCheck({
      dir: dist,
      out,
      cpu: true,
      ready,
      settleMs: 100,
      forbidden: ['DEV_TOOL_MARKER'],
      async play({ game, still, ok }) {
        selects.push(await game().evaluate(() => getComputedStyle(document.body).userSelect))
        await still('played')
        ok('the fixture played')
      },
      log: (l) => lines.push(l),
    })
    expect(result.problems).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.runs.map((r) => r.name)).toEqual(['desktop', 'nosdk'])
    const [desk, nosdk] = result.runs
    expect(desk?.calls.slice(0, 2)).toEqual(['init', 'loadingStart'])
    expect(desk?.calls).toContain('gameplayStart')
    expect(nosdk?.calls).toEqual([])
    expect(desk?.stills).toEqual(['desktop-01-title.png', 'desktop-02-played.png'])
    for (const r of result.runs)
      for (const s of r.stills) expect(fs.existsSync(path.join(out, s))).toBe(true)
    expect(selects).toEqual(['none', 'none'])
    expect(fs.readFileSync(path.join(dist, 'index.html'), 'utf8')).toContain(NO_SELECT_CSS)
    expect(JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8')).ok).toBe(true)
    expect(lines).toContain('  ok   none of DEV_TOOL_MARKER in the code')
    expect(lines.at(-1)).toMatch(/^portal check: ok/)
  })

  it('fails a build that reaches out, loads too slowly, or holds a forbidden word', async () => {
    const result = await runPortalCheck({
      dir: dist,
      out: tempDir(),
      cpu: true,
      ready,
      settleMs: 100,
      only: ['desktop'],
      loadLimitMs: 0,
      forbidden: ['elsewhere.example'],
      async play({ game, page, fail }) {
        await game().evaluate(() => /** @type {any} */ (window).__game.reachOut())
        await page.waitForTimeout(500)
        fail('the fixture says so')
      },
      log: () => {},
    })
    expect(result.ok).toBe(false)
    expect(result.runs.map((r) => r.name)).toEqual(['desktop'])
    const all = result.problems.join('\n')
    expect(all).toMatch(/"elsewhere.example" is in assets\/index-[\w-]+\.js/)
    expect(all).toMatch(/desktop: loaded in \d+ ms \(limit 0\)/)
    expect(all).toContain('https://elsewhere.example/beacon')
    expect(all).toContain('wss://relay.example/room')
    expect(all).toContain('desktop: the fixture says so')
    // The blocked beacon's console line is reported once, as another host, not as an error too.
    expect(all).not.toContain('ERR_BLOCKED_BY_CLIENT')
  })
})
