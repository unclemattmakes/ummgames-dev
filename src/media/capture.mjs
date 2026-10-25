// @ts-check
/**
 * `umm-dev capture`: record shots of a game in virtual time (clock.mjs), one folder per shot:
 *
 *   f00000.jpg ...  the frames, exactly fps per second of game time, none missing
 *   <name>.mp4      libx264 at fps (shots of more than two frames)
 *   sheet.jpg       with `sheet`: a contact sheet, each tile labelled with its game frame
 *   meta.json       the shot, its URL, the frame count and the tick it held at
 *   states.jsonl    with a `state` hook: what it returned on every frame (see compare.mjs)
 *
 * A shot's times (`from`, `dur`, event `at`) are seconds of game time from tick 0, the frame
 * the clock held at once the game was ready.
 */
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { clockScript } from './clock.mjs'
import {
  ffmpeg,
  filterPath,
  frameName,
  hasBin,
  isSafeName,
  isSoftwareRenderer,
  launchChromium,
  listFrames,
  MediaError,
  pageFn,
  readJson,
  rel,
  removeInside,
  webglRenderer,
} from './util.mjs'

/**
 * The `capture` section's defaults. Nothing here names a game: a game sets its own debug
 * global, URL flags and hooks in `umm-dev.config.mjs`.
 */
export const CAPTURE_DEFAULTS = {
  /** A running dev server's origin (`http://localhost:5173`). Unset: start Vite here. */
  url: /** @type {string | null} */ (null),
  /** Vite config file for the dev server, relative to the game root. Unset: Vite's own lookup. */
  vite: /** @type {string | null} */ (null),
  /** Dev-server port. `CAPTURE_PORT` overrides it. One capture per port at a time. */
  port: 5440,
  /** Query every shot gets, after the shot's own (the shot's value wins). String or object. */
  query: /** @type {string | Record<string, string>} */ (''),
  /** Path of the page, before the query. */
  path: '/',
  /** Name of the game's debug handle on `window`, handed to page hooks as `debug`. */
  debugGlobal: /** @type {string | null} */ (null),
  /** Page function `(debug, clock) => boolean`: the game is ready to shoot. Unset: always. */
  ready: /** @type {unknown} */ (null),
  /** `ready`: hold on the first boot frame where `ready` holds. `assign`: hold the moment the
   *  game assigns `debugGlobal`, then wait (time frozen) for `ready`. */
  hold: /** @type {'ready' | 'assign'} */ ('ready'),
  /** Earliest boot frame that can become tick 0. */
  bootFrames: 60,
  /** Page function `(names, debug) => void` hiding a shot's `hide` list. Default: CSS selectors. */
  hide: /** @type {unknown} */ (null),
  /** Page function `(shot, debug) => unknown` run at tick 0, before recording, for every shot. */
  prep: /** @type {unknown} */ (null),
  /** Page function `(debug) => JSON` logged on every frame to states.jsonl. */
  state: /** @type {unknown} */ (null),
  /** Node function `(shot, { query, path }) => string`: the page URL (path and query) of a shot. */
  shotUrl: /** @type {((shot: Shot, ctx: { query: string, path: string }) => string) | null} */ (
    null
  ),
  /** Frames per second of game time. */
  fps: 60,
  /** Math.random seed; null leaves it alone. */
  seed: /** @type {number | null} */ (1),
  /** Real frames per game frame while recording. Higher is slower, never choppier. */
  skip: 2,
  /** Canvas pixels of a shot without `size`. */
  size: /** @type {[number, number]} */ ([1920, 1080]),
  /** Device pixel ratio: the window is `size / dpr` CSS px. */
  dpr: 1,
  /** `canvas` copies the canvas (WebGL, WebGPU, 2D); `page` screenshots it, DOM included. */
  grab: /** @type {'canvas' | 'page'} */ ('canvas'),
  /** The canvas to grab. */
  canvas: 'canvas',
  /** Where key events go. */
  keyTarget: /** @type {'window' | 'document' | 'canvas'} */ ('window'),
  /** JPEG quality, 0 to 1 (`png: true` on a shot for lossless). */
  quality: 0.92,
  /** x264 CRF of each shot's mp4: near-lossless, it is a source for cuts. */
  crf: 16,
  /** The shots file, relative to the game root. */
  shots: 'shots.json',
  /** Output folder, relative to the game root. */
  out: 'test-results/capture',
  /** Font file for the contact sheets' labels. Unset: fontconfig's default. */
  font: /** @type {string | null} */ (null),
  /** Chromium launch: headless, channel, extra args. No channel: the installed Chrome, then
   *  Edge, then Playwright's Chromium (which draws in software when headless). */
  browser: { headless: true, channel: /** @type {string | undefined} */ (undefined), args: [] },
  /** Seconds to wait for the game to be ready. */
  bootTimeout: 180,
}

