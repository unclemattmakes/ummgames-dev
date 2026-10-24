// @ts-check
import path from 'node:path'
import { loadConfig } from '../config.mjs'
import { CAPTURE_DEFAULTS, captureShots, loadShots } from '../media/capture.mjs'
import { compareCaptures } from '../media/compare.mjs'
import { guard, isSafeName, MediaError, parse, rel, UsageError } from '../media/util.mjs'

export const describe = 'record shots of the game in virtual time, frame-exact (docs/media.md)'

const USAGE = `usage: umm-dev capture <shot...> [options]
       umm-dev capture --all [options]
       umm-dev capture --list
       umm-dev capture --compare <dirA> <dirB>

Records each shot at exactly capture.fps in virtual time: the page's clock waits for every
frame to be written, so a slow GPU makes a capture slower, never choppier. Per shot, in
<out>/<name>/: the frames, <name>.mp4, meta.json, and sheet.jpg with --sheet.

options:
  --file <shots.json>   the shots (default capture.shots: ${CAPTURE_DEFAULTS.shots})
  --out <dir>           output folder (default capture.out: ${CAPTURE_DEFAULTS.out})
  --all                 every shot in the file
  --sheet               a contact sheet per shot, tiles labelled with their game frame
  --every <s>           seconds between sheet tiles (default 0.1)
  --crop <w:h:x:y>      crop the sheet's tiles, in canvas px
  --igpu                Chromium on the integrated GPU
  --tag <t>             write to <name>@<t>, to --compare two runs of one shot
  --list                print the shots and exit
  --compare <a> <b>     are two capture folders the same footage? exit 0 if so

umm-dev.config.mjs, section capture: url, vite, port (CAPTURE_PORT overrides), path, query,
debugGlobal, ready, hold, bootFrames, hide, prep, state, shotUrl, fps, seed, skip, size, dpr,
grab, canvas, keyTarget, quality, crf, shots, out, font, browser, bootTimeout.
docs/media.md has each one and the shot fields.`

/** @param {string[]} argv @param {{ cwd: string }} ctx */
export async function run(argv, ctx) {
  return guard(USAGE, async () => {
    const { values: o, positionals } = parse(argv, {
      help: { type: 'boolean', short: 'h' },
      file: { type: 'string' },
      out: { type: 'string' },
      all: { type: 'boolean' },
      sheet: { type: 'boolean' },
      every: { type: 'string' },
      crop: { type: 'string' },
      igpu: { type: 'boolean' },
      tag: { type: 'string' },
      list: { type: 'boolean' },
      compare: { type: 'boolean' },
    })
    if (o.help) {
      console.log(USAGE)
      return 0
    }
    if (o.compare) {
      if (positionals.length !== 2) throw new UsageError('--compare takes two capture folders')
      const [a, b] = positionals.map((p) => path.resolve(ctx.cwd, p))
      const { same, lines } = compareCaptures(a, b)
      for (const l of lines) console.log(l)
      console.log(same ? 'SAME footage' : 'DIFFERENT footage')
      return same ? 0 : 1
    }
    const cfg = await loadConfig('capture', CAPTURE_DEFAULTS, ctx.cwd)
    const file = path.resolve(o.file ? ctx.cwd : cfg.root, o.file ?? cfg.shots)
    const all = loadShots(file)
    if (o.list) {
      for (const s of all) console.log(`${s.name}${s.why ? `  ${s.why}` : ''}`)
      return 0
    }
    if (!positionals.length && !o.all)
      throw new UsageError(
        `name the shots to capture, or --all. Shots in ${rel(cfg.root, file)}: ${all.map((s) => s.name).join(', ')}`,
      )
    const shots = o.all
      ? all
      : positionals.map((n) => {
          const s = all.find((x) => x.name === n)
          if (!s)
            throw new MediaError(`no shot "${n}" in ${rel(cfg.root, file)} (--list shows them)`)
          return s
        })
    if (o.tag != null && !isSafeName(o.tag))
      throw new UsageError(
        `--tag must be a folder-safe name (letters, digits, . _ @ -; not only dots), got "${o.tag}"`,
      )
    const every = o.every == null ? 0.1 : Number(o.every)
    if (!(every > 0)) throw new UsageError('--every must be seconds > 0')
    if (o.crop != null && !/^\d+:\d+:\d+:\d+$/.test(o.crop))
      throw new UsageError('--crop must be w:h:x:y in canvas px')
    const results = await captureShots({
      cfg,
      shots,
      out: path.resolve(o.out ? ctx.cwd : cfg.root, o.out ?? cfg.out),
      sheet: o.sheet || o.every || o.crop ? { every, crop: o.crop ?? null } : null,
      igpu: o.igpu,
      tag: o.tag,
    })
    const failed = results.filter((r) => !r.ok)
    if (failed.length) {
      console.error(
        `\n${failed.length} of ${results.length} shots failed: ${failed.map((r) => r.name).join(', ')}.\nAn unmet expect means content moved under the recipe: re-pick from/dur (its why says what the frame is for).`,
      )
      return 1
    }
    return 0
  })
}
