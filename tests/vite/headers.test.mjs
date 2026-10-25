// @ts-check
import { afterAll, describe, expect, it } from 'vitest'
import {
  hashedAsset,
  headers,
  headersFile,
  IMMUTABLE_CACHE,
  notFoundPage,
  securityHeaders,
  unhashedUnderAssets,
} from '../../src/vite/index.mjs'
import { buildFixture, cleanUp } from './build-fixture.mjs'

afterAll(cleanUp)

/** One header's value for `/*` in a `_headers` text. */
const header = (/** @type {string} */ text, /** @type {string} */ name) =>
  new RegExp(`^/\\*\\n(?:  .*\\n)*?  ${name}: (.*)$`, 'm').exec(text)?.[1]

describe('the header policy', () => {
  it('locks the build to its own origin', () => {
    const h = securityHeaders()
    expect(h['X-Frame-Options']).toBe('SAMEORIGIN')
    expect(h['Content-Security-Policy']).toBe("frame-ancestors 'self'")
    expect(h['Strict-Transport-Security']).toBe('max-age=31536000')
    expect(h['Permissions-Policy']).toContain('camera=()')
  })
})

describe('headersFile', () => {
  it('writes the security rule for every path, then the cache rule and any more', () => {
    const text = headersFile({
      immutableAssets: true,
      rules: { '/levels/*': { 'Cache-Control': 'no-cache' } },
    })
    expect(text).toBe(
      [
        '/*',
        '  Strict-Transport-Security: max-age=31536000',
        '  X-Frame-Options: SAMEORIGIN',
        "  Content-Security-Policy: frame-ancestors 'self'",
        '  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()',
        '/assets/*',
        `  Cache-Control: ${IMMUTABLE_CACHE}`,
        '/levels/*',
        '  Cache-Control: no-cache',
        '',
      ].join('\n'),
    )
    expect(headersFile()).not.toContain('Cache-Control')
    expect(() => headersFile({ rules: { '/x': { A: 'b\nC: d' } } })).toThrow(/bad _headers text/)
  })

  it('knows a hashed name from a stable one', () => {
    expect(hashedAsset().test('assets/index-CmsxLgAy.js')).toBe(true)
    expect(hashedAsset().test('assets/index-a_b-c1d2.css')).toBe(true)
    expect(unhashedUnderAssets(['assets/hero.glb', 'assets/a-12345678.js', 'index.html'])).toEqual([
      'assets/hero.glb',
    ])
    expect(unhashedUnderAssets(['static/x.png'], 'static')).toEqual(['static/x.png'])
  })
})

describe('the headers plugin', () => {
  it("emits the site's _headers with the immutable cache when publicDir is off", async () => {
    const { read } = await buildFixture({
      publicDir: false,
      plugins: [headers({ immutableAssets: true }), notFoundPage()],
    })
    const text = read('_headers')
    expect(header(text, 'X-Frame-Options')).toBe('SAMEORIGIN')
    expect(header(text, 'Content-Security-Policy')).toBe("frame-ancestors 'self'")
    expect(text).toContain(`/assets/*\n  Cache-Control: ${IMMUTABLE_CACHE}\n`)
  })

  it('fails the build when an unhashed file would get the immutable cache', async () => {
    await expect(
      buildFixture({ publicDir: 'public', plugins: [headers({ immutableAssets: true })] }),
    ).rejects.toThrow(/no content hash: .*assets\/hero\.txt/)
  })

  it('rejects the removed portal options when the config is made, not after a build', () => {
    // @ts-expect-error: removed in 0.2.0
    expect(() => headers({ target: 'portal' })).toThrow(/target was removed in 0\.2\.0/)
    // @ts-expect-error: removed in 0.2.0
    expect(() => headers({ frameAncestors: ['https://a.example'] })).toThrow(/frameAncestors/)
  })
})
