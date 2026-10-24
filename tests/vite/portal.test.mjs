// @ts-check
import { afterAll, describe, expect, it } from 'vitest'
import {
  CRAZYGAMES_SDK_URL,
  orphanChunks,
  overLimits,
  PORTAL_MODE,
  portalAssets,
  portalPrune,
  portalSdk,
  portalSiteOnly,
  stripSiteOnly,
} from '../../src/vite/index.mjs'
import { buildFixture, cleanUp } from './build-fixture.mjs'

afterAll(cleanUp)

/** @param {string} fileName @param {string | null} text @param {boolean} [entry] */
const chunk = (fileName, text, entry = false) => ({ fileName, text, entry, isChunk: true })

describe('orphanChunks', () => {
  it('drops a chunk nothing names, and a chain of them, but never an entry', () => {
    const files = [
      chunk('assets/index-aaaaaaaa.js', 'import("./level-bbbbbbbb.js")', true),
      chunk('assets/level-bbbbbbbb.js', 'export const x = 1'),
      chunk('assets/editor-cccccccc.js', 'import("./editor-panel-dddddddd.js")'),
      chunk('assets/editor-panel-dddddddd.js', 'export const y = 2'),
      {
        fileName: 'index.html',
        text: '<script src="/assets/index-aaaaaaaa.js">',
        entry: false,
        isChunk: false,
      },
    ]
    expect(orphanChunks(files).sort()).toEqual([
      'assets/editor-cccccccc.js',
      'assets/editor-panel-dddddddd.js',
    ])
  })

  it('does not read binary assets, so they keep no chunk', () => {
    const files = [
      chunk('assets/a-aaaaaaaa.js', null),
      { fileName: 'x.bin', text: null, entry: false, isChunk: false },
    ]
    expect(orphanChunks(files)).toEqual(['assets/a-aaaaaaaa.js'])
  })
})

describe('stripSiteOnly', () => {
  it('removes marked elements and their line, and leaves the rest', () => {
    const html =
      '<body>\n  <p>keep</p>\n  <p class="x" data-site-only>go</p>\n  <a data-site-only href="/">go too</a>\n</body>'
    expect(stripSiteOnly(html)).toBe('<body>\n  <p>keep</p>\n</body>')
  })

  it('takes another attribute name, and refuses one that is not a name', () => {
    expect(stripSiteOnly('<i data-web>x</i><b>y</b>', 'data-web')).toBe('<b>y</b>')
    expect(() => stripSiteOnly('', 'a b')).toThrow(/bad attribute/)
  })
})

describe('overLimits', () => {
  it('names each limit broken', () => {
    expect(overLimits([1, 2], { files: 5, bytes: 10 })).toEqual([])
    expect(overLimits([1, 2, 3], { files: 2, bytes: 10 })).toEqual(['3 files (limit 2)'])
    expect(overLimits([2 * 1024 * 1024], { files: 5, bytes: 1024 * 1024 })).toEqual([
      '2.0 MB (limit 1.0 MB)',
    ])
  })
})

describe('the portal build of the fixture', () => {
  it('loads the SDK first, strips site-only lines, prunes the dev tool and copies only listed assets', async () => {
    const { files, read } = await buildFixture({
      mode: PORTAL_MODE,
      base: './',
      publicDir: false,
      plugins: [
        portalSdk(),
        portalPrune({ log: false }),
        portalSiteOnly(),
        portalAssets({ paths: ['assets/hero.txt'] }),
      ],
    })
    const html = read('index.html')
    const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'))
    const scripts = [...head.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1])
    expect(scripts[0]).toBe(CRAZYGAMES_SDK_URL)
    expect(scripts.length).toBeGreaterThan(1)
    expect(html).not.toContain('data-site-only')
    expect(html).not.toContain('example.com')
    expect(html).toContain('id="splash"')

    const js = files.filter((f) => f.endsWith('.js'))
    expect(js.some((f) => f.includes('level'))).toBe(true)
    expect(js.some((f) => f.includes('dev-tool'))).toBe(false)
    for (const f of js) expect(read(f)).not.toContain('DEV_TOOL_MARKER')

    expect(files).toContain('assets/hero.txt')
    expect(files).not.toContain('assets/unused.txt')
  })

  it('without portalPrune the dead dev-tool chunk would ship', async () => {
    const { files } = await buildFixture({ mode: PORTAL_MODE, publicDir: false })
    expect(files.some((f) => f.includes('dev-tool'))).toBe(true)
  })

  it('the site build keeps its site-only line and the dev tool', async () => {
    const { files, read } = await buildFixture({ publicDir: false })
    expect(read('index.html')).toContain('data-site-only')
    expect(files.some((f) => f.includes('dev-tool'))).toBe(true)
    expect(read('index.html')).not.toContain(CRAZYGAMES_SDK_URL)
  })

  it('fails on a listed asset that is missing, with the hint', async () => {
    await expect(
      buildFixture({
        mode: PORTAL_MODE,
        publicDir: false,
        plugins: [portalAssets({ paths: ['assets/nope.glb'], missingHint: 'fetch the assets' })],
      }),
    ).rejects.toThrow(/assets\/nope\.glb is missing from public\/: fetch the assets/)
  })

  it('takes the list from a function of the root', async () => {
    /** @type {string[]} */
    const roots = []
    const { files } = await buildFixture({
      mode: PORTAL_MODE,
      publicDir: false,
      plugins: [
        portalAssets({
          paths: async (root) => {
            roots.push(root)
            return ['assets/unused.txt']
          },
        }),
      ],
    })
    expect(roots).toHaveLength(1)
    expect(files).toContain('assets/unused.txt')
  })

  it("fails a build over the portal's limits", async () => {
    await expect(
      buildFixture({
        mode: PORTAL_MODE,
        publicDir: false,
        plugins: [portalAssets({ limits: { files: 2, bytes: 10_000_000 } })],
      }),
    ).rejects.toThrow(/over its limits: \d+ files \(limit 2\)/)
  })
})