/** @typedef {typeof CAPTURE_DEFAULTS & { root: string }} CaptureConfig */

/**
 * @typedef {object} Shot
 * @property {string} name
 * @property {string} [query]        extra URL flags; they win over the config's `query`
 * @property {number} [from]         seconds of game time where recording starts (default 0)
 * @property {number} dur            seconds to record
 * @property {[number, string, number][]} [keys]     [atSec, KeyboardEvent.code, holdSec]
 * @property {[number, string][]} [run]              [atSec, JS] run on that exact frame
 * @property {[number, string, number, number][]} [pointer]  [atSec, pointerdown|pointermove|pointerup, x, y]
 * @property {string[]} [hide]       handed to the hide hook
 * @property {string} [prep]         JS run at tick 0, after the config's prep
 * @property {string} [expect]       JS checked on the last frame; false fails the run
 * @property {string} [why]          what the frame is for, printed when `expect` fails
 * @property {number} [skip]
 * @property {[number, number]} [size]
 * @property {boolean} [png]
 */

/** Keys of `query` parts in order; the first value of a key wins. @param {...(string | Record<string, string> | null | undefined)} parts */
export function mergeQuery(...parts) {
  /** @type {Map<string, string>} */
  const out = new Map()
  for (const p of parts) {
    if (!p) continue
    const entries =
      typeof p === 'string'
        ? [...new URLSearchParams(p.replace(/^[?&]/, '')).entries()]
        : Object.entries(p).map(([k, v]) => [k, String(v)])
    for (const [k, v] of entries) if (!out.has(k)) out.set(k, v)
  }
  return new URLSearchParams([...out]).toString()
}

/**
 * The page URL (path + query) of a shot.
 * @param {Shot} shot
 * @param {Pick<CaptureConfig, 'query' | 'path' | 'shotUrl'>} cfg
 */
export function shotUrl(shot, cfg) {
  if (cfg.shotUrl) {
    return cfg.shotUrl(shot, { query: mergeQuery(cfg.query), path: cfg.path })
  }
  const q = mergeQuery(shot.query, cfg.query)
  return `${cfg.path}${q ? `?${q}` : ''}`
}

/**
 * A shot's scheduled events in game frames from tick 0: [frame, type, ...args].
 * @param {Shot} shot
 * @param {number} fps
 * @returns {[number, string, ...unknown[]][]}
 */
export function shotEvents(shot, fps) {
  const at = (/** @type {number} */ s) => Math.round(s * fps)
  /** @type {[number, string, ...unknown[]][]} */
  const ev = []
  for (const [t, code, hold] of shot.keys ?? []) {
    ev.push([at(t), 'keydown', code])
    // A tap shorter than a frame still lasts one.
    ev.push([Math.max(at(t) + 1, at(t + hold)), 'keyup', code])
  }
  for (const [t, js] of shot.run ?? []) ev.push([at(t), 'run', js])
  for (const [t, type, x, y] of shot.pointer ?? []) ev.push([at(t), 'pointer', type, x, y])
  return ev.sort((a, b) => a[0] - b[0])
}

/**
 * Problems with a shots file's entries, as messages.
 * @param {unknown} shots
 * @returns {string[]}
 */
