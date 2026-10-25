// @ts-check
/**
 * The cut as a plan: every ffmpeg command `umm-dev cut` will run, built without touching the
 * disk, so `--print` can show it and the tests can read it.
 *
 *   1. each shot to its own near-lossless segment, exactly `dur` seconds at `fps`
 *      (re-timed from game frames, trimmed, sped, reversed, reframed, graded, or wiped)
 *   2. one pass joining them (concat or cross-dissolve), then overlays, cards, fades,
 *      the length and the music, encoded with `+faststart`
 */
import path from 'node:path'
import { cutLength, EDL_DEFAULTS } from './edl.mjs'
import { drawtextEscape, filterPath } from './util.mjs'

/**
 * How a clip reaches ffmpeg: its input args, and the filter that turns it into game time
 * (one input frame per game frame, starting at 0).
 * @typedef {{ args: string[], retime: string }} ClipSource
 */

/**
 * @typedef {object} PlanContext
 * @property {string} root                       paths in the edit list resolve from here
 * @property {boolean} [draft]                   fast encodes, `-draft` in the file name
 * @property {string | null} [font]              cards' font when the edit list names none
 * @property {(clip: string, clipsDir: string, clipFps: number) => ClipSource} resolveClip
 */

/**
 * @typedef {object} Plan
 * @property {{ label: string, args: string[] }[]} commands
 * @property {string} out
 * @property {string} segDir
 * @property {number} length
 * @property {[number, number]} size
 * @property {number} fps
 */

/**
 * The filters that fit any clip into the frame: reframe, cover-scale, crop, grade.
 * @param {{ crop?: string, grade?: string }} s
 * @param {number} W @param {number} H
 */
export function lookFilters(s, W, H) {
  return [
    ...(s.crop ? [`crop=${s.crop}`] : []),
    `scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos:out_range=tv`,
    `crop=${W}:${H}`,
    ...(s.grade ? [s.grade] : []),
    'setsar=1',
    'format=yuv420p',
  ]
}

/**
 * One shot's chain from its source: re-time, trim to `in` + `dur` (scaled by speed), speed,
 * reverse.
 * @param {import('./edl.mjs').EdlShot} s
 * @param {string} retime
 */
export function trimChain(s, retime) {
  const speed = s.speed ?? 1
  return [
    retime,
    `trim=start=${s.in}:duration=${round(s.dur * speed)}`,
    speed === 1 ? 'setpts=PTS-STARTPTS' : `setpts=(PTS-STARTPTS)/${speed}`,
    ...(s.reverse ? ['reverse'] : []),
  ].join(',')
}

/** @param {number} n */
const round = (n) => Math.round(n * 1e6) / 1e6

/**
 * The join: concat or cross-dissolve, segment by segment. Returns the filter parts and the
 * label of the joined stream.
 * @param {{ dur: number, dissolve?: number }[]} segs
 * @returns {{ parts: string[], label: string, total: number }}
 */
export function joinGraph(segs) {
  const parts = []
  // concat outputs the 1/1000000 timebase, and xfade refuses two inputs whose timebases differ,
  // so a dissolve anywhere after a hard cut failed ("First input link main timebase ... do not
  // match"). Then every segment is put on that timebase first; other joins are left as they are.
  const firstCut = segs.findIndex((s, i) => i > 0 && !((s.dissolve ?? 0) > 0))
  const settb = firstCut > 0 && segs.some((s, i) => i > firstCut && (s.dissolve ?? 0) > 0)
  /** @param {number} i */
  const input = (i) => (settb ? `[t${i}]` : `[${i}:v]`)
  if (settb) for (let i = 0; i < segs.length; i++) parts.push(`[${i}:v]settb=AVTB[t${i}]`)
  let prev = input(0)
  let total = segs[0].dur
  for (let i = 1; i < segs.length; i++) {
    const d = segs[i].dissolve ?? 0
    const label = `[c${i}]`
    if (d > 0) {
      parts.push(
        `${prev}${input(i)}xfade=transition=fade:duration=${d}:offset=${round(total - d)}${label}`,
      )
      total += segs[i].dur - d
    } else {
      parts.push(`${prev}${input(i)}concat=n=2:v=1:a=0${label}`)
      total += segs[i].dur
    }
    prev = label
  }
  return { parts, label: prev, total: round(total) }
}

/**
 * A card: centred text fading in and out.
 * @param {{ text: string, at: number, to: number, y?: string | number, size?: number, color?: string, fade?: number }} c
 * @param {string} font
 */
