// @ts-check
/**
 * The perf helpers in a real Chromium, on a page whose handle counts rAF frames: the CPU
 * throttle, the frame read, a CPU profile written to disk and summed, and a cold load on a
 * throttled network.
 */

import fs from 'node:fs'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launchChromium } from '../../src/media/util.mjs'
import {
  coldLoad,
  cpuProfile,
  formatFrames,
  measureFrames,
  NETWORKS,
  selfTime,
} from '../../src/testing/index.mjs'

const PAGE = `<!doctype html><body><script>
  const times = []
  let last = -1
  window.__pf = {
    frames: 0,
    stats() {
      const s = [...times].sort((a, b) => a - b)
      const at = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0
      const avg = s.reduce((a, b) => a + b, 0) / Math.max(1, s.length)
      return { fps: avg ? 1000 / avg : 0, avgMs: avg, p50Ms: at(0.5), p95Ms: at(0.95), p99Ms: at(0.99),
        minMs: s[0] ?? 0, maxMs: s.at(-1) ?? 0, count: s.length, hitchCount: s.filter((t) => t > 33.4).length }
    },
    info: () => ({ calls: 3 }),
  }
  function burn() { let x = 0; for (let i = 0; i < 2e5; i++) x += Math.sqrt(i); return x }
  function frame(now) {
    if (last >= 0) times.push(now - last)
    last = now
    burn()
    window.__pf.frames++
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
</script></body>`

/** @type {import('playwright').Browser} */
let browser
/** @type {import('node:http').Server} */
let server
let base = ''
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'umm-perf-'))

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(PAGE)
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', () => done(null)))
  const at = server.address()
  base = `http://127.0.0.1:${typeof at === 'object' && at ? at.port : 0}/`
  const pw = await import('playwright')
  browser = await launchChromium(pw, { headless: true })
})

afterAll(async () => {
  await browser?.close()
  server?.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('perf helpers in Chromium', () => {
  it('measures frames on a throttled CPU, reads extras and keeps a profile', async () => {
    const page = await browser.newPage()
    const out = path.join(tmp, 'deep/phone.cpuprofile')
    const m = await measureFrames(page, {
      url: base,
      cpu: 4,
      minFrames: 10,
      settleMs: 300,
      read: ['info', 'missing'],
      profileMs: 400,
      profileOut: out,
    })
    expect(m.stats.count).toBeGreaterThan(5)
    expect(formatFrames(m.stats)).toMatch(/^p50 [\d.]+ ms, p95 [\d.]+ ms, fps \d+, hitches \d+$/)
    expect(m.extra).toEqual({ info: { calls: 3 }, missing: null })
    const saved = JSON.parse(fs.readFileSync(out, 'utf8'))
    const { rows, totalMs } = selfTime(saved)
    expect(totalMs).toBeGreaterThan(300)
    expect(rows.some((r) => r.functionName === 'burn')).toBe(true)
    expect(m.profile?.nodes.length).toBe(saved.nodes.length)
    await page.close()
  }, 60_000)

  it('times a cold load to the first frames on a throttled network', async () => {
    const page = await browser.newPage()
    const ms = await coldLoad(page, base, { network: NETWORKS.slow4g, cpu: 2 })
    // The latency alone is 150 ms each way.
    expect(ms).toBeGreaterThan(150)
    expect(
      await page.evaluate(() => /** @type {any} */ (window).__pf.frames),
    ).toBeGreaterThanOrEqual(2)
    const profile = await cpuProfile(page, 100)
    expect(profile.nodes.length).toBeGreaterThan(0)
    await page.close()
  }, 60_000)
})
