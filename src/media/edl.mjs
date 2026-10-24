// @ts-check
/**
 * The edit list (EDL) `umm-dev cut` reads, and its validation. Fields:
 *
 *   clips          folder of captured clips, relative to the game root (default test-results/capture)
 *   clipFps        game frames per second of the clips (default 60)
 *   size [w, h]    output frame (default 1920x1080); clips are scaled to cover and cropped
 *   fps            output rate (default 60)
 *   out            output file, relative to the game root (default dist-video/cut.mp4)
 *   crf            final x264 CRF (default 18)
 *   maxMB          fail if the result is bigger
 *   length         seconds; the end is trimmed to it (default: the shots' sum)
 *   cover {file, hold}   a still for the first `hold` s; the next shot's `dissolve` blends from it
 *   shots [{clip, in, dur, dissolve?, speed?, reverse?, grade?, crop?,
 *           wipeFrom?, wipeAt?, wipe?, transition?, beat?, note?}]
 *   overlays [{file, at, to, w, x, y, fade?, opacity?}]   image bugs, in output px
 *   cards [{text, at, to, y?, size?, color?, fade?}]     centred text; needs `font`
 *   font           a .ttf/.otf for cards (or `--font`); none is bundled
 *   fadeIn, fadeOut      seconds (default 0)
 *   music {file, ranges: [[from, to]...], fadeOut?, gain?}  omitted: a silent cut, no audio track
 *
 * docs/media.md explains each field.
 */

/**
 * @typedef {object} EdlShot
 * @property {string} clip
 * @property {number} in          game seconds into the clip
 * @property {number} dur         seconds in the cut
 * @property {number} [dissolve]  seconds of cross-dissolve INTO this shot
 * @property {number} [speed]
 * @property {boolean} [reverse]
 * @property {string} [grade]     an ffmpeg filter chain applied after the scale
 * @property {string} [crop]      w:h:x:y in clip px, before the scale (reframe a clip)
 * @property {string} [wipeFrom]  a clip at the same game time that plays first, then wipes to `clip`
 * @property {number} [wipeAt]    the wipe ends this many seconds into the shot
 * @property {number} [wipe]      the wipe's length (default 1)
 * @property {string} [transition] xfade transition of the wipe (default wiperight)
 * @property {string} [beat]      what the in-point must show (the store's review sheet prints it)
 * @property {string} [note]
 */

/**
 * @typedef {object} Edl
 * @property {string} [clips]
 * @property {number} [clipFps]
 * @property {[number, number]} [size]
 * @property {number} [fps]
 * @property {string} [out]
 * @property {number} [crf]
 * @property {number} [maxMB]
 * @property {number} [length]
 * @property {{ file: string, hold: number }} [cover]
 * @property {EdlShot[]} shots
 * @property {{ file: string, at: number, to: number, w: number, x: number | string, y: number | string, fade?: number, opacity?: number }[]} [overlays]
 * @property {{ text: string, at: number, to: number, y?: string | number, size?: number, color?: string, fade?: number }[]} [cards]
 * @property {string} [font]
 * @property {number} [fadeIn]
 * @property {number} [fadeOut]
 * @property {{ file: string, ranges: [number, number][], fadeOut?: number, gain?: number }} [music]
 */

export const EDL_DEFAULTS = {
  clips: 'test-results/capture',
  clipFps: 60,
  size: /** @type {[number, number]} */ ([1920, 1080]),
  fps: 60,
  out: 'dist-video/cut.mp4',
  crf: 18,
}

const TOP = new Set([
  'clips',
  'clipFps',
  'size',
  'fps',
  'out',
  'crf',
  'maxMB',
  'length',
  'cover',
  'shots',
  'overlays',
  'cards',
  'font',
  'fadeIn',
  'fadeOut',
  'music',
])
const SHOT = new Set([
  'clip',
  'in',
  'dur',
  'dissolve',
  'speed',
  'reverse',
  'grade',
  'crop',
  'wipeFrom',
  'wipeAt',
  'wipe',
  'transition',
  'beat',
  'note',
])

/** @param {unknown} v */
const num = (v) => typeof v === 'number' && Number.isFinite(v)
/** @param {unknown} v */
const str = (v) => typeof v === 'string' && v.length > 0
/** A comment key: `$comment`, `_note`. @param {string} k */
const comment = (k) => k.startsWith('$') || k.startsWith('_')

/**
 * The cut's length in seconds: the shots' durations less each dissolve, or `length`.
 * @param {Edl} edl
 */
