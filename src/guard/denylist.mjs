// @ts-check
/**
 * A generic path denylist: keep files a game must never commit out of git history.
 *
 * `.gitignore` is the first line of defence; this is the second, because one `git add -f`, or a
 * file extension nobody anticipated, defeats the first. Git history is forever, and a rewrite
 * after the fact invalidates every clone, so the check runs before the object exists (a
 * pre-commit hook, --staged) and again in CI (--tree, --history).
 *
 * This file ships NO rules. Each game names its own table, in umm-dev.config.mjs
 * (`guard.denylist`, an object) or in a JSON file (`guard.denylist: 'path/to/rules.json'`).
 * See docs/guard.md for the table's shape.
 *
 * Exit codes of the runner: 0 clean, 1 violations, 2 usage or internal error.
 */
import fs from 'node:fs'
import path from 'node:path'
import { git, globToRegExp, normalise } from './git.mjs'

/**
 * @typedef {object} Rules
 * @property {number} [maxBytes]       size ceiling for any file not size-allowed (off when unset)
 * @property {number} [hardCeiling]    cap on size-allowed files (default 2 MiB)
 * @property {{ group?: string, why: string, ext: string[] }[]} [extensions]
 * @property {{ prefix: string, why: string }[]} [prefixes]      repo-relative path prefixes
 * @property {(string | { segment: string, why?: string })[]} [segments]  whole directory names
 * @property {{ pattern: string | RegExp, flags?: string, except?: string | RegExp, why: string }[]} [names]  file-name patterns
 * @property {{ glob: string, why: string }[]} [allow]            exempt from every rule
 * @property {{ glob: string, why: string, max?: number }[]} [sizeAllow]  exempt from maxBytes only
 * @property {string} [allowEnv]       env var that lets a --staged check report and pass
 * @property {string[]} [advice]       lines printed under "What to do instead"
 */

/** @typedef {{ rule: string, why: string, detail: string }} Violation */

export const HARD_CEILING = 2 * 1024 * 1024

/** @param {string | RegExp} p @param {string} [flags] */
const re = (p, flags) => (p instanceof RegExp ? p : new RegExp(p, flags ?? 'i'))

