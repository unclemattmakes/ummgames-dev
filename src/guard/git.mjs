// @ts-check
/**
 * Small git and file helpers the guards share. No dependencies: a guard runs inside a git hook,
 * where the cwd is the work tree's top level and nothing else can be assumed.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/**
 * @param {string[]} args
 * @param {string} cwd
 * @param {string} [input]
 */
export function git(args, cwd, input) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1 << 30,
    input,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
}

/**
 * The work tree's top level, or null outside git.
 * @param {string} cwd
 */
export function topLevel(cwd) {
  try {
    return path.resolve(git(['rev-parse', '--show-toplevel'], cwd).trim())
  } catch {
    return null
  }
}

/**
 * A merge, cherry-pick, revert or rebase is in progress: those replay commits written under
 * their own rules.
 * @param {string} cwd
 */
export function replaying(cwd) {
  const dir = path.resolve(cwd, git(['rev-parse', '--git-dir'], cwd).trim())
  return ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'REBASE_HEAD'].some((f) =>
    fs.existsSync(path.join(dir, f)),
  )
}

/**
 * Restricted glob (`*`, `?`, `**`) to an anchored RegExp over forward-slash paths.
 * @param {string} glob
 */
export function globToRegExp(glob) {
  let re = '^'
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') {
      i += 1
      if (glob[i + 1] === '/') {
        i += 1
        re += '(?:.*/)?'
      } else re += '.*'
    } else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else re += String(c).replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`${re}$`)
}

/** Repo-relative, forward slashes, no leading "./". @param {string} p */
export const normalise = (p) => p.replace(/\\/g, '/').replace(/^\.\//, '')

/**
 * A file is text when its first 8 KB hold no NUL byte.
 * @param {string} file
 */
export function isText(file) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(8192)
    const n = fs.readSync(fd, buf, 0, buf.length, 0)
    return !buf.subarray(0, n).includes(0)
  } catch {
    return false
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

/**
 * Files under `paths` (files or directories, relative to `cwd`): git's list (tracked plus
 * untracked, minus ignored) inside a work tree, else a walk that skips node_modules and .git.
 * Returned relative to `root`.
 * @param {string[]} paths
 * @param {string} cwd
 * @param {string | null} root  the work tree's top level, or null outside git
 */
export function listFiles(paths, cwd, root) {
  if (root) {
    const args = ['ls-files', '-z', '-co', '--exclude-standard', '--full-name', '--', ...paths]
    return git(args, cwd)
      .split('\0')
      .filter(Boolean)
      .filter((f) => fs.existsSync(path.join(root, f)))
  }
  /** @type {string[]} */
  const out = []
  const base = cwd
  /** @param {string} p */
  const walk = (p) => {
    let st
    try {
      st = fs.statSync(p)
    } catch {
      return
    }
    if (st.isFile()) out.push(normalise(path.relative(base, p)))
    else if (st.isDirectory()) {
      for (const e of fs.readdirSync(p))
        if (e !== 'node_modules' && e !== '.git') walk(path.join(p, e))
    }
  }
  for (const p of paths.length > 0 ? paths : ['.']) walk(path.resolve(cwd, p))
  return out
}
