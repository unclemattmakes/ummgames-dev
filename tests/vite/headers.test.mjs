// @ts-check
import { afterAll, describe, expect, it } from 'vitest'
import {
  CRAZYGAMES_ORIGINS,
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
  it('locks the site build to its own origin', () => {
    const h = securityHeaders()
    expect(h['X-Frame-Options']).toBe('SAMEORIGIN')
    expect(h['Content-Security-Policy']).toBe("frame-ancestors 'self'")
    expect(h['Strict-Transport-Security']).toBe('max-age=31536000')
    expect(h['Permissions-Policy']).toContain('camera=()')
    expect(securityHeaders({ target: 'site' })).toEqual(h)
  })

  it('lets the portal frame the portal build, and sends no X-Frame-Options', () => {
    const h = securityHeaders({ target: 'portal' })
    expect(h['X-Frame-Options']).toBeUndefined()
    expect(h['Content-Security-Policy']).toBe(
      `frame-ancestors 'self' ${CRAZYGAMES_ORIGINS.join(' ')}`,
    )
    expect(h['Content-Security-Policy']).toContain('https://*.crazygames.com')
    expect(h['Strict-Transport-Security']).toBeDefined()
    expect(h['Permissions-Policy']).toBeDefined()
  })

  it('takes the portal origins as given', () => {
    const h = securityHeaders({
      target: 'portal',
      frameAncestors: ['https://games.example.org', 'https://*.example.net:8443', "'self'"],
    })
    expect(h['Content-Security-Policy']).toBe(
      "frame-ancestors 'self' https://games.example.org https://*.example.net:8443",
    )
  })

  it('refuses what would weaken the site or break the header', () => {
    expect(() =>
      securityHeaders({ target: 'site', frameAncestors: ['https://a.example'] }),
    ).toThrow(/portal build/)
    expect(() => securityHeaders({ target: 'portal', frameAncestors: [] })).toThrow(/at least one/)
    for (const bad of [
      '*',
      'https://a.example/path',
      "'none'",
      'https://a.example\n  X: y',
      'a.example',
    ]) {
      expect(() => securityHeaders({ target: 'portal', frameAncestors: [bad] })).toThrow(
        /frame-ancestors source/,
      )
    }
    // @ts-expect-error: not a target
    expect(() => securityHeaders({ target: 'mobile' })).toThrow(/unknown build target/)
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

  it('emits the portal build its own frame policy', async () => {
    const { read } = await buildFixture({
      mode: 'portal',
      base: './',
      publicDir: false,
      plugins: [headers({ target: 'portal' })],
    })
    const text = read('_headers')
    expect(header(text, 'X-Frame-Options')).toBeUndefined()
    expect(header(text, 'Content-Security-Policy')).toBe(
      "frame-ancestors 'self' https://crazygames.com https://*.crazygames.com",
    )
  })

  it('rejects bad options when the config is made, not after a build', () => {
    expect(() => headers({ target: 'portal', frameAncestors: ['nope'] })).toThrow()
  })
})
