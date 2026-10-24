// @ts-check
/**
 * `umm-dev merge keep-both <file.md>...`
 * `umm-dev merge resolve-table <file.md>...`
 * `umm-dev merge driver <keep-both|resolve-table> %O %A %B [%L] [%P]`
 *
 * Markdown conflict resolvers (src/agent/merge.mjs), by hand during a merge or as a git merge
 * driver. docs/agent.md has the .gitattributes and git config lines.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { isMarkdown, keepBoth, resolveTable } from '../agent/merge.mjs'

export const describe =
  'resolve markdown append and table-row conflicts, by hand or as a merge driver'

const HELP = `usage: umm-dev merge keep-both <file.md>...
       umm-dev merge resolve-table <file.md>...
       umm-dev merge driver <keep-both|resolve-table> %O %A %B [%L] [%P]

  keep-both      a conflict where both sides APPENDED blocks: keep both, ours first, with a
                 blank line between when both meet on text. Markdown (.md, .markdown) only.
  resolve-table  a conflict where both sides rewrote rows of one table, each a different subset:
                 take each row from the side that changed it against the merge base (the
                 index's stage 1, so run it during the merge), keyed on the first cell. Refuses
                 a row both changed, a non-row line in the conflict, a repeated key, and sides
                 holding different keys.
  driver         the same, called by git as a merge driver (.gitattributes and git config lines
                 in docs/agent.md). git's own three-way merge runs first; only a conflict
                 reaches the resolver. On a refusal it leaves the ordinary conflict markers and
                 exits 1, so git reports a conflict for a person.

  Look before you run one: blocks appended at the end of a file mean keep-both; the same table
  rows rewritten mean resolve-table (keep-both would duplicate every row). By hand, the file is
  rewritten in place and not staged: read it, then git add it.

exit: keep-both, resolve-table: 0 every file resolved; 1 a file refused (that file is left as
      it was); 64 usage
      driver: 0 merged or resolved; 1 conflict left for a person; 2 git merge-file failed;
      64 usage`

/**
 * @param {string[]} argv
 * @param {{ cwd: string }} ctx
 */
export async function run(argv, ctx) {
  const [sub, ...rest] = argv
  if (!sub || sub === '--help' || sub === '-h') {
    console.log(HELP)
    return sub ? 0 : 64
  }
  if (sub === 'keep-both' || sub === 'resolve-table') {
    if (rest.length === 0) {
      console.error(`umm-dev merge ${sub}: name the file(s)\n\n${HELP}`)
      return 64
    }
    let bad = 0
    for (const f of rest) if (!byHand(sub, path.resolve(ctx.cwd, f), f, ctx.cwd)) bad++
    return bad > 0 ? 1 : 0
  }
  if (sub === 'driver') return driver(rest)
  console.error(`umm-dev merge: no subcommand "${sub}"\n\n${HELP}`)
  return 64
}

/**
 * @param {'keep-both' | 'resolve-table'} how
 * @param {string} abs
 * @param {string} shown
 * @param {string} cwd
 */
function byHand(how, abs, shown, cwd) {
  if (!isMarkdown(abs)) {
    console.error(`REFUSING ${shown}: ${how} is for markdown only.`)
    return false
  }
  const text = fs.readFileSync(abs, 'utf8')
  let r
  if (how === 'keep-both') r = keepBoth(text)
  else {
    let base
    try {
      // `:1:./path` is relative to the cwd; a bare `:1:path` is relative to the repo root.
      const rel = path.relative(cwd, abs).replace(/\\/g, '/')
      base = execFileSync('git', ['show', `:1:./${rel}`], {
        cwd,
        encoding: 'utf8',
        maxBuffer: 1 << 28,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch {
      console.error(`REFUSING ${shown}: no merge base in the index (run it during the merge).`)
      return false
    }
    r = resolveTable(text, base)
  }
  if (!r.ok) {
    console.error(`REFUSING ${shown}: ${r.reason}.`)
    return false
  }
  fs.writeFileSync(abs, r.text)
  for (const n of r.notes) console.log(`  ${n}`)
  console.log(`  ${shown}: resolved (${how})`)
  return true
}

/** @param {string[]} argv */
function driver(argv) {
  const [how, O, A, B, L, P] = argv
  if ((how !== 'keep-both' && how !== 'resolve-table') || !O || !A || !B) {
    console.error(`umm-dev merge driver: needs a resolver and %O %A %B\n\n${HELP}`)
    return 64
  }
  const size = Number(L) || 7
  const shown = P ?? A
  // git's own three-way merge first: a clean merge needs no resolver.
  const m = spawnSync(
    'git',
    [
      'merge-file',
      '-p',
      `--marker-size=${size}`,
      '-L',
      'ours',
      '-L',
      'base',
      '-L',
      'theirs',
      A,
      O,
      B,
    ],
    { encoding: 'utf8', maxBuffer: 1 << 28 },
  )
  // merge-file exits with the number of conflicts (at most 127), or 255 when it fails.
  if (m.status === null || m.status > 127 || m.error) {
    console.error(`umm-dev merge driver: git merge-file failed on ${shown}`)
    return 2
  }
  const merged = m.stdout
  if (m.status === 0) {
    fs.writeFileSync(A, merged)
    return 0
  }
  if (P && !isMarkdown(P)) {
    fs.writeFileSync(A, merged)
    console.error(`umm-dev merge driver: ${shown} is not markdown; left the conflict for a person.`)
    return 1
  }
  const r =
    how === 'keep-both'
      ? keepBoth(merged, size)
      : resolveTable(merged, fs.readFileSync(O, 'utf8'), size)
  if (!r.ok) {
    fs.writeFileSync(A, merged)
    console.error(`umm-dev merge driver: ${shown}: ${r.reason}; left the conflict for a person.`)
    return 1
  }
  fs.writeFileSync(A, r.text)
  console.error(`umm-dev merge driver: ${shown}: resolved by ${how} (${r.blocks} block(s))`)
  return 0
}
