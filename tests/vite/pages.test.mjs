// @ts-check
/** The 404 page, the licences module and page, the app icon and the share card. */
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  APPLE_TOUCH_ICON,
  appIcon,
  appleTouchIconPng,
  collectLicences,
  fallbackName,
  licences,
  licencesHtml,
  notFoundHtml,
  notFoundPage,
  parseIconSvg,
  pathPoints,
  rasterize,
  SHARE_CARD,
} from '../../src/vite/index.mjs'
import { buildFixture, cleanUp, FIXTURE, tempDir } from './build-fixture.mjs'

afterAll(cleanUp)

/** A PNG's width, height and colour type, from its IHDR. */
function pngHeader(/** @type {Buffer} */ b) {
  expect(b.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  expect(b.subarray(12, 16).toString('ascii')).toBe('IHDR')
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colourType: b[25] }
}

describe('the 404 page', () => {
  it('is emitted at the top of the build, escaped, with no script', async () => {
    const { read } = await buildFixture({
      publicDir: false,
      plugins: [notFoundPage({ title: 'Lost <in> space', homeLabel: 'Play "it"' })],
    })
    const html = read('404.html')
    expect(html).toContain('<title>Lost &lt;in&gt; space</title>')
    expect(html).toContain('<a href="/">Play &quot;it&quot;</a>')
    expect(html).toContain('<meta name="robots" content="noindex" />')
    expect(html).not.toContain('<script')
  })

  it('takes a whole page instead', () => {
    expect(notFoundHtml({ html: '<p>gone</p>' })).toBe('<p>gone</p>')
  })
})

/** A game root in a temp folder: two dependencies, one shipping no licence file. */
function licencedProject() {
  const root = tempDir()
  const write = (/** @type {string} */ rel, /** @type {string} */ text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), text)
  }
  write(
    'package.json',
    JSON.stringify({
      name: 'fixture',
      private: true,
      type: 'module',
      dependencies: { 'dep-a': '1.0.0', '@scope/dep-b': '2.0.0' },
      devDependencies: { 'dev-only': '1.0.0' },
    }),
  )
  write('node_modules/dep-a/package.json', JSON.stringify({ version: '1.2.3', license: 'MIT' }))
  write('node_modules/dep-a/LICENSE', 'MIT Licence text\r\nfor dep-a <ok>')
  write('node_modules/dep-a/NOTICE.md', 'A notice for dep-a')
  write(
    'node_modules/@scope/dep-b/package.json',
    JSON.stringify({ version: '2.0.1', license: 'Apache-2.0' }),
  )
  write('node_modules/dev-only/package.json', JSON.stringify({ version: '9.9.9' }))
  write('licences/scope-dep-b.LICENSE', 'Apache licence text for dep-b')
  write('index.html', '<!doctype html><script type="module" src="/main.js"></script>')
  write('main.js', "import { LICENCES } from 'virtual:licences'\nwindow.__licences = LICENCES\n")
  return root
}

