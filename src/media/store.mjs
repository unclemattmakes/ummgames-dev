// @ts-check
/**
 * `umm-dev store`: a portal's store kit from the game itself, end to end:
 *
 *   1. preflight  ffmpeg, the templates, the edit lists and shots are there and valid, and the
 *                 game's own `preflight` hook (its assets pulled, say) passes
 *   2. capture    every shot in `store.shots` to `<out>/capture`, contact sheets every 0.5 s;
 *                 a shot whose `expect` fails stops the kit (its `why` says what it was for)
 *   3. stills     covers, icons, a logo: Chromium renders the game's templates (stills.mjs)
 *   4. cut        each video's edit list (cut.mjs)
 *   5. review     `<out>/review/<video>-beats.jpg`: each shot's in-point frame, captioned with
 *                 its `beat`, to check the in-points still land after content changes
 *   6. check      every output against the preset (`presets/<portal>.json`), and what is missing
 *
 * The recipe is the game's: its shots, templates and edit lists, named in `umm-dev.config.mjs`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { captureShots, loadShots } from './capture.mjs'
import { cutEdl, resolveClip } from './cut.mjs'
import { EDL_DEFAULTS, validateEdl } from './edl.mjs'
import { checkKit, loadPreset } from './spec.mjs'
import { renderStill } from './stills.mjs'
import {
  ffmpeg,
  hasBin,
  launchChromium,
  MediaError,
  probe,
  readJson,
  rel,
  removeInside,
} from './util.mjs'

export const STORE_DEFAULTS = {
  /** A preset in presets/ by name, or a path to one (relative to the game root). */
  preset: 'crazygames',
  /** Output folder, relative to the game root. */
  out: 'dist-store',
  /** The kit's capture shots, relative to the game root. Unset: no capture step. */
  shots: /** @type {string | null} */ (null),
  /** Seconds between contact-sheet tiles of the kit's captures. */
  sheetEvery: 0.5,
  /** Stills to render (stills.mjs `Still`). */
  stills: /** @type {import('./stills.mjs').Still[]} */ ([]),
  /** Videos: an edit list each, and the preset asset id it is checked as (default: its stem). */
  videos: /** @type {{ edl: string, spec?: string | false }[]} */ ([]),
  /** Node function `async ({ root, store }) => string[] | void`: problems that stop the kit. */
  preflight:
    /** @type {((ctx: { root: string, store: Record<string, any> }) => Promise<string[] | undefined> | string[] | undefined) | null} */ (
      null
    ),
}

/** @typedef {typeof STORE_DEFAULTS & { root: string }} StoreConfig */

export const STEPS = /** @type {const} */ ([
  'preflight',
  'capture',
  'stills',
  'cut',
  'review',
  'check',
])
/** @typedef {typeof STEPS[number]} Step */

/** @param {StoreConfig} store */
const captureDir = (store) => path.resolve(store.root, store.out, 'capture')

/**
 * A video's edit list with the kit's defaults: clips from the kit's capture, out in the kit.
 * @param {StoreConfig} store @param {{ edl: string }} v
 * @returns {import('./edl.mjs').Edl}
 */
export function kitEdl(store, v) {
  const edl = readJson(path.resolve(store.root, v.edl))
  const stem = path.basename(v.edl, '.json')
  return {
    ...edl,
    clips: edl.clips ?? rel(store.root, captureDir(store)),
    out: edl.out ?? `${store.out}/${stem}.mp4`,
  }
}

/** @param {{ edl: string, spec?: string | false }} v */
const videoId = (v) => (v.spec === false ? null : (v.spec ?? path.basename(v.edl, '.json')))

/**
 * Problems that would stop the kit partway, found before anything runs.
 * @param {StoreConfig} store @param {Step[]} steps
 */
