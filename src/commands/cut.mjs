// @ts-check
import path from 'node:path'
import { findGameRoot } from '../config.mjs'
import { cutEdl } from '../media/cut.mjs'
import { validateEdl } from '../media/edl.mjs'
import { guard, MediaError, parse, readJson, UsageError } from '../media/util.mjs'

export const describe = 'cut a video from an edit list over captured clips (docs/media.md)'

const USAGE = `usage: umm-dev cut <edl.json> [--draft] [--print] [--font <file>] [--check]

Cuts one mp4 from an edit list: shots trimmed and re-timed from game frames, sped, reversed,
reframed or graded; joined with cuts, dissolves or matched wipes; overlays, text cards, fades
and optional music. Paths in the edit list are relative to the game root.

options:
  --draft          fast encodes, written beside the output as <out>-draft.mp4
  --print          print the ffmpeg commands instead of running them (also without ffmpeg)
  --font <file>    a .ttf or .otf for text cards when the edit list names none
  --check          validate the edit list and exit

docs/media.md lists the edit list's fields.`

/** @param {string[]} argv @param {{ cwd: string }} ctx */
export async function run(argv, ctx) {
  return guard(USAGE, async () => {
    const { values: o, positionals } = parse(argv, {
      help: { type: 'boolean', short: 'h' },
      draft: { type: 'boolean' },
      print: { type: 'boolean' },
      font: { type: 'string' },
      check: { type: 'boolean' },
    })
    if (o.help) {
      console.log(USAGE)
      return 0
    }
    if (positionals.length !== 1) throw new UsageError('name one edit list (a .json file)')
    const file = path.resolve(ctx.cwd, positionals[0])
    const edl = readJson(file)
    const font = o.font ? path.resolve(ctx.cwd, o.font) : null
    if (o.check) {
      const errs = validateEdl(edl, { font })
      if (errs.length) throw new MediaError(`${positionals[0]}:\n  ${errs.join('\n  ')}`)
      console.log(`${positionals[0]}: ok`)
      return 0
    }
    cutEdl(edl, { root: findGameRoot(ctx.cwd), draft: o.draft, print: o.print, font })
    return 0
  })
}
