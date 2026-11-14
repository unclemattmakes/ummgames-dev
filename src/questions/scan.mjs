// @ts-check
/**
 * Find the questions files in one repo or in every repo under a folder, and read them with
 * what has already been answered.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { answeredIds, parseQuestions } from './parse.mjs'

/** A questions file: QUESTIONS.md, questions-for-someone.md and the like. */
export const QUESTIONS_FILE = /^questions([-_. ].*)?\.md$/i
/** Where a repo keeps it, in the order looked. */
export const PLACES = ['docs', '.']
export const ANSWERS_NAME = 'ANSWERS.md'

/**
 * @typedef {object} QuestionsFile
 * @property {string} project the repo's folder name
 * @property {string} repo the repo's absolute path
 * @property {string} file the questions file's absolute path
 * @property {string} rel the questions file, relative to the repo, with forward slashes
 * @property {string} answers the answers file's absolute path (beside the questions file)
 */

/**
 * The questions files in one repo. Two names for one file (a case-insensitive disk) count once.
 * @param {string} repo
 * @returns {QuestionsFile[]}
 */
export function filesIn(repo) {
  /** @type {QuestionsFile[]} */
  const out = []
  const seen = new Set()
  for (const place of PLACES) {
    const dir = path.join(repo, place)
    let names = []
    try {
      names = fs.readdirSync(dir)
    } catch {
      continue
    }
    for (const name of names.sort()) {
      if (!QUESTIONS_FILE.test(name)) continue
      const file = path.join(dir, name)
      let real = file
      try {
        if (!fs.statSync(file).isFile()) continue
        real = fs.realpathSync.native(file)
      } catch {
        continue
      }
      const key = process.platform === 'linux' ? real : real.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        project: path.basename(repo),
        repo,
        file,
        rel: path.relative(repo, file).split(path.sep).join('/'),
        answers: path.join(dir, ANSWERS_NAME),
      })
    }
  }
  return out
}

/**
 * Whether a folder is the main checkout of a git repo. A linked worktree has a `.git` file, not
 * a folder, and holds a branch's copy of the questions, so it is left out.
 * @param {string} dir
 */
export function isMainCheckout(dir) {
  try {
    return fs.statSync(path.join(dir, '.git')).isDirectory()
  } catch {
    return false
  }
}

/**
 * The repos to read: each root that is itself a repo, and each main checkout one level under a
 * root that is not.
 * @param {string[]} roots
 */
export function reposUnder(roots) {
  /** @type {string[]} */
  const out = []
  for (const root of roots.map((r) => path.resolve(r))) {
    if (isMainCheckout(root)) {
      out.push(root)
      continue
    }
    let names = []
    try {
      names = fs.readdirSync(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const d of names) {
      if (!d.isDirectory() || d.name.startsWith('.') || d.name === 'node_modules') continue
      const dir = path.join(root, d.name)
      if (isMainCheckout(dir)) out.push(dir)
    }
  }
  return out
}

/** @type {Map<string, { at: number, time: number }>} */
const lastCommitCache = new Map()

/**
 * When the repo last had a commit, in seconds since 1970; 0 when unknown. Cached for ten minutes,
 * since it only orders the list.
 * @param {string} repo
 */
export function lastCommit(repo) {
  const hit = lastCommitCache.get(repo)
  if (hit && Date.now() - hit.at < 600_000) return hit.time
  let time = 0
  try {
    time = Number(
      execFileSync('git', ['-C', repo, 'log', '-1', '--format=%ct'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5000,
      }).trim(),
    )
  } catch {}
  lastCommitCache.set(repo, { at: Date.now(), time })
  return time
}

/**
 * @typedef {import('./parse.mjs').Question & { project: string, rel: string, key: string }} OpenQuestion
 * `key` is `<project>/<rel>#<id>`: unique across every repo read.
 */

/**
 * @typedef {object} Scan
 * @property {OpenQuestion[]} open unanswered questions: urgent first, then the repos with the
 *   newest commits, then file order
 * @property {{ project: string, rel: string, open: number, answered: number, lastCommit: number }[]} files
 */

/**
 * Read every questions file under the roots.
 * @param {string[]} roots
 * @returns {Scan}
 */
export function scan(roots) {
  /** @type {OpenQuestion[]} */
  const open = []
  /** @type {Scan['files']} */
  const files = []
  for (const repo of reposUnder(roots)) {
    for (const f of filesIn(repo)) {
      let md = ''
      try {
        md = fs.readFileSync(f.file, 'utf8')
      } catch {
        continue
      }
      let done = new Set()
      try {
        done = answeredIds(fs.readFileSync(f.answers, 'utf8'))
      } catch {}
      const qs = parseQuestions(md)
      const left = qs.filter((q) => !done.has(q.id))
      files.push({
        project: f.project,
        rel: f.rel,
        open: left.length,
        answered: qs.length - left.length,
        lastCommit: lastCommit(repo),
      })
      for (const q of left)
        open.push({ ...q, project: f.project, rel: f.rel, key: `${f.project}/${f.rel}#${q.id}` })
    }
  }
  const order = new Map(
    [...files]
      .sort((a, b) => b.lastCommit - a.lastCommit || a.project.localeCompare(b.project))
      .map((f, i) => [`${f.project}/${f.rel}`, i]),
  )
  const rank = (/** @type {OpenQuestion} */ q) => order.get(`${q.project}/${q.rel}`) ?? 0
  open.sort((a, b) => Number(b.urgent) - Number(a.urgent) || rank(a) - rank(b) || a.line - b.line)
  return { open, files }
}
