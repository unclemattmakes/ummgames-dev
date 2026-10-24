// @ts-check
/**
 * `umm-dev cut`: an edit list (edl.mjs) over captured clips, to one mp4. With `print`, or when
 * ffmpeg is not on PATH, nothing runs: the commands are printed to run elsewhere.
 */
import fs from 'node:fs'
import path from 'node:path'
import { validateEdl } from './edl.mjs'
import { planCut } from './graph.mjs'
import { ffmpeg, hasBin, MediaError, rel } from './util.mjs'

/**
 * Find a clip on disk. A capture folder's `<clip>/<clip>.mp4` first, then a loose
 * `<clip>.mp4`, an ffmpeg concat list (`<clip>/list.txt`), or the bare frames.
 * @param {string} clip @param {string} dir @param {number} clipFps
 * @param {{ lenient?: boolean }} [opts]  lenient: assume the first form (for `--print`)
 * @returns {import('./graph.mjs').ClipSource}
 */
export function resolveClip(clip, dir, clipFps, opts = {}) {
  const retime = `setpts=N/${clipFps}/TB`
  const inFolder = path.join(dir, clip, `${clip}.mp4`)
  if (fs.existsSync(inFolder)) return { args: ['-i', inFolder], retime }
  const loose = path.join(dir, `${clip}.mp4`)
  if (fs.existsSync(loose)) return { args: ['-i', loose], retime }
  const list = path.join(dir, clip, 'list.txt')
  if (fs.existsSync(list))
    return {
      args: ['-f', 'concat', '-safe', '0', '-i', list],
      retime: `fps=${clipFps},setpts=N/${clipFps}/TB`,
    }
  for (const ext of ['jpg', 'png']) {
    if (fs.existsSync(path.join(dir, clip, `f00000.${ext}`)))
      return {
        args: ['-framerate', String(clipFps), '-i', path.join(dir, clip, `f%05d.${ext}`)],
        retime,
      }
  }
  if (opts.lenient) return { args: ['-i', inFolder], retime }
  throw new MediaError(`no clip "${clip}" in ${dir}: capture it, or fix "clips" in the edit list`)
}

/**
 * @param {import('./edl.mjs').Edl} edl
 * @param {{ root: string, draft?: boolean, print?: boolean, font?: string | null, log?: (l: string) => void }} opts
 * @returns {{ out: string, length: number, mb: number | null, printed: boolean }}
 */
export function cutEdl(edl, opts) {
  const log = opts.log ?? console.log
  const errs = validateEdl(edl, { font: opts.font })
  if (errs.length) throw new MediaError(`the edit list has problems:\n  ${errs.join('\n  ')}`)
  const noFfmpeg = !opts.print && !hasBin('ffmpeg')
  const print = Boolean(opts.print) || noFfmpeg
  if (noFfmpeg) log('# ffmpeg is not on PATH: printing the commands instead of running them.')
  const plan = planCut(edl, {
    root: opts.root,
    draft: opts.draft,
    font: opts.font ? path.resolve(opts.root, opts.font) : null,
    resolveClip: (c, d, f) => resolveClip(c, d, f, { lenient: print }),
  })
  if (!print) {
    fs.rmSync(plan.segDir, { recursive: true, force: true })
    fs.mkdirSync(plan.segDir, { recursive: true })
  } else log(`mkdir -p ${JSON.stringify(plan.segDir)}`)
  try {
    for (const c of plan.commands) {
      log(print ? `# ${c.label}` : c.label)
      ffmpeg(c.args, { print, log })
    }
  } finally {
    if (!print) fs.rmSync(plan.segDir, { recursive: true, force: true })
  }
  if (print) {
    log(`# would write ${plan.out} (${plan.length.toFixed(2)} s)`)
    return { out: plan.out, length: plan.length, mb: null, printed: true }
  }
  const mb = fs.statSync(plan.out).size / 1e6
  const [W, H] = plan.size
  log(
    `wrote ${rel(opts.root, plan.out)} (${plan.length.toFixed(2)} s, ${W}x${H}, ${mb.toFixed(1)} MB)`,
  )
  if (edl.maxMB && mb > edl.maxMB)
    throw new MediaError(
      `${rel(opts.root, plan.out)} is ${mb.toFixed(1)} MB, over "maxMB" ${edl.maxMB}: raise "crf" in the edit list`,
    )
  return { out: plan.out, length: plan.length, mb, printed: false }
}
