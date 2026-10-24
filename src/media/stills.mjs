// @ts-check
/**
 * Store stills (covers, icons, a logo) rendered by Chromium from the game's own templates.
 *
 * A template is an HTML or SVG file in the game. Before it loads, `window.STORE` is set to the
 * still's `data`, its `w` and `h`, its `name`, and `plates`: each named capture shot's last
 * frame as a data URL, so a cover can composite real game frames. `__TOKEN__` in the template
 * becomes the data URL of the file `inline.TOKEN` names (a font from node_modules, a logo).
 *
 * The page is rendered at `scale` (default 2) and downscaled with lanczos to `w` x `h` and to
 * each of `sizes`, so edges stay clean. A template that draws late sets `window.READY = false`
 * at the top of its script and `true` when done; otherwise the render waits for fonts and images.
 */
import fs from 'node:fs'
import path from 'node:path'
import { ffmpeg, listFrames, MediaError } from './util.mjs'

/**
 * @typedef {object} Still
 * @property {string} name                 output file stem; the preset asset id unless `spec`
 * @property {string | false} [spec]       preset asset id to check it against; false: none
 * @property {string} template             .html or .svg, relative to the game root
 * @property {number} w
 * @property {number} h
 * @property {number} [scale]              device scale of the render (default 2; 1 with `clip`)
 * @property {[number, number][]} [sizes]  more sizes from the same render
 * @property {boolean} [keepRender]        also keep the render at scale (key art for press)
 * @property {Record<string, string>} [plates]  name in STORE.plates to capture shot name
 * @property {Record<string, string>} [inline]  TOKEN to a file inlined as a data URL
 * @property {Record<string, unknown>} [data]
 * @property {string} [clip]               CSS selector: crop to that element's box (plus `pad`)
 * @property {number} [pad]
 * @property {boolean} [transparent]       keep transparency where nothing is drawn (default true)
 */

const TYPES = /** @type {Record<string, string>} */ ({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
})

/** @param {string} file */
export function dataUrl(file) {
  const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
  return `data:${type};base64,${fs.readFileSync(file).toString('base64')}`
}

/**
 * A plate: the last frame a capture wrote for that shot.
 * @param {string} captureDir @param {string} shot
 */
export function plateFile(captureDir, shot) {
  const dir = path.join(captureDir, shot)
  const frames = listFrames(dir)
  if (!frames.length)
    throw new MediaError(
      `no plate for "${shot}": capture it first (umm-dev capture ${shot} --out ${captureDir})`,
    )
  return path.join(dir, /** @type {string} */ (frames.at(-1)))
}

/**
 * The page's HTML: the template, tokens inlined, `window.STORE` set before its scripts run.
 * @param {string} template  the template's text
 * @param {boolean} svg
 * @param {Record<string, unknown>} store
 * @param {Record<string, string>} inlined  TOKEN to data URL
 */
export function stillHtml(template, svg, store, inlined) {
  let t = template
  for (const [k, v] of Object.entries(inlined)) t = t.replaceAll(`__${k}__`, v)
  if (svg) {
    const w = Number(store.w)
    const h = Number(store.h)
    const sized = /<svg[^>]*\swidth=/.test(t)
      ? t
      : t.replace('<svg', `<svg width="${w}" height="${h}"`)
    t = `<!doctype html><html><head></head><body style="margin:0;background:transparent;width:${w}px;height:${h}px;overflow:hidden">${sized}</body></html>`
  }
  const json = JSON.stringify(store).replace(/</g, '\\u003c')
  const boot = `<script>window.STORE = ${json}</script>`
  if (/<head[^>]*>/i.test(t)) return t.replace(/<head[^>]*>/i, (m) => `${m}${boot}`)
  return `${boot}${t}`
}

/**
 * Render one still. Returns the files written.
 * @param {import('playwright').Browser} browser
 * @param {Still} still
 * @param {{ root: string, out: string, captureDir: string }} ctx
 * @returns {Promise<{ id: string | null, file: string, size: [number, number] }[]>}
 */
