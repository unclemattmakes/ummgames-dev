// @ts-check
/**
 * The public entry points by their package names, so tsc checks the hand-written `.d.ts` files
 * against real Playwright types and Vite's resolver finds them through `exports`.
 */
import * as testing from '@ummgames/dev/testing'
import * as vite from '@ummgames/dev/vite'
import { describe, expect, it } from 'vitest'

/**
 * Never called: it only has to typecheck. A Playwright `Page` fits `fakePortal`, and `open()`
 * gives back Playwright's own `Frame`.
 * @param {import('playwright').Page} page
 * @returns {Promise<import('playwright').Frame>}
 */
async function _typesOnly(page) {
  const portal = await testing.fakePortal(page, { sdk: { invite: 'ABCD' } })
  /** @type {string[]} */
  const calls = await portal.calls()
  void calls
  /** @type {import('vite').Plugin[]} */
  const plugins = [
    vite.portalSdk(),
    vite.portalPrune(),
    vite.portalSiteOnly(),
    vite.portalAssets({ paths: ['a.glb'] }),
    vite.headers({ target: 'portal' }),
    vite.notFoundPage(),
    vite.licences({ page: 'licences.html' }),
    vite.appIcon({ svg: 'icon.svg', shareCard: true }),
  ]
  void plugins
  return portal.open()
}
void _typesOnly

describe('the package entry points', () => {
  it('export what their .d.ts files declare', () => {
    for (const name of ['fakePortal', 'fakeSdkScript', 'headersFor', 'PORTAL_HOST']) {
      expect(testing).toHaveProperty(name)
    }
    for (const name of [
      'portalSdk',
      'portalPrune',
      'portalSiteOnly',
      'portalAssets',
      'headers',
      'securityHeaders',
      'notFoundPage',
      'licences',
      'appIcon',
      'PORTAL_MODE',
    ]) {
      expect(vite).toHaveProperty(name)
    }
    expect(testing.CRAZYGAMES_SDK_URL).toBe(vite.CRAZYGAMES_SDK_URL)
  })
})