export function validateShots(shots) {
  if (!Array.isArray(shots)) return ['the shots file must be a JSON array of shots']
  /** @type {string[]} */
  const errs = []
  const seen = new Set()
  shots.forEach((s, i) => {
    const at = `shot ${i}${s?.name ? ` (${s.name})` : ''}`
    if (!isSafeName(s?.name))
      errs.push(
        `${at}: "name" must be a folder-safe string (letters, digits, . _ @ -; not only dots)`,
      )
    else if (seen.has(s.name)) errs.push(`${at}: the name is used twice`)
    seen.add(s?.name)
    if (!(typeof s?.dur === 'number' && s.dur > 0)) errs.push(`${at}: "dur" must be seconds > 0`)
    if (s?.from != null && !(typeof s.from === 'number' && s.from >= 0))
      errs.push(`${at}: "from" must be seconds >= 0`)
    if (s?.size != null && !isSize(s.size)) errs.push(`${at}: "size" must be [w, h] in px`)
    for (const k of /** @type {const} */ (['keys', 'run', 'pointer']))
      if (s?.[k] != null && !Array.isArray(s[k])) errs.push(`${at}: "${k}" must be an array`)
  })
  return errs
}

/** @param {unknown} v */
const isSize = (v) =>
  Array.isArray(v) && v.length === 2 && v.every((n) => Number.isInteger(n) && n > 0)

/** @param {string} file */
export function loadShots(file) {
  if (!fs.existsSync(file))
    throw new MediaError(
      `no shots file ${file}: write one (docs/media.md, Shots), or set capture.shots or --file`,
    )
  const shots = readJson(file)
  const errs = validateShots(shots)
  if (errs.length) throw new MediaError(`${file}:\n  ${errs.join('\n  ')}`)
  return /** @type {Shot[]} */ (shots)
}

/** Does anything answer on `port` at the loopback? Another capture, most likely. @param {number} port */
export function portBusy(port) {
  return Promise.all(
    ['127.0.0.1', '::1'].map(
      (host) =>
        new Promise((done) => {
          const c = net.connect({ port, host })
          c.setTimeout(500)
          c.once('connect', () => {
            c.destroy()
            done(true)
          })
          c.once('timeout', () => {
            c.destroy()
            done(false)
          })
          c.once('error', () => done(false))
        }),
    ),
  ).then((r) => r.includes(true))
}

/**
 * The capture's dev server: the game's own Vite on `port`, or the configured `url`.
 * @param {CaptureConfig} cfg
 * @returns {Promise<{ origin: string, close: () => Promise<void> }>}
 */
export async function startServer(cfg) {
  if (cfg.url) return { origin: cfg.url.replace(/\/$/, ''), close: async () => {} }
  const port = Number(process.env.CAPTURE_PORT ?? cfg.port)
  if (await portBusy(port)) {
    throw new MediaError(
      [
        `port ${port} is in use: another capture is probably running on this machine.`,
        'Captures share the GPU and the port, so run one at a time: wait for it to finish, or',
        'pick a free port with CAPTURE_PORT=<n> (or `capture.port` in umm-dev.config.mjs).',
      ].join('\n'),
    )
  }
  /** @type {typeof import('vite')} */
  let vite
  try {
    vite = await import('vite')
  } catch {
    throw new MediaError('capture starts the game with Vite: add vite to the devDependencies')
  }
  const server = await vite.createServer({
    root: cfg.root,
    configFile: cfg.vite ? path.resolve(cfg.root, cfg.vite) : undefined,
    server: { port, strictPort: true, host: 'localhost' },
    logLevel: 'error',
  })
  await server.listen()
  return { origin: `http://localhost:${port}`, close: () => server.close() }
}

/** @param {{ headless?: boolean, channel?: string, args?: string[] }} b @param {boolean} igpu */
export function launchOptions(b, igpu) {
  return {
    headless: b.headless ?? true,
    channel: b.channel,
    args: [
      '--window-position=0,0',
      // A covered window stops getting frames, and the virtual clock stalls with it.
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      ...(b.args ?? []),
      ...(igpu ? ['--force_low_power_gpu', '--use-webgpu-power-preference=force-low-power'] : []),
    ],
  }
}

/**
 * The default hide hook: each name is a CSS selector, hidden for the shot.
 * @param {string[]} names
 */
/* c8 ignore next 6 */
function hideSelectors(names) {
  if (!names.length) return
  const style = document.createElement('style')
  style.textContent = `${names.join(',')}{display:none!important}`
  document.head.append(style)
}

