// @ts-check
/**
 * The home-screen icon and the link-preview card, drawn from the game's `icon.svg` at build
 * time, so no PNG is committed and the tab icon, the home-screen icon and the card cannot drift.
 *
 * - **The icon.** iOS's Add to Home Screen reads only a PNG `apple-touch-icon`, at 180 px. It is
 *   emitted at the site root, where iOS also looks on its own, served from memory in dev, and
 *   linked from the page head.
 * - **The share card** (optional). A chat client unfurls a link with `og:image`, which must be
 *   a raster; 1200 x 630 is the size the big clients crop to. The card is the icon's ground over
 *   the whole card with the icon centred on it. The game's own `og:image` tag names it, at an
 *   absolute URL.
 *
 * The SVG reader is deliberately small: a square `viewBox` from 0 0, one `<rect>` (the ground)
 * and `<path>`s of straight lines (M, L, H, V, Z, absolute or relative) with `#rrggbb` fills.
 * Anything else (a curve, an arc, a transform, a group) throws, so an icon that outgrows the
 * reader fails the build rather than shipping a wrong picture. The ground is drawn square: iOS
 * rounds the icon itself and fills a transparent corner black.
 */
import fs from 'node:fs'
import path from 'node:path'
import { encodePng } from './png.mjs'

export const APPLE_TOUCH_ICON = 'apple-touch-icon.png'
export const APPLE_TOUCH_SIZE = 180
export const SHARE_CARD = 'share-card.png'
export const SHARE_CARD_SIZE = Object.freeze({ width: 1200, height: 630, mark: 420 })

/** Subsamples per pixel side: 4 x 4, enough for clean edges on flat shapes. */
const SAMPLES = 4

/** @typedef {[number, number, number]} Rgb */
/** @typedef {{ size: number, ground: Rgb, shapes: { fill: Rgb, points: [number, number][] }[] }} Icon */

/**
 * @param {string | undefined} s
 * @returns {Rgb}
 */
const hex = (s) => {
  const m = /^#([0-9a-f]{6})$/i.exec(s ?? '')
  if (!m?.[1]) throw new Error(`app-icon: a fill must be #rrggbb, got ${s}`)
  const n = Number.parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * @param {string} tag
 * @param {string} name
 */
const attr = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]

/**
 * Straight-line path data to one polygon's points. Throws on anything curved.
 * @param {string} d
 * @returns {[number, number][]}
 */
export function pathPoints(d) {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? []
  /** @type {[number, number][]} */
  const points = []
  let x = 0
  let y = 0
  let cmd = ''
  let i = 0
  const num = () => {
    const v = Number(tokens[i++])
    if (!Number.isFinite(v)) throw new Error(`app-icon: a number was expected in "${d}"`)
    return v
  }
  while (i < tokens.length) {
    const t = /** @type {string} */ (tokens[i])
    if (/[A-Za-z]/.test(t)) {
      cmd = t
      i++
    }
    switch (cmd) {
      case 'M':
      case 'L':
        x = num()
        y = num()
        break
      case 'm':
      case 'l':
        x += num()
        y += num()
        break
      case 'H':
        x = num()
        break
      case 'h':
        x += num()
        break
      case 'V':
        y = num()
        break
      case 'v':
        y += num()
        break
      case 'Z':
      case 'z':
        continue
      default:
        throw new Error(`app-icon: path command "${cmd}" is not a straight line ("${d}")`)
    }
    points.push([x, y])
  }
  if (points.length < 3) throw new Error(`app-icon: "${d}" is not a polygon`)
  return points
}

/**
 * An SVG's text to a ground colour, a viewBox size and filled polygons.
 * @param {string} svg
 * @returns {Icon}
 */
export function parseIconSvg(svg) {
  const body = svg.replace(/<!--[\s\S]*?-->/g, '')
  const box = (attr(/<svg[^>]*>/.exec(body)?.[0] ?? '', 'viewBox') ?? '').split(/\s+/).map(Number)
  if (box.length !== 4 || box[0] !== 0 || box[1] !== 0 || box[2] !== box[3]) {
    throw new Error(`app-icon: a square viewBox from 0 0 is expected, got "${box.join(' ')}"`)
  }
  const rects = body.match(/<rect\b[^>]*>/g) ?? []
  if (rects.length !== 1) {
    throw new Error(`app-icon: one <rect> (the ground) expected, found ${rects.length}`)
  }
  for (const unsupported of [
    '<circle',
    '<ellipse',
    '<polygon',
    '<polyline',
    '<g ',
    '<g>',
    'transform=',
  ]) {
    if (body.includes(unsupported)) throw new Error(`app-icon: "${unsupported}" is not read here`)
  }
  const shapes = (body.match(/<path\b[^>]*>/g) ?? []).map((tag) => ({
    fill: hex(attr(tag, 'fill')),
    points: pathPoints(attr(tag, 'd') ?? ''),
  }))
  return {
    size: /** @type {number} */ (box[2]),
    ground: hex(attr(/** @type {string} */ (rects[0]), 'fill')),
    shapes,
  }
}

/**
 * Even-odd point in polygon.
 * @param {number} px
 * @param {number} py
 * @param {[number, number][]} pts
 */
