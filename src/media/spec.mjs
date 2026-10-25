// @ts-check
/**
 * Storefront specs: `presets/<store>.json` (or any file of that shape), and the checks a store
 * asset must pass against its entry. The checks are pure functions of an ffprobe result
 * (util.probe), so they are tested without media.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MediaError, readJson } from './util.mjs'

export const PRESETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../presets')

/**
 * @typedef {object} AssetSpec
 * @property {'image' | 'video'} kind
 * @property {[number, number]} [size]        exact pixels
 * @property {[number, number]} [minSize]     at least these pixels
 * @property {string[]} [formats]             image: png, jpg, webp
 * @property {[number, number]} [seconds]     video: inclusive range
 * @property {boolean} [audio]                video: false means no audio track at all
 * @property {number} [maxMB]
 * @property {string[]} [codecs]              video: ffprobe codec names (h264, vp9, av1)
 * @property {number} [fps]                   video: frames per second, to 0.01
 * @property {boolean} [required]             the storefront needs it
 */

/**
 * @typedef {object} Preset
 * @property {string} name
 * @property {string[]} [sources]
 * @property {string} [checked]
 * @property {Record<string, AssetSpec>} assets
 * @property {string[]} [rules]   what a person must check by eye
 */

/**
 * A preset by name (`crazygames`) or path (`store/my-store.json`, relative to `root`).
 * @param {string} nameOrPath
 * @param {string} [root]
 * @returns {Preset}
 */
export function loadPreset(nameOrPath, root = process.cwd()) {
  const file = /[\\/]|\.json$/.test(nameOrPath)
    ? path.resolve(root, nameOrPath)
    : path.join(PRESETS, `${nameOrPath}.json`)
  if (!fs.existsSync(file)) {
    const known = fs.existsSync(PRESETS)
      ? fs
          .readdirSync(PRESETS)
          .filter((f) => f.endsWith('.json'))
          .map((f) => f.slice(0, -5))
      : []
    throw new MediaError(
      `no preset "${nameOrPath}": use one of ${known.join(', ') || '(none)'} or a path to a .json`,
    )
  }
  const preset = readJson(file)
  const errs = validatePreset(preset)
  if (errs.length) throw new MediaError(`${file}:\n  ${errs.join('\n  ')}`)
  return preset
}

/** @param {unknown} v */
const pair = (v) =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && n > 0)

/**
 * @param {any} p
 * @returns {string[]}
 */
export function validatePreset(p) {
  /** @type {string[]} */
  const errs = []
  if (typeof p?.name !== 'string') errs.push('"name" must be the storefront\'s name')
  if (typeof p?.assets !== 'object' || p.assets === null) {
    errs.push('"assets" must map asset ids to specs')
    return errs
  }
  for (const [id, a] of Object.entries(p.assets)) {
    const s = /** @type {any} */ (a)
    if (s?.kind !== 'image' && s?.kind !== 'video')
      errs.push(`${id}: "kind" must be image or video`)
    for (const k of ['size', 'minSize', 'seconds'])
      if (s?.[k] != null && !pair(s[k])) errs.push(`${id}: "${k}" must be a pair of numbers`)
    if (s?.seconds && s.seconds[0] > s.seconds[1]) errs.push(`${id}: "seconds" must be [min, max]`)
  }
  return errs
}

/** ffprobe's name for an image's format, as a preset writes it. @param {import('./util.mjs').Probe} p */
export function imageFormat(p) {
  const c = p.video?.codec ?? ''
  if (c === 'png') return 'png'
  if (c === 'mjpeg') return 'jpg'
  if (c === 'webp') return 'webp'
  return c
}

/**
 * Check one probed file against its spec. Returns the failures, as messages; empty passes.
 * @param {import('./util.mjs').Probe} p
 * @param {AssetSpec} spec
 * @returns {string[]}
 */
export function checkAsset(p, spec) {
  /** @type {string[]} */
  const fails = []
  const v = p.video
  if (!v) return ['no picture in it']
  if (spec.size && (v.width !== spec.size[0] || v.height !== spec.size[1]))
    fails.push(`is ${v.width}x${v.height}, must be ${spec.size[0]}x${spec.size[1]}`)
  if (spec.minSize && (v.width < spec.minSize[0] || v.height < spec.minSize[1]))
    fails.push(`is ${v.width}x${v.height}, must be at least ${spec.minSize.join('x')}`)
  const mb = p.bytes / 1e6
  if (spec.maxMB != null && mb > spec.maxMB)
    fails.push(`is ${mb.toFixed(1)} MB, over ${spec.maxMB} MB: raise the edit list's "crf"`)
  if (spec.kind === 'image') {
    const f = imageFormat(p)
    if (spec.formats && !spec.formats.includes(f))
      fails.push(`is ${f}, must be ${spec.formats.join(' or ')}`)
    return fails
  }
  const d = p.duration ?? 0
  if (spec.seconds && (d < spec.seconds[0] - 0.02 || d > spec.seconds[1] + 0.02))
    fails.push(`runs ${d.toFixed(2)} s, must be ${spec.seconds[0]} to ${spec.seconds[1]} s`)
  if (spec.audio === false && p.audio.length)
    fails.push('has an audio track, must be silent: drop "music" from the edit list')
  if (spec.audio === true && !p.audio.length) fails.push('has no audio track')
  if (spec.codecs && !spec.codecs.includes(v.codec))
    fails.push(`is ${v.codec}, must be ${spec.codecs.join(' or ')}`)
  if (spec.fps != null && v.fps != null && Math.abs(v.fps - spec.fps) > 0.01)
    fails.push(`runs at ${v.fps.toFixed(2)} fps, must be ${spec.fps}`)
  return fails
}

/**
 * The store's report: one line per preset asset, plus anything made that the preset lacks.
 * @param {Preset} preset
 * @param {Record<string, import('./util.mjs').Probe | null>} made  asset id to its probe (null: not made)
 * @returns {{ ok: boolean, lines: string[] }}
 */
export function checkKit(preset, made) {
  const lines = []
  let ok = true
  for (const [id, spec] of Object.entries(preset.assets)) {
    const p = made[id]
    if (!p) {
      if (spec.required) ok = false
      lines.push(
        `${spec.required ? 'MISSING' : 'skipped'}  ${id}${spec.required ? ' (required)' : ''}`,
      )
      continue
    }
    const fails = checkAsset(p, spec)
    if (fails.length) ok = false
    lines.push(
      fails.length
        ? `FAIL     ${id}: ${path.basename(p.file)} ${fails.join('; ')}`
        : `ok       ${id}: ${path.basename(p.file)}`,
    )
  }
  for (const id of Object.keys(made))
    if (!(id in preset.assets)) lines.push(`??       ${id}: the preset has no spec of that id`)
  return { ok, lines }
}
