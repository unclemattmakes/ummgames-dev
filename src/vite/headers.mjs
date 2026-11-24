// @ts-check
/**
 * Cloudflare's `_headers` file: security headers on every path, and a year-long cache on hashed
 * output. Workers static assets and Pages both read it.
 *
 * - **`nosniff` and a referrer policy.** Pages sends these by default, but Workers static assets,
 *   where every game site is served, sends neither. A site went without them until 2026-11-08.
 *
 * - **Strict-Transport-Security**, one year. No `includeSubDomains` or `preload`: both bind
 *   hostnames a game does not own the list of.
 * - **Framing.** The build may be framed by its own origin only: `X-Frame-Options: SAMEORIGIN`
 *   and CSP `frame-ancestors 'self'`. A CSP holding only `frame-ancestors` restricts nothing else.
 *   `framedBy` names other exact origins that may frame the site too, such as a station that airs
 *   it; then `X-Frame-Options` is left out, because it cannot name another origin.
 * - **Permissions-Policy** denying what a game never asks for: camera, microphone, geolocation,
 *   payment, USB. Gamepads, fullscreen and the clipboard stay at the browser's default.
 *
 * - **A script rule, when a site turns it on** (`scripts`). `script-src` allows the site's own
 *   files, WebAssembly and Cloudflare's Web Analytics beacon, which Cloudflare writes into every
 *   page it proxies; `object-src 'none'` and `base-uri 'self'` close the other ways in. Inline
 *   script, inline handlers (`onload="..."`), `eval` and `blob:` workers stop running, so an
 *   HTML injection cannot run script. Off by default: many sites take the kit's `main`, and a
 *   page that needs any of those goes blank. `reportOnly` sends it as Report-Only first.
 *
 * Left out on purpose: COOP and COEP (they break cross-origin assets unless every host opts in)
 * and the rest of a full Content-Security-Policy (`connect-src`, `img-src`, `style-src`: a
 * wrong one is a broken game, and none of them stops injected script).
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
export const REFERRER_POLICY = 'strict-origin-when-cross-origin'
export const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
/** Where Cloudflare's Web Analytics beacon loads from. Cloudflare adds its tag to proxied pages. */
export const WEB_ANALYTICS = 'https://static.cloudflareinsights.com'

/**
 * Header name to value for every path of the build.
 * @returns {Record<string, string>}
 */
export function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': REFERRER_POLICY,
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
 * @property {readonly string[]} [framedBy] Exact `https://` origins that may frame the site, beside
 *   its own.
 * @property {boolean | ScriptOptions} [scripts] Send the script rule. Default false.
 */

/**
 * @typedef {object} ScriptOptions
 * @property {readonly string[]} [hosts] More exact `https://` origins scripts may load from.
 * @property {boolean} [wasm] Allow WebAssembly (`'wasm-unsafe-eval'`). Default true.
 * @property {boolean} [webAnalytics] Allow Cloudflare's Web Analytics beacon. Default true.
 * @property {boolean} [reportOnly] Send the rule as `Content-Security-Policy-Report-Only`, so the
 *   browser logs what it would block and blocks nothing. Default false.
 */

/** `https://host` or `https://host:port`, nothing more: no path, no wildcard, no scheme but https. */
const ORIGIN =
  /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?$/

const SCRIPT_KEYS = ['hosts', 'wasm', 'webAnalytics', 'reportOnly']

/**
 * The script rule's directives: `script-src`, `object-src 'none'` and `base-uri 'self'`.
 * @param {ScriptOptions} [options]
 * @returns {string}
 */
export function scriptPolicy(options = {}) {
  const extra = Object.keys(options).filter((k) => !SCRIPT_KEYS.includes(k))
  if (extra.length > 0) {
    throw new Error(`headers: scripts takes ${SCRIPT_KEYS.join(', ')}, not ${extra.join(', ')}`)
  }
  const { hosts = [], wasm = true, webAnalytics = true } = options
  for (const host of hosts) {
    if (!ORIGIN.test(host)) {
      throw new Error(
        `headers: scripts.hosts takes exact https:// origins, not ${JSON.stringify(host)}`,
      )
    }
  }
  const src = ["'self'"]
  if (wasm) src.push("'wasm-unsafe-eval'")
  if (webAnalytics) src.push(WEB_ANALYTICS)
  src.push(...hosts)
  return `script-src ${src.join(' ')}; object-src 'none'; base-uri 'self'`
}

/**
 * `scripts` as options, or null when the rule is off.
 * @param {unknown} scripts
 * @returns {ScriptOptions | null}
 */
function scriptOptions(scripts) {
  if (scripts === undefined || scripts === false) return null
  if (scripts === true) return {}
  if (typeof scripts === 'object' && scripts !== null && !Array.isArray(scripts)) return scripts
  throw new Error(`headers: scripts takes true, false or { ${SCRIPT_KEYS.join(', ')} }`)
}

/**
 * The `/*` headers, with `framedBy` and the script rule folded in. The script rule joins
 * `frame-ancestors` in the one policy, or follows it as a Report-Only header.
 * @param {readonly string[]} framedBy
 * @param {unknown} scripts
 * @returns {Record<string, string>}
 */
function siteHeaders(framedBy, scripts) {
  for (const origin of framedBy) {
    if (!ORIGIN.test(origin)) {
      throw new Error(
        `headers: framedBy takes exact https:// origins, not ${JSON.stringify(origin)}`,
      )
    }
  }
  const script = scriptOptions(scripts)
  const policy = script ? scriptPolicy(script) : ''
  /** @type {Record<string, string>} */
  const out = {}
  for (const [name, value] of Object.entries(securityHeaders())) {
    if (name === 'X-Frame-Options' && framedBy.length > 0) continue
    if (name !== 'Content-Security-Policy') {
      out[name] = value
      continue
    }
    const frame = ["frame-ancestors 'self'", ...framedBy].join(' ')
    out[name] = policy && !script?.reportOnly ? `${frame}; ${policy}` : frame
    if (policy && script?.reportOnly) out['Content-Security-Policy-Report-Only'] = policy
  }
  return out
}

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
  const {
    immutableAssets = false,
    assetsDir = 'assets',
    rules = {},
    framedBy = [],
    scripts = false,
  } = options
  const block = (/** @type {string} */ pattern, /** @type {Record<string, string>} */ h) => {
    clean(pattern)
    const lines = Object.entries(h).map(([k, v]) => `  ${clean(k)}: ${clean(v)}\n`)
    return `${pattern}\n${lines.join('')}`
  }
  const sections = [block('/*', siteHeaders(framedBy, scripts))]
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
