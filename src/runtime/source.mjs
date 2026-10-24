// @ts-check
/**
 * The runtime sources this package ships: `runtime/` beside `src/`, at the installed version.
 * A game reads them from `node_modules/@ummgames/dev/runtime/`; tests point `pkgRoot` at a
 * fixture instead.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isSafeRuntimePath } from './header.mjs'

/** This package's root: the folder holding its package.json. */
export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** Files under `runtime/` that are tooling for the folder, not code to copy. */
const NOT_COPYABLE = new Set(['runtime/tsconfig.json', 'runtime/env.d.ts'])

/**
 * `v` plus the version in package.json: the tag a game pins.
 * @param {string} [pkgRoot]
 */
export function packageVersion(pkgRoot = PACKAGE_ROOT) {
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'))
  return `v${pkg.version}`
}

/** @param {string} p */
export function toPosix(p) {
  return p.split(path.sep).join('/')
}

/**
 * Every copyable file under `runtime/`, as posix paths starting `runtime/`, sorted.
 * @param {string} [pkgRoot]
 * @returns {string[]}
 */
export function listRuntime(pkgRoot = PACKAGE_ROOT) {
  const base = path.join(pkgRoot, 'runtime')
  if (!fs.existsSync(base)) return []
  /** @type {string[]} */
  const out = []
  /** @param {string} dir */
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else {
        const rel = toPosix(path.relative(pkgRoot, full))
        if (!NOT_COPYABLE.has(rel)) out.push(rel)
      }
    }
  }
  walk(base)
  return out.sort()
}

/**
 * Resolve what a user typed (`dev/fuzzy.ts`, `runtime/dev/fuzzy.ts`, `dev`, `runtime/dev/`) to
 * the runtime files it names. A folder names every file under it.
 * @param {string} spec
 * @param {string} [pkgRoot]
 * @returns {string[]}
 */
export function resolveRuntime(spec, pkgRoot = PACKAGE_ROOT) {
  let rel = toPosix(spec).replace(/^\.\//, '').replace(/\/+$/, '')
  if (rel !== 'runtime' && !rel.startsWith('runtime/')) rel = `runtime/${rel}`
  const all = listRuntime(pkgRoot)
  if (all.includes(rel)) return [rel]
  return all.filter((f) => f.startsWith(`${rel}/`))
}

/**
 * The absolute path of a runtime file, refusing any path that is unsafe or resolves outside
 * `<pkgRoot>/runtime`.
 * @param {string} runtimePath
 * @param {string} [pkgRoot]
 */
export function runtimeFile(runtimePath, pkgRoot = PACKAGE_ROOT) {
  const base = path.resolve(pkgRoot, 'runtime')
  const file = path.resolve(pkgRoot, ...runtimePath.split('/'))
  if (!isSafeRuntimePath(runtimePath) || !file.startsWith(base + path.sep))
    throw new Error(`not a runtime path: ${runtimePath}`)
  return file
}

/**
 * The installed text of a runtime file, or `null` when this version no longer ships it.
 * @param {string} runtimePath
 * @param {string} [pkgRoot]
 */
export function readRuntime(runtimePath, pkgRoot = PACKAGE_ROOT) {
  const file = runtimeFile(runtimePath, pkgRoot)
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
}