/**
 * Encode a capture folder's frames to `<name>.mp4`.
 * @param {string} dir @param {string} name @param {string} ext @param {number} fps @param {number} crf
 */
export function encodeFrames(dir, name, ext, fps, crf) {
  const mp4 = path.join(dir, `${name}.mp4`)
  ffmpeg([
    ...['-framerate', String(fps), '-i', path.join(dir, `f%05d.${ext}`)],
    // yuv420p needs even sides.
    ...[
      '-vf',
      'scale=trunc(iw/2)*2:trunc(ih/2)*2:out_range=tv',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
    ],
    ...['-crf', String(crf), '-r', String(fps), '-movflags', '+faststart', mp4],
  ])
  return mp4
}

/**
 * A contact sheet of a capture folder: a tile every `every` s, labelled with its game frame.
 * @param {{ dir: string, ext: string, count: number, from: number, fps: number, every: number, crop?: string | null, font?: string | null, cols?: number }} o
 */
export function makeSheet(o) {
  const step = Math.max(1, Math.round(o.every * o.fps))
  const tiles = Math.ceil(o.count / step)
  const cols = Math.min(o.cols ?? 6, tiles)
  const rows = Math.ceil(tiles / cols)
  const font = o.font ? `fontfile='${filterPath(o.font)}':` : ''
  const first = Math.round(o.from * o.fps)
  const vf = [
    `select='not(mod(n,${step}))'`,
    ...(o.crop ? [`crop=${o.crop}`] : []),
    `scale=${o.crop ? 480 : 320}:-2`,
    // Selected frames renumber from 0; label each with its game frame from tick 0.
    `drawtext=${font}text='f%{eif\\:n*${step}+${first + 1}\\:d}':x=6:y=6:fontsize=20:fontcolor=yellow:box=1:boxcolor=black@0.6`,
    `tile=${cols}x${rows}`,
  ].join(',')
  const out = path.join(o.dir, 'sheet.jpg')
  ffmpeg([
    ...['-framerate', String(o.fps), '-i', path.join(o.dir, `f%05d.${o.ext}`)],
    ...['-vf', vf, '-fps_mode', 'vfr', '-frames:v', '1', '-q:v', '3', out],
  ])
  return out
}

/**
 * @typedef {object} CaptureRun
 * @property {CaptureConfig} cfg
 * @property {Shot[]} shots
 * @property {string} out                  absolute output folder
 * @property {{ every: number, crop: string | null } | null} [sheet]
 * @property {boolean} [igpu]
 * @property {string} [tag]                suffix for the shot folders (`name@tag`), to compare runs
 * @property {(line: string) => void} [log]
 */

/**
 * Capture every shot. Resolves to the shots that failed (an unmet `expect`, a missing frame).
 * @param {CaptureRun} run
 * @returns {Promise<{ name: string, dir: string, frames: number, ok: boolean, problems: string[] }[]>}
 */
