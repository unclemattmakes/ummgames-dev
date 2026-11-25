// @ts-check
/**
 * Perf spec helpers for Playwright: frame times read from the game's perf handle, a throttled
 * CPU, a cold load on a throttled network, and a CPU profile. See docs/perf.md.
 *
 *   test.use(PERF_DEVICES.phone.use)
 *   const { stats } = await measureFrames(page, { url: '/?stress=300', cpu: PERF_DEVICES.phone.cpu })
 *   expect(stats.p95Ms).toBeLessThan(50)
 *
 * The game installs the handle (`runtime/dev/perf-handle.ts`, or its own object of the same
 * shape): `frames`, a count that rises once a frame, and `stats()`, the perf recorder's.
 * Throttling goes through Chrome's DevTools protocol, so these work in Chromium only.
 */
import fs from 'node:fs'
import path from 'node:path'

/**
 * The two cases a perf spec measures. `use` goes to `test.use`; `cpu` is the throttle rate.
 * The phone is a mid phone held sideways: CPU at a quarter speed. The GPU stays this machine's,
 * so a phone run speaks for the CPU side only.
 */
export const PERF_DEVICES = {
  desktop: {
    name: 'desktop 1280x720',
    use: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
    cpu: 1,
  },
  phone: {
    name: 'phone 812x375 @2x, CPU 4x',
    use: { viewport: { width: 812, height: 375 }, deviceScaleFactor: 2 },
    cpu: 4,
  },
}

/** Throttled networks for a cold load. `download` and `upload` are bytes a second. */
export const NETWORKS = {
  fast4g: {
    name: 'fast 4G',
    download: (9 * 1024 * 1024) / 8,
    upload: (9 * 1024 * 1024) / 32,
    latency: 60,
  },
  slow4g: {
    name: 'slow 4G',
    download: (1.6 * 1024 * 1024) / 8,
    upload: (1.6 * 1024 * 1024) / 32,
    latency: 150,
  },
}

/** @typedef {import('playwright').Page} Page */
/** @typedef {{ name?: string, download: number, upload?: number, latency: number }} Network */

/**
 * A DevTools protocol session on the page, one per page, kept for the page's life.
 * @type {WeakMap<Page, Promise<import('playwright').CDPSession>>}
 */
const sessions = new WeakMap()
/** @param {Page} page */
function cdp(page) {
  let s = sessions.get(page)
  if (!s) {
    s = page.context().newCDPSession(page)
    sessions.set(page, s)
  }
  return s
}

/**
 * Slow the page's CPU by `rate` (4 is a quarter speed; 1 is none).
 * @param {Page} page
 * @param {number} rate
 */
export async function throttleCpu(page, rate) {
  if (!(rate >= 1)) throw new Error(`throttleCpu: rate must be 1 or more, not ${rate}`)
  await (await cdp(page)).send('Emulation.setCPUThrottlingRate', { rate })
}

/**
 * Throttle the page's network, with the cache off unless `cache` is true.
 * @param {Page} page
 * @param {Network} network
 * @param {{ cache?: boolean }} [options]
 */
export async function throttleNetwork(page, network, options = {}) {
  const s = await cdp(page)
  await s.send('Network.enable')
  await s.send('Network.setCacheDisabled', { cacheDisabled: !options.cache })
  await s.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: network.latency,
    downloadThroughput: network.download,
    uploadThroughput: network.upload ?? network.download / 4,
  })
}

/**
 * Wait until the handle has counted more than `n` frames.
 * @param {Page} page
 * @param {number} n
 * @param {{ handle?: string, timeout?: number }} [options]
 */
export async function waitForFrames(page, n, options = {}) {
  const { handle = '__pf', timeout = 45_000 } = options
  await page.waitForFunction(
    ([h, min]) => {
      const pf = /** @type {Record<string, { frames?: number } | undefined>} */ (
        /** @type {unknown} */ (window)
      )[/** @type {string} */ (h)]
      return (pf?.frames ?? 0) > /** @type {number} */ (min)
    },
    [handle, n],
    { timeout },
  )
}