/** @param {number} n */
export function kib(n) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MiB` : `${(n / 1024).toFixed(1)} KiB`
}

/**
 * Load the rule table from a config value: an object, or a JSON file path relative to root.
 * @param {unknown} value
 * @param {string} root
 * @returns {Rules | null}
 */
export function loadRules(value, root) {
  if (value == null || value === false) return null
  if (typeof value === 'string') {
    return /** @type {Rules} */ (JSON.parse(fs.readFileSync(path.resolve(root, value), 'utf8')))
  }
  if (typeof value === 'object') return /** @type {Rules} */ (value)
  throw new Error('guard.denylist must be a rule object or the path of a JSON file')
}

/**
 * Compile a rule table into a function from (path, size) to violations.
 * @param {Rules} rules
 * @param {{ maxBytes?: number }} [o]
 */
export function compile(rules, o = {}) {
  const maxBytes = o.maxBytes ?? rules.maxBytes
  const ceiling = rules.hardCeiling ?? HARD_CEILING
  const allow = (rules.allow ?? []).map((a) => ({ ...a, re: globToRegExp(a.glob) }))
  const sizeAllow = (rules.sizeAllow ?? []).map((a) => ({ ...a, re: globToRegExp(a.glob) }))
  /** @type {Map<string, { group?: string, why: string }>} */
  const ext = new Map()
  for (const g of rules.extensions ?? []) for (const e of g.ext) ext.set(e.toLowerCase(), g)
  /** @type {Map<string, string>} */
  const segments = new Map()
  for (const s of rules.segments ?? []) {
    const seg = typeof s === 'string' ? s : s.segment
    const why = typeof s === 'string' ? '' : (s.why ?? '')
    segments.set(seg.toLowerCase(), why)
  }
  const names = (rules.names ?? []).map((n) => ({
    ...n,
    re: re(n.pattern, n.flags),
    except: n.except ? re(n.except, n.flags) : null,
  }))

  /**
   * @param {string} file
   * @param {number | undefined} size
   * @returns {Violation[]}
   */
  return function violationsFor(file, size) {
    const p = normalise(file)
    const lower = p.toLowerCase()
    const base = p.slice(p.lastIndexOf('/') + 1)
    if (allow.some((a) => a.re.test(p))) return []
    /** @type {Violation[]} */
    const out = []
    for (const d of rules.prefixes ?? []) {
      if (lower.startsWith(d.prefix.toLowerCase())) {
        out.push({ rule: 'denied-path', why: d.why, detail: `under ${d.prefix}` })
      }
    }
    for (const seg of p.split('/').slice(0, -1)) {
      const why = segments.get(seg.toLowerCase())
      if (why !== undefined) {
        out.push({
          rule: 'denied-dir',
          why: why || 'a denied folder name',
          detail: `path segment "${seg}"`,
        })
        break
      }
    }
    const dot = base.lastIndexOf('.')
    const e = dot > 0 ? base.slice(dot).toLowerCase() : ''
    const g = e ? ext.get(e) : undefined
    if (g) out.push({ rule: 'denied-ext', why: g.why, detail: g.group ? `${e} (${g.group})` : e })
    for (const n of names) {
      if (n.re.test(base) && !n.except?.test(base)) {
        out.push({ rule: 'denied-name', why: n.why, detail: `name matches ${n.re}` })
      }
    }
    if (typeof size === 'number') {
      const sa = sizeAllow.find((a) => a.re.test(p))
      const limit = sa ? (sa.max ?? ceiling) : maxBytes
      if (limit !== undefined && size > limit) {
        out.push({
          rule: 'too-big',
          why: sa
            ? `size-allowed (${sa.why}) but past the ${kib(limit)} ceiling`
            : 'over the size ceiling: a large file is an asset until proven otherwise',
          detail: `${kib(size)} > ${kib(limit)}`,
        })
      }
    }
    return out
  }
}

/** @param {string} abs */
function statSize(abs) {
  try {
    return fs.statSync(abs).size
  } catch {
    return undefined
  }
}

/**
 * Sizes for blob shas, in one `git cat-file --batch-check`.
 * @param {string[]} shas
 * @param {string} cwd
 */
function blobSizes(shas, cwd) {
  const wanted = [...new Set(shas.filter((s) => s && !/^0+$/.test(s)))]
  /** @type {Map<string, number>} */
  const sizes = new Map()
  if (wanted.length === 0) return sizes
  const out = git(['cat-file', '--batch-check'], cwd, `${wanted.join('\n')}\n`)
  for (const line of out.split('\n')) {
    const m = line.match(/^([0-9a-f]{7,64}) (\w+) (\d+)$/)
    if (m?.[2] === 'blob') sizes.set(/** @type {string} */ (m[1]), Number(m[3]))
  }
  return sizes
}

/** @typedef {{ file: string, size: number | undefined }} Item */

/**
 * Staged files with their STAGED size. `--no-abbrev` is load-bearing: `git diff --raw`
 * abbreviates object names, `cat-file` answers with full ones, and a map keyed on the short
 * form misses every lookup, which silently turns the size rule off.
 * @param {string} root
 * @returns {Item[]}
 */
export function collectStaged(root) {
  const parts = git(
    ['diff', '--cached', '--raw', '-z', '--no-abbrev', '--diff-filter=ACMR'],
    root,
  ).split('\0')
  /** @type {{ file: string, sha: string }[]} */
  const entries = []
  let i = 0
  while (i < parts.length) {
    const meta = parts[i]
    if (meta?.[0] !== ':') {
      i += 1
      continue
    }
    const fields = meta.slice(1).split(' ')
    const sha = fields[3] ?? ''
    const status = fields[4] ?? ''
    // R and C print <src>\0<dst>; everything else prints one path.
    const at = status[0] === 'R' || status[0] === 'C' ? i + 2 : i + 1
    const file = parts[at]
    if (file) entries.push({ file, sha })
    i = at + 1
  }
  const sizes = blobSizes(
    entries.map((e) => e.sha),
    root,
  )
  // Fall back to the work tree's size, so "unknown" never reads as "fine".
  return entries.map((e) => ({
    file: e.file,
    size: sizes.get(e.sha) ?? statSize(path.join(root, e.file)),
  }))
}

/** @param {string} root @returns {Item[]} */
export function collectTree(root) {
  return git(['ls-files', '-z'], root)
    .split('\0')
    .filter(Boolean)
    .map((file) => ({ file, size: statSize(path.join(root, file)) }))
}

/** Every blob ever committed on any ref, with the path it was stored under. @param {string} root */
export function collectHistory(root) {
  /** @type {{ file: string, sha: string }[]} */
  const entries = []
  for (const line of git(['rev-list', '--objects', '--all'], root).split('\n')) {
    const sp = line.indexOf(' ')
    if (sp < 0) continue
    const file = line.slice(sp + 1).trim()
    if (file) entries.push({ file, sha: line.slice(0, sp) })
  }
  const sizes = blobSizes(
    entries.map((e) => e.sha),
    root,
  )
  return entries
    .filter((e) => sizes.has(e.sha))
    .map((e) => ({ file: e.file, size: sizes.get(e.sha) }))
}

/**
 * @param {Rules} rules
 * @param {(s: string) => void} w
 */
export function listRules(rules, w) {
  w(
    `size ceiling: ${rules.maxBytes ? kib(rules.maxBytes) : 'none'} (size-allowed paths capped at ${kib(rules.hardCeiling ?? HARD_CEILING)})\n`,
  )
  for (const g of rules.extensions ?? [])
    w(`ext ${g.group ?? ''}: ${g.ext.join(' ')}\n    ${g.why}\n`)
  for (const d of rules.prefixes ?? []) w(`path ${d.prefix}\n    ${d.why}\n`)
  for (const s of rules.segments ?? []) w(`dir  ${typeof s === 'string' ? s : s.segment}\n`)
  for (const n of rules.names ?? []) w(`name ${n.pattern}\n    ${n.why}\n`)
  for (const a of rules.allow ?? []) w(`allow ${a.glob}\n    ${a.why}\n`)
  for (const a of rules.sizeAllow ?? [])
    w(`size-allow ${a.glob}${a.max ? ` (max ${kib(a.max)})` : ''}\n    ${a.why}\n`)
}

/**
 * @param {{ file: string, size: number | undefined, violations: Violation[] }[]} bad
 * @param {string} mode
 * @param {Rules} rules
 * @param {(s: string) => void} w
 */
export function report(bad, mode, rules, w) {
  w('\n  BLOCKED: this would put content the denylist forbids into git history.\n\n')
  w(`  mode: --${mode}   offending files: ${bad.length}\n\n`)
  for (const b of bad) {
    w(`  ${b.file}${typeof b.size === 'number' ? `  [${kib(b.size)}]` : ''}\n`)
    for (const v of b.violations) w(`      ${v.rule}: ${v.detail}\n          ${v.why}\n`)
    w('\n')
  }
  w('  What to do instead\n')
  for (const a of rules.advice ?? []) w(`    - ${a}\n`)
  w('    - Unstage what you did not mean to add: git restore --staged <file>\n')
  w('    - A real exception: add an allow or sizeAllow entry WITH A REASON to the rule table.\n')
  if (rules.allowEnv)
    w(`    - ${rules.allowEnv}=1 git commit ...   print this, commit anyway (CI still runs it)\n`)
  w('    - git commit --no-verify               skip the hook entirely\n\n')
}
