// @ts-check
/**
 * `@ummgames/dev/vitest`: the shared Vitest config, with the game's own paths.
 *
 *   // vitest.config.ts
 *   import { defineConfig } from 'vitest/config'
 *   import { vitestConfig } from '@ummgames/dev/vitest'
 *   export default defineConfig(vitestConfig({ root: import.meta.url }))
 *
 * Unit tests in node, `tests/unit/**\/*.test.ts`, and an `@` alias to `<root>/src`. Every
 * option is the game's to change; `test` and `resolve` merge over the defaults a key at a time.
 * This file imports nothing from Vitest, so it works with whichever Vitest the game has.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * @typedef {{
 *   root?: string | URL,
 *   include?: string[],
 *   environment?: string,
 *   alias?: Record<string, string> | false,
 *   test?: Record<string, unknown>,
 *   resolve?: Record<string, unknown>,
 *   [key: string]: unknown,
 * }} VitestPresetOptions
 * @typedef {{
 *   resolve: Record<string, unknown> & { alias: Record<string, string> },
 *   test: Record<string, unknown> & { include: string[], environment: string },
 *   [key: string]: unknown,
 * }} VitestPresetConfig
 */

/**
 * The folder a `root` names: a path, a folder URL, or a config file's own `import.meta.url`.
 * @param {string | URL | undefined} root
 */
export function rootDir(root) {
  if (root === undefined) return process.cwd()
  const s = root instanceof URL ? root.href : root
  if (!s.startsWith('file:')) return path.resolve(s)
  const p = fileURLToPath(s)
  return /\.[cm]?[jt]s$/.test(p) ? path.dirname(p) : p
}

/**
 * @param {VitestPresetOptions} [options]
 * @returns {VitestPresetConfig}
 */
export function vitestConfig(options = {}) {
  const {
    root,
    include = ['tests/unit/**/*.test.ts'],
    environment = 'node',
    alias = { '@': 'src' },
    test = {},
    resolve = {},
    ...rest
  } = options
  const dir = rootDir(root)
  /** @type {Record<string, string>} */
  const aliases = {}
  for (const [k, v] of Object.entries(alias || {})) aliases[k] = path.resolve(dir, v)
  const own = /** @type {Record<string, string> | undefined} */ (resolve.alias)
  return {
    ...rest,
    resolve: { ...resolve, alias: { ...aliases, ...own } },
    test: { include, environment, ...test },
  }
}

export default vitestConfig
