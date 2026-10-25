// @ts-check
/**
 * `umm-dev copy <runtime path> [--to <path in game>] [--force] [--dry-run]`
 * `umm-dev copy --list`
 *
 * Writes a runtime file (or every file in a runtime folder) into the game, line 1 a header that
 * names this package's version, the runtime path and the body's hash. See docs/runtime.md.
 */
import path from 'node:path'
import { parseArgs } from 'node:util'
import { loadConfig } from '../config.mjs'
import { copyRuntime, missingSiblings } from '../runtime/copy.mjs'
import { listRuntime, packageVersion } from '../runtime/source.mjs'

export const describe = 'copy a runtime/ file into the game, stamped for drift'

const HELP = `usage: umm-dev copy <runtime path> [--to <path in game>] [--force] [--dry-run]
       umm-dev copy --list

  <runtime path>  a file or folder under runtime/ (dev/fuzzy.ts, runtime/dev, input)
  --to <path>     where it goes, from the game root: a file, or a folder (trailing /)
                  default: <runtime.into>/<path under runtime/>, runtime.into = "src"
                  (dev/perf-hud.ts -> src/dev/perf-hud.ts). A game that keeps
                  the file elsewhere must pass --to <its path>, or it gets a second copy.
  --force         overwrite a copy changed here; a file that is not a copy only
                  when <runtime path> names that one file (a folder copy never does)
  --dry-run       say what would be written, write nothing
  --list          list the runtime files this version ships

Over an existing file it writes only an untouched copy, unless --force.
Take over a game's own file one at a time: copy <file> --to <its path> --force.

exit: 0 written or already current; 1 something refused; 2 usage`

/**
 * @param {string[]} argv
 * @param {{ cwd: string }} ctx
 */
export async function run(argv, ctx) {
  /** @type {ReturnType<typeof parseArgs>} */
  let args
  try {
    args = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        to: { type: 'string' },
        force: { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        list: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    })
  } catch (e) {
    console.error(`umm-dev copy: ${e instanceof Error ? e.message : e}\n\n${HELP}`)
    return 2
  }
  const { values, positionals } = args
  if (values.help) {
    console.log(HELP)
    return 0
  }
  if (values.list) {
    console.log(`runtime files in @ummgames/dev ${packageVersion()}:`)
    for (const f of listRuntime()) console.log(`  ${f.slice('runtime/'.length)}`)
    return 0
  }
  if (positionals.length !== 1) {
    console.error(`umm-dev copy: name one runtime file or folder\n\n${HELP}`)
    return 2
  }
  const cfg = await loadConfig('runtime', { into: 'src' }, ctx.cwd)
  const spec = /** @type {string} */ (positionals[0])
  let results
  try {
    results = copyRuntime({
      spec,
      root: cfg.root,
      into: cfg.into,
      to: /** @type {string | undefined} */ (values.to),
      force: Boolean(values.force),
      dryRun: Boolean(values['dry-run']),
    })
  } catch (e) {
    console.error(
      `umm-dev copy: ${e instanceof Error ? e.message : e}. umm-dev copy --list shows them.`,
    )
    return 2
  }
  let refused = 0
  for (const r of results) {
    const short = r.runtimePath.slice('runtime/'.length)
    if (r.outcome === 'refused') {
      refused++
      console.error(`refused  ${r.file}: ${r.reason}`)
      continue
    }
    console.log(`${r.outcome.padEnd(8)} ${r.file}  (from ${short})`)
    if (r.outcome === 'written' || r.outcome === 'updated') {
      for (const s of missingSiblings(path.join(cfg.root, r.file)))
        console.log(`         imports ${s}, which is not beside it: copy that too`)
    }
  }
  return refused ? 1 : 0
}