export function cardFilter(c, font) {
  const f = c.fade ?? 0.4
  const alpha = `if(lt(t,${c.at}),0,if(lt(t,${round(c.at + f)}),(t-${c.at})/${f},if(lt(t,${round(c.to - f)}),1,if(lt(t,${c.to}),(${c.to}-t)/${f},0))))`
  const y = c.y ?? 'h*0.78-text_h/2'
  return `drawtext=fontfile='${filterPath(font)}':expansion=none:text='${drawtextEscape(c.text)}':fontsize=${c.size ?? 72}:fontcolor=${c.color ?? 'white'}:alpha='${alpha}':x=(w-text_w)/2:y=${y}:borderw=2:bordercolor=black@0.35:shadowcolor=black@0.55:shadowx=0:shadowy=3:enable='between(t,${c.at},${c.to})'`
}

/**
 * The music: source ranges spliced in order with a 60 ms crossfade, faded out at the end.
 * @param {{ ranges: [number, number][], fadeOut?: number, gain?: number }} m
 * @param {number} idx  the music's input index
 * @param {number} len
 */
export function musicGraph(m, idx, len) {
  const parts = []
  const n = m.ranges.length
  if (n > 1) parts.push(`[${idx}:a]asplit=${n}${m.ranges.map((_, i) => `[s${i}]`).join('')}`)
  m.ranges.forEach(([a, b], i) => {
    const src = n > 1 ? `[s${i}]` : `[${idx}:a]`
    parts.push(`${src}atrim=${a}:${round(b + (i < n - 1 ? 0.06 : 0))},asetpts=PTS-STARTPTS[m${i}]`)
  })
  let prev = '[m0]'
  for (let i = 1; i < n; i++) {
    parts.push(`${prev}[m${i}]acrossfade=d=0.06:c1=tri:c2=tri[mx${i}]`)
    prev = `[mx${i}]`
  }
  const mf = m.fadeOut ?? 3
  parts.push(
    `${prev}afade=t=out:st=${round(Math.max(0, len - mf))}:d=${mf},atrim=0:${len},volume=${m.gain ?? 1}[a]`,
  )
  return parts
}

/**
 * Every ffmpeg command of the cut. The edit list must already be valid (validateEdl).
 * @param {import('./edl.mjs').Edl} edl
 * @param {PlanContext} ctx
 * @returns {Plan}
 */
