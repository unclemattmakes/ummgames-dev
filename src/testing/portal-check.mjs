// @ts-check
/**
 * The portal check: a game's portal build as a portal runs it, in Chrome, with a verdict.
 *
 * 1. Build it, if a build command is given.
 * 2. Read the folder with `checkPortalBuild` (the upload rules) and scan its code for words the
 *    portal build must not hold (a socket, the game's own site).
 * 3. Open it in the fake portal once per run (a desktop frame with the SDK, the same with the SDK
 *    blocked as an ad blocker would, a phone if asked), wait until it is loaded, shoot the title,
 *    and hand over to the game's own `play` steps.
 * 4. Fail on a console error, a request to another host, a missing file, a WebSocket dial, a
 *    load slower than the portal allows, or SDK calls out of order.
 *
 * `umm-dev portal check` runs it with the game's `portal` config; a game script can call
 * `runPortalCheck(options)` itself. See docs/portal.md.
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { launchChromium } from '../media/util.mjs'
import { CRAZYGAMES_SDK_URL, checkPortalBuild } from '../vite/portal.mjs'
import { fakePortal } from './fake-portal.mjs'

/** CrazyGames asks that a game loads within 20 s in desktop Chrome. */
export const PORTAL_LOAD_LIMIT_MS = 20_000

/** CrazyGames' smallest desktop frame for a game, at devicePixelRatio 1. */
export const CRAZYGAMES_SMALLEST_FRAME = Object.freeze({ width: 907, height: 510 })

/** The runs when a game names none: the smallest desktop frame, with the SDK and without. */
export const DEFAULT_PORTAL_RUNS = Object.freeze([
  Object.freeze({ name: 'desktop' }),
  Object.freeze({ name: 'nosdk', sdk: /** @type {false} */ (false) }),
])

/** The files the code scan reads. */
const CODE_FILE = /\.(m?js|html|css)$/i

/**
 * Chrome's flags: the real GPU (Direct3D 11 through ANGLE on Windows), or SwiftShader with
 * `cpu`, which needs no GPU lease and draws far slower. Sound may start without a gesture.
 * @param {{ cpu?: boolean, platform?: string }} [options]
 * @returns {string[]}
 */
export function portalChromeArgs({ cpu = false, platform = process.platform } = {}) {
  const sound = '--autoplay-policy=no-user-gesture-required'
  if (cpu) return ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', sound]
  const gpu = ['--enable-gpu', '--ignore-gpu-blocklist']
  return platform === 'win32' ? [...gpu, '--use-angle=d3d11', sound] : [...gpu, sound]
}

/**
 * Each forbidden word found in the build's code (`.js`, `.mjs`, `.html`, `.css`), with the files
 * holding it, relative to `dir`. Case matters. Empty when none is there.
 * @param {string} dir
 * @param {readonly string[]} words
 * @returns {{ word: string, files: string[] }[]}
 */
export function forbiddenHits(dir, words) {
  if (words.length === 0 || !fs.existsSync(dir)) return []
  const files = fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && CODE_FILE.test(d.name))
    .map((d) => path.join(d.parentPath, d.name))
    .sort()
  const texts = files.map((f) => ({
    rel: path.relative(dir, f).replace(/\\/g, '/'),
    text: fs.readFileSync(f, 'utf8'),
  }))
  return words
    .map((word) => ({ word, files: texts.filter((t) => t.text.includes(word)).map((t) => t.rel) }))
    .filter((h) => h.files.length > 0)
}

/**
 * @typedef {object} RunSeen
 * @property {number} loadMs From opening the portal page to the game's `ready`.
 * @property {string[]} calls The SDK calls, in order; empty with the SDK blocked.
 * @property {string[]} errors Console errors and uncaught exceptions.
 * @property {string[]} elsewhere Requests to other hosts, blocked.
 * @property {string[]} missing Paths with no file behind them.
 * @property {string[]} sockets WebSocket dials, closed.
 */

/**
 * @typedef {object} RunRules
 * @property {boolean} sdk Whether the run had the SDK.
 * @property {string} [sdkUrl] The SDK script's URL, blocked on purpose when `sdk` is false.
 * @property {number} [loadLimitMs] Default `PORTAL_LOAD_LIMIT_MS`.
 * @property {boolean} [played] The game's `play` steps ran, so a `gameplayStart` is due.
 * @property {boolean} [noAds] Any `requestAd` call fails the run.
 * @property {readonly string[] | null} [calls] The exact SDK calls the run must make.
 */

/**
 * What a run broke, one line each; empty when it passed. Console lines about blocked requests
 * (`ERR_BLOCKED_BY_CLIENT`) are left out: each blocked request is reported once, under other
 * hosts, and the SDK script blocked on purpose is not reported at all.
 * @param {RunSeen} seen
 * @param {RunRules} rules
 * @returns {string[]}
 */
