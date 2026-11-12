// @ts-check
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  CRAZYGAMES_LIMITS,
  CRAZYGAMES_SDK_URL,
  checkPortalBuild,
  orphanChunks,
  overLimits,
  PORTAL_MODE,
  portalAssets,
  portalCheck,
  portalPrune,
  portalSdk,
  portalSiteOnly,
  publicFiles,
  stripSiteOnly,
} from '../../src/vite/index.mjs'
import { buildFixture, cleanUp, REPO, tempDir } from './build-fixture.mjs'

/** The portal fixture: it boots the runtime adapter and has a dev tool and a site-only line. */
const GAME = path.join(REPO, 'tests/vite/fixtures/portal-game')

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
    expect(overLimits([2_000_000], { files: 5, bytes: 1_000_000 })).toEqual([
      '2.0 MB (limit 1.0 MB)',
    ])
  })

  it("holds a build to CrazyGames' limits by default, in decimal megabytes", () => {
    expect(CRAZYGAMES_LIMITS).toEqual({ files: 1500, bytes: 50_000_000 })
    expect(overLimits([50_000_000])).toEqual([])
    expect(overLimits([50_000_001])).toEqual(['50.0 MB (limit 50.0 MB)'])
    expect(overLimits(new Array(1501).fill(1))).toEqual(['1501 files (limit 1500)'])
  })
})

/** Write `files` (path to text) under a fresh folder. @param {Record<string, string>} files */
function folder(files) {
  const dir = tempDir()
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), text)
  }
  return dir
}

describe('publicFiles', () => {
  it('lists every file but dotfiles, site files and the excluded prefixes', () => {
    const dir = folder({
      'audio/theme.ogg': 'x',
      'models/hero.glb': 'x',
      'dev/forge.glb': 'x',
      '.assetsignore': 'x',
      '.cache/a.bin': 'x',
      _headers: 'x',
      'nested/_headers': 'x',
    })
    expect(publicFiles(dir, { exclude: ['dev/'] })).toEqual([
      'audio/theme.ogg',
      'models/hero.glb',
      'nested/_headers',
    ])
    expect(publicFiles(path.join(dir, 'nowhere'))).toEqual([])
  })
})

describe('checkPortalBuild', () => {
  it('passes a clean folder and reports its size', () => {
    const dir = folder({
      'index.html': '<script type="module" src="./assets/a.js"></script><a href="//cdn.x/y">',
      'assets/a.js': '1234',
    })
    const r = checkPortalBuild(dir)
    expect(r.problems).toEqual([])
    expect(r.files).toBe(2)
    expect(r.mobile).toBe(true)
  })

  it('names every broken rule', () => {
    const dir = folder({
      'index.html': '<script src="/assets/a.js"></script>\n<p data-site-only>site</p>',
      'assets/a.js': '1',
      'assets/a.js.map': '{}',
      '.assetsignore': '',
      _headers: '',
    })
    expect(checkPortalBuild(dir, { limits: { files: 3, bytes: 1_000_000 } }).problems).toEqual([
      '5 files (limit 3)',
      '.assetsignore: a dotfile',
      '_headers: a site file the portal ignores',
      'assets/a.js.map: a source map (set build.sourcemap: false)',
      "index.html: /assets/a.js is root-absolute (set base: './')",
      'index.html: an element marked data-site-only is still there',
    ])
  })

  it('needs index.html at the top, not inside a folder', () => {
    const dir = folder({ 'game/index.html': '<p>hi</p>' })
    expect(checkPortalBuild(dir).problems).toEqual(['no index.html at the top of the folder'])
    expect(checkPortalBuild(path.join(dir, 'gone')).problems[0]).toMatch(/does not exist/)
  })
})

describe('the portal build of the fixture', () => {
  it('loads the SDK first, strips site-only lines, prunes the dev tool and copies only listed assets', async () => {
    const { files, read } = await buildFixture({
      root: GAME,
      mode: PORTAL_MODE,
      base: './',
      publicDir: false,
      plugins: [
        portalSdk(),
        portalPrune({ log: false }),
        portalSiteOnly(),
        portalAssets({ paths: ['assets/hero.txt'] }),
        portalCheck({ log: false }),
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
    const { files } = await buildFixture({ root: GAME, mode: PORTAL_MODE, publicDir: false })
    expect(files.some((f) => f.includes('dev-tool'))).toBe(true)
  })

  it('the site build keeps its site-only line and the dev tool', async () => {
    const { files, read } = await buildFixture({ root: GAME, publicDir: false })
    expect(read('index.html')).toContain('data-site-only')
    expect(files.some((f) => f.includes('dev-tool'))).toBe(true)
    expect(read('index.html')).not.toContain(CRAZYGAMES_SDK_URL)
  })

  it('fails on a listed asset that is missing, with the hint', async () => {
    await expect(
      buildFixture({
        root: GAME,
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
      root: GAME,
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

  it("fails a build over the portal's limits, counting what publicDir copied in", async () => {
    const plugins = () => [portalSiteOnly(), portalCheck({ log: false, limits: false })]
    const bare = await buildFixture({
      root: GAME,
      mode: PORTAL_MODE,
      base: './',
      publicDir: false,
      plugins: plugins(),
    })
    const n = bare.files.length
    // public/ adds two files to the same bundle.
    await expect(
      buildFixture({
        root: GAME,
        mode: PORTAL_MODE,
        base: './',
        plugins: [
          portalSiteOnly(),
          portalCheck({ log: false, limits: { files: n + 1, bytes: 1e7 } }),
        ],
      }),
    ).rejects.toThrow(`breaks the portal's rules:\n  ${n + 2} files (limit ${n + 1})`)
  })

  it('fails a build that forgot base or the site-only strip', async () => {
    await expect(
      buildFixture({
        root: GAME,
        mode: PORTAL_MODE,
        publicDir: false,
        plugins: [portalCheck({ log: false })],
      }),
    ).rejects.toThrow(/root-absolute[\s\S]*data-site-only is still there/)
  })

  it('refuses the old limits option on portalAssets', () => {
    expect(() => portalAssets(/** @type {any} */ ({ limits: false }))).toThrow(/portalCheck/)
  })
})
