// @ts-check
/**
 * `umm-dev making-of shot <url...> [--all <origin>] [--out <dir>] [--phone] [--wait <ms>]`
 *
 * Loads making-of pages in Chrome, shoots each toy, and exits 1 when a toy drew nothing, a page
 * logged an error, or something sticks out past the screen's edge. See docs/making-of.md.
 */
import { parseArgs } from 'node:util'
import { findGameRoot } from '../config.mjs'
import { problemsIn, shootPages } from '../making-of/shot.mjs'
import { pagesOnDisk } from '../making-of/site.mjs'

export const describe = 'check a making-of site: shoot each toy, fail on a blank toy or an error'

const HELP = `usage: umm-dev making-of shot <url...> [options]
       umm-dev making-of shot --all <origin> [options]

  --all <origin>  every page under making-of/ in this game, from a running server
                  (http://localhost:5173)
  --out <dir>     where the screenshots go (default test-results/making-of)
  --phone         a 375x812 phone at 2x, in place of 1280x800
  --wait <ms>     how long each toy runs before its shot (default 2500)

A toy with a WebGL world needs the GPU:
  umm-dev gpu run --name mo-shot -- umm-dev making-of shot --all http://localhost:5173

exit: 0 clean; 1 a toy drew nothing, a page logged an error, or an element is past the screen's
edge; 2 usage`

/** @param {string[]} args */
const parseOptions = (args) =>
  parseArgs({
    args,
    allowPositionals: true,
    options: {
      all: { type: 'string' },
      out: { type: 'string' },
      phone: { type: 'boolean' },
      wait: { type: 'string' },
    },
  })

/**
 * @param {string[]} argv
 * @param {{ cwd: string }} ctx
 */
export async function run(argv, ctx) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP)
    return 0
  }
  const [sub, ...rest] = argv
  if (sub !== 'shot') {
    console.error(HELP)
    return 2
  }
  /** @type {ReturnType<typeof parseOptions>} */
  let parsed
  try {
    parsed = parseOptions(rest)
  } catch (e) {
    console.error(`umm-dev making-of: ${/** @type {Error} */ (e).message}`)
    return 2
  }
  const { values, positionals } = parsed
  const wait = values.wait === undefined ? undefined : Number(values.wait)
  if (wait !== undefined && !(wait >= 0)) {
    console.error('umm-dev making-of: --wait takes milliseconds')
    return 2
  }
  const urls = [...positionals]
  if (values.all) {
    const origin = values.all.replace(/\/$/, '')
    for (const slug of pagesOnDisk(findGameRoot(ctx.cwd))) {
      urls.push(`${origin}/making-of/${slug === 'index' ? '' : `${slug}/`}`)
    }
  }
  if (urls.length === 0) {
    console.error(HELP)
    return 2
  }
  const shots = await shootPages(urls, {
    ...(values.out ? { out: values.out } : {}),
    ...(values.phone ? { phone: true } : {}),
    ...(wait === undefined ? {} : { wait }),
  })
  const bad = shots.filter((s) => problemsIn(s).length > 0)
  const toys = shots.reduce((n, s) => n + s.toys.length, 0)
  console.log(`\n${shots.length} pages, ${toys} toys, ${bad.length} pages with problems`)
  return bad.length ? 1 : 0
}
