// @ts-check
/**
 * The making-of site's build, as a Vite plugin. The site is pages inside the game's own build:
 * `making-of/<slug>/index.html`, with toy code wherever the game keeps it. `createMakingOf` does
 * the things a plain Vite build does not:
 *
 *   1. adds each page as a build input. Setting the input replaces Vite's default, so the game's
 *      own entries are listed too;
 *   2. writes the shared nav, chapter header, prev and next, cards and footer from the game's
 *      chapter list, so the pages read without JS and there is one nav;
 *   3. runs the game's own `transforms`, then resolves `data-const` and `data-snippet`
 *      (source-truth.mjs).
 *
 * Without `chapters` it skips step 2 and lists every page on disk, for a site of hand-written
 * pages. It touches only pages under `/making-of/`. See docs/making-of.md.
 */
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { clearSourceCache, escapeHtml, resolveSources } from './source-truth.mjs'

/** @typedef {import('./index.d.ts').Chapter} Chapter */
/** @typedef {import('./index.d.ts').MakingOfOptions} MakingOfOptions */
/** @typedef {import('./index.d.ts').MakingOfSite} MakingOfSite */

/** A chapter with this many sections or more gets an "On this page" list under its header. */
export const TOC_MIN_SECTIONS = 4

/** @param {string} s */
const text = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** @param {string} slug */
const href = (slug) => (slug === 'index' ? '/making-of/' : `/making-of/${slug}/`)

/**
 * A page's file, from the game root.
 * @param {string} slug
 */
export const pageFile = (slug) =>
  slug === 'index' ? 'making-of/index.html' : `making-of/${slug}/index.html`

/**
 * Every `making-of/**` page on disk, as a slug: `index`, `flight`, `tools/lathe`.
 * @param {string} root
 * @returns {string[]}
 */
