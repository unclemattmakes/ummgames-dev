// @ts-check
/** The site plugin: chapters to pages, nav and footer as options, and a real multi-page build. */
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  createMakingOf,
  pageFile,
  pagesOnDisk,
  sectionId,
  TOC_MIN_SECTIONS,
} from '../../src/making-of/index.mjs'
import { buildFixture, cleanUp, tempDir } from '../vite/build-fixture.mjs'

afterAll(cleanUp)

const CHAPTERS = [
  {
    slug: 'why',
    number: 'Prologue',
    title: 'Why',
    pitch: 'A <reason>.',
    status: 'published',
    toys: [],
  },
  {
    slug: 'flight',
    number: '01',
    title: 'Flight',
    pitch: 'It flies.',
    status: 'published',
    toys: ['a', 'b'],
  },
  { slug: 'next', number: '02', title: 'Next', pitch: 'Soon.', status: 'planned', toys: ['c'] },
  { slug: 'rough', number: '03', title: 'Rough', pitch: 'Rough.', status: 'draft', toys: [] },
]

/** A game folder with these pages. @param {Record<string, string>} pages */
function game(pages) {
  const root = tempDir()
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>Game</title>')
  fs.mkdirSync(path.join(root, 'src'))
  fs.writeFileSync(path.join(root, 'src/tuning.ts'), 'export const SPEED = 40\n')
  for (const [file, html] of Object.entries(pages)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), html)
  }
  return root
}

const PAGE = `<!doctype html><html><head><title>Flight</title></head><body>
<!--mo:nav--><!--mo:header--><article><h2>One</h2><p><span data-const="src/tuning.ts#SPEED"></span></p></article>
<!--mo:pagenav--><!--mo:footer--></body></html>`

describe('pages on disk', () => {
  it('lists the index and each folder with a page, nested ones too', () => {
    const root = game({
      'making-of/index.html': '',
      'making-of/flight/index.html': '',
      'making-of/tools/lathe/index.html': '',
      'making-of/assets/note.txt': '',
    })
    expect(pagesOnDisk(root).sort()).toEqual(['flight', 'index', 'tools/lathe'])
    expect(pagesOnDisk(tempDir())).toEqual([])
    expect(pageFile('index')).toBe('making-of/index.html')
    expect(pageFile('flight')).toBe('making-of/flight/index.html')
  })
})

describe('transformPage', () => {
  const root = game({})
  const site = createMakingOf({ site: 'My Game', chapters: CHAPTERS })

  it('fills the nav, header, footer, prev and next, and the meta tags', () => {
    const out = site.transformPage(root, 'flight', PAGE)
    expect(out).toContain('Making of <b>My Game</b>')
    expect(out).toContain('<div class="breadcrumb">Chapter 01</div>')
    expect(out).toContain('<h1 class="page-title">Flight</h1>')
    expect(out).toContain('<meta property="og:site_name" content="Making of My Game" />')
    expect(out).toContain('&larr; Previous')
    expect(out).toContain('<span class="nav-title">Why</span>')
    expect(out).not.toContain('Next &rarr;')
    expect(out).toContain('<footer class="site-footer">')
    expect(out).not.toContain('<!--mo:')
  })

  it('prints a named chapter number as it is, and escapes a pitch', () => {
    const out = site.transformPage(root, 'why', PAGE)
    expect(out).toContain('<div class="breadcrumb">Prologue</div>')
    expect(out).toContain('<p class="page-subtitle">A &lt;reason&gt;.</p>')
    expect(out).toContain('content="A &lt;reason&gt;."')
  })

  it('resolves the sources after the slots, naming the page on a failure', () => {
    expect(site.transformPage(root, 'flight', PAGE)).toContain('>40</span>')
    expect(() =>
      site.transformPage(root, 'flight', '<span data-const="src/gone.ts#X"></span>'),
    ).toThrow(/making-of\/flight/)
  })

  it('writes cards: a planned chapter has no link, and another status shows as a tag', () => {
    const out = site.transformPage(root, 'index', '<!--mo:cards-->')
    expect(out).toContain('<a class="chapter-card" href="/making-of/flight/">')
    expect(out).toContain('<span class="tag">2 toys</span>')
    expect(out).toContain('<div class="chapter-card planned">')
    expect(out).toContain('<span class="tag">1 toy</span>')
    expect(out).toContain('<span class="tag soon">coming</span>')
    expect(out).toContain('<span class="tag soon">draft</span>')
    const demos = createMakingOf({ site: 'G', chapters: CHAPTERS, unit: 'demo' })
    expect(demos.transformPage(root, 'index', '<!--mo:cards-->')).toContain('2 demos')
  })

  it('gives every h2 an id, and lists them once there are enough', () => {
    const few = '<!--mo:header--><h2>One</h2>'
    expect(site.transformPage(root, 'flight', few)).toContain('<h2 id="one">One</h2>')
    expect(site.transformPage(root, 'flight', few)).not.toContain('page-toc')
    const many = `<!--mo:header-->${'<h2>Same <em>one</em></h2>'.repeat(TOC_MIN_SECTIONS)}`
    const out = site.transformPage(root, 'flight', many)
    expect(out).toContain('page-toc')
    expect(out).toContain('id="same-one-2"')
    expect(sectionId('Why &amp; how <b>now</b>?')).toBe('why-how-now')
  })

  it('leaves a site page without a chapter alone but for the slots', () => {
    const out = site.transformPage(root, 'playground', '<title>P</title><!--mo:header--><h2>A</h2>')
    expect(out).toBe('<title>P</title><h2>A</h2>')
  })
})