export function runProblems(seen, rules) {
  const {
    sdk,
    sdkUrl = CRAZYGAMES_SDK_URL,
    loadLimitMs = PORTAL_LOAD_LIMIT_MS,
    played = false,
    noAds = false,
    calls: want = null,
  } = rules
  /** @type {string[]} */
  const out = []
  const errors = seen.errors.filter((e) => !e.includes('ERR_BLOCKED_BY_CLIENT'))
  if (errors.length) out.push(`console errors:\n    ${errors.join('\n    ')}`)
  if (seen.loadMs > loadLimitMs) out.push(`loaded in ${seen.loadMs} ms (limit ${loadLimitMs})`)
  const stray = seen.elsewhere.filter((u) => sdk || u !== sdkUrl)
  if (stray.length) out.push(`asked other hosts:\n    ${stray.join('\n    ')}`)
  if (seen.missing.length) out.push(`missing files:\n    ${seen.missing.join('\n    ')}`)
  if (seen.sockets.length) out.push(`dialled sockets:\n    ${seen.sockets.join('\n    ')}`)
  if (!sdk) return out
  const c = seen.calls
  const heard = `the SDK heard ${c.join(', ') || 'nothing'}`
  if (want) {
    if (JSON.stringify(c) !== JSON.stringify(want)) out.push(`${heard}; wanted ${want.join(', ')}`)
    return out
  }
  const start = c.indexOf('loadingStart')
  const stop = c.indexOf('loadingStop')
  const play = c.indexOf('gameplayStart')
  if (c[0] !== 'init') out.push(`${heard}: init is not first`)
  else if (start < 0 || stop < 0 || stop < start)
    out.push(`${heard}: no loadingStart then loadingStop`)
  else if (play >= 0 && play < stop) out.push(`${heard}: gameplayStart before loadingStop`)
  if (played && play < 0) out.push(`${heard}: no gameplayStart after the play steps`)
  const twice = c.findIndex(
    (x, i) => i > 0 && x === c[i - 1] && (x === 'gameplayStart' || x === 'gameplayStop'),
  )
  if (twice > 0) out.push(`${heard}: ${c[twice]} twice in a row`)
  if (noAds && c.some((x) => x.startsWith('requestAd')))
    out.push(`${heard}: an ad was asked for, and this build asks for none`)
  return out
}

/**
 * @typedef {import('./index.d.ts').PortalCheckRun} PortalCheckRun
 * @typedef {import('./index.d.ts').PortalCheckOptions} PortalCheckOptions
 * @typedef {import('./index.d.ts').PortalCheckResult} PortalCheckResult
 * @typedef {import('./index.d.ts').PortalRunReport} PortalRunReport
 */

/**
 * Run the whole check. Resolves with the verdict; throws only when Chrome cannot start.
 * @param {PortalCheckOptions} [options]
 * @returns {Promise<PortalCheckResult>}
 */
export async function runPortalCheck(options = {}) {
  const root = path.resolve(options.root ?? process.cwd())
  const dir = path.resolve(root, options.dir ?? 'dist-portal')
  const out = path.resolve(root, options.out ?? 'test-results/portal-check')
  const log = options.log ?? console.log
  const forbidden = options.forbidden ?? []
  const settleMs = options.settleMs ?? 1000
  const only = options.only ?? null
  const runs = (options.runs ?? DEFAULT_PORTAL_RUNS).filter((r) => !only || only.includes(r.name))
  /** @type {string[]} */
  const problems = []
  /** @param {string} why */
  const fail = (why) => {
    problems.push(why)
    log(`  FAIL ${why}`)
  }
  /** @param {string} what */
  const ok = (what) => log(`  ok   ${what}`)
  fs.mkdirSync(out, { recursive: true })

  if (options.build) {
    log(`== build: ${options.build}`)
    try {
      execSync(options.build, { cwd: root, stdio: 'inherit' })
    } catch {
      fail(`the build failed: ${options.build}`)
      return finish({ problems, files: null, runs: [], out })
    }
  }

  log('== files')
  const files = checkPortalBuild(
    dir,
    options.limits === undefined ? {} : { limits: options.limits },
  )
  const size = `${files.files} files, ${(files.bytes / 1e6).toFixed(1)} MB`
  if (files.problems.length) fail(`${size}:\n    ${files.problems.join('\n    ')}`)
  else ok(`${size}, within the limits${files.mobile ? ' and the mobile homepage size' : ''}`)
  if (!fs.existsSync(path.join(dir, 'index.html'))) {
    return finish({ problems, files, runs: [], out })
  }
  const hits = forbiddenHits(dir, forbidden)
  for (const h of hits) fail(`"${h.word}" is in ${h.files.join(', ')}`)
  if (forbidden.length && hits.length === 0) ok(`none of ${forbidden.join(' ')} in the code`)

  /** @type {typeof import('playwright')} */
  let pw
  try {
    pw = await import('playwright')
  } catch {
    throw new Error('the portal check needs Playwright: pnpm add -D playwright')
  }
  const browser = await launchChromium(
    pw,
    {
      headless: !options.headed,
      channel: options.channel,
      args: portalChromeArgs({ cpu: options.cpu }),
    },
    log,
  )
  /** @type {PortalRunReport[]} */
  const reports = []
  try {
    for (const run of runs) {
      log(`== ${run.name}`)
      const report = await oneRun(browser, run, { ...options, dir, out, settleMs, log, ok, fail })
      reports.push(report)
      for (const p of report.problems) fail(`${run.name}: ${p}`)
      if (report.problems.length === 0) ok(`${run.name}: loaded in ${report.loadMs} ms, clean`)
    }
  } finally {
    await browser.close()
  }
  return finish({ problems, files, runs: reports, out })

  /**
   * @param {{ problems: string[], files: import('../vite/index.d.ts').PortalReport | null, runs: PortalRunReport[], out: string }} r
   * @returns {PortalCheckResult}
   */
  function finish(r) {
    const result = { ok: r.problems.length === 0, ...r }
    fs.writeFileSync(path.join(r.out, 'report.json'), `${JSON.stringify(result, null, 2)}\n`)
    log(
      result.ok
        ? `portal check: ok. Stills in ${r.out}`
        : `portal check: FAILED (${r.problems.length})`,
    )
    return result
  }
}

