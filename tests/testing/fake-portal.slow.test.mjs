// @ts-check
/**
 * The fake portal in Chromium against a portal build of the fixture game, which boots the
 * runtime adapter (`runtime/portal/portal-sdk.ts`). Needs Playwright's Chromium. Nothing listens
 * on a port: Playwright answers every request.
 */
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fakePortal } from '../../src/testing/index.mjs'
import {
  headers,
  PORTAL_MODE,
  portalPrune,
  portalSdk,
  portalSiteOnly,
} from '../../src/vite/index.mjs'
import { buildFixture, cleanUp } from '../vite/build-fixture.mjs'

/** @type {import('playwright').Browser} */
let browser
/** @type {string} */
let dist

beforeAll(async () => {
  const built = await buildFixture({
    mode: PORTAL_MODE,
    base: './',
    publicDir: false,
    plugins: [
      portalSdk(),
      portalPrune({ log: false }),
      portalSiteOnly(),
      headers({ target: 'portal', frameAncestors: ['https://portal.test'] }),
    ],
  })
  dist = built.out
  browser = await launch()
})

afterAll(async () => {
  await browser?.close()
  cleanUp()
})

/**
 * Playwright's own Chromium, else an installed Chrome or Edge (a machine whose Playwright browser
 * download is for another version still runs the spec).
 */
async function launch() {
  /** @type {unknown} */
  let first = null
  for (const channel of [undefined, 'chrome', 'msedge']) {
    try {
      return await chromium.launch(channel ? { channel } : {})
    } catch (e) {
      first ??= e
    }
  }
  throw first
}

/** A fresh page, closed after `fn`. */
async function withPage(/** @type {(page: import('playwright').Page) => Promise<void>} */ fn) {
  const page = await browser.newPage()
  try {
    await fn(page)
  } finally {
    await page.close()
  }
}

/** @param {import('playwright').Frame} frame */
const ready = (frame) => frame.waitForFunction(() => /** @type {any} */ (window).__game?.ready)

describe('the fake portal', () => {
  it('serves the build in an iframe, fakes the SDK, and blocks every other host', async () => {
    await withPage(async (page) => {
      /** @type {string[]} */
      const beacons = []
      const portal = await fakePortal(page, {
        dist,
        routes: [
          {
            match: 'https://stats.example/batch',
            handle: (route) => {
              beacons.push(route.request().postData() ?? '')
              return route.fulfill({ status: 204 })
            },
          },
        ],
      })
      const game = await portal.open()
      await ready(game)
      expect(game.url()).toBe(`${portal.gameUrl}index.html`)
      expect(await portal.calls()).toEqual(['init', 'loadingStart', 'loadingStop', 'gameplayStart'])
      expect(await game.evaluate(() => /** @type {any} */ (window).__game.sdk)).toBe('crazygames')
      expect(await game.evaluate(() => /** @type {any} */ (window).__game.level)).toBe('level-one')
      expect(await game.evaluate(() => /** @type {any} */ (window).__devTool)).toBeUndefined()

      // A midgame ad: play stops, the sound mutes while it plays, then both come back.
      await game.evaluate(() => /** @type {any} */ (window).__game.ad())
      const calls = await portal.calls()
      expect(calls.slice(4)).toEqual([
        'gameplayStop',
        'requestAd:midgame',
        'adStarted',
        'adFinished',
        'gameplayStart',
      ])
      expect(await game.evaluate(() => /** @type {any} */ (window).__game.muted)).toEqual([
        true,
        false,
      ])

      expect(portal.served).toContain('index.html')
      expect(portal.missing).toEqual([])
      expect(portal.elsewhere).toEqual([])
      expect(portal.sockets).toEqual([])

      await game.evaluate(() => {
        const w = /** @type {any} */ (window)
        w.__game.reachOut()
        fetch('https://stats.example/batch', { method: 'POST', body: 'hello' })
      })
      await expect.poll(() => portal.elsewhere).toEqual(['https://elsewhere.example/beacon'])
      await expect.poll(() => portal.sockets).toEqual(['wss://relay.example/room'])
      await expect.poll(() => beacons).toEqual(['hello'])
    })
  })

  it('launches from an invite with a signed-in player, and fires a join', async () => {
    await withPage(async (page) => {
      const portal = await fakePortal(page, { dist, sdk: { invite: 'abcd', user: 'Ada' } })
      const game = await portal.open()
      await ready(game)
      const state = await game.evaluate(() => {
        const g = /** @type {any} */ (window).__game
        return { inviteRoom: g.inviteRoom, username: g.username }
      })
      expect(state).toEqual({ inviteRoom: 'ABCD', username: 'Ada' })
      await portal.joinRoom('wxyz')
      expect(await game.evaluate(() => /** @type {any} */ (window).__game.joined)).toBe('WXYZ')
      expect(await game.evaluate((c) => /** @type {any} */ (window).__game.invite(c), 'WXYZ')).toBe(
        `${portal.gameUrl}index.html?room=WXYZ`,
      )
      expect(await portal.rooms()).toEqual([
        { kind: 'update', roomId: 'WXYZ', isJoinable: false, inviteParams: { room: 'WXYZ' } },
        { kind: 'link', room: 'WXYZ' },
      ])
    })
  })

  it('plays on without the SDK when the portal page blocks its script', async () => {
    await withPage(async (page) => {
      const portal = await fakePortal(page, { dist, sdk: false })
      const game = await portal.open()
      await ready(game)
      expect(await game.evaluate(() => /** @type {any} */ (window).__game.sdk)).toBe('none')
      expect(portal.elsewhere).toEqual(['https://sdk.crazygames.com/crazygames-sdk-v3.js'])
    })
  })

  it("lets a portal on another origin frame the portal build under the build's own headers", async () => {
    await withPage(async (page) => {
      const portal = await fakePortal(page, {
        dist,
        gameOrigin: 'https://game.test',
        applyHeaders: true,
      })
      const game = await portal.open()
      await ready(game)
      expect(game.url()).toBe('https://game.test/games/game/index.html')
    })
  })

  it("refuses the frame when the build's headers do not name the portal", async () => {
    const site = await buildFixture({ publicDir: false, plugins: [headers()] })
    await withPage(async (page) => {
      const portal = await fakePortal(page, {
        dist: site.out,
        gameOrigin: 'https://game.test',
        applyHeaders: true,
      })
      await expect(portal.open()).rejects.toThrow(/no game frame/)
    })
  })
})
