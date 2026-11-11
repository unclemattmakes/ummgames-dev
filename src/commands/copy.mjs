// @ts-check
/**
 * `umm-dev copy <runtime path> [--to <path in game>] [--force] [--dry-run]`
 * `umm-dev copy --from <source> <path> [--to <path in game>] [--force] [--dry-run]`
 * `umm-dev copy [--from <source>] --list`
 *
 * Writes a runtime file (or every file in a runtime folder) into the game, line 1 a header that
 * names this package's version, the runtime path and the body's hash. With `--from`, the file
 * comes from one of the game's own sources (`runtime.sources`) instead, and the header names the
 * source, the commit and the path. See docs/runtime.md.
 */
import path from 'node:path'
import { parseArgs } from 'node:util'
import { loadConfig } from '../config.mjs'
import { copyRuntime, copySource, missingSiblings } from '../runtime/copy.mjs'
import { listRuntime, packageVersion } from '../runtime/source.mjs'
import { getSource, listSource, resolveSources } from '../runtime/sources.mjs'

export const describe = 'copy a runtime/ file into the game, stamped for drift'

const HELP = `usage: umm-dev copy <runtime path> [--to <path in game>] [--force] [--dry-run]
       umm-dev copy --from <source> <path> [--to <path in game>] [--force] [--dry-run]
       umm-dev copy [--from <source>] --list

  <runtime path>  a file or folder under runtime/ (dev/fuzzy.ts, runtime/dev, input)
  --to <path>     where it goes, from the game root: a file, or a folder (trailing /)
                  default: <runtime.into>/<path under runtime/>, runtime.into = "src"
                  (dev/perf-hud.ts -> src/dev/perf-hud.ts). A game that keeps
                  the file elsewhere must pass --to <its path>, or it gets a second copy.
  --force         overwrite a copy changed here; a file that is not a copy only
                  when <runtime path> names that one file (a folder copy never does)
  --dry-run       say what would be written, write nothing
  --from <source> copy from one of the game's own sources instead: a git checkout
                  named in runtime.sources, read at its ref (committed work only).
                  <path> is the file or folder in that checkout; default
                  destination <runtime.into>/<path>
  --list          list the runtime files this version ships, or with --from,
                  the files the source has at its ref

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
        from: { type: 'string' },
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
  const cfg = await loadConfig('runtime', { into: 'src', sources: {} }, ctx.cwd)
  const from = /** @type {string | undefined} */ (values.from)
  /** @type {Record<string, import('../runtime/sources.mjs').Source>} */
  let sources = {}
  if (from !== undefined) {
    try {
      sources = resolveSources(
        /** @type {Record<string, import('../runtime/sources.mjs').SourceConfig>} */ (cfg.sources),
        cfg.root,
      )
      getSource(sources, from)
    } catch (e) {
      console.error(`umm-dev copy: ${e instanceof Error ? e.message : e}`)
      return 2
    }
  }
  if (values.list) {
    if (from !== undefined) {
      const src = getSource(sources, from)
      console.log(`files in source ${from} (${src.repo}) at ${src.ref}:`)
      for (const f of listSource(src)) console.log(`  ${f}`)
      return 0
    }
    console.log(`runtime files in @ummgames/dev ${packageVersion()}:`)
    for (const f of listRuntime()) console.log(`  ${f.slice('runtime/'.length)}`)
    return 0
  }
  if (positionals.length !== 1) {
    console.error(
      `umm-dev copy: name one ${from === undefined ? 'runtime' : 'source'} file or folder\n\n${HELP}`,
    )
    return 2
  }
  const spec = /** @type {string} */ (positionals[0])
  const common = {
    spec,
    root: cfg.root,
    into: cfg.into,
    to: /** @type {string | undefined} */ (values.to),
    force: Boolean(values.force),
    dryRun: Boolean(values['dry-run']),
  }
  let results
  try {
    results =
      from === undefined ? copyRuntime(common) : copySource({ ...common, name: from, sources })
  } catch (e) {
    const list = from === undefined ? 'umm-dev copy --list' : `umm-dev copy --from ${from} --list`
    console.error(`umm-dev copy: ${e instanceof Error ? e.message : e}. ${list} shows them.`)
    return 2
  }
  let refused = 0
  for (const r of results) {
    const short =
      from === undefined ? r.runtimePath.slice('runtime/'.length) : `${from} ${r.runtimePath}`
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
