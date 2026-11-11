// @ts-check
/**
 * `umm-dev drift [--json] [--diff] [--strict]`
 *
 * Lists every runtime copy in the game (found by its header) and whether it changed here, upstream
 * (the installed `runtime/` file, or for a copy from one of the game's own sources, that source's
 * file at its ref), or both. Drift is information: the exit code is 0 unless `--strict`.
 * See docs/runtime.md.
 */
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { loadConfig } from '../config.mjs'
import { unifiedDiff } from '../runtime/diff.mjs'
import {
  advice,
  fetchOriginal,
  installedVersion,
  readCopy,
  STATUS_TEXT,
  scanDrift,
  sourceOriginal,
} from '../runtime/drift.mjs'
import { readRuntime } from '../runtime/source.mjs'
import { readSource, resolveSources } from '../runtime/sources.mjs'

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
A copy from one of the game's own sources (copy --from) compares with that source's
file at its ref, read through git; "source not found" when runtime.sources does not
name it or its checkout is not on this machine. --diff reads its original from the
source at the header's commit.
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
  const cfg = await loadConfig('runtime', { sources: {} }, ctx.cwd)
  const root = cfg.root
  /** @type {Record<string, import('../runtime/sources.mjs').Source>} */
  let sources
  try {
    sources = resolveSources(
      /** @type {Record<string, import('../runtime/sources.mjs').SourceConfig>} */ (cfg.sources),
      root,
    )
  } catch (e) {
    console.error(`umm-dev drift: ${e instanceof Error ? e.message : e}`)
    return 2
  }
  const copies = scanDrift({ root, sources })
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
  // A source copy's version is a 12-digit commit, longer than a tag.
  const vw = Math.max(8, ...copies.map((c) => c.version.length + 1))
  for (const c of copies) {
    console.log(`  ${c.file.padEnd(w)}  ${c.version.padEnd(vw)} ${STATUS_TEXT[c.status]}`)
    const next = advice(c)
    if (next) console.log(`  ${''.padEnd(w)}  ${''.padEnd(vw)} ${next}`)
  }

  if (values.diff) {
    for (const c of copies) {
      if (c.status === 'current') continue
      const from = c.source === null ? '' : `${c.source} `
      console.log(`\n=== ${c.file} (${from}${c.runtimePath}, copied at ${c.version})`)
      const local = /** @type {{ body: string }} */ (
        readCopy(fs.readFileSync(path.join(root, c.file), 'utf8'))
      ).body
      const src = c.source === null ? undefined : sources[c.source]
      const upstream =
        c.source === null ? readRuntime(c.runtimePath) : src ? readSource(src, c.runtimePath) : null
      /** @type {string | null} */
      let original = null
      if (!c.changedHere) original = local
      else if (!c.changedUpstream && upstream !== null) original = upstream
      else {
        const got = c.source === null ? await fetchOriginal(c) : sourceOriginal(c, sources)
        if (got.text !== null) {
          original = got.text
          console.log(`(original from ${got.from})`)
        } else {
          console.log(`(the original at ${c.version} is not available: ${got.why})`)
          if (c.source === null) console.log('(set UMM_DEV_REPO to a local clone to diff offline)')
        }
      }
      if (original !== null) {
        if (c.changedHere)
          process.stdout.write(
            unifiedDiff(original, local, {
              from: `${from}${c.version} ${c.runtimePath}`,
              to: c.file,
            }),
          )
        if (c.changedUpstream && upstream !== null)
          process.stdout.write(
            unifiedDiff(original, upstream, {
              from: `${from}${c.version} ${c.runtimePath}`,
              to: `${upstreamName(c, src, installed)} ${c.runtimePath}`,
            }),
          )
      } else if (upstream !== null) {
        process.stdout.write(
          unifiedDiff(upstream, local, {
            from: `${upstreamName(c, src, installed)} ${c.runtimePath}`,
            to: c.file,
          }),
        )
      }
    }
  }
  return values.strict && drifted ? 1 : 0
}

/**
 * How the diff names the upstream side: the installed package, or the source at its ref.
 * @param {{ source: string | null }} c
 * @param {import('../runtime/sources.mjs').Source | undefined} src
 * @param {string} installed
 */
function upstreamName(c, src, installed) {
  return c.source === null ? `installed ${installed}` : `${c.source} at ${src?.ref ?? '?'}`
}