/**
 * @param {import('playwright').Browser} browser
 * @param {PortalCheckRun} run
 * @param {PortalCheckOptions & { dir: string, out: string, settleMs: number, log: (line: string) => void, ok: (what: string) => void, fail: (why: string) => void }} o
 * @returns {Promise<PortalRunReport>}
 */
async function oneRun(browser, run, o) {
  const frame = run.frame ?? CRAZYGAMES_SMALLEST_FRAME
  const sdk = run.sdk === undefined ? {} : run.sdk
  const touch = run.touch === true
  const context = await browser.newContext({
    viewport:
      run.viewport ?? (touch ? frame : { width: frame.width + 40, height: frame.height + 40 }),
    deviceScaleFactor: run.deviceScaleFactor ?? (touch ? 2 : 1),
    ...(touch ? { isMobile: true, hasTouch: true } : {}),
  })
  if (o.hideGamepads !== false) {
    // A pad plugged into this machine reaches headless Chrome, and a pad in use moves menus.
    await context.addInitScript(() => {
      navigator.getGamepads = () => []
    })
  }
  const page = await context.newPage()
  /** @type {string[]} */
  const errors = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 300))
  })
  page.on('pageerror', (e) => errors.push(`uncaught: ${e.message}`))
  const portal = await fakePortal(page, {
    dist: o.dir,
    frame,
    sdk,
    ...(o.gamePath ? { gamePath: o.gamePath } : {}),
    ...(run.query ? { query: run.query } : {}),
  })
  /** @type {string[]} */
  const stills = []
  /** @type {string[]} */
  const problems = []
  let shot = 0
  /** @param {string} name */
  const still = async (name) => {
    shot++
    const file = path.join(o.out, `${run.name}-${String(shot).padStart(2, '0')}-${name}.png`)
    await page.locator('iframe').first().screenshot({ path: file })
    stills.push(path.relative(o.out, file).replace(/\\/g, '/'))
  }
  let loadMs = 0
  let played = false
  const started = Date.now()
  try {
    const game = await portal.open()
    const ready = o.ready ?? (() => document.readyState === 'complete')
    await game.waitForFunction(ready, null, { timeout: o.readyTimeoutMs ?? 60_000 })
    loadMs = Date.now() - started
    await page.waitForTimeout(o.settleMs)
    await still('title')
    if (o.play && run.play !== false) {
      played = true
      await o.play({
        run,
        page,
        context,
        portal,
        game: () => portal.frame(),
        still,
        ok: o.ok,
        fail: (why) => problems.push(why),
        log: o.log,
      })
    }
  } catch (e) {
    loadMs ||= Date.now() - started
    problems.push(`stopped: ${String(e instanceof Error ? e.message : e).split('\n')[0]}`)
    await still('stopped').catch(() => {})
  }
  const calls = sdk === false ? [] : await portal.calls().catch(() => [])
  const seen = {
    loadMs,
    calls,
    errors,
    elsewhere: [...portal.elsewhere],
    missing: [...portal.missing],
    sockets: [...portal.sockets],
  }
  problems.push(
    ...runProblems(seen, {
      sdk: sdk !== false,
      loadLimitMs: o.loadLimitMs,
      played,
      noAds: o.noAds,
      calls: run.calls ?? null,
    }),
  )
  await context.close()
  return { name: run.name, ...seen, served: portal.served.length, stills, problems }
}
