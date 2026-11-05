// @ts-check
/**
 * A static import walker, for guards that ask what a file can reach: a toy must not reach the
 * module that boots the game, a browser spec must not reach a bundler-only global, a test's width
 * is how many modules it puts on the line.
 *
 * What counts as an import: every `from '...'` in the file and every side-effect `import '...'`,
 * comments included. Deliberately crude: a walker that over-approximates fails in the safe
 * direction for every caller. Dynamic `import()` is not followed, since it loads only if the code
 * runs. Bare specifiers are packages and stop the walk. See docs/making-of.md.
 */
import fs from 'node:fs'
import path from 'node:path'

/** @typedef {import('./index.d.ts').ImportGraph} ImportGraph */
/** @typedef {import('./index.d.ts').ImportGraphOptions} ImportGraphOptions */
/** @typedef {import('./index.d.ts').ImportWalkOptions} ImportWalkOptions */

/**
 * Whole `import type ... from '...'` and `export type ... from '...'` statements. A compiler
 * erases these, so a loader that transpiles per file never opens the module they name. Only a
 * statement that starts `import type` counts: `import { type X } from '...'` keeps its module
 * under `verbatimModuleSyntax`, so that edge stays real.
 */
const TYPE_ONLY_STATEMENT = /^(?:import|export)\s+type\s[\s\S]*?\sfrom\s+['"][^'"]+['"]/gm

/** @param {string} p */
const isFile = (p) => {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

/**
 * A walker over one game's sources.
 * @param {ImportGraphOptions} options
 * @returns {ImportGraph}
 */
export function createImportGraph({ root, alias = { '@/': 'src/' } }) {
  /** @type {ImportGraph['rel']} */
  const rel = (abs) => path.relative(root, abs).replace(/\\/g, '/')

  /** @type {ImportGraph['resolveSpecifier']} */
  const resolveSpecifier = (fromFile, spec) => {
    const bare = spec.split('?')[0] ?? spec
    let base = null
    for (const [prefix, dir] of Object.entries(alias)) {
      if (bare.startsWith(prefix)) base = path.join(root, dir, bare.slice(prefix.length))
    }
    if (base === null && bare.startsWith('.')) base = path.resolve(path.dirname(fromFile), bare)
    if (base === null) return null
    const candidates = [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.mjs`,
      path.join(base, 'index.ts'),
    ]
    if (base.endsWith('.js')) candidates.push(base.replace(/\.js$/, '.ts'))
    return candidates.find(isFile) ?? null
  }

  /** @type {ImportGraph['importsOf']} */
  const importsOf = (file, { valueOnly = false } = {}) => {
    let src = fs.readFileSync(file, 'utf8')
    if (valueOnly) src = src.replace(TYPE_ONLY_STATEMENT, '')
    const out = [...src.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '')
    for (const m of src.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) out.push(m[1] ?? '')
    return out
  }

  /** @type {ImportGraph['walkImports']} */
  function* walkImports(entry, options = {}) {
    const seen = new Set()
    const queue = [{ file: entry, chain: [entry] }]
    for (let next = queue.shift(); next; next = queue.shift()) {
      if (seen.has(next.file)) continue
      seen.add(next.file)
      yield next
      // Only source files are parsed: a JSON or asset import is a leaf.
      if (!/\.(m?[jt]s|tsx)$/.test(next.file)) continue
      for (const spec of importsOf(next.file, options)) {
        const target = resolveSpecifier(next.file, spec)
        if (target && !seen.has(target)) {
          queue.push({ file: target, chain: [...next.chain, target] })
        }
      }
    }
  }

  /** @type {ImportGraph['reachable']} */
  const reachable = (entry, under = 'src') => {
    const dir = path.join(root, under) + path.sep
    const out = new Set()
    for (const { file } of walkImports(entry)) {
      if (file.startsWith(dir) && /\.tsx?$/.test(file) && !/\.(d|test)\.ts$/.test(file)) {
        out.add(rel(file))
      }
    }
    return out
  }

  return { rel, resolveSpecifier, importsOf, walkImports, reachable }
}