export async function preflight(store, steps) {
  /** @type {string[]} */
  const p = []
  for (const bin of ['ffmpeg', 'ffprobe']) if (!hasBin(bin)) p.push(`${bin} is not on PATH`)
  if (!store.stills.length && !store.videos.length)
    p.push('the store section names no stills or videos: add them to umm-dev.config.mjs')
  if (steps.includes('capture') && store.shots) {
    try {
      loadShots(path.resolve(store.root, store.shots))
    } catch (e) {
      p.push(e instanceof Error ? e.message : String(e))
    }
  }
  for (const s of store.stills)
    if (!fs.existsSync(path.resolve(store.root, s.template)))
      p.push(`still "${s.name}": no template ${s.template}`)
  for (const v of store.videos) {
    try {
      const errs = validateEdl(kitEdl(store, v))
      for (const e of errs) p.push(`${v.edl}: ${e}`)
    } catch (e) {
      p.push(e instanceof Error ? e.message : String(e))
    }
  }
  try {
    loadPreset(store.preset, store.root)
  } catch (e) {
    p.push(e instanceof Error ? e.message : String(e))
  }
  if (store.preflight) {
    const own = await store.preflight({ root: store.root, store })
    if (Array.isArray(own)) p.push(...own)
  }
  return p
}

/**
 * The review sheet of one video: each shot's in-point frame, captioned with clip, time, beat.
 * @param {StoreConfig} store @param {{ edl: string }} v @param {(l: string) => void} log
 */
export function reviewSheet(store, v, log) {
  const edl = kitEdl(store, v)
  const [W, H] = edl.size ?? EDL_DEFAULTS.size
  const clipFps = edl.clipFps ?? EDL_DEFAULTS.clipFps
  const clips = path.resolve(store.root, /** @type {string} */ (edl.clips))
  const stem = path.basename(v.edl, '.json')
  const dir = path.resolve(store.root, store.out, 'review', `.${stem}`)
  removeInside(dir, path.resolve(store.root, store.out, 'review'))
  fs.mkdirSync(dir, { recursive: true })
  const tw = W >= H ? 640 : 360
  const th = Math.round((tw * H) / W / 2) * 2
  const tiles = []
  for (const [i, s] of edl.shots.entries()) {
    const n = Math.round(s.in * clipFps)
    const frame = ['jpg', 'png']
      .map((e) => path.join(clips, s.clip, `f${String(n).padStart(5, '0')}.${e}`))
      .find((f) => fs.existsSync(f))
    /** @type {string[]} */
    let input
    if (frame) input = ['-i', frame]
    else {
      try {
        const src = resolveClip(s.clip, clips, clipFps)
        input = ['-ss', String(s.in), ...src.args]
      } catch {
        log(`  review: no frame for ${s.clip} at ${s.in} s`)
        continue
      }
    }
    // Captions are files beside the tiles: no filter escaping.
    fs.writeFileSync(path.join(dir, `beat-${i}.txt`), `${s.clip} @ ${s.in}s\n${s.beat ?? ''}`)
    const vf = [
      `scale=${tw}:${th}:force_original_aspect_ratio=increase,crop=${tw}:${th}`,
      `drawbox=y=ih-42:w=iw:h=42:color=black@0.7:t=fill`,
      `drawtext=textfile=beat-${i}.txt:x=8:y=h-38:fontsize=13:line_spacing=3:fontcolor=white`,
    ].join(',')
    ffmpeg([...input, '-frames:v', '1', '-vf', vf, `beat-${i}.jpg`], { cwd: dir })
    tiles.push(`beat-${i}.jpg`)
  }
  if (!tiles.length) return null
  const cols = W >= H ? 2 : 4
  const out = path.resolve(store.root, store.out, 'review', `${stem}-beats.jpg`)
  if (tiles.length === 1) fs.copyFileSync(path.join(dir, tiles[0]), out)
  else {
    const layout = tiles.map((_, i) => `${(i % cols) * tw}_${Math.floor(i / cols) * th}`).join('|')
    ffmpeg(
      [
        ...tiles.flatMap((t) => ['-i', t]),
        '-filter_complex',
        `${tiles.map((_, i) => `[${i}]`).join('')}xstack=inputs=${tiles.length}:layout=${layout}:fill=black`,
        out,
      ],
      { cwd: dir },
    )
  }
  removeInside(dir, path.resolve(store.root, store.out, 'review'))
  return out
}

