/**
 * The security headers for what a site Worker answers itself. The kit's `headers()` Vite plugin
 * writes them into `_headers`, but `_headers` only reaches the static assets: a route the Worker's
 * script answers (`/privacy`, `/api/*`, a redirect) goes out without them. `securityHeaders` takes
 * the same `framedBy`, `scripts` and `rules` as `headers()` and returns every header its `/*` rules
 * write, in the order they write them. Pass both the same options and the two cannot drift: the kit's own
 * test holds this file to `headers()`.
 *
 * Imports nothing, so it runs in a Worker, a browser or Node.
 */

/** `max-age=31536000`, with no `includeSubDomains` or `preload`. */
export const HSTS = 'max-age=31536000'
/** `strict-origin-when-cross-origin`. */
export const REFERRER_POLICY = 'strict-origin-when-cross-origin'
/** Denies what a game never asks for. */
export const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
/** Where Cloudflare's Web Analytics beacon loads from. Cloudflare adds its tag to proxied pages. */
export const WEB_ANALYTICS = 'https://static.cloudflareinsights.com'

/** `X-Robots-Tag: noindex`, for a site that is not listed yet: `rules: { '/*': NOINDEX }`. */
export const NOINDEX: Readonly<Record<string, string>> = { 'X-Robots-Tag': 'noindex' }

/** The options `headers()` shares with this file. Others it takes (`immutableAssets`) are ignored. */
export interface SecurityHeaderOptions {
  /** Exact `https://` origins that may frame the site beside its own. Default none. */
  framedBy?: readonly string[]
  /** Path pattern to headers, as `headers()` takes them. Only the `/*` rule is read here. */
  rules?: Readonly<Record<string, Readonly<Record<string, string>>>>
  /** The script rule, as `headers()` takes it. Default false. */
  scripts?: boolean | ScriptOptions
}

/** The script rule's options, as `headers()` takes them. */
export interface ScriptOptions {
  /** More exact `https://` origins scripts may load from. Default none. */
  hosts?: readonly string[]
  /** Allow WebAssembly to compile (`'wasm-unsafe-eval'`). Default true. */
  wasm?: boolean
  /** Allow Cloudflare's Web Analytics beacon. Default true. */
  webAnalytics?: boolean
  /** Send the rule as `Content-Security-Policy-Report-Only`, blocking nothing. Default false. */
  reportOnly?: boolean
}

/** `https://host` or `https://host:port`, nothing more: no path, no wildcard, no scheme but https. */
const ORIGIN =
  /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?$/

const SCRIPT_KEYS = ['hosts', 'wasm', 'webAnalytics', 'reportOnly']

/**
 * The script rule's directives: `script-src` with `'self'`, then `'wasm-unsafe-eval'`, the
 * beacon's origin and `hosts`, then `object-src 'none'; base-uri 'self'`. Throws, as `headers()`
 * does, on a host that is not an exact `https://` origin and on an unknown option.
 */
export function scriptPolicy(options: ScriptOptions = {}): string {
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

/** `scripts` as options, or null when the rule is off. */
function scriptOptions(scripts: unknown): ScriptOptions | null {
  if (scripts === undefined || scripts === false) return null
  if (scripts === true) return {}
  if (typeof scripts === 'object' && scripts !== null && !Array.isArray(scripts)) {
    return scripts as ScriptOptions
  }
  throw new Error(`headers: scripts takes true, false or { ${SCRIPT_KEYS.join(', ')} }`)
}

/**
 * Header name to value for every path of the site, as `headers()` writes them for `/*`:
 * `nosniff`, the referrer policy, HSTS, framing, the Permissions-Policy, then the `/*` rule from
 * `rules`, which wins where it names the same header. With `framedBy`, the origins join
 * `frame-ancestors 'self'` and `X-Frame-Options` is left out, because it cannot name another
 * origin. With `scripts`, the script rule joins `frame-ancestors` in the one policy, or follows it
 * as `Content-Security-Policy-Report-Only`. Throws, as `headers()` does, on an origin that is not
 * an exact `https://` origin and on a newline in a header.
 */
export function securityHeaders(options: SecurityHeaderOptions = {}): Record<string, string> {
  const framedBy = options.framedBy ?? []
  for (const origin of framedBy) {
    if (!ORIGIN.test(origin)) {
      throw new Error(
        `headers: framedBy takes exact https:// origins, not ${JSON.stringify(origin)}`,
      )
    }
  }
  const script = scriptOptions(options.scripts)
  const policy = script ? scriptPolicy(script) : ''
  const out: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': REFERRER_POLICY,
    'Strict-Transport-Security': HSTS,
  }
  if (framedBy.length === 0) out['X-Frame-Options'] = 'SAMEORIGIN'
  const frame = ["frame-ancestors 'self'", ...framedBy].join(' ')
  out['Content-Security-Policy'] = policy && !script?.reportOnly ? `${frame}; ${policy}` : frame
  if (policy && script?.reportOnly) out['Content-Security-Policy-Report-Only'] = policy
  out['Permissions-Policy'] = PERMISSIONS_POLICY
  for (const [name, value] of Object.entries(options.rules?.['/*'] ?? {})) {
    out[clean(name)] = clean(value)
  }
  return out
}

/**
 * `res` with every header in `headers` it does not already set; a header the route set is kept.
 * A new `Response` over the same body, since a response's own headers can be immutable (a
 * redirect's are).
 */
export function withSecurityHeaders(
  res: Response,
  headers: Readonly<Record<string, string>> = securityHeaders(),
): Response {
  const out = new Response(res.body, res)
  for (const [name, value] of Object.entries(headers)) {
    if (!out.headers.has(name)) out.headers.set(name, value)
  }
  return out
}

function clean(s: string): string {
  if (/[\r\n]/.test(s) || s.trim() === '')
    throw new Error(`bad _headers text: ${JSON.stringify(s)}`)
  return s
}
