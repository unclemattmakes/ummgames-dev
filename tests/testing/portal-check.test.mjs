// @ts-check
/**
 * The portal check's rules, without a browser: what fails a run, the code scan, Chrome's flags,
 * and the command up to the point it would start Chrome. The browser runs are in
 * portal-check.slow.test.mjs.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  CRAZYGAMES_SDK_URL,
  forbiddenHits,
  portalChromeArgs,
  runPortalCheck,
  runProblems,
} from '../../src/testing/index.mjs'

const BIN = path.resolve(import.meta.dirname, '../../bin/umm-dev.mjs')
/** @type {string[]} */
const made = []
afterAll(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true })
})
const temp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'umm-portal-check-'))
  made.push(d)
  return d
}

/** A clean run with the SDK, which each test spoils one way. */
const clean = () => ({
  loadMs: 1200,
  calls: ['init', 'loadingStart', 'progress:50', 'loadingStop', 'gameplayStart'],
  errors: /** @type {string[]} */ ([]),
  elsewhere: /** @type {string[]} */ ([]),
  missing: /** @type {string[]} */ ([]),
  sockets: /** @type {string[]} */ ([]),
})

describe('runProblems', () => {
  it('passes a clean run', () => {
    expect(runProblems(clean(), { sdk: true, played: true })).toEqual([])
  })

  it('fails each thing a portal refuses', () => {
    const seen = {
      ...clean(),
      loadMs: 25_000,
      errors: ['TypeError: x is undefined'],
      elsewhere: ['https://elsewhere.example/beacon'],
      missing: ['/games/game/assets/gone.glb'],
      sockets: ['wss://relay.example/room'],
    }
    const out = runProblems(seen, { sdk: true }).join('\n')
    expect(out).toContain('console errors:\n    TypeError: x is undefined')
    expect(out).toContain('loaded in 25000 ms (limit 20000)')
    expect(out).toContain('https://elsewhere.example/beacon')
    expect(out).toContain('/games/game/assets/gone.glb')
    expect(out).toContain('wss://relay.example/room')
  })

  it('leaves out the SDK blocked on purpose, and every blocked-request console line', () => {
    const seen = {
      ...clean(),
      calls: [],
      elsewhere: [CRAZYGAMES_SDK_URL],
      errors: ['Failed to load resource: net::ERR_BLOCKED_BY_CLIENT'],
    }
    expect(runProblems(seen, { sdk: false, played: true })).toEqual([])
    // With the SDK on, a request for its script would be served, so one in elsewhere is real.
    expect(runProblems({ ...seen, calls: clean().calls }, { sdk: true })).toEqual([
      `asked other hosts:\n    ${CRAZYGAMES_SDK_URL}`,
    ])
  })

  it('holds the SDK calls to their order', () => {
    /** @param {string[]} calls @param {object} [more] */
    const say = (calls, more = {}) => runProblems({ ...clean(), calls }, { sdk: true, ...more })
    expect(say(['loadingStart', 'init', 'loadingStop'])[0]).toMatch(/init is not first/)
    expect(say(['init', 'loadingStart'])[0]).toMatch(/no loadingStart then loadingStop/)
    expect(say(['init', 'loadingStop', 'loadingStart'])[0]).toMatch(/no loadingStart then/)
    expect(say(['init', 'loadingStart', 'gameplayStart', 'loadingStop'])[0]).toMatch(
      /gameplayStart before loadingStop/,
    )
    expect(say(['init', 'loadingStart', 'loadingStop'], { played: true })[0]).toMatch(
      /no gameplayStart after the play steps/,
    )
    expect(say(['init', 'loadingStart', 'loadingStop'])).toEqual([])
    expect(
      say(['init', 'loadingStart', 'loadingStop', 'gameplayStart', 'gameplayStart'])[0],
    ).toMatch(/gameplayStart twice in a row/)
  })

  it('fails an ad only when the build asks for none', () => {
    const calls = [...clean().calls, 'gameplayStop', 'requestAd:midgame', 'adStarted']
    expect(runProblems({ ...clean(), calls }, { sdk: true })).toEqual([])
    expect(runProblems({ ...clean(), calls }, { sdk: true, noAds: true })[0]).toMatch(
      /an ad was asked for/,
    )
  })

  it('takes an exact list of calls in place of the order rules', () => {
    const want = ['init', 'loadingStart', 'progress:50', 'loadingStop', 'gameplayStart']
    expect(runProblems(clean(), { sdk: true, calls: want })).toEqual([])
    expect(runProblems(clean(), { sdk: true, calls: want.slice(0, 4) })[0]).toMatch(
      /the SDK heard .*; wanted init, loadingStart, progress:50, loadingStop$/,
    )
  })
})