export const pagesOnDisk = (root) => {
  const dir = path.join(root, 'making-of')
  if (!existsSync(dir)) return []
  /** @type {string[]} */
  const slugs = []
  /** @param {string} at @param {string} prefix */
  const walk = (at, prefix) => {
    for (const e of readdirSync(at, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const slug = `${prefix}${e.name}`
      if (existsSync(path.join(at, e.name, 'index.html'))) slugs.push(slug)
      walk(path.join(at, e.name), `${slug}/`)
    }
  }
  if (existsSync(path.join(dir, 'index.html'))) slugs.push('index')
  walk(dir, '')
  return slugs
}

/**
 * A section heading's anchor: its words, lowercased and hyphenated.
 * @param {string} heading
 */
export const sectionId = (heading) =>
  heading
    .replace(/<[^>]*>/g, '')
    .replace(/&[a-z]+;|&#\d+;/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/**
 * Give every plain `<h2>` an id, so a section can be linked, and list them under the header when
 * there are enough to need it. Ids are unique within the page.
 * @param {string} html
 */
const sections = (html) => {
  const seen = new Set()
  /** @type {{ id: string, text: string }[]} */
  const found = []
  const out = html.replace(/<h2>([\s\S]*?)<\/h2>/g, (_m, /** @type {string} */ heading) => {
    let id = sectionId(heading) || 'section'
    for (let n = 2; seen.has(id); n++) id = `${sectionId(heading)}-${n}`
    seen.add(id)
    found.push({ id, text: heading })
    return `<h2 id="${id}">${heading}</h2>`
  })
  const toc =
    found.length < TOC_MIN_SECTIONS
      ? ''
      : `<nav class="page-toc" aria-label="On this page"><div class="toc-label">On this page</div><ol>` +
        found
          .map((s) => `<li class="toc-item"><a class="toc-link" href="#${s.id}">${s.text}</a></li>`)
          .join('') +
        `</ol></nav>`
  return { html: out, toc }
}

/**
 * One game's making-of site.
 * @param {MakingOfOptions} options
 * @returns {MakingOfSite}
 */
export function createMakingOf(options) {
  const {
    site,
    sitePages = ['index', 'playground'],
    unit = 'toy',
    transforms = [],
    source = {},
    entries = { main: 'index.html' },
    buildPages = true,
  } = options
  const chapters = options.chapters ?? []
  const isBuilt = options.isBuilt ?? ((c) => c.status === 'published')
  const handWritten = options.chapters === undefined

  /** The chapters with a page, in reading order. */
  const builtChapters = () => chapters.filter(isBuilt)

  const nav = () =>
    options.nav ??
    `<nav class="site-nav"><a class="brand" href="/making-of/">Making of <b>${text(site)}</b></a>` +
      `<span class="links"><a href="/making-of/">Chapters</a>` +
      `<a href="/making-of/playground/">Playground</a>` +
      `<a class="play" href="/">Play the game</a></span></nav>`

  const footer = () =>
    options.footer ??
    `<footer class="site-footer"><p><b>${text(site)}</b></p>` +
      `<p><a href="/">Play it</a> · <a href="/making-of/">Making of</a></p></footer>`

  /** @param {Chapter} c */
  const header = (c) =>
    `<header class="page-header"><div class="breadcrumb">${/^\d+$/.test(c.number) ? `Chapter ${text(c.number)}` : text(c.number)}</div>` +
    `<h1 class="page-title">${text(c.title)}</h1>` +
    `<p class="page-subtitle">${text(c.pitch)}</p>${options.headerNote?.(c) ?? ''}</header>`

  const cards = () =>
    `<div class="chapter-cards">${chapters
      .map((c) => {
        const tag = c.status === 'published' ? '' : c.status === 'planned' ? 'coming' : c.status
        const body =
          `<span class="card-num">${text(c.number)}</span>` +
          `<span class="card-title">${text(c.title)}</span>` +
          `<span class="card-pitch">${text(c.pitch)}</span>` +
          (c.toys.length
            ? `<span class="tag">${c.toys.length} ${unit}${c.toys.length === 1 ? '' : 's'}</span>`
            : '') +
          (tag ? `<span class="tag soon">${text(tag)}</span>` : '')
        return isBuilt(c)
          ? `<a class="chapter-card" href="${href(c.slug)}">${body}</a>`
          : `<div class="chapter-card planned">${body}</div>`
      })
      .join('')}</div>`

  /** @param {string} slug */
  const pagenav = (slug) => {
    const order = builtChapters()
    const i = order.findIndex((c) => c.slug === slug)
    if (i < 0) return ''
    const prev = order[i - 1]
    const next = order[i + 1]
    /** @param {Chapter} c @param {string} dir */
    const link = (c, dir) =>
      `<a href="${href(c.slug)}"><span class="nav-dir">${dir}</span><span class="nav-title">${text(c.title)}</span></a>`
    return `<div class="page-nav">${prev ? link(prev, '&larr; Previous') : ''}${next ? link(next, 'Next &rarr;') : ''}</div>`
  }

  /**
   * The pitch as the page's description, for link previews.
   * @param {Chapter} c
   */
  const meta = (c) =>
    `<meta name="description" content="${escapeHtml(c.pitch)}" />` +
    `<meta property="og:type" content="article" />` +
    `<meta property="og:site_name" content="Making of ${escapeHtml(site)}" />` +
    `<meta property="og:title" content="${escapeHtml(c.title)}" />` +
    `<meta property="og:description" content="${escapeHtml(c.pitch)}" />`

  /** @type {MakingOfSite['transformPage']} */
  const transformPage = (root, slug, html) => {
    const chapter = builtChapters().find((c) => c.slug === slug) ?? null
    let out = html
    if (!handWritten) {
      const { html: withIds, toc } = chapter ? sections(html) : { html, toc: '' }
      out = withIds
        .replace('</title>', chapter ? `</title>${meta(chapter)}` : '</title>')
        .replace('<!--mo:nav-->', nav())
        .replace('<!--mo:header-->', chapter ? header(chapter) + toc : '')
        .replace('<!--mo:cards-->', cards())
        .replace('<!--mo:pagenav-->', pagenav(slug))
        .replace('<!--mo:footer-->', footer())
    }
    const own = transforms.reduce((h, t) => t(h, { root, slug, chapter }), out)
    return resolveSources(root, own, `making-of/${slug}`, source)
  }

  /**
   * The pages a build emits: every page on disk for hand-written pages, else the listed ones.
   * @param {string} root
   */
  const builtPages = (root) => {
    const built = new Set([...sitePages, ...builtChapters().map((c) => c.slug)])
    return pagesOnDisk(root).filter((slug) => handWritten || built.has(slug))
  }

  /** @type {MakingOfSite['plugin']} */
  const plugin = () => {
    let root = process.cwd()
    return {
      name: 'umm-making-of',
      config(userConfig, env) {
        root = path.resolve(userConfig.root ?? process.cwd())
        const wanted = typeof buildPages === 'function' ? buildPages(env) : buildPages
        if (env.command !== 'build' || !wanted) return undefined
        /** @type {Record<string, string>} */
        const input = {}
        for (const [name, file] of Object.entries(entries)) input[name] = path.join(root, file)
        for (const slug of builtPages(root)) {
          input[`making-of-${slug.replaceAll('/', '-')}`] = path.join(root, pageFile(slug))
        }
        return { build: { rollupOptions: { input } } }
      },
      // A source edit can change a quoted value: the next page load reads it again.
      handleHotUpdate() {
        clearSourceCache()
      },
      transformIndexHtml: {
        order: 'pre',
        handler(html, ctx) {
          const m = /^\/making-of\/(?:(.+)\/)?index\.html$/.exec(ctx.path)
          if (!m) return html
          return transformPage(root, m[1] ?? 'index', html)
        },
      },
    }
  }

  return { plugin, transformPage, builtChapters, builtPages }
}
