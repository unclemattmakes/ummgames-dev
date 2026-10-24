// @ts-check
/**
 * No em-dash in anything newly written. The character is built from its code point, so this
 * file passes its own check.
 *
 * Three modes:
 * - files: every line of the named files (or of every file git lists, with no paths).
 * - staged: only the lines a commit ADDS (`git diff --cached -U0`). What it lets through, on
 *   purpose: a line MOVED unchanged (the same text is removed elsewhere in the same commit), a
 *   merge, cherry-pick, revert or rebase in progress, and the paths in `exclude` (generated
 *   trees, whose fix belongs in the tool that writes them). A tree that held thousands of dashes
 *   when the rule arrived loses them line by line, because an edited line is an added line.
 * - message: a commit message, minus its `#` comment lines.
 */
import fs from 'node:fs'
import path from 'node:path'
import { git, globToRegExp, isText, listFiles, normalise, replaying, topLevel } from './git.mjs'

export const DASH = String.fromCharCode(0x2014)
export const HOW = 'Use a colon, a comma, parentheses or a new sentence instead.'

/** @typedef {{ file: string, line: number, text: string }} Hit */

/** @param {string[]} globs */
const excluder = (globs) => {
  const res = globs.map(globToRegExp)
  return (/** @type {string} */ f) => res.some((r) => r.test(normalise(f)))
}

/**
 * @param {string} cwd
 * @param {string[]} exclude
 * @returns {Hit[]}
 */
export function checkStaged(cwd, exclude) {
  if (replaying(cwd)) return []
  const skip = excluder(exclude)
  const diff = git(
    ['diff', '--cached', '-U0', '--no-color', '--no-ext-diff', '--diff-filter=ACMR'],
    cwd,
  )
  const removed = new Set()
  /** @type {Hit[]} */
  const added = []
  /** @type {string | null} */
  let file = null
  let line = 0
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      file = raw.startsWith('+++ b/') ? raw.slice(6) : null
      continue
    }
    if (raw.startsWith('--- ')) continue
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
    if (hunk) {
      line = Number(hunk[1])
      continue
    }
    if (raw.startsWith('-')) {
      removed.add(raw.slice(1).trim())
      continue
    }
    if (raw.startsWith('+')) {
      const text = raw.slice(1)
      if (file && text.includes(DASH) && !skip(file)) added.push({ file, line, text })
      line++
    }
  }
  return added.filter((a) => !removed.has(a.text.trim()))
}

/**
 * @param {string[]} paths  files or directories; none means every file git lists
 * @param {string} cwd
 * @param {string[]} exclude
 * @returns {Hit[]}
 */
export function checkFiles(paths, cwd, exclude) {
  const root = topLevel(cwd)
  const skip = excluder(exclude)
  /** @type {Hit[]} */
  const hits = []
  for (const rel of listFiles(paths, cwd, root)) {
    if (skip(rel)) continue
    const abs = path.resolve(root ?? cwd, rel)
    if (!isText(abs)) continue
    const lines = fs.readFileSync(abs, 'utf8').split('\n')
    lines.forEach((text, i) => {
      if (text.includes(DASH)) hits.push({ file: rel, line: i + 1, text })
    })
  }
  return hits
}

/** @param {string} file */
export function checkMessage(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => !l.startsWith('#'))
    .some((l) => l.includes(DASH))
}

/**
 * @param {Hit[]} hits
 * @param {string} what
 * @param {(s: string) => void} write
 */
export function reportHits(hits, what, write) {
  write(`em-dash: ${hits.length} ${what} carry an em-dash. ${HOW}\n`)
  for (const a of hits.slice(0, 40))
    write(`  ${a.file}:${a.line}: ${a.text.trim().slice(0, 140)}\n`)
  if (hits.length > 40) write(`  ... and ${hits.length - 40} more\n`)
}