describe('options', () => {
  const root = game({})

  it('takes a whole nav, footer and header note', () => {
    const site = createMakingOf({
      site: 'G',
      chapters: CHAPTERS,
      nav: '<nav id="own"></nav>',
      footer: '<footer id="own"></footer>',
      headerNote: (c) => `<p class="flag">${c.slug}</p>`,
    })
    const out = site.transformPage(root, 'flight', PAGE)
    expect(out).toContain('<nav id="own"></nav>')
    expect(out).toContain('<footer id="own"></footer>')
    expect(out).toContain('<p class="flag">flight</p></header>')
    expect(out).not.toContain('Making of <b>')
  })

  it('isBuilt decides what has a page: a draft on a preview build', () => {
    const site = createMakingOf({
      site: 'G',
      chapters: CHAPTERS,
      isBuilt: (c) => c.status !== 'planned',
    })
    expect(site.builtChapters().map((c) => c.slug)).toEqual(['why', 'flight', 'rough'])
    expect(site.transformPage(root, 'index', '<!--mo:cards-->')).toContain(
      'href="/making-of/rough/"',
    )
  })

  it('runs the game own passes after the slots and before the sources', () => {
    /** @type {string[]} */
    const seen = []
    const site = createMakingOf({
      site: 'G',
      chapters: CHAPTERS,
      transforms: [
        (html, page) => {
          seen.push(`${page.slug}:${page.chapter?.title}:${html.includes('site-nav')}`)
          return html.replace('<i data-n></i>', '<span data-const="src/tuning.ts#SPEED"></span>')
        },
      ],
    })
    const out = site.transformPage(root, 'flight', '<!--mo:nav--><i data-n></i>')
    expect(seen).toEqual(['flight:Flight:true'])
    expect(out).toContain('>40</span>')
  })

  it('without chapters, runs only the passes, on hand-written pages', () => {
    const site = createMakingOf({ site: 'G' })
    const html =
      '<title>T</title><!--mo:nav--><h2>A</h2><span data-const="src/tuning.ts#SPEED"></span>'
    const out = site.transformPage(root, 'deep/page', html)
    expect(out).toContain('<!--mo:nav-->')
    expect(out).toContain('<h2>A</h2>')
    expect(out).toContain('>40</span>')
  })
})

describe('the plugin in a build', () => {
  const pages = {
    'making-of/index.html': '<!doctype html><title>Home</title><!--mo:nav--><!--mo:cards-->',
    'making-of/playground/index.html': '<!doctype html><title>Toys</title><!--mo:nav-->',
    'making-of/flight/index.html': PAGE,
    'making-of/rough/index.html': PAGE,
  }

  it('emits the game, the site pages and built chapters, and no other page', async () => {
    const root = game(pages)
    const site = createMakingOf({ site: 'My Game', chapters: CHAPTERS })
    const { read, files } = await buildFixture({ root, plugins: [site.plugin()] })
    /** @param {string} f */
    const has = (f) => files.includes(f)
    expect(has('index.html')).toBe(true)
    expect(has('making-of/index.html')).toBe(true)
    expect(has('making-of/playground/index.html')).toBe(true)
    expect(read('making-of/flight/index.html')).toContain('Making of <b>My Game</b>')
    expect(read('making-of/flight/index.html')).toContain('>40</span>')
    expect(has('making-of/rough/index.html')).toBe(false)
  })

  it('fails the build on a stale reference, naming the page', async () => {
    const root = game({ 'making-of/flight/index.html': '<span data-const="src/gone.ts#X"></span>' })
    const site = createMakingOf({ site: 'G', chapters: CHAPTERS })
    await expect(buildFixture({ root, plugins: [site.plugin()] })).rejects.toThrow(
      /making-of\/flight/,
    )
  })

  it('leaves the build input alone when buildPages says no', async () => {
    const root = game(pages)
    const site = createMakingOf({
      site: 'G',
      chapters: CHAPTERS,
      buildPages: (env) => env.mode === 'site',
    })
    const plain = await buildFixture({ root, plugins: [site.plugin()] })
    expect(plain.files).not.toContain('making-of/index.html')
    const full = await buildFixture({ root, mode: 'site', plugins: [site.plugin()] })
    expect(full.files).toContain('making-of/index.html')
  })

  it('keeps the game page out of the pass', async () => {
    const root = game({})
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>G</title><!--mo:nav-->')
    const site = createMakingOf({ site: 'G', chapters: CHAPTERS })
    const { read } = await buildFixture({ root, plugins: [site.plugin()] })
    expect(read('index.html')).toContain('<!--mo:nav-->')
  })
})
