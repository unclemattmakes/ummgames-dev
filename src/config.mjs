// @ts-check
/**
 * A game's settings for these tools live in `umm-dev.config.mjs` at the game's root:
 *
 *   import { defineConfig } from '@ummgames/dev'
 *   export default defineConfig({ capture: { ... }, store: { ... } })
 *
 * Each tool reads only its own section. The root is the nearest folder at or above `cwd`
 * holding a package.json, so a command run from a subfolder or a worktree finds its game.
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const CONFIG_FILES = ['umm-dev.config.mjs', 'umm-dev.config.js']

/** @param {string} [cwd] */
export function findGameRoot(cwd = process.cwd()) {
  let dir = path.resolve(cwd)
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir
    const up = path.dirname(dir)
    if (up === dir) return path.resolve(cwd)
    dir = up
  }
}

/**
 * @template {object} T
 * @param {T} config
 * @returns {T}
 */
export function defineConfig(config) {
  return config
}

/**
 * The whole config object, or `{}` when the game has none.
 * @param {string} [cwd]
 * @returns {Promise<{ root: string, file: string | null, config: Record<string, unknown> }>}
 */
export async function loadConfigFile(cwd) {
  const root = findGameRoot(cwd)
  for (const name of CONFIG_FILES) {
    const file = path.join(root, name)
    if (fs.existsSync(file)) {
      const mod = await import(pathToFileURL(file).href)
      return { root, file, config: mod.default ?? {} }
    }
  }
  return { root, file: null, config: {} }
}

/**
 * One section, merged over the tool's defaults. Plain objects merge one level deep; anything
 * else in the game's section replaces the default.
 * @template {Record<string, unknown>} D
 * @param {string} section
 * @param {D} defaults
 * @param {string} [cwd]
 * @returns {Promise<D & { root: string }>}
 */
export async function loadConfig(section, defaults, cwd) {
  const { root, config } = await loadConfigFile(cwd)
  const own = /** @type {Record<string, unknown>} */ (config[section] ?? {})
  /** @type {Record<string, unknown>} */
  const out = { ...defaults }
  for (const [k, v] of Object.entries(own)) {
    const d = out[k]
    out[k] = isPlain(d) && isPlain(v) ? { ...d, ...v } : v
  }
  return /** @type {D & { root: string }} */ ({ ...out, root })
}

/** @param {unknown} v @returns {v is Record<string, unknown>} */
function isPlain(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
