// @ts-check
/**
 * The agent instructions stay small.
 *
 * The root CLAUDE.md is read in full by every session, so its size is a cost every session pays,
 * and it grows because lessons are appended and none ever leave. A cap turns growth into a
 * decision: raising it is an edit to the game's config with a reason, and the practice at the
 * cap is one in, one out (move a lesson down to a nested CLAUDE.md, a file header or a test).
 *
 * The same sweep checks that every relative link in every CLAUDE.md resolves, so a moved
 * document cannot leave a dead pointer in the file every session reads.
 */
import fs from 'node:fs'
import path from 'node:path'
import { git } from './git.mjs'

/**
 * @typedef {object} ClaudeMdConfig
 * @property {number} rootMaxLines
 * @property {number | null} nestedMaxLines  null: no cap on nested files
 * @property {string | null} mustMention  text the root must contain (the page on keeping it small)
 * @property {boolean} links  check relative links
 */

/** @type {ClaudeMdConfig} */
export const CLAUDE_MD_DEFAULTS = {
  rootMaxLines: 200,
  nestedMaxLines: 100,
  mustMention: null,
  links: true,
}

/**
 * Every CLAUDE.md git lists (tracked or untracked, not ignored), root first. Outside git, the
 * root's only.
 * @param {string} root
 */
export function instructionFiles(root) {
  let files
  try {
    files = git(['ls-files', '-co', '--exclude-standard', '--', '*CLAUDE.md', 'CLAUDE.md'], root)
      .split('\n')
      .map((f) => f.trim())
      .filter((f) => f === 'CLAUDE.md' || f.endsWith('/CLAUDE.md'))
  } catch {
    files = fs.existsSync(path.join(root, 'CLAUDE.md')) ? ['CLAUDE.md'] : []
  }
  files = [...new Set(files)].filter((f) => fs.existsSync(path.join(root, f)))
  return files.sort((a, b) => (a === 'CLAUDE.md' ? -1 : b === 'CLAUDE.md' ? 1 : a.localeCompare(b)))
}

/** @param {string} text */
export const lineCount = (text) => text.replace(/\r?\n$/, '').split(/\r?\n/).length

/**
 * Relative link targets in markdown, minus anchors and URLs.
 * @param {string} text
 */
export const relativeLinks = (text) =>
  [...text.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)]
    .map((m) => m[1] ?? '')
    .filter((t) => t !== '' && !/^[a-z][a-z0-9+.-]*:/i.test(t))

/**
 * @param {string} root
 * @param {ClaudeMdConfig} cfg
 * @returns {{ files: { file: string, lines: number, cap: number | null }[], problems: string[] }}
 */
export function checkClaudeMd(root, cfg) {
  const files = instructionFiles(root)
  /** @type {string[]} */
  const problems = []
  if (!files.includes('CLAUDE.md')) problems.push('no CLAUDE.md at the root')
  const rows = files.map((f) => {
    const text = fs.readFileSync(path.join(root, f), 'utf8')
    const lines = lineCount(text)
    const cap = f === 'CLAUDE.md' ? cfg.rootMaxLines : cfg.nestedMaxLines
    if (cap != null && lines > cap) {
      problems.push(`${f}: ${lines} lines, over its cap of ${cap}. Move a lesson down a level.`)
    }
    if (f === 'CLAUDE.md' && cfg.mustMention && !text.includes(cfg.mustMention)) {
      problems.push(`CLAUDE.md does not mention ${cfg.mustMention}, the page on keeping it small`)
    }
    if (cfg.links) {
      for (const t of relativeLinks(text)) {
        if (!fs.existsSync(path.join(root, path.dirname(f), t)))
          problems.push(`${f}: dead link -> ${t}`)
      }
    }
    return { file: f, lines, cap }
  })
  return { files: rows, problems }
}
