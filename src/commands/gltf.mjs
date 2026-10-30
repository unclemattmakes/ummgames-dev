// @ts-check
/**
 * `umm-dev gltf optimize <file...> [--level medium|high] [--no-keep-extras] [--dry-run]`
 *
 * Shrinks each GLB in place with `optimizeGlb` from `@ummgames/dev/gltf` and prints a size line
 * per file. Needs the glTF packages in the game (optional peers). See docs/gltf.md.
 */
import { parseArgs } from 'node:util'
import { OPTIMIZE_LEVELS, optimizeGlb } from '../gltf/index.mjs'

export const describe = 'shrink GLB files in place: dedup, weld, prune, meshopt'

const HELP = `usage: umm-dev gltf optimize <file...> [--level medium|high] [--no-keep-extras] [--dry-run]

  optimize           rewrite each GLB in place: dedup, weld, prune, then meshopt
                     compression with quantization. Never joins or flattens meshes,
                     so node names and extras survive. Reads KHR_ and EXT_meshopt input.
  --level <level>    meshopt level: medium or high (default medium)
  --no-keep-extras   let prune remove unused nodes, meshes and materials even when
                     they carry extras (default: keep them)
  --dry-run          print the sizes, write nothing

A file is rewritten only when the result is smaller. A file optimized once grows if
quantized again, so a second run leaves it alone and says "(not written: no smaller)".

Needs @gltf-transform/core, /extensions and /functions 4.5.1 and meshoptimizer 1.3.0
in the game: pnpm add -D @gltf-transform/core@4.5.1 @gltf-transform/extensions@4.5.1 @gltf-transform/functions@4.5.1 meshoptimizer@1.3.0

Prints one line per file: <file>: <before> -> <after> bytes (<after as % of before>)

exit: 0 every file optimized; 1 a file failed (the rest still run); 2 usage`

/** @param {unknown} e */
const message = (e) => (e instanceof Error ? e.message : String(e))

/**
 * @param {string[]} argv
 * @param {{ cwd: string }} _ctx
 */
export async function run(argv, _ctx) {
  /** @type {{ values: Record<string, string | boolean | undefined>, positionals: string[] }} */
  let args
  try {
    args = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        level: { type: 'string' },
        'no-keep-extras': { type: 'boolean' },
        'dry-run': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    })
  } catch (e) {
    console.error(`umm-dev gltf: ${message(e)}\n\n${HELP}`)
    return 2
  }
  const { values, positionals } = args
  if (values.help) {
    console.log(HELP)
    return 0
  }
  const [sub, ...files] = positionals
  if (sub !== 'optimize') {
    console.error(
      `umm-dev gltf: ${sub ? `no subcommand "${sub}"` : 'name a subcommand'}\n\n${HELP}`,
    )
    return 2
  }
  if (files.length === 0) {
    console.error(`umm-dev gltf: name at least one .glb file\n\n${HELP}`)
    return 2
  }
  const level = /** @type {string | undefined} */ (values.level) ?? 'medium'
  if (!OPTIMIZE_LEVELS.includes(level)) {
    console.error(`umm-dev gltf: --level must be medium or high, not "${level}"`)
    return 2
  }
  const keepExtras = !values['no-keep-extras']
  const dryRun = values['dry-run'] === true

  let failed = false
  for (const file of files) {
    try {
      const { before, after, written } = await optimizeGlb(file, {
        level: /** @type {'medium' | 'high'} */ (level),
        keepExtras,
        dryRun,
      })
      const pct = before > 0 ? Math.round((100 * after) / before) : 0
      const note = dryRun ? ' (dry run, not written)' : written ? '' : ' (not written: no smaller)'
      console.log(`${file}: ${before} -> ${after} bytes (${pct}%)${note}`)
    } catch (e) {
      console.error(`umm-dev gltf: ${file}: ${message(e)}`)
      failed = true
    }
  }
  return failed ? 1 : 0
}