export async function captureShots(run) {
  const { cfg, shots } = run
  if (run.tag != null && !isSafeName(run.tag))
    throw new MediaError(
      `--tag must be a folder-safe name (letters, digits, . _ @ -; not only dots), got "${run.tag}"`,
    )
  const log = run.log ?? console.log
  if (!hasBin('ffmpeg')) throw new MediaError('capture needs ffmpeg on PATH to encode its shots')
  /** @type {typeof import('playwright')} */
  let pw
  try {
    pw = await import('playwright')
  } catch {
    throw new MediaError(
      'capture drives Chromium through Playwright: add playwright to the devDependencies and run `pnpm exec playwright install chromium`',
    )
  }
  const hooks = {
    ready: pageFn(cfg.ready, 'capture.ready'),
    hide: pageFn(cfg.hide, 'capture.hide') ?? hideSelectors.toString(),
    prep: pageFn(cfg.prep, 'capture.prep'),
    state: pageFn(cfg.state, 'capture.state'),
  }
  const server = await startServer(cfg)
  /** @type {import('playwright').Browser} */
  let browser
  try {
    browser = await launchChromium(pw, launchOptions(cfg.browser, Boolean(run.igpu)), log)
  } catch (e) {
    await server.close()
    throw e
  }
  const results = []
  let checkedGpu = false
  try {
    for (const shot of shots) results.push(await captureOne(shot))
  } finally {
    await browser.close()
    await server.close()
  }
  return results

  /** @param {Shot} shot */
  async function captureOne(shot) {
    const name = `${shot.name}${run.tag ? `@${run.tag}` : ''}`
    const dir = path.join(run.out, name)
    removeInside(dir, run.out)
    fs.mkdirSync(dir, { recursive: true })
    const fps = cfg.fps
    const from = shot.from ?? 0
    const lo = Math.round(from * fps)
    const hi = Math.round((from + shot.dur) * fps)
    const count = hi - lo
    const ext = shot.png ? 'png' : 'jpg'
    const [cw, ch] = shot.size ?? cfg.size
    const viewport = { width: Math.round(cw / cfg.dpr), height: Math.round(ch / cfg.dpr) }
    const page = await browser.newPage({
      viewport,
      deviceScaleFactor: cfg.dpr,
      // The hooks arrive as source text; a strict CSP must not refuse them.
      bypassCSP: true,
    })
    /** @type {string[]} */
    const problems = []
    page.on('pageerror', (e) => log(`[${name}] ${e.message}`))
    page.on('console', (m) => {
      if (m.type() === 'error') log(`[${name}] ${m.text()}`)
    })
    /** @type {string[]} */
    const states = []
    let written = 0
    const binding = '__ummCaptureFrame'
    await page.exposeBinding(binding, async (_src, n, b64, st) => {
      const file = path.join(dir, frameName(n, ext))
      if (b64) fs.writeFileSync(file, Buffer.from(b64, 'base64'))
      else
        await page.screenshot({
          path: file,
          type: shot.png ? 'png' : 'jpeg',
          ...(shot.png ? {} : { quality: Math.round(cfg.quality * 100) }),
          clip: { x: 0, y: 0, ...viewport },
          caret: 'hide',
          animations: 'disabled',
        })
      if (hooks.state) states[n] = JSON.stringify({ n, ...(st ?? {}) })
      written = Math.max(written, n + 1)
    })
    await page.addInitScript(
      clockScript({
        fps,
        seed: cfg.seed,
        skip: shot.skip ?? cfg.skip,
        bootFrames: cfg.bootFrames,
        debugGlobal: cfg.debugGlobal,
        hold: cfg.hold,
        ready: cfg.hold === 'ready' ? hooks.ready : null,
        state: hooks.state,
        keyTarget: cfg.keyTarget,
        canvas: cfg.canvas,
        grab: cfg.grab,
        format: shot.png ? 'png' : 'jpeg',
        quality: cfg.quality,
        binding,
      }),
    )
    const url = `${server.origin}${shotUrl(shot, cfg)}`
    log(`[${name}] ${url}`)
    await page.goto(url)
    if (!checkedGpu) {
      checkedGpu = true
      const renderer = await webglRenderer(page)
      if (isSoftwareRenderer(renderer))
        log(
          `warning: WebGL draws in software here (${renderer}), so capture will be slow. Install Chrome, or set capture.browser.channel to a browser that uses the GPU.`,
        )
    }
    const clock = () =>
      page.evaluate(() => {
        const v = /** @type {any} */ (window).__ummClock
        return v
          ? {
              mode: String(v.mode),
              frames: Number(v.frames),
              heldAt: Number(v.heldAt),
              grabbed: Number(v.grabbed),
              busy: Boolean(v.busy),
              error: v.error ? String(v.error) : null,
            }
          : null
      })
    const ticker = setInterval(() => {
      clock().then(
        (v) => v && log(`[${name}] clock ${v.mode} frame ${v.frames}, ${v.grabbed}/${count}`),
        () => {},
      )
    }, 10_000)
    try {
      await page
        .waitForFunction(() => /** @type {any} */ (window).__ummClock?.mode === 'hold', null, {
          timeout: cfg.bootTimeout * 1000,
          polling: 100,
        })
        .catch(() => {
          throw new MediaError(
            `[${name}] the game never became ready in ${cfg.bootTimeout} s: check capture.ready${cfg.hold === 'assign' ? ` and that the game assigns window.${cfg.debugGlobal}` : ''}`,
          )
        })
      if (cfg.hold === 'assign' && hooks.ready) {
        await page
          .waitForFunction(
            ([src, g]) => {
              const f = new Function(`return (${src})`)()
              const w = /** @type {any} */ (window)
              try {
                return Boolean(f(g ? w[g] : undefined, w.__ummClock))
              } catch {
                return false
              }
            },
            [hooks.ready, cfg.debugGlobal],
            { timeout: cfg.bootTimeout * 1000, polling: 100 },
          )
          .catch(() => {
            throw new MediaError(`[${name}] capture.ready never held after the hold`)
          })
      }
      // Shot setup, all at frozen time: tick 0.
      const setup = await page.evaluate(
        ([hideSrc, prepSrc, s, g]) => {
          const w = /** @type {any} */ (window)
          const debug = g ? w[g] : undefined
          const compile = (/** @type {string} */ src) => new Function(`return (${src})`)()
          const out = []
          if (s.hide?.length) compile(String(hideSrc))(s.hide, debug)
          if (prepSrc) out.push(compile(prepSrc)(s, debug))
          if (s.prep) {
            // An expression, or failing that, statements.
            let f
            try {
              f = new Function('debug', `return (${s.prep})`)
            } catch {
              f = new Function('debug', s.prep)
            }
            out.push(f(debug))
          }
          return JSON.stringify(out)
        },
        /** @type {const} */ ([hooks.hide, hooks.prep, shot, cfg.debugGlobal]),
      )
      if (setup !== '[]' && setup !== '[null]') log(`[${name}] prep: ${setup}`)
      await page.evaluate(
        ([l, h, ev]) => /** @type {any} */ (window).__ummClock.run(l, h, ev),
        [lo, hi, shotEvents(shot, fps)],
      )
      await page.waitForFunction(
        (n) => {
          const v = /** @type {any} */ (window).__ummClock
          return v.error || (v.mode === 'hold' && !v.busy && v.grabbed >= n)
        },
        count,
        { timeout: 0, polling: 50 },
      )
      const v = await clock()
      if (v?.error) problems.push(`the clock stopped: ${v.error}`)
      // The recipe's check, on the last frame: the clock is holding it.
      if (shot.expect) {
        const ok = await page
          .evaluate(
            ([e, g]) => {
              const w = /** @type {any} */ (window)
              return Boolean(new Function('debug', `return (${e})`)(g ? w[g] : undefined))
            },
            [shot.expect, cfg.debugGlobal],
          )
          .catch((e) => `error: ${e instanceof Error ? e.message : e}`)
        if (ok !== true) {
          problems.push(`expect ${ok === false ? 'false' : ok}: ${shot.expect}`)
          if (shot.why) problems.push(`the frame is for: ${shot.why}`)
        }
      }
      const held = v?.heldAt ?? null
      const frames = listFrames(dir).length
      const missing = Array.from({ length: count }, (_, i) => i).filter(
        (i) => !fs.existsSync(path.join(dir, frameName(i, ext))),
      )
      if (missing.length) problems.push(`${missing.length} of ${count} frames missing`)
      if (hooks.state) fs.writeFileSync(path.join(dir, 'states.jsonl'), `${states.join('\n')}\n`)
      fs.writeFileSync(
        path.join(dir, 'meta.json'),
        `${JSON.stringify({ shot, url, fps, size: [cw, ch], frames, expected: count, missing: missing.length, written, heldAtBootFrame: held, seed: cfg.seed }, null, 2)}\n`,
      )
      log(`[${name}] ${frames} frames, ${missing.length} missing`)
      if (!missing.length && frames > 2)
        log(`  ${rel(cfg.root, encodeFrames(dir, name, ext, fps, cfg.crf))}`)
      if (run.sheet && frames)
        log(
          `  ${rel(cfg.root, makeSheet({ dir, ext, count: frames, from, fps, every: run.sheet.every, crop: run.sheet.crop, font: cfg.font }))}`,
        )
      for (const p of problems) log(`[${name}] ${p}`)
      return { name, dir, frames, ok: problems.length === 0 && frames > 0, problems }
    } finally {
      clearInterval(ticker)
      await page.close()
    }
  }
}
