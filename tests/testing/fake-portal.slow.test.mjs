// @ts-check
/**
 * The fake portal in Chromium against a portal build of the fixture game, which boots the
 * runtime adapter (`runtime/portal/portal-sdk.ts`). Needs Playwright's Chromium. Nothing listens
 * on a port: Playwright answers every request.
 */

import path from 'node:path'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fakePortal } from '../../src/testing/index.mjs'
import {
  PORTAL_MODE,
  portalCheck,
  portalPrune,
  portalSdk,
  portalSiteOnly,
} from '../../src/vite/index.mjs'
import { buildFixture, cleanUp, REPO } from '../vite/build-fixture.mjs'

/** @type {import('playwright').Browser} */
let browser
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
      portalPrune({ log: false }),
      portalSiteOnly(),
      portalCheck({ log: false }),
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
      expect(await portal.calls()).toEqual([
        'init',
        'loadingStart',
        'progress:50',
        'loadingStop',
        'gameplayStart',
      ])
      expect(await game.evaluate(() => /** @type {any} */ (window).__game.sdk)).toBe('crazygames')
      expect(await game.evaluate(() => /** @type {any} */ (window).__game.level)).toBe('level-one')
      expect(await game.evaluate(() => /** @type {any} */ (window).__devTool)).toBeUndefined()

      // A midgame ad: play stops, the sound mutes while it plays, then both come back.
      await game.evaluate(() => /** @type {any} */ (window).__game.ad())
      const calls = await portal.calls()
      expect(calls.slice(5)).toEqual([
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

  it('serves the game from another origin than the portal page', async () => {
    await withPage(async (page) => {
      const portal = await fakePortal(page, { dist, gameOrigin: 'https://game.test' })
      const game = await portal.open()
      await ready(game)
      expect(game.url()).toBe('https://game.test/games/game/index.html')
      expect(portal.elsewhere).toEqual([])
    })
  })

  it('mutes on the muteAudio setting, saves through SDK.data and pays a rewarded ad', async () => {
    await withPage(async (page) => {
      const portal = await fakePortal(page, {
        dist,
        sdk: {
          device: 'mobile',
          settings: { disableChat: true },
          ad: { startMs: 20, lengthMs: 50 },
        },
      })
      const game = await portal.open()
      await ready(game)
      const g = () => game.evaluate(() => /** @type {any} */ (window).__game)
      expect((await g()).device).toBe('mobile')
      expect(await game.evaluate(() => /** @type {any} */ (window).__game.chat())).toBe(false)
      await portal.setSettings({ muteAudio: true })
      await portal.setSettings({ muteAudio: false })
      expect((await g()).muted).toEqual([true, false])
      await game.evaluate(() => /** @type {any} */ (window).__game.save('day 2'))
      expect(await portal.data()).toEqual({ save: 'day 2' })
      expect(await game.evaluate(() => /** @type {any} */ (window).__game.load())).toBe('day 2')
      expect(await game.evaluate(() => /** @type {any} */ (window).__game.reward())).toBe(true)
    })
  })
})