export function cutLength(edl) {
  let total = edl.cover ? edl.cover.hold : 0
  edl.shots.forEach((s, i) => {
    total += s.dur - (i > 0 || edl.cover ? (s.dissolve ?? 0) : 0)
  })
  return edl.length ?? total
}

/**
 * Every problem with an edit list, as messages that say what to fix. Empty: it is valid.
 * @param {unknown} input
 * @param {{ font?: string | null }} [opts]
 * @returns {string[]}
 */
export function validateEdl(input, opts = {}) {
  /** @type {string[]} */
  const errs = []
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    return ['the edit list must be a JSON object with a "shots" array']
  const edl = /** @type {Record<string, any>} */ (input)
  for (const k of Object.keys(edl))
    if (!TOP.has(k) && !comment(k)) errs.push(`unknown field "${k}" (see docs/media.md)`)
  if (edl.size != null) {
    const s = edl.size
    if (!(Array.isArray(s) && s.length === 2 && s.every((n) => Number.isInteger(n) && n > 0)))
      errs.push('"size" must be [width, height] in px')
    else if (s.some((/** @type {number} */ n) => n % 2))
      errs.push('"size" must be even on both sides (x264 at yuv420p)')
  }
  for (const k of ['fps', 'clipFps', 'maxMB', 'length'])
    if (edl[k] != null && !(num(edl[k]) && edl[k] > 0)) errs.push(`"${k}" must be a number > 0`)
  if (edl.crf != null && !(Number.isInteger(edl.crf) && edl.crf >= 0 && edl.crf <= 51))
    errs.push('"crf" must be an integer from 0 to 51')
  for (const k of ['clips', 'out', 'font'])
    if (edl[k] != null && !str(edl[k])) errs.push(`"${k}" must be a path`)
  if (edl.out != null && str(edl.out) && !/\.mp4$/i.test(edl.out)) errs.push('"out" must end .mp4')
  if (edl.cover != null) {
    if (!str(edl.cover.file)) errs.push('"cover.file" must be an image path')
    if (!(num(edl.cover.hold) && edl.cover.hold > 0)) errs.push('"cover.hold" must be seconds > 0')
  }

  if (!Array.isArray(edl.shots) || edl.shots.length === 0) {
    errs.push('"shots" must be a non-empty array')
    return errs
  }
  /** @type {number | null} */
  let prevDur = edl.cover && num(edl.cover.hold) ? edl.cover.hold : null
  edl.shots.forEach((/** @type {Record<string, any>} */ s, /** @type {number} */ i) => {
    const at = `shots[${i}]${str(s?.clip) ? ` (${s.clip})` : ''}`
    if (typeof s !== 'object' || s === null) {
      errs.push(`${at} must be an object`)
      return
    }
    for (const k of Object.keys(s))
      if (!SHOT.has(k) && !comment(k)) errs.push(`${at}: unknown field "${k}"`)
    if (!str(s.clip)) errs.push(`${at}: "clip" must name a captured clip`)
    if (!(num(s.in) && s.in >= 0)) errs.push(`${at}: "in" must be game seconds >= 0`)
    if (!(num(s.dur) && s.dur > 0)) errs.push(`${at}: "dur" must be seconds > 0`)
    if (s.speed != null && !(num(s.speed) && s.speed > 0)) errs.push(`${at}: "speed" must be > 0`)
    if (s.reverse != null && typeof s.reverse !== 'boolean')
      errs.push(`${at}: "reverse" must be true or false`)
    if (s.crop != null && !(str(s.crop) && /^[^:]+:[^:]+:[^:]+:[^:]+$/.test(s.crop)))
      errs.push(`${at}: "crop" must be w:h:x:y`)
    if (s.grade != null && !str(s.grade)) errs.push(`${at}: "grade" must be an ffmpeg filter chain`)
    if (s.dissolve != null) {
      if (!(num(s.dissolve) && s.dissolve >= 0)) errs.push(`${at}: "dissolve" must be seconds >= 0`)
      else if (s.dissolve > 0 && prevDur == null)
        errs.push(`${at}: the first shot has nothing to dissolve from (add a "cover", or drop it)`)
      else if (num(s.dur) && s.dissolve >= s.dur)
        errs.push(`${at}: "dissolve" must be shorter than the shot's "dur"`)
      else if (prevDur != null && s.dissolve >= prevDur)
        errs.push(`${at}: "dissolve" must be shorter than the shot before it`)
    }
    if (s.wipeFrom != null) {
      const w = s.wipe ?? 1
      if (!str(s.wipeFrom)) errs.push(`${at}: "wipeFrom" must name a captured clip`)
      if (!(num(w) && w > 0)) errs.push(`${at}: "wipe" must be seconds > 0`)
      if (!num(s.wipeAt)) errs.push(`${at}: a wipe needs "wipeAt", seconds into the shot`)
      else if (s.wipeAt < w || (num(s.dur) && s.wipeAt > s.dur))
        errs.push(`${at}: "wipeAt" must be between "wipe" (${w}) and "dur"`)
      if ((s.speed ?? 1) !== 1 || s.reverse) errs.push(`${at}: a wipe plays at speed 1, forwards`)
    } else if (s.wipeAt != null || s.wipe != null || s.transition != null)
      errs.push(`${at}: "wipeAt", "wipe" and "transition" need "wipeFrom"`)
    prevDur = num(s.dur) ? s.dur : null
  })

  for (const [i, o] of (Array.isArray(edl.overlays) ? edl.overlays : []).entries()) {
    const at = `overlays[${i}]`
    if (!str(o?.file)) errs.push(`${at}: "file" must be an image path`)
    if (!(num(o?.at) && num(o?.to) && o.to > o.at && o.at >= 0))
      errs.push(`${at}: "at" and "to" must be seconds, at < to`)
    if (!(num(o?.w) && o.w > 0)) errs.push(`${at}: "w" must be its width in output px`)
    for (const k of ['x', 'y'])
      if (!(num(o?.[k]) || str(o?.[k]))) errs.push(`${at}: "${k}" must be px or an expression`)
    if (o?.fade != null && num(o.at) && num(o.to) && !(o.fade >= 0 && 2 * o.fade <= o.to - o.at))
      errs.push(`${at}: "fade" must fit twice between "at" and "to"`)
    if (o?.opacity != null && !(num(o.opacity) && o.opacity >= 0 && o.opacity <= 1))
      errs.push(`${at}: "opacity" must be 0 to 1`)
  }
  if (edl.overlays != null && !Array.isArray(edl.overlays)) errs.push('"overlays" must be an array')

  if (edl.cards != null && !Array.isArray(edl.cards)) errs.push('"cards" must be an array')
  const cards = Array.isArray(edl.cards) ? edl.cards : []
  if (cards.length && !str(edl.font) && !str(opts.font))
    errs.push('cards need a font: set "font" to a .ttf or .otf file, or pass --font')
  for (const [i, c] of cards.entries()) {
    const at = `cards[${i}]`
    if (!str(c?.text)) errs.push(`${at}: "text" must be a string`)
    if (!(num(c?.at) && num(c?.to) && c.to > c.at && c.at >= 0))
      errs.push(`${at}: "at" and "to" must be seconds, at < to`)
    if (c?.size != null && !(num(c.size) && c.size > 0)) errs.push(`${at}: "size" must be px > 0`)
    if (c?.fade != null && num(c.at) && num(c.to) && !(c.fade >= 0 && 2 * c.fade <= c.to - c.at))
      errs.push(`${at}: "fade" must fit twice between "at" and "to"`)
  }

  for (const k of ['fadeIn', 'fadeOut'])
    if (edl[k] != null && !(num(edl[k]) && edl[k] >= 0)) errs.push(`"${k}" must be seconds >= 0`)

  if (edl.music != null) {
    const m = edl.music
    if (!str(m?.file)) errs.push('"music.file" must be an audio path')
    if (
      !(
        Array.isArray(m?.ranges) &&
        m.ranges.length > 0 &&
        m.ranges.every(
          (/** @type {unknown} */ r) =>
            Array.isArray(r) &&
            r.length === 2 &&
            num(r[0]) &&
            num(r[1]) &&
            r[0] >= 0 &&
            r[1] > r[0],
        )
      )
    )
      errs.push('"music.ranges" must be [[from, to], ...] in source seconds, from < to')
    if (m?.gain != null && !(num(m.gain) && m.gain >= 0)) errs.push('"music.gain" must be >= 0')
    if (m?.fadeOut != null && !(num(m.fadeOut) && m.fadeOut >= 0))
      errs.push('"music.fadeOut" must be seconds >= 0')
  }

  if (errs.length === 0) {
    const len = cutLength(/** @type {Edl} */ (edl))
    if ((edl.fadeIn ?? 0) + (edl.fadeOut ?? 0) > len)
      errs.push(`"fadeIn" and "fadeOut" together are longer than the cut (${len.toFixed(2)} s)`)
    for (const [i, o] of [...(edl.overlays ?? []), ...cards].entries())
      if (o.to > len + 1e-6)
        errs.push(`overlay or card ${i} ends at ${o.to} s, after the cut (${len.toFixed(2)} s)`)
  }
  return errs
}
