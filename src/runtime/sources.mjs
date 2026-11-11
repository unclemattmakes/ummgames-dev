// @ts-check
/**
 * A game's own sources: git checkouts on this machine that it copies files from, beside this
 * package's runtime/. Code that has to stay private (it names a game, a host or a service) is
 * shared this way instead of through the public kit. A game names each source in `runtime.sources`
 * of its umm-dev.config.mjs; nothing about any source is written here.
 *
 * Files are read through git at the source's ref, never from its working tree, so a copy is always
 * of committed work and its header can name the commit that last changed it.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { isSafeCommit, isSafeSourceName, isSafeSourcePath } from './header.mjs'
import { toPosix } from './source.mjs'

/**
 * @typedef {{ repo: string, ref?: string }} SourceConfig
 * @typedef {{ name: string, repo: string, ref: string }} Source
 */

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  })
}

/**
 * The checkout that owns the game's git data. In a linked worktree that is the main checkout, so
 * a source path like `../other-repo` means the same folder from every worktree, however deep it
 * sits. Outside git, the game root itself.
 * @param {string} root
 */
export function mainCheckout(root) {
  try {
    const common = git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim()
    return path.basename(common) === '.git' ? path.dirname(common) : root
  } catch {
    return root
  }
}

/**
 * The game's `runtime.sources`, checked, with each `repo` made absolute from the main checkout.
 * Throws on a bad name or a source without a `repo`.
 * @param {Record<string, SourceConfig> | undefined} sources
 * @param {string} root the game root
 * @returns {Record<string, Source>}
 */
export function resolveSources(sources, root) {
  /** @type {Record<string, Source>} */
  const out = {}
  if (!sources) return out
  const base = mainCheckout(root)
  for (const [name, cfg] of Object.entries(sources)) {
    if (!isSafeSourceName(name))
      throw new Error(
        `runtime.sources: "${name}" is not a usable name (letters, digits, _ and -; not ummgames-dev)`,
      )
    if (!cfg || typeof cfg.repo !== 'string' || cfg.repo === '')
      throw new Error(`runtime.sources.${name}: needs repo, the path to its git checkout`)
    out[name] = { name, repo: path.resolve(base, cfg.repo), ref: cfg.ref ?? 'HEAD' }
  }
  return out
}

/**
 * One source by name, checked to be a git checkout on this machine.
 * @param {Record<string, Source>} sources
 * @param {string} name
 * @returns {Source}
 */
export function getSource(sources, name) {
  const src = sources[name]
  if (!src) {
    const known = Object.keys(sources)
    throw new Error(
      `no source "${name}" in runtime.sources${known.length ? ` (it has ${known.join(', ')})` : ''}`,
    )
  }
  if (!fs.existsSync(src.repo))
    throw new Error(`source "${name}": ${src.repo} is not on this machine`)
  try {
    git(src.repo, ['rev-parse', '--verify', '--quiet', `${src.ref}^{commit}`])
  } catch {
    throw new Error(`source "${name}": ${src.repo} has no commit at ${src.ref}`)
  }
  return src
}

/**
 * Every file the source has at its ref, as posix paths, sorted.
 * @param {Source} src
 * @returns {string[]}
 */
export function listSource(src) {
  return git(src.repo, ['ls-tree', '-r', '--name-only', '--full-tree', src.ref])
    .split('\n')
    .map((f) => toPosix(f.trim()))
    .filter((f) => f && isSafeSourcePath(f))
    .sort()
}

/**
 * What a user typed (`client/a.ts`, `./client/`, `client`) as the source files it names. A folder
 * names every file under it.
 * @param {string} spec
 * @param {Source} src
 * @returns {string[]}
 */
export function resolveSourceSpec(spec, src) {
  const rel = normalizeSourceSpec(spec)
  const all = listSource(src)
  if (all.includes(rel)) return [rel]
  return all.filter((f) => f.startsWith(`${rel}/`))
}

/** @param {string} spec */
export function normalizeSourceSpec(spec) {
  return toPosix(spec).replace(/^\.\//, '').replace(/\/+$/, '')
}

/**
 * A file's text at the source's ref, or at `rev` (a commit from a header). `null` when it is not
 * there.
 * @param {Source} src
 * @param {string} srcPath
 * @param {string} [rev]
 * @returns {string | null}
 */
export function readSource(src, srcPath, rev = src.ref) {
  if (!isSafeSourcePath(srcPath)) throw new Error(`not a source path: ${srcPath}`)
  if (rev !== src.ref && !isSafeCommit(rev)) throw new Error(`not a commit: ${rev}`)
  try {
    return git(src.repo, ['show', `${rev}:${srcPath}`])
  } catch {
    return null
  }
}

/**
 * The commit that last changed the file at the source's ref: 12 hex digits. It goes in the
 * header, so copying the same file twice writes the same header.
 * @param {Source} src
 * @param {string} srcPath
 */
export function lastCommit(src, srcPath) {
  const out = git(src.repo, ['log', '-1', '--format=%H', src.ref, '--', srcPath]).trim()
  if (!isSafeCommit(out)) throw new Error(`source "${src.name}": no commit for ${srcPath}`)
  return out.slice(0, 12)
}