function inside(px, py, pts) {
  let hit = false
  for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
    const [xa, ya] = /** @type {[number, number]} */ (pts[a])
    const [xb, yb] = /** @type {[number, number]} */ (pts[b])
    if (ya > py !== yb > py && px < ((xb - xa) * (py - ya)) / (yb - ya) + xa) hit = !hit
  }
  return hit
}

/**
 * The icon at `size` x `size` px, RGB, row-major. Later shapes paint over earlier ones.
 * @param {Icon} icon
 * @param {number} size
 * @returns {Uint8Array}
 */
export function rasterize(icon, size) {
  const rgb = new Uint8Array(size * size * 3)
  const scale = icon.size / size
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const sum = [0, 0, 0]
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = (col + (sx + 0.5) / SAMPLES) * scale
          const y = (row + (sy + 0.5) / SAMPLES) * scale
          let c = icon.ground
          for (const shape of icon.shapes) if (inside(x, y, shape.points)) c = shape.fill
          for (let k = 0; k < 3; k++) sum[k] = /** @type {number} */ (sum[k]) + c[k]
        }
      }
      const at = (row * size + col) * 3
      for (let k = 0; k < 3; k++)
        rgb[at + k] = Math.round(/** @type {number} */ (sum[k]) / (SAMPLES * SAMPLES))
    }
  }
  return rgb
}

/**
 * The card's pixels: the icon's ground everywhere, the icon centred at `mark` px.
 * @param {Icon} icon
 * @param {number} width
 * @param {number} height
 * @param {number} mark
 * @returns {Uint8Array}
 */
export function rasterizeCard(icon, width, height, mark) {
  const rgb = new Uint8Array(width * height * 3)
  for (let i = 0; i < width * height; i++) rgb.set(icon.ground, i * 3)
  const art = rasterize(icon, mark)
  const left = Math.round((width - mark) / 2)
  const top = Math.round((height - mark) / 2)
  for (let row = 0; row < mark; row++) {
    rgb.set(art.subarray(row * mark * 3, (row + 1) * mark * 3), ((top + row) * width + left) * 3)
  }
  return rgb
}

/**
 * @param {string} svg
 * @param {number} [size]
 */
export const appleTouchIconPng = (svg, size = APPLE_TOUCH_SIZE) =>
  encodePng({ width: size, height: size, channels: 3, data: rasterize(parseIconSvg(svg), size) })

/**
 * @param {string} svg
 * @param {{ width: number, height: number, mark: number }} [size]
 */
export const shareCardPng = (svg, size = SHARE_CARD_SIZE) =>
  encodePng({
    width: size.width,
    height: size.height,
    channels: 3,
    data: rasterizeCard(parseIconSvg(svg), size.width, size.height, size.mark),
  })

/**
 * @typedef {object} AppIconOptions
 * @property {string} svg The icon's SVG, relative to Vite's root or absolute.
 * @property {string} [fileName] Default `apple-touch-icon.png`.
 * @property {number} [size] Default 180.
 * @property {boolean} [link] Add `<link rel="apple-touch-icon">` to the head. Default true.
 * @property {boolean | { fileName?: string, width?: number, height?: number, mark?: number }} [shareCard]
 *   Also draw the share card. Off by default.
 */

/**
 * Link the icon, serve it in dev and emit it in a build; the share card too when asked.
 * @param {AppIconOptions} options
 * @returns {import('vite').Plugin}
 */
export function appIcon(options) {
  const { fileName = APPLE_TOUCH_ICON, size = APPLE_TOUCH_SIZE, link = true } = options
  const card = options.shareCard
    ? {
        fileName: SHARE_CARD,
        ...SHARE_CARD_SIZE,
        ...(typeof options.shareCard === 'object' ? options.shareCard : {}),
      }
    : null
  let root = process.cwd()
  let base = '/'
  /** @type {Map<string, Buffer>} */
  const made = new Map()
  const svgText = () => fs.readFileSync(path.resolve(root, options.svg), 'utf8')
  /** @param {string} name */
  const bytes = (name) => {
    let b = made.get(name)
    if (!b) {
      b =
        name === fileName
          ? appleTouchIconPng(svgText(), size)
          : shareCardPng(svgText(), /** @type {NonNullable<typeof card>} */ (card))
      made.set(name, b)
    }
    return b
  }
  const names = card ? [fileName, card.fileName] : [fileName]
  return {
    name: 'umm:app-icon',
    configResolved(config) {
      root = config.root
      base = config.base
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const at = (req.url ?? '').split('?')[0] ?? ''
        const name = names.find((n) => at === `${base}${n}` || at === `/${n}`)
        if (!name) return next()
        try {
          const b = bytes(name)
          res.setHeader('Content-Type', 'image/png')
          res.end(b)
        } catch (e) {
          next(e)
        }
      })
      server.watcher.add(path.resolve(root, options.svg))
      server.watcher.on('change', (f) => {
        if (path.resolve(f) === path.resolve(root, options.svg)) made.clear()
      })
    },
    generateBundle() {
      for (const name of names)
        this.emitFile({ type: 'asset', fileName: name, source: bytes(name) })
    },
    transformIndexHtml() {
      if (!link) return []
      const href = base === './' || base === '' ? fileName : `${base}${fileName}`
      return [{ tag: 'link', attrs: { rel: 'apple-touch-icon', href }, injectTo: 'head' }]
    },
  }
}