/**
 * @param {{ store: StoreConfig, capture: import('./capture.mjs').CaptureConfig, steps: Step[], only?: string[] | null, igpu?: boolean, draft?: boolean, log?: (l: string) => void }} o
 * @returns {Promise<{ ok: boolean, report: string[] }>}
 */
export async function runStore(o) {
  const { store } = o
  const log = o.log ?? console.log
  const outDir = path.resolve(store.root, store.out)
  const has = (/** @type {Step} */ s) => o.steps.includes(s)
  /** @type {Record<string, import('./util.mjs').Probe | null>} */
  const made = {}

  if (has('preflight')) {
    log('== preflight')
    const problems = await preflight(store, o.steps)
    if (problems.length)
      throw new MediaError(`store stopped at preflight:\n  ${problems.join('\n  ')}`)
    log('  ok')
  }

  if (has('capture') && store.shots) {
    log('== capture')
    let shots = loadShots(path.resolve(store.root, store.shots))
    if (o.only?.length) {
      const unknown = o.only.filter((n) => !shots.some((s) => s.name === n))
      if (unknown.length) throw new MediaError(`no shot ${unknown.join(', ')} in ${store.shots}`)
      shots = shots.filter((s) => o.only?.includes(s.name))
    }
    const results = await captureShots({
      cfg: o.capture,
      shots,
      out: captureDir(store),
      sheet: { every: store.sheetEvery, crop: null },
      igpu: o.igpu,
      log,
    })
    const failed = results.filter((r) => !r.ok)
    if (failed.length)
      throw new MediaError(
        `store stopped at capture: ${failed.map((r) => `${r.name} (${r.problems.join('; ')})`).join(', ')}\ncontent changed under the recipe: re-pick those shots, then re-run with --steps capture,... or --only`,
      )
  }

  if (has('stills') && store.stills.length) {
    log('== stills')
    /** @type {typeof import('playwright')} */
    let pw
    try {
      pw = await import('playwright')
    } catch {
      throw new MediaError('stills render in Chromium: add playwright to the devDependencies')
    }
    const browser = await launchChromium(
      pw,
      { headless: true, channel: o.capture.browser?.channel },
      log,
    )
    try {
      for (const s of store.stills) {
        const files = await renderStill(browser, s, {
          root: store.root,
          out: outDir,
          captureDir: captureDir(store),
        })
        for (const f of files) log(`  ${rel(store.root, f.file)}`)
      }
    } finally {
      await browser.close()
    }
  }

  if (has('cut')) {
    for (const v of store.videos) {
      log(`== cut ${v.edl}`)
      cutEdl(kitEdl(store, v), { root: store.root, draft: o.draft, log: (l) => log(`  ${l}`) })
    }
  }

  if (has('review')) {
    for (const v of store.videos) {
      log(`== review ${v.edl}`)
      const sheet = reviewSheet(store, v, log)
      if (sheet) log(`  ${rel(store.root, sheet)}: check each frame shows its beat`)
    }
  }

  if (!has('check')) return { ok: true, report: [] }
  log('== check')
  const preset = loadPreset(store.preset, store.root)
  for (const s of store.stills) {
    if (s.spec === false || s.clip) continue
    const file = path.join(outDir, `${s.name}-${s.w}x${s.h}.png`)
    made[s.spec ?? s.name] = fs.existsSync(file) ? probe(file) : null
  }
  for (const v of store.videos) {
    const id = videoId(v)
    if (!id) continue
    const file = path.resolve(store.root, /** @type {string} */ (kitEdl(store, v).out))
    made[id] = fs.existsSync(file) ? probe(file) : null
  }
  for (const id of Object.keys(made)) if (!made[id]) delete made[id]
  const { ok, lines } = checkKit(preset, made)
  for (const l of lines) log(`  ${l}`)
  if (preset.rules?.length) {
    log(`  by eye (${preset.name}):`)
    for (const r of preset.rules) log(`    - ${r}`)
  }
  return { ok, report: lines }
}
