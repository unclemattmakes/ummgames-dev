// @ts-check
/**
 * `umm-dev copy`: write runtime files into a game, each stamped with the header that
 * `umm-dev drift` reads back. A copy is the game's from then on.
 *
 * Overwriting is safe only when the game's file is an untouched copy (its body still hashes to
 * its header). A changed copy, or a file that is not a copy at all, needs `force`.
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  bodyHash,
  commentStyleFor,
  normalizeEol,
  parseCopy,
  parseSourceCopy,
  stamp,
  stampSource,
} from './header.mjs'
import { PACKAGE_ROOT, packageVersion, readRuntime, resolveRuntime, toPosix } from './source.mjs'
import {
  getSource,
  lastCommit,
  normalizeSourceSpec,
  readSource,
  resolveSourceSpec,
} from './sources.mjs'

/**
 * @typedef {'written' | 'updated' | 'current' | 'refused' | 'would-write'} CopyOutcome
 * @typedef {{ runtimePath: string, file: string, outcome: CopyOutcome, reason?: string }} CopyResult
 */

/**
 * Where each runtime file lands in the game, relative to `root`.
 *
 * - No `to`: `<into>/<path under runtime/>` (`runtime/dev/fuzzy.ts` -> `src/dev/fuzzy.ts`).
 * - `to` naming a folder (an existing one, a trailing slash, or several files): inside it,
 *   keeping each file's path below the folder that was asked for.
 * - `to` naming a file: exactly there (one file only).
 *
 * `prefix` is what every file path starts with and a default destination drops: `runtime/` for
 * this package's files, nothing for a source's.
 *
 * @param {{ files: string[], spec: string, root: string, into: string, to?: string | undefined, prefix?: string }} p
 * @returns {Map<string, string>} file path -> absolute destination
 */
export function plan({ files, spec, root, into, to, prefix = 'runtime/' }) {
  /** @type {Map<string, string>} */
  const out = new Map()
  const norm = prefix ? normalizeSpec(spec) : normalizeSourceSpec(spec)
  const asked = files.length === 1 && files[0] === norm ? null : norm
  for (const f of files) {
    const underRuntime = f.slice(prefix.length)
    if (to === undefined) {
      out.set(f, path.resolve(root, into, ...underRuntime.split('/')))
      continue
    }
    const target = path.resolve(root, to)
    const isDir =
      files.length > 1 ||
      /[\\/]$/.test(to) ||
      (fs.existsSync(target) && fs.statSync(target).isDirectory())
    if (!isDir) {
      out.set(f, target)
      continue
    }
    const below = asked ? f.slice(asked.length + 1) : path.posix.basename(f)
    out.set(f, path.join(target, ...below.split('/')))
  }
  return out
}

