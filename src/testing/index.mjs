// @ts-check
/**
 * `@ummgames/dev/testing`: helpers for a game's own specs. See docs/build.md.
 *
 *   expect(headersFor('dist', '/')['x-frame-options']).toBe('SAMEORIGIN')
 */
import fs from 'node:fs'
import path from 'node:path'

/**
 * The headers Cloudflare Pages would send for `pathname` from a build's `_headers`: every rule
 * whose pattern matches, in order (splats only; placeholders are not read).
 * @param {string} dist
 * @param {string} pathname
 * @returns {Record<string, string>}
 */
export function headersFor(dist, pathname) {
  const file = path.join(dist, '_headers')
  if (!fs.existsSync(file)) return {}
  /** @type {Record<string, string>} */
  const out = {}
  let on = false
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    if (!/^\s/.test(line)) {
      const re = line
        .trim()
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
      on = new RegExp(`^${re}$`).test(pathname)
      continue
    }
    const at = line.indexOf(':')
    if (on && at > 0) out[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim()
  }
  return out
}