export function planCut(edl, ctx) {
  const [W, H] = edl.size ?? EDL_DEFAULTS.size
  const FPS = edl.fps ?? EDL_DEFAULTS.fps
  const clipFps = edl.clipFps ?? EDL_DEFAULTS.clipFps
  const clipsDir = path.resolve(ctx.root, edl.clips ?? EDL_DEFAULTS.clips)
  const finalOut = path.resolve(ctx.root, edl.out ?? EDL_DEFAULTS.out)
  const out = ctx.draft ? finalOut.replace(/\.mp4$/i, '-draft.mp4') : finalOut
  const segDir = path.join(path.dirname(out), `.segs-${path.basename(out, '.mp4')}`)
  const draft = Boolean(ctx.draft)
  // Segments are intermediates, so near-lossless; the final pass sets the size.
  const segEnc = ['-c:v', 'libx264', '-preset', draft ? 'veryfast' : 'medium', '-crf', '10']
  const finalEnc = draft
    ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24']
    : ['-c:v', 'libx264', '-preset', 'slow', '-crf', String(edl.crf ?? EDL_DEFAULTS.crf)]
  const tail = ['-r', String(FPS), ...segEnc, '-pix_fmt', 'yuv420p', '-an']
  const look = (/** @type {{ crop?: string, grade?: string }} */ s) =>
    lookFilters(s, W, H).join(',')

  /** @type {{ label: string, args: string[] }[]} */
  const commands = []
  /** @type {{ file: string, dur: number, dissolve?: number }[]} */
  const segs = []
  const segFile = (/** @type {number} */ i) =>
    path.join(segDir, `${String(i).padStart(2, '0')}.mp4`)

  if (edl.cover) {
    const file = segFile(0)
    commands.push({
      label: `seg 0 cover ${edl.cover.hold}s`,
      args: [
        ...['-loop', '1', '-framerate', String(FPS), '-t', String(edl.cover.hold)],
        ...['-i', path.resolve(ctx.root, edl.cover.file)],
        ...['-vf', `${look({})},fps=${FPS}`, ...tail, file],
      ],
    })
    segs.push({ file, dur: edl.cover.hold })
  }
  for (const s of edl.shots) {
    const i = segs.length
    const file = segFile(i)
    const a = ctx.resolveClip(s.clip, clipsDir, clipFps)
    if (s.wipeFrom) {
      // A wipe: `wipeFrom` plays first, `clip` replaces it across `wipe` seconds ending
      // `wipeAt` into the shot, both at the SAME game time. Virtual-time captures of one shot
      // line up frame for frame, so a matched wipe holds.
      const b = ctx.resolveClip(s.wipeFrom, clipsDir, clipFps)
      const w = s.wipe ?? 1
      const wipeAt = /** @type {number} */ (s.wipeAt)
      const f = [
        `[0:v]${trimChain(s, b.retime)},${look(s)},fps=${FPS}[a]`,
        `[1:v]${trimChain({ ...s, in: round(s.in + wipeAt - w), dur: round(s.dur - wipeAt + w) }, a.retime)},${look(s)},fps=${FPS}[b]`,
        `[a][b]xfade=transition=${s.transition ?? 'wiperight'}:duration=${w}:offset=${round(wipeAt - w)},trim=duration=${s.dur}[v]`,
      ]
      commands.push({
        label: `seg ${i} ${s.wipeFrom} wipes to ${s.clip} @${s.in} ${s.dur}s`,
        args: [...b.args, ...a.args, '-filter_complex', f.join(';'), '-map', '[v]', ...tail, file],
      })
    } else {
      commands.push({
        label: `seg ${i} ${s.clip} @${s.in} ${s.dur}s`,
        args: [
          ...a.args,
          ...[
            '-filter_complex',
            `[0:v]${trimChain(s, a.retime)},${look(s)},fps=${FPS},trim=duration=${s.dur}[v]`,
          ],
          ...['-map', '[v]', ...tail, file],
        ],
      })
    }
    segs.push({ file, dur: s.dur, dissolve: s.dissolve })
  }

  const join = joinGraph(segs)
  const parts = [...join.parts]
  let prev = join.label
  const len = edl.length ?? cutLength(edl)

  // Image overlays (a logo bug): looped stills, faded, placed in output pixels.
  const overlays = edl.overlays ?? []
  const overlayInputs = overlays.flatMap((o) => [
    ...['-loop', '1', '-framerate', String(FPS), '-t', String(len)],
    ...['-i', path.resolve(ctx.root, o.file)],
  ])
  overlays.forEach((o, k) => {
    const f = o.fade ?? 0.5
    const idx = segs.length + k
    const fades = f
      ? `,fade=t=in:st=${o.at}:d=${f}:alpha=1,fade=t=out:st=${round(o.to - f)}:d=${f}:alpha=1`
      : ''
    parts.push(
      `[${idx}:v]format=rgba,scale=${o.w}:-1,colorchannelmixer=aa=${o.opacity ?? 1}${fades}[ov${k}]`,
    )
    parts.push(
      `${prev}[ov${k}]overlay=x=${o.x}:y=${o.y}:enable='between(t,${o.at},${o.to})'[o${k}]`,
    )
    prev = `[o${k}]`
  })

  const font = edl.font ? path.resolve(ctx.root, edl.font) : ctx.font
  const cards = (edl.cards ?? []).map((c) => cardFilter(c, /** @type {string} */ (font)))
  const fadeIn = edl.fadeIn ?? 0
  const fadeOut = edl.fadeOut ?? 0
  const post = [
    ...cards,
    ...(fadeIn ? [`fade=t=in:st=0:d=${fadeIn}`] : []),
    ...(fadeOut ? [`fade=t=out:st=${round(len - fadeOut)}:d=${fadeOut}`] : []),
    `trim=duration=${len}`,
    'format=yuv420p',
  ]
  parts.push(`${prev}${post.join(',')}[v]`)

  const m = edl.music
  const musicIn = m ? ['-i', path.resolve(ctx.root, m.file)] : []
  if (m) parts.push(...musicGraph(m, segs.length + overlays.length, len))
  const audio = m ? ['-map', '[a]', '-c:a', 'aac', '-b:a', '256k'] : ['-an']

  commands.push({
    label: `join ${segs.length} segments, ${len.toFixed(2)} s`,
    args: [
      ...segs.flatMap((s) => ['-i', s.file]),
      ...overlayInputs,
      ...musicIn,
      ...['-filter_complex', parts.join(';'), '-map', '[v]', ...audio],
      ...['-r', String(FPS), ...finalEnc, '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out],
    ],
  })
  return { commands, out, segDir, length: len, size: [W, H], fps: FPS }
}
