// @ts-check
/**
 * Cloudflare Pages' `_headers` file: security headers on every path, and a year-long cache on
 * hashed output.
 *
 * Pages sends only `nosniff` and a referrer policy by default. This adds:
 *
 * - **Strict-Transport-Security**, one year. No `includeSubDomains` or `preload`: both bind
 *   hostnames a game does not own the list of.
 * - **Framing.** The build may be framed by its own origin only: `X-Frame-Options: SAMEORIGIN`
 *   and CSP `frame-ancestors 'self'`. A CSP holding only `frame-ancestors` restricts nothing else.
 * - **Permissions-Policy** denying what a game never asks for: camera, microphone, geolocation,
 *   payment, USB. Gamepads, fullscreen and the clipboard stay at the browser's default.
 *
 * Left out on purpose: COOP and COEP (they break cross-origin assets unless every host opts in)
 * and a full Content-Security-Policy (a wrong one is a broken game; run it in Report-Only first).
 *
 * The cache rule marks `/assets/*` immutable, which is safe only when nothing under `assets/` has
 * a stable name: turn it on when `publicDir` is off, and the build fails if a file there lacks
 * a content hash.
 */
import fs from 'node:fs'
import path from 'node:path'

export const HEADERS_FILE = '_headers'
export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'
export const HSTS = 'max-age=31536000'
export const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'

/**
 * Header name to value for every path of the build.
 * @returns {Record<string, string>}
 */
export function securityHeaders() {
  return {
    'Strict-Transport-Security': HSTS,
    'X-Frame-Options': 'SAMEORIGIN',
    'Content-Security-Policy': "frame-ancestors 'self'",
    'Permissions-Policy': PERMISSIONS_POLICY,
  }
}

/**
 * @typedef {object} HeadersOptions
 * @property {boolean} [immutableAssets] Cache hashed output under `assetsDir` for a year.
 * @property {string} [assetsDir] Default `assets`, Vite's `build.assetsDir`.
 * @property {Readonly<Record<string, Readonly<Record<string, string>>>>} [rules]
 *   More rules, path pattern to headers, after the built-in ones.
 */

/**
 * The text of `_headers`.
 * @param {HeadersOptions} [options]
 * @returns {string}
 */
export function headersFile(options = {}) {
  for (const gone of ['target', 'frameAncestors']) {
    // Ignoring it would quietly refuse the framing the game asked for.
    if (gone in options) {
      throw new Error(`headers: ${gone} was removed in 0.2.0; _headers is for the site build only`)
    }
  }
  const { immutableAssets = false, assetsDir = 'assets', rules = {} } = options
  const block = (/** @type {string} */ pattern, /** @type {Record<string, string>} */ h) => {
    clean(pattern)
    const lines = Object.entries(h).map(([k, v]) => `  ${clean(k)}: ${clean(v)}\n`)
    return `${pattern}\n${lines.join('')}`
  }
  const sections = [block('/*', securityHeaders())]
  if (immutableAssets) sections.push(block(`/${assetsDir}/*`, { 'Cache-Control': IMMUTABLE_CACHE }))
  for (const [pattern, h] of Object.entries(rules)) sections.push(block(pattern, { ...h }))
  return sections.join('')
}

/** @param {string} s */
function clean(s) {
  if (/[\r\n]/.test(s) || s.trim() === '')
    throw new Error(`bad _headers text: ${JSON.stringify(s)}`)
  return s
}

/**
 * `name-AbCd_-12.js` under `assetsDir`: a name ending in an 8-character content hash.
 * @param {string} [assetsDir]
 */
export function hashedAsset(assetsDir = 'assets') {
  const dir = assetsDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${dir}/.+-[\\w-]{8}\\.[\\w.]+$`)
}

/**
 * Names in a bundle that sit under `assetsDir` without a content hash.
 * @param {readonly string[]} fileNames
 * @param {string} [assetsDir]
 * @returns {string[]}
 */
export function unhashedUnderAssets(fileNames, assetsDir = 'assets') {
  const re = hashedAsset(assetsDir)
  return fileNames.filter((n) => n.startsWith(`${assetsDir}/`) && !re.test(n))
}

/**
 * Emit `_headers` at the top of the build output. Nothing in dev.
 * @param {Omit<HeadersOptions, 'assetsDir'>} [options] `assetsDir` comes from Vite's config.
 * @returns {import('vite').Plugin}
 */
export function headers(options = {}) {
  let assetsDir = 'assets'
  let publicDir = ''
  // Fail at config time, not after a whole build.
  headersFile(options)
  return {
    name: 'umm:headers',
    apply: 'build',
    configResolved(config) {
      assetsDir = config.build.assetsDir
      publicDir = config.publicDir
    },
    generateBundle(_options, bundle) {
      if (options.immutableAssets) {
        // Vite copies `public/` after the bundle, so its files are not in `bundle`: list them.
        const copied = publicDir ? filesUnder(path.join(publicDir, assetsDir), assetsDir) : []
        const bad = unhashedUnderAssets([...Object.keys(bundle), ...copied], assetsDir)
        if (bad.length > 0) {
          this.error(
            `/${assetsDir}/* is cached immutable but these have no content hash: ${bad.join(', ')}`,
          )
        }
      }
      this.emitFile({
        type: 'asset',
        fileName: HEADERS_FILE,
        source: headersFile({ ...options, assetsDir }),
      })
    },
  }
}

/**
 * Every file under `dir`, named as `prefix/<relative path>`; none if `dir` is missing.
 * @param {string} dir
 * @param {string} prefix
 * @returns {string[]}
 */
function filesUnder(dir, prefix) {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => path.relative(dir, path.join(d.parentPath, d.name)).split(path.sep).join('/'))
    .map((rel) => `${prefix}/${rel}`)
}