/**
 * Call `method` on the handle in the page and return what it gives (null when the handle or
 * the method is missing). The result must survive structured clone: plain data.
 * @param {Page} page
 * @param {string} method
 * @param {{ handle?: string }} [options]
 * @returns {Promise<unknown>}
 */
export async function readPerfHandle(page, method, options = {}) {
  const { handle = '__pf' } = options
  return page.evaluate(
    ([h, m]) => {
      const pf = /** @type {Record<string, Record<string, unknown> | undefined>} */ (
        /** @type {unknown} */ (window)
      )[/** @type {string} */ (h)]
      const fn = pf?.[/** @type {string} */ (m)]
      return typeof fn === 'function' ? (fn.call(pf) ?? null) : null
    },
    [handle, method],
  )
}

/**
 * Record a CPU profile of the page for `ms`, and write it to `out` when given (folders made).
 * `umm-dev perf top <out>` sums it.
 * @param {Page} page
 * @param {number} ms
 * @param {string} [out]
 */
export async function cpuProfile(page, ms, out) {
  const s = await cdp(page)
  await s.send('Profiler.enable')
  await s.send('Profiler.start')
  await page.waitForTimeout(ms)
  const { profile } = await s.send('Profiler.stop')
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, JSON.stringify(profile))
  }
  return profile
}

/**
 * The perf probe: load `url` (if given), throttle the CPU, wait for `minFrames`, let the scene
 * settle, optionally profile, then read `stats()` and each method in `read` from the handle.
 * @param {Page} page
 * @param {import('./index.js').MeasureFramesOptions} [options]
 * @returns {Promise<import('./index.js').FrameMeasure>}
 */
export async function measureFrames(page, options = {}) {
  const {
    url,
    cpu = 1,
    handle = '__pf',
    minFrames = 120,
    settleMs = 8000,
    timeout = 45_000,
    read = [],
    profileMs = 0,
    profileOut,
  } = options
  if (cpu !== 1) await throttleCpu(page, cpu)
  if (url !== undefined) await page.goto(url)
  await waitForFrames(page, minFrames, { handle, timeout })
  await page.waitForTimeout(settleMs)
  const profile = profileMs > 0 ? await cpuProfile(page, profileMs, profileOut) : undefined
  const stats = /** @type {import('./index.js').PerfStatsLike | null} */ (
    await readPerfHandle(page, 'stats', { handle })
  )
  if (!stats) throw new Error(`measureFrames: window.${handle}.stats() gave nothing`)
  /** @type {Record<string, unknown>} */
  const extra = {}
  for (const m of read) extra[m] = await readPerfHandle(page, m, { handle })
  return { stats, extra, ...(profile ? { profile } : {}) }
}

/**
 * A cold load: the network throttled, the cache off, the CPU throttled, then the milliseconds
 * from navigation until the handle has counted `frames` frames.
 * @param {Page} page
 * @param {string} url
 * @param {import('./index.js').ColdLoadOptions} options
 */
export async function coldLoad(page, url, options) {
  const { network, cpu = 4, frames = 2, handle = '__pf', timeout = 60_000 } = options
  await throttleNetwork(page, network)
  if (cpu !== 1) await throttleCpu(page, cpu)
  const t0 = Date.now()
  await page.goto(url, { waitUntil: 'commit' })
  await waitForFrames(page, frames - 1, { handle, timeout })
  return Date.now() - t0
}

/**
 * One line for the log: p50, p95, fps and hitches.
 * @param {import('./index.js').PerfStatsLike} s
 */
export function formatFrames(s) {
  return `p50 ${s.p50Ms.toFixed(1)} ms, p95 ${s.p95Ms.toFixed(1)} ms, fps ${s.fps.toFixed(0)}, hitches ${s.hitchCount}`
}

export { formatTop, selfTime } from '../perf/profile.mjs'