describe('licences', () => {
  it('reads every dependency, its notices in order, and a fallback for one that ships none', () => {
    const root = licencedProject()
    const list = collectLicences(root)
    expect(list.map((l) => [l.name, l.version, l.licence])).toEqual([
      ['@scope/dep-b', '2.0.1', 'Apache-2.0'],
      ['dep-a', '1.2.3', 'MIT'],
    ])
    expect(list[1]?.text).toBe('MIT Licence text\nfor dep-a <ok>\n\nA notice for dep-a')
    expect(list[0]?.text).toBe('Apache licence text for dep-b')
    expect(fallbackName('@scope/dep-b')).toBe('scope-dep-b.LICENSE')
    expect(collectLicences(root, { exclude: ['dep-a'] }).map((l) => l.name)).toEqual([
      '@scope/dep-b',
    ])
  })

  it('fails on a dependency with no notice anywhere', () => {
    const root = licencedProject()
    fs.rmSync(path.join(root, 'licences'), { recursive: true })
    expect(() => collectLicences(root)).toThrow(
      /@scope\/dep-b ships no licence.*licences\/scope-dep-b\.LICENSE/,
    )
  })

  it('serves the virtual module and writes the page', async () => {
    const root = licencedProject()
    const { files, read } = await buildFixture({
      root,
      publicDir: false,
      plugins: [licences({ page: 'licences.html', pageTitle: 'Third-party licences' })],
    })
    const js = files
      .filter((f) => f.endsWith('.js'))
      .map(read)
      .join('\n')
    expect(js).toContain('Apache licence text for dep-b')
    expect(js).toMatch(/"version": ?"1.2.3"/)
    expect(js).not.toContain('dev-only')
    const page = read('licences.html')
    expect(page).toContain('<title>Third-party licences</title>')
    expect(page).toContain('<h2>dep-a 1.2.3</h2>')
    expect(page).toContain('for dep-a &lt;ok&gt;')
    expect(page).not.toContain('<script')
  })

  it('writes no page unless asked', async () => {
    const { files } = await buildFixture({
      root: licencedProject(),
      publicDir: false,
      plugins: [licences()],
    })
    expect(files).not.toContain('licences.html')
    expect(licencesHtml([], { intro: 'a & b' })).toContain('<p>a &amp; b</p>')
  })
})

describe('the app icon', () => {
  const svg = fs.readFileSync(path.join(FIXTURE, 'icon.svg'), 'utf8')

  it('reads straight-line paths, and refuses curves and groups', () => {
    expect(pathPoints('M0 0 h10 v10 H0 z')).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ])
    expect(() => pathPoints('M0 0 C1 1 2 2 3 3')).toThrow(/not a straight line/)
    expect(() => parseIconSvg(svg.replace('<path', '<g><path'))).toThrow(/is not read here/)
    expect(() => parseIconSvg(svg.replace('0 0 100 100', '0 0 100 50'))).toThrow(/square viewBox/)
  })

  it('draws the ground and the shapes over it', () => {
    const icon = parseIconSvg(svg)
    expect(icon.ground).toEqual([0x12, 0x34, 0x56])
    const px = rasterize(icon, 10)
    const at = (/** @type {number} */ x, /** @type {number} */ y) => [
      ...px.subarray((y * 10 + x) * 3, (y * 10 + x) * 3 + 3),
    ]
    expect(at(5, 1)).toEqual([255, 0, 0]) // inside the triangle
    expect(at(0, 5)).toEqual([0x12, 0x34, 0x56]) // the ground
    expect(at(5, 8)).toEqual([255, 255, 255]) // the bar
  })

  it('emits a 180 px PNG and links it; the share card when asked', async () => {
    const { files, out, read } = await buildFixture({
      publicDir: false,
      plugins: [appIcon({ svg: 'icon.svg', shareCard: true })],
    })
    expect(files).toEqual(expect.arrayContaining([APPLE_TOUCH_ICON, SHARE_CARD]))
    expect(pngHeader(fs.readFileSync(path.join(out, APPLE_TOUCH_ICON)))).toEqual({
      width: 180,
      height: 180,
      colourType: 2,
    })
    expect(pngHeader(fs.readFileSync(path.join(out, SHARE_CARD)))).toMatchObject({
      width: 1200,
      height: 630,
    })
    expect(read('index.html')).toContain(
      '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
    )
    expect(appleTouchIconPng(svg)).toEqual(fs.readFileSync(path.join(out, APPLE_TOUCH_ICON)))
  })

  it('links relative to a relative base, and only the icon by default', async () => {
    const { files, read } = await buildFixture({
      base: './',
      publicDir: false,
      plugins: [appIcon({ svg: path.join(FIXTURE, 'icon.svg'), size: 32 })],
    })
    expect(files).not.toContain(SHARE_CARD)
    expect(read('index.html')).toContain('href="apple-touch-icon.png"')
  })
})
