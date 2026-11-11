/**
 * runtime/worker/security-headers.ts against the kit's own `headers()`. A site Worker sends this
 * file's set on what its script answers, and `_headers` (written by `headersFile`) covers the
 * static assets; the two must be the same set, or one kind of page goes out without a header.
 */
import { describe, expect, it } from 'vitest'
import {
  HSTS,
  headersFile,
  PERMISSIONS_POLICY,
  REFERRER_POLICY,
  securityHeaders as viteSecurityHeaders,
} from '../../src/vite/index.mjs'

/** @param {string} rel @returns {Promise<any>} */
const load = (rel) =>
  import(/* @vite-ignore */ new URL(`../../runtime/${rel}`, import.meta.url).href)

/**
 * Every header the `/*` rules of a `_headers` text set, in the order written; a later rule wins.
 * @param {string} text
 * @returns {[string, string][]}
 */
function everyPath(text) {
  /** @type {Map<string, string>} */
  const out = new Map()
  let on = false
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    if (!line.startsWith(' ')) {
      on = line === '/*'
      continue
    }
    if (!on) continue
    const at = line.indexOf(': ')
    out.set(line.slice(0, at).trim(), line.slice(at + 2))
  }
  return [...out]
}

const ORIGINS = ['https://tv.example.com', 'https://air.example.org:8443']
/**
 * Every combination a game uses, and a rule that replaces a built-in header.
 * @type {import('../../src/vite/headers.mjs').HeadersOptions[]}
 */
const CASES = [
  {},
  { framedBy: [] },
  { framedBy: ORIGINS },
  { framedBy: ORIGINS.slice(0, 1) },
  { rules: { '/*': { 'X-Robots-Tag': 'noindex' } } },
  { framedBy: ORIGINS, rules: { '/*': { 'X-Robots-Tag': 'noindex' } } },
  {
    framedBy: ORIGINS,
    rules: {
      '/*': { 'X-Robots-Tag': 'noindex', 'X-Extra': 'a: b' },
      '/making-of/*': { 'X-Only-There': '1' },
    },
  },
  { rules: { '/*': { 'Content-Security-Policy': "frame-ancestors 'none'" } } },
]

describe('worker/security-headers', async () => {
  const w = await load('worker/security-headers.ts')

  it('is exactly the /* set headers() writes, in order, for every option', () => {
    for (const options of CASES) {
      const label = JSON.stringify(options)
      expect(Object.entries(w.securityHeaders(options)), label).toEqual(
        everyPath(headersFile(options)),
      )
      // immutableAssets is headers()'s alone; it changes nothing on /*.
      expect(Object.entries(w.securityHeaders(options)), label).toEqual(
        everyPath(headersFile({ ...options, immutableAssets: true })),
      )
    }
  })

  it('with no options, is the plugin securityHeaders(), and shares its values', () => {
    expect(Object.entries(w.securityHeaders())).toEqual(Object.entries(viteSecurityHeaders()))
    expect([w.HSTS, w.REFERRER_POLICY, w.PERMISSIONS_POLICY]).toEqual([
      HSTS,
      REFERRER_POLICY,
      PERMISSIONS_POLICY,
    ])
  })

  it('keeps a noindex constant, as a site that is not listed yet passes it to both', () => {
    const options = { framedBy: ORIGINS, rules: { '/*': w.NOINDEX } }
    expect(w.securityHeaders(options)).toEqual({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Strict-Transport-Security': 'max-age=31536000',
      'Content-Security-Policy': `frame-ancestors 'self' ${ORIGINS.join(' ')}`,
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      'X-Robots-Tag': 'noindex',
    })
    expect(Object.entries(w.securityHeaders(options))).toEqual(everyPath(headersFile(options)))
  })

  it('refuses what headers() refuses', () => {
    for (const bad of [
      'http://tv.example.com',
      'https://*.example.com',
      'https://tv.example.com/',
      "'self'",
      'https://a.example.com https://b.example.com',
    ]) {
      expect(() => w.securityHeaders({ framedBy: [bad] }), bad).toThrow(/framedBy/)
      expect(() => headersFile({ framedBy: [bad] }), bad).toThrow(/framedBy/)
    }
    const nl = { rules: { '/*': { A: 'b\nC: d' } } }
    expect(() => w.securityHeaders(nl)).toThrow(/bad _headers text/)
    expect(() => headersFile(nl)).toThrow(/bad _headers text/)
  })

  it('adds what a response lacks, keeps what the route set, and leaves the original alone', async () => {
    const set = w.securityHeaders({ rules: { '/*': w.NOINDEX } })
    const original = new Response('hi', {
      status: 201,
      headers: { 'Content-Type': 'text/plain', 'X-Robots-Tag': 'all' },
    })
    const res = w.withSecurityHeaders(original, set)
    expect(res).not.toBe(original)
    expect(res.status).toBe(201)
    expect(await res.text()).toBe('hi')
    expect(res.headers.get('x-robots-tag')).toBe('all')
    expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN')
    expect(res.headers.get('strict-transport-security')).toBe(HSTS)
    expect(original.headers.has('x-frame-options')).toBe(false)
  })

  it('works on a redirect, whose own headers are immutable', () => {
    const res = w.withSecurityHeaders(Response.redirect('https://example.com/', 301))
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('https://example.com/')
    expect(res.headers.get('content-security-policy')).toBe("frame-ancestors 'self'")
  })
})
