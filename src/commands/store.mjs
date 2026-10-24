// @ts-check
import { loadConfig } from '../config.mjs'
import { CAPTURE_DEFAULTS } from '../media/capture.mjs'
import { runStore, STEPS, STORE_DEFAULTS } from '../media/store.mjs'
import { guard, parse, UsageError } from '../media/util.mjs'

export const describe =
  'make a portal store kit: covers, icons, preview videos, spec checks (docs/media.md)'

const USAGE = `usage: umm-dev store [--steps <list>] [--no-capture] [--only <shots>] [--draft] [--igpu]

Runs the game's store recipe end to end, in six steps:
  ${STEPS.join(', ')}.
Captures the kit's shots, renders the stills from the game's HTML or SVG templates, cuts each
video's edit list, writes a review sheet of every in-point, and checks every output against
the preset.

options:
  --steps <list>    comma-separated steps to run, always in the order above
                    (default all: ${STEPS.join(',')})
  --no-capture      every chosen step but capture: rebuild from the captures already made
  --only <shots>    capture only these shots (comma-separated); the other steps still run
  --draft           fast video encodes, written as <out stem>-draft.mp4 (not for upload; the
                    check step checks the full-quality file, not the draft)
  --igpu            capture on the integrated GPU
  -h, --help        print this help

exit codes: 0 the kit passes its preset; 1 a FAIL or MISSING line, or a stop at preflight,
capture, stills or cut; 2 a usage mistake.

umm-dev.config.mjs, section store: preset (default ${STORE_DEFAULTS.preset}), out (default ${STORE_DEFAULTS.out}),
shots, sheetEvery, stills, videos, preflight. The capture and stills steps also read the capture
section. docs/media.md has the recipe's files and the preset schema.`

/** @param {string[]} argv @param {{ cwd: string }} ctx */
export async function run(argv, ctx) {
  return guard(USAGE, async () => {
    const { values: o } = parse(argv, {
      help: { type: 'boolean', short: 'h' },
      steps: { type: 'string' },
      'no-capture': { type: 'boolean' },
      only: { type: 'string' },
      draft: { type: 'boolean' },
      igpu: { type: 'boolean' },
    })
    if (o.help) {
      console.log(USAGE)
      return 0
    }
    /** @type {import('../media/store.mjs').Step[]} */
    let steps = [...STEPS]
    if (o.steps) {
      const asked = o.steps.split(',').map((s) => s.trim())
      const bad = asked.filter((s) => !STEPS.includes(/** @type {any} */ (s)))
      if (bad.length)
        throw new UsageError(`no step ${bad.join(', ')}: steps are ${STEPS.join(', ')}`)
      steps = STEPS.filter((s) => asked.includes(s))
    }
    if (o['no-capture']) steps = steps.filter((s) => s !== 'capture')
    const store = await loadConfig('store', STORE_DEFAULTS, ctx.cwd)
    const capture = await loadConfig('capture', CAPTURE_DEFAULTS, ctx.cwd)
    const { ok } = await runStore({
      store,
      capture,
      steps,
      only: o.only ? o.only.split(',').map((s) => s.trim()) : null,
      igpu: o.igpu,
      draft: o.draft,
    })
    if (!ok) {
      console.error('\nthe kit fails its preset: fix each FAIL or MISSING line above')
      return 1
    }
    console.log(`\nstore done: ${store.out}/`)
    return 0
  })
}
