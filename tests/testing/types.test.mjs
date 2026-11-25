// @ts-check
/**
 * The public entry points by their package names, so tsc checks the hand-written `.d.ts` files
 * against real Vite and Playwright types, and Vite's resolver finds them through `exports`.
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
  const portal = await testing.fakePortal(page, { sdk: { invite: 'ABCD', device: 'mobile' } })
  /** @type {string[]} */
  const calls = await portal.calls()
  /** @type {Record<string, string>} */
  const data = await portal.data()
  void calls
  void data
  /** @type {import('@ummgames/dev/vite').PortalReport} */
  const report = vite.checkPortalBuild('dist-portal', { limits: false })
  void report
  /** @type {string[]} */
  const kept = vite.publicFiles('public', { exclude: ['dev/'] })
  void kept
  /** @type {import('vite').Plugin[]} */
  const plugins = [
    vite.portalSdk(),
    vite.portalPrune(),
    vite.portalSiteOnly(),
    vite.portalAssets({ paths: ['a.glb'] }),
    vite.portalCheck({ limits: vite.CRAZYGAMES_LIMITS }),
    vite.headers({ immutableAssets: true }),
    vite.notFoundPage(),
    vite.licences({ page: 'licences.html' }),
    vite.appIcon({ svg: 'icon.svg', shareCard: true }),
  ]
  void plugins
  /** @type {Record<string, string>} */
  const h = testing.headersFor('dist', '/')
  void h
  return portal.open()
}
void _typesOnly

/**
 * Never called: a Playwright `Page` fits the perf helpers.
 * @param {import('playwright').Page} page
 */
async function _perfTypesOnly(page) {
  await testing.throttleCpu(page, testing.PERF_DEVICES.phone.cpu)
  const m = await testing.measureFrames(page, { url: '/', read: ['gpu'], profileMs: 100 })
  /** @type {number} */
  const p95 = m.stats.p95Ms
  /** @type {number} */
  const ms = await testing.coldLoad(page, '/', { network: testing.NETWORKS.slow4g })
  void [p95, ms, testing.formatFrames(m.stats)]
  if (m.profile) void testing.formatTop(testing.selfTime(m.profile), 5)
}
void _perfTypesOnly

describe('the package entry points', () => {
  it('export what their .d.ts files declare', () => {
    for (const name of [
      'headersFor',
      'fakePortal',
      'fakeSdkScript',
      'PORTAL_HOST',
      'measureFrames',
      'coldLoad',
      'cpuProfile',
      'throttleCpu',
      'throttleNetwork',
      'waitForFrames',
      'readPerfHandle',
      'formatFrames',
      'selfTime',
      'formatTop',
      'PERF_DEVICES',
      'NETWORKS',
    ]) {
      expect(testing).toHaveProperty(name)
    }
    for (const name of [
      'headers',
      'securityHeaders',
      'notFoundPage',
      'licences',
      'appIcon',
      'portalSdk',
      'portalPrune',
      'portalSiteOnly',
      'portalAssets',
      'portalCheck',
      'checkPortalBuild',
      'publicFiles',
      'PORTAL_MODE',
    ]) {
      expect(vite).toHaveProperty(name)
    }
    expect(testing.CRAZYGAMES_SDK_URL).toBe(vite.CRAZYGAMES_SDK_URL)
  })
})