/** @param {string} spec */
function normalizeSpec(spec) {
  const rel = toPosix(spec).replace(/^\.\//, '').replace(/\/+$/, '')
  return rel === 'runtime' || rel.startsWith('runtime/') ? rel : `runtime/${rel}`
}

/**
 * @param {{
 *   spec: string,
 *   root: string,
 *   into?: string,
 *   to?: string | undefined,
 *   force?: boolean,
 *   dryRun?: boolean,
 *   pkgRoot?: string,
 * }} p
 * @returns {CopyResult[]}
 */
export function copyRuntime({
  spec,
  root,
  into = 'src',
  to,
  force = false,
  dryRun = false,
  pkgRoot = PACKAGE_ROOT,
}) {
  const files = resolveRuntime(spec, pkgRoot)
  if (files.length === 0) throw new Error(`no runtime file or folder "${spec}"`)
  const version = packageVersion(pkgRoot)
  const dests = plan({ files, spec, root, into, to })
  const namedOne = files.length === 1 && files[0] === normalizeSpec(spec)
  /** @type {CopyResult[]} */
  const results = []
  for (const [runtimePath, dest] of dests)
    results.push(
      place({
        runtimePath,
        dest,
        root,
        namedOne,
        force,
        dryRun,
        hint: runtimePath.slice('runtime/'.length),
        text: () =>
          stamp({
            file: dest,
            version,
            runtimePath,
            source: /** @type {string} */ (readRuntime(runtimePath, pkgRoot)),
          }),
      }),
    )
  return results
}

/**
 * Copy files from one of the game's own sources (`runtime.sources`), each stamped with the source's
 * name, the commit that last changed it, its path there and its hash. The same rules as a kit
 * copy: an untouched copy is replaced, a changed one or a file that is not a copy needs `force`.
 *
 * @param {{
 *   name: string,
 *   spec: string,
 *   root: string,
 *   sources: Record<string, import('./sources.mjs').Source>,
 *   into?: string,
 *   to?: string | undefined,
 *   force?: boolean,
 *   dryRun?: boolean,
 * }} p
 * @returns {CopyResult[]}
 */
export function copySource({
  name,
  spec,
  root,
  sources,
  into = 'src',
  to,
  force = false,
  dryRun = false,
}) {
  const src = getSource(sources, name)
  const files = resolveSourceSpec(spec, src)
  if (files.length === 0)
    throw new Error(`no file or folder "${spec}" in source "${name}" at ${src.ref}`)
  const dests = plan({ files, spec, root, into, to, prefix: '' })
  const namedOne = files.length === 1 && files[0] === normalizeSourceSpec(spec)
  /** @type {CopyResult[]} */
  const results = []
  for (const [srcPath, dest] of dests)
    results.push(
      place({
        runtimePath: srcPath,
        dest,
        root,
        namedOne,
        force,
        dryRun,
        hint: `--from ${name} ${srcPath}`,
        text: () =>
          stampSource({
            file: dest,
            name,
            commit: lastCommit(src, srcPath),
            srcPath,
            source: /** @type {string} */ (readSource(src, srcPath)),
          }),
      }),
    )
  return results
}

/**
 * Write one stamped file, or say why not. Over an existing file it writes only an untouched copy
 * (of the kit or of a source), unless `force`.
 * @param {{
 *   runtimePath: string,
 *   dest: string,
 *   root: string,
 *   namedOne: boolean,
 *   force: boolean,
 *   dryRun: boolean,
 *   hint: string,
 *   text: () => string,
 * }} p
 * @returns {CopyResult}
 */
function place({ runtimePath, dest, root, namedOne, force, dryRun, hint, text: make }) {
  const file = toPosix(path.relative(root, dest))
  if (!commentStyleFor(dest))
    return {
      runtimePath,
      file,
      outcome: 'refused',
      reason: `no comment syntax for ${path.extname(dest) || 'a file without an extension'}`,
    }
  const text = make()
  /** @type {CopyOutcome} */
  let outcome = 'written'
  if (fs.existsSync(dest)) {
    const existing = fs.readFileSync(dest, 'utf8')
    if (normalizeEol(existing) === text) return { runtimePath, file, outcome: 'current' }
    const copy = parseCopy(existing) ?? parseSourceCopy(existing)
    const clean = copy !== null && bodyHash(copy.body) === copy.hash
    // --force overwrites a file that is not a copy only when the spec named exactly that file:
    // a folder copy must never replace the game's own code.
    if (copy === null && force && !namedOne)
      return {
        runtimePath,
        file,
        outcome: 'refused',
        reason: `exists and is not a copy; a folder copy never overwrites it, even with --force (name the file: umm-dev copy ${hint} --to ${file} --force)`,
      }
    if (!clean && !force)
      return {
        runtimePath,
        file,
        outcome: 'refused',
        reason: copy
          ? 'changed here since it was copied (umm-dev drift --diff shows how); --force overwrites'
          : 'exists and is not a copy; --force overwrites',
      }
    outcome = 'updated'
  }
  if (dryRun) return { runtimePath, file, outcome: 'would-write' }
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, text)
  return { runtimePath, file, outcome }
}

/**
 * Relative imports a copied file makes that have no file beside it in the game: the sibling
 * runtime files the game still has to copy.
 * @param {string} dest absolute path of the copy
 * @returns {string[]} the import specifiers that do not resolve
 */
export function missingSiblings(dest) {
  const text = fs.readFileSync(dest, 'utf8')
  const specs = [...text.matchAll(/(?:import|export)[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]/g)]
    .map((m) => /** @type {string} */ (m[1]))
    .filter((s, i, a) => a.indexOf(s) === i)
  const dir = path.dirname(dest)
  const exts = ['', '.ts', '.tsx', '.js', '.mjs', '.d.ts', '/index.ts']
  return specs.filter((s) => {
    const base = path.resolve(dir, s.replace(/\.js$/, ''))
    return !exts.some((e) => fs.existsSync(base + e)) && !fs.existsSync(path.resolve(dir, s))
  })
}