describe('forbiddenHits', () => {
  it('finds each word in the code files only, case and all', () => {
    const dir = temp()
    fs.mkdirSync(path.join(dir, 'assets'))
    fs.writeFileSync(path.join(dir, 'index.html'), '<p>Play more at my-site</p>')
    fs.writeFileSync(path.join(dir, 'assets/a.js'), 'new WebSocket(url)')
    fs.writeFileSync(path.join(dir, 'assets/b.mjs'), 'const s = "websocket"')
    fs.writeFileSync(path.join(dir, 'assets/words.json'), '"WebSocket my-site"')
    expect(forbiddenHits(dir, ['WebSocket', 'my-site', 'twitch'])).toEqual([
      { word: 'WebSocket', files: ['assets/a.js'] },
      { word: 'my-site', files: ['index.html'] },
    ])
    expect(forbiddenHits(dir, [])).toEqual([])
    expect(forbiddenHits(path.join(dir, 'none'), ['x'])).toEqual([])
  })
})

describe('portalChromeArgs', () => {
  it('asks for the GPU, through Direct3D 11 on Windows, or SwiftShader with cpu', () => {
    expect(portalChromeArgs({ platform: 'win32' })).toContain('--use-angle=d3d11')
    expect(portalChromeArgs({ platform: 'linux' })).not.toContain('--use-angle=d3d11')
    expect(portalChromeArgs({ platform: 'linux' })).toContain('--ignore-gpu-blocklist')
    const cpu = portalChromeArgs({ cpu: true, platform: 'win32' })
    expect(cpu).toContain('--use-angle=swiftshader')
    expect(cpu).not.toContain('--enable-gpu')
  })
})

describe('runPortalCheck without a build', () => {
  it('fails on a missing folder before it starts Chrome, and writes the report', async () => {
    const root = temp()
    /** @type {string[]} */
    const lines = []
    const result = await runPortalCheck({ root, log: (l) => lines.push(l) })
    expect(result.ok).toBe(false)
    expect(result.runs).toEqual([])
    expect(result.problems.join('\n')).toMatch(/dist-portal does not exist/)
    const report = JSON.parse(
      fs.readFileSync(path.join(root, 'test-results/portal-check/report.json'), 'utf8'),
    )
    expect(report.ok).toBe(false)
    expect(lines.at(-1)).toBe('portal check: FAILED (1)')
  })

  it('stops when the build command fails', async () => {
    const root = temp()
    const result = await runPortalCheck({
      root,
      build: `"${process.execPath}" -e "process.exit(3)"`,
      log: () => {},
    })
    expect(result.problems).toEqual([expect.stringMatching(/^the build failed/)])
    expect(result.files).toBeNull()
  })
})

describe('umm-dev portal', () => {
  /** @param {string[]} args @param {string} cwd */
  const cli = (args, cwd) => {
    try {
      return {
        code: 0,
        out: execFileSync(process.execPath, [BIN, ...args], {
          cwd,
          encoding: 'utf8',
          stdio: 'pipe',
        }),
      }
    } catch (e) {
      const err = /** @type {{ status: number, stdout: string, stderr: string }} */ (e)
      return { code: err.status, out: `${err.stdout}${err.stderr}` }
    }
  }

  it('reads the game config, and exits 1 on a folder that is not there', () => {
    const root = temp()
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"g","type":"module"}')
    fs.writeFileSync(
      path.join(root, 'umm-dev.config.mjs'),
      "export default { portal: { dir: 'build/portal', out: 'shots' } }\n",
    )
    const r = cli(['portal', 'check', '--no-build'], root)
    expect(r.code).toBe(1)
    expect(r.out).toContain('portal does not exist')
    expect(fs.existsSync(path.join(root, 'shots/report.json'))).toBe(true)
  })

  it('exits 2 on usage: no subcommand, an unknown option or run', () => {
    const root = temp()
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"g"}')
    expect(cli(['portal'], root).code).toBe(2)
    expect(cli(['portal', 'check', '--frames'], root).code).toBe(2)
    const r = cli(['portal', 'check', '--only', 'desktop,phone'], root)
    expect(r.code).toBe(2)
    expect(r.out).toContain('no run named phone (runs: desktop, nosdk)')
  })
})
