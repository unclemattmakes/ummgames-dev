// @ts-check
/**
 * `umm-dev loop`: the site loop a games site shows from a cut or a store preview. A silent
 * mp4 with its long edge capped (720 px by default, never upscaled), H.264 high at yuv420p
 * with `+faststart` so it plays before it has fully loaded, and a poster beside it
 * (`<stem>.poster.webp`) so the card shows a still before the video starts.
 *
 * The poster frame: a few frames sampled across the clip, and the one with the most detail
 * (the spread of its grey levels) wins, brightness breaking ties. A clip that fades up from
 * black, or flashes white, does not hand the card a flat rectangle.
 */
import fs from 'node:fs'
import path from 'node:path'
import { ffmpeg, ffmpegBytes, MediaError, probe } from './util.mjs'

export const LOOP_DEFAULTS = {
  /** Output folder, relative to the game root. */
  out: 'dist-site',
  /** Long edge in px; a smaller source keeps its size. */
  edge: 720,
  /** x264 CRF: decorative, so small. */
  crf: 30,
  /** `webp` or `jpg`. */
  posterFormat: /** @type {'webp' | 'jpg'} */ ('webp'),
  /** Poster quality, 0 to 100. */
  posterQuality: 80,
  /** Fractions of the clip tried for the poster. */
  samples: [0.15, 0.4, 0.65],
  /** Seconds into the clip for the poster instead of sampling. */
  posterAt: /** @type {number | null} */ (null),
}

/** @typedef {typeof LOOP_DEFAULTS} LoopConfig */

/** Scale to cap the long edge at `edge`, keep the aspect, even sides, never upscale. @param {number} edge */
export function loopScale(edge) {
  return `scale='if(gt(a,1),min(${edge},iw),-2)':'if(gt(a,1),-2,min(${edge},ih))':flags=lanczos,scale=trunc(iw/2)*2:trunc(ih/2)*2`
}

/**
 * Detail and brightness of a grey frame's bytes: stdev + mean / 4.
 * @param {Uint8Array} px
 */
export function posterScore(px) {
  if (!px.length) return -1
  let sum = 0
  for (const v of px) sum += v
  const mean = sum / px.length
  let sq = 0
  for (const v of px) sq += (v - mean) ** 2
  return Math.sqrt(sq / px.length) + mean / 4
}

/**
 * The poster's time: `posterAt`, or the best of the sampled frames.
 * @param {string} file @param {number} duration @param {LoopConfig} cfg
 */
export function pickPosterTime(file, duration, cfg) {
  if (cfg.posterAt != null) return Math.min(cfg.posterAt, Math.max(0, duration - 0.05))
  let best = { t: Math.min(0.3, duration / 2), score: -1 }
  for (const f of cfg.samples) {
    const t = Math.max(0, Math.min(duration - 0.05, duration * f))
    const px = ffmpegBytes([
      ...['-ss', t.toFixed(3), '-i', file, '-frames:v', '1'],
      ...['-vf', 'scale=96:-2,format=gray', '-f', 'rawvideo'],
    ])
    const score = posterScore(px)
    if (score > best.score) best = { t, score }
  }
  return best.t
}

/**
 * @param {string} input  an mp4 (a cut, a store preview)
 * @param {LoopConfig & { root: string, name?: string }} cfg
 * @returns {{ mp4: string, poster: string, posterAt: number, mb: number }}
 */
export function makeLoop(input, cfg) {
  const src = probe(input)
  if (!src.video || !src.duration)
    throw new MediaError(`${input} has no video to loop: pass an mp4 (a cut or a store preview)`)
  const outDir = path.resolve(cfg.root, cfg.out)
  fs.mkdirSync(outDir, { recursive: true })
  const stem = cfg.name ?? path.basename(input).replace(/\.[^.]+$/, '')
  const mp4 = path.join(outDir, `${stem}.mp4`)
  if (path.resolve(mp4) === path.resolve(input))
    throw new MediaError(`the loop would overwrite its source ${input}: set --out or --name`)
  const scale = loopScale(cfg.edge)
  ffmpeg([
    ...['-i', input, '-vf', `${scale}:out_range=tv`, '-an', '-c:v', 'libx264'],
    '-profile:v',
    'high',
    ...['-pix_fmt', 'yuv420p', '-crf', String(cfg.crf), '-preset', 'slow'],
    ...['-movflags', '+faststart', mp4],
  ])
  const at = pickPosterTime(input, src.duration, cfg)
  const poster = path.join(outDir, `${stem}.poster.${cfg.posterFormat}`)
  const q =
    cfg.posterFormat === 'webp'
      ? ['-quality', String(cfg.posterQuality)]
      : ['-q:v', String(Math.max(2, Math.round(31 - (cfg.posterQuality / 100) * 29)))]
  ffmpeg(['-ss', at.toFixed(3), '-i', input, '-vf', scale, '-frames:v', '1', ...q, poster])
  return { mp4, poster, posterAt: at, mb: fs.statSync(mp4).size / 1e6 }
}
