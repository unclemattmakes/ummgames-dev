// @ts-check
/**
 * `umm-dev portal check [--no-build] [--dir <dir>] [--out <dir>] [--only <run,...>] [--cpu] [--headed]`
 *
 * The portal build as a portal runs it, in Chrome: the folder against the upload rules, the code
 * against the game's forbidden words, then each run in the fake portal with the game's own play
 * steps. Exits 1 on any failure. See docs/portal.md.
 */
import { parseArgs } from 'node:util'
import { loadConfig } from '../config.mjs'
import { runPortalCheck } from '../testing/portal-check.mjs'

export const describe = 'check a portal build in Chrome: upload rules, other hosts, SDK calls, play'

const HELP = `usage: umm-dev portal check [options]

  --no-build          skip portal.build, check the folder as it is
  --dir <dir>         the built portal folder (default portal.dir, dist-portal)
  --out <dir>         where the stills and report.json go (default portal.out,
                      test-results/portal-check)
  --only <run,...>    only these runs, by name (default every run in portal.runs:
                      desktop, nosdk)
  --cpu               draw in software (SwiftShader): needs no GPU lease, far slower
  --headed            show the browser

Each run opens the build in the fake portal (an iframe on https://portal.test, a fake
CrazyGames SDK, every other host blocked), waits for portal.ready, shoots the title, runs the
game's portal.play steps, and fails on a console error, a request to another host, a missing
file, a WebSocket dial, a load over portal.loadLimitMs (20000), or SDK calls out of order.
The rest of the settings come from the game's umm-dev.config.mjs, portal: { ... }.

On the GPU, take the lease:
  umm-dev gpu run --name portal-check -- umm-dev portal check

Docs: docs/portal.md.

exit: 0 passed; 1 a check failed; 2 usage, or Chrome or Playwright missing`

/** @type {import('../testing/index.d.ts').PortalCheckConfig} */
const DEFAULTS = {
  dir: 'dist-portal',
  build: null,
  out: 'test-results/portal-check',
  forbidden: [],
  ready: null,
  readyTimeoutMs: 60_000,
  loadLimitMs: 20_000,
  settleMs: 1000,
  play: null,
  noAds: false,
  hideGamepads: true,
}

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
  if (sub !== 'check') {
    console.error(HELP)
    return 2
  }
  /** @type {{ values: Record<string, string | boolean | undefined> }} */
  let parsed
  try {
    parsed = parseArgs({
      args: rest,
      options: {
        'no-build': { type: 'boolean' },
        dir: { type: 'string' },
        out: { type: 'string' },
        only: { type: 'string' },
        cpu: { type: 'boolean' },
        headed: { type: 'boolean' },
      },
    })
  } catch (e) {
    console.error(`umm-dev portal: ${e instanceof Error ? e.message : e}\n\n${HELP}`)
    return 2
  }
  const { values } = parsed
  const cfg = await loadConfig('portal', /** @type {Record<string, unknown>} */ (DEFAULTS), ctx.cwd)
  const { root, ...own } = cfg
  /** @type {import('../testing/index.d.ts').PortalCheckOptions} */
  const options = {
    .../** @type {import('../testing/index.d.ts').PortalCheckConfig} */ (own),
    root,
    cpu: values.cpu === true,
    headed: values.headed === true,
  }
  if (values['no-build']) options.build = null
  if (typeof values.dir === 'string') options.dir = values.dir
  if (typeof values.out === 'string') options.out = values.out
  if (typeof values.only === 'string') {
    const names = values.only
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const known = (options.runs ?? [{ name: 'desktop' }, { name: 'nosdk' }]).map((r) => r.name)
    const unknown = names.filter((n) => !known.includes(n))
    if (unknown.length) {
      console.error(
        `umm-dev portal: no run named ${unknown.join(', ')} (runs: ${known.join(', ')})`,
      )
      return 2
    }
    options.only = names
  }
  try {
    const result = await runPortalCheck(options)
    return result.ok ? 0 : 1
  } catch (e) {
    console.error(`umm-dev portal: ${e instanceof Error ? e.message : e}`)
    return 2
  }
}
