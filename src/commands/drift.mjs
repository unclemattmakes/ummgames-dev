// @ts-check
/**
 * `umm-dev drift [--json] [--diff] [--strict]`
 *
 * Lists every runtime copy in the game (found by its header) and whether it changed here, upstream
 * (the installed `runtime/` file), or both. Drift is information: the exit code is 0 unless
 * `--strict`. See docs/runtime.md.
 */
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { findGameRoot } from '../config.mjs'
import { unifiedDiff } from '../runtime/diff.mjs'
import {
  advice,
  fetchOriginal,
  installedVersion,
  STATUS_TEXT,
  scanDrift,
} from '../runtime/drift.mjs'
import { parseCopy } from '../runtime/header.mjs'
import { readRuntime } from '../runtime/source.mjs'

export const describe = 'report how far each copied runtime file has drifted'

const HELP = `usage: umm-dev drift [--json] [--diff] [--strict]

  --json    one JSON object: { root, installed, copies: [...] }
  --diff    show the changes: here (original -> the game's copy) and upstream
            (original -> the installed file). When both changed, the original comes
            from the clone UMM_DEV_REPO names, at the header's tag, or from the public
            repo; offline, the copy is compared with the installed file instead.
  --strict  exit 1 when any copy is not current (for CI)

Finds copies by their line 1 header (git ls-files in a checkout). Each is current,
changed here, changed upstream, changed here and upstream, or no longer shipped.
After bumping the kit, run each "take it:" line as printed: it keeps the copy's path.

exit: 0 reported (drift or not); 1 --strict and something drifted; 2 usage`

/**
 * @param {string[]} argv
 * @param {{ cwd: string }} ctx
 */
export async function run(argv, ctx) {
  /** @type {{ json?: boolean, diff?: boolean, strict?: boolean, help?: boolean }} */
  let values
  try {
    values = parseArgs({
      args: argv,
      options: {
        json: { type: 'boolean' },
        diff: { type: 'boolean' },
        strict: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    }).values
  } catch (e) {
    console.error(`umm-dev drift: ${e instanceof Error ? e.message : e}\n\n${HELP}`)
    return 2
  }
  if (values.help) {
    console.log(HELP)
    return 0
  }
  const root = findGameRoot(ctx.cwd)
  const copies = scanDrift({ root })
  const installed = installedVersion()
  const drifted = copies.some((c) => c.status !== 'current')

  if (values.json) {
    console.log(JSON.stringify({ root, installed, copies }, null, 2))
    return values.strict && drifted ? 1 : 0
  }

  if (copies.length === 0) {
    console.log(`no runtime copies in ${root} (umm-dev copy makes them)`)
    return 0
  }
  console.log(`${copies.length} runtime copies in ${root}; installed @ummgames/dev ${installed}\n`)
  const w = Math.max(...copies.map((c) => c.file.length))
  for (const c of copies) {
    console.log(`  ${c.file.padEnd(w)}  ${c.version.padEnd(8)} ${STATUS_TEXT[c.status]}`)
    const next = advice(c)
    if (next) console.log(`  ${''.padEnd(w)}  ${''.padEnd(8)} ${next}`)
  }

  if (values.diff) {
    for (const c of copies) {
      if (c.status === 'current') continue
      console.log(`\n=== ${c.file} (${c.runtimePath}, copied at ${c.version})`)
      const local = /** @type {{ body: string }} */ (
        parseCopy(fs.readFileSync(path.join(root, c.file), 'utf8'))
      ).body
      const upstream = readRuntime(c.runtimePath)
      /** @type {string | null} */
      let original = null
      if (!c.changedHere) original = local
      else if (!c.changedUpstream && upstream !== null) original = upstream
      else {
        const got = await fetchOriginal(c)
        if (got.text !== null) {
          original = got.text
          console.log(`(original from ${got.from})`)
        } else {
          console.log(`(the original at ${c.version} is not available: ${got.why})`)
          console.log('(set UMM_DEV_REPO to a local clone to diff offline)')
        }
      }
      if (original !== null) {
        if (c.changedHere)
          process.stdout.write(
            unifiedDiff(original, local, { from: `${c.version} ${c.runtimePath}`, to: c.file }),
          )
        if (c.changedUpstream && upstream !== null)
          process.stdout.write(
            unifiedDiff(original, upstream, {
              from: `${c.version} ${c.runtimePath}`,
              to: `installed ${installed} ${c.runtimePath}`,
            }),
          )
      } else if (upstream !== null) {
        process.stdout.write(
          unifiedDiff(upstream, local, {
            from: `installed ${installed} ${c.runtimePath}`,
            to: c.file,
          }),
        )
      }
    }
  }
  return values.strict && drifted ? 1 : 0
}