export async function renderStill(browser, still, ctx) {
  const tplFile = path.resolve(ctx.root, still.template)
  if (!fs.existsSync(tplFile))
    throw new MediaError(`still "${still.name}": no template ${still.template}`)
  const svg = tplFile.toLowerCase().endsWith('.svg')
  const scale = still.scale ?? (still.clip ? 1 : 2)
  /** @type {Record<string, string>} */
  const plates = {}
  for (const [k, shot] of Object.entries(still.plates ?? {}))
    plates[k] = dataUrl(plateFile(ctx.captureDir, shot))
  /** @type {Record<string, string>} */
  const inlined = {}
  for (const [k, f] of Object.entries(still.inline ?? {})) {
    const file = path.resolve(ctx.root, f)
    if (!fs.existsSync(file)) throw new MediaError(`still "${still.name}": no file ${f} to inline`)
    inlined[k] = dataUrl(file)
  }
  const html = stillHtml(
    fs.readFileSync(tplFile, 'utf8'),
    svg,
    { ...(still.data ?? {}), name: still.name, w: still.w, h: still.h, plates },
    inlined,
  )
  const page = await browser.newPage({
    viewport: { width: still.w, height: still.h },
    deviceScaleFactor: scale,
  })
  /** @type {string[]} */
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  try {
    // setContent's page is about:blank, which init scripts skip: STORE rides in the page.
    await page.setContent(html, { waitUntil: 'load' })
    await page
      .waitForFunction(
        () => {
          const w = /** @type {any} */ (window)
          const imgs = [...document.images].every((i) => i.complete)
          return (
            document.fonts.status === 'loaded' &&
            imgs &&
            (w.READY === undefined || w.READY === true)
          )
        },
        null,
        { timeout: 60_000, polling: 50 },
      )
      .catch(() => {
        throw new MediaError(
          `still "${still.name}" never became ready${errors.length ? `: ${errors.join('; ')}` : ' (window.READY stayed false)'}`,
        )
      })
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))),
    )
    if (errors.length) throw new MediaError(`still "${still.name}": ${errors.join('; ')}`)
    fs.mkdirSync(ctx.out, { recursive: true })
    const transparent = still.transparent ?? true
    const id = still.spec === false ? null : (still.spec ?? still.name)
    if (still.clip) {
      const box = await page.locator(still.clip).first().boundingBox()
      if (!box) throw new MediaError(`still "${still.name}": nothing matches ${still.clip}`)
      const pad = still.pad ?? 0
      const file = path.join(ctx.out, `${still.name}.png`)
      await page.screenshot({
        path: file,
        omitBackground: transparent,
        clip: {
          x: box.x - pad,
          y: box.y - pad,
          width: box.width + 2 * pad,
          height: box.height + 2 * pad,
        },
      })
      const size = /** @type {[number, number]} */ ([
        Math.round((box.width + 2 * pad) * scale),
        Math.round((box.height + 2 * pad) * scale),
      ])
      return [{ id, file, size }]
    }
    const big = path.join(ctx.out, `${still.name}-${still.w * scale}x${still.h * scale}.png`)
    await page.screenshot({
      path: big,
      omitBackground: transparent,
      clip: { x: 0, y: 0, width: still.w, height: still.h },
    })
    /** @type {{ id: string | null, file: string, size: [number, number] }[]} */
    const files = []
    const sizes = /** @type {[number, number][]} */ ([[still.w, still.h], ...(still.sizes ?? [])])
    for (const [i, [w, h]] of sizes.entries()) {
      const file = path.join(ctx.out, `${still.name}-${w}x${h}.png`)
      if (file !== big) ffmpeg(['-i', big, '-vf', `scale=${w}:${h}:flags=lanczos`, file])
      files.push({ id: i === 0 ? id : null, file, size: [w, h] })
    }
    if (scale !== 1 && !still.keepRender) fs.rmSync(big)
    else if (scale !== 1)
      files.push({ id: null, file: big, size: [still.w * scale, still.h * scale] })
    return files
  } finally {
    await page.close()
  }
}
