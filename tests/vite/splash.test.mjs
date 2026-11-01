// @ts-check
/** The splash plugin: its markup, the page it writes, the portrait in dev and in the build. */
import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'vite'
import { afterAll, describe, expect, it } from 'vitest'
import {
  devSplash,
  injectSplash,
  SPLASH_CSS,
  SPLASH_PORTRAIT,
  SPLASH_PORTRAIT_FILE,
  SPLASH_WORDS,
  splashMarkup,
  splashWords,
} from '../../src/vite/index.mjs'
import { buildFixture, cleanUp, REPO, tempDir } from './build-fixture.mjs'

afterAll(cleanUp)

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>My game</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
`

/** A game root in a temp folder: a page, an entry, and its copy of the splash stylesheet. */
function splashProject(page = PAGE) {
  const root = tempDir()
  const write = (/** @type {string} */ rel, /** @type {string | Buffer} */ data) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), data)
  }
  write('index.html', page)
  write('src/main.js', 'document.title = "booted"\n')
  write('src/boot/dev-splash.css', fs.readFileSync(path.join(REPO, 'runtime/boot/dev-splash.css')))
  return { root, write }
}

const count = (/** @type {string} */ text, /** @type {string} */ part) =>
  text.split(part).length - 1

describe('splashWords', () => {
  it('types the game just before the last word', () => {
    expect(splashWords('My Game')).toEqual([...SPLASH_WORDS.slice(0, -1), 'My Game', 'Games'])
    expect(splashWords('Two', ['one', 'End'])).toEqual(['one', 'Two', 'End'])
  })
})

describe('splashMarkup', () => {
  it('has a sizer per word, escaped, and labels the last one', () => {
    const html = splashMarkup({ words: ['a <b>', 'Games'], portraitSrc: '/p.webp' })
    expect(count(html, 'class="dev-splash__sizer"')).toBe(2)
    expect(html).toContain('<span class="dev-splash__sizer">a &lt;b&gt;</span>')
    expect(html).toContain('aria-label="Uncle Matt Makes: Games. Loading."')
    expect(html).toContain('<span class="visually-hidden">Games</span>')
    expect(html).toContain('data-src="/p.webp"')
    expect(html).toContain('class="dev-splash__typed"')
    expect(html).toContain('class="dev-splash__fill"')
    expect(html).not.toContain('dev-splash__url')
  })

  it('leaves the portrait out without a src, and writes the url line with amber dots', () => {
    const html = splashMarkup({ url: 'example.com' })
    expect(count(html, 'class="dev-splash__sizer"')).toBe(SPLASH_WORDS.length)
    expect(html).not.toContain('<img')
    expect(html).toContain('<p class="dev-splash__url">example<span>.</span>com</p>')
  })

  it('refuses an empty list or a blank word', () => {
    expect(() => splashMarkup({ words: [] })).toThrow(/empty/)
    expect(() => splashMarkup({ words: [' ', 'Games'] })).toThrow(/one line/)
  })
})

describe('injectSplash', () => {
  it('links the stylesheet at the end of <head> and puts the markup first in <body>', () => {
    const html = injectSplash(PAGE, { words: ['x', 'Games'] })
    expect(html).toMatch(/<link rel="stylesheet" href="\/src\/boot\/dev-splash.css" \/>\s*<\/head>/)
    expect(html).toMatch(/<body>\s*<div id="dev-splash"/)
    expect(injectSplash(html)).toBe(html)
  })

  it('keeps a page’s own markup and link', () => {
    const own = PAGE.replace(
      '</head>',
      `<link rel="stylesheet" href="${SPLASH_CSS}" /></head>`,
    ).replace(
      '<div id="app">',
      '<div id="dev-splash"><span class="dev-splash__typed"></span></div><div id="app">',
    )
    expect(injectSplash(own)).toBe(own)
  })

  it('links nothing with css false', () => {
    expect(injectSplash(PAGE, { css: false })).not.toContain('<link')
  })
})

describe('devSplash in a build', () => {
  it('writes the markup, bundles the stylesheet and emits the kit’s portrait', async () => {
    const { root } = splashProject()
    const { files, out, read } = await buildFixture({
      root,
      plugins: [devSplash({ game: 'My Game', url: 'example.com' })],
    })
    const html = read('index.html')
    expect(count(html, 'class="dev-splash__sizer"')).toBe(SPLASH_WORDS.length + 1)
    expect(html).toContain('<span class="dev-splash__sizer">My Game</span>')
    expect(html).toContain(`data-src="/${SPLASH_PORTRAIT}"`)
    expect(html).toContain('dev-splash__url')
    expect(html).not.toContain(SPLASH_CSS)
    const css = files.filter((f) => f.endsWith('.css'))
    expect(css).toHaveLength(1)
    expect(read(/** @type {string} */ (css[0]))).toContain('#dev-splash')
    expect(html).toContain(css[0])
    expect(fs.readFileSync(path.join(out, SPLASH_PORTRAIT))).toEqual(
      fs.readFileSync(SPLASH_PORTRAIT_FILE),
    )
  })

  it('names the portrait relative to a relative base', async () => {
    const { root } = splashProject()
    const { read } = await buildFixture({ root, base: './', plugins: [devSplash()] })
    expect(read('index.html')).toContain(`data-src="${SPLASH_PORTRAIT}"`)
  })

  it('leaves the portrait to a game that keeps its own in public/', async () => {
    const { root, write } = splashProject()
    write(`public/${SPLASH_PORTRAIT}`, 'the game’s own')
    const { read } = await buildFixture({ root, plugins: [devSplash()] })
    expect(read(SPLASH_PORTRAIT)).toBe('the game’s own')
  })

  it('takes the game’s own portrait file, or none', async () => {
    const { root, write } = splashProject()
    write('art/face.png', 'png bytes')
    const own = await buildFixture({ root, plugins: [devSplash({ portrait: 'art/face.png' })] })
    expect(own.read('brand/face.png')).toBe('png bytes')
    expect(own.read('index.html')).toContain('data-src="/brand/face.png"')
    const none = await buildFixture({ root, plugins: [devSplash({ portrait: false })] })
    expect(none.files.some((f) => f.startsWith('brand/'))).toBe(false)
    expect(none.read('index.html')).not.toContain('<img')
  })

  it('keeps hand-written markup as it is', async () => {
    const page = PAGE.replace(
      '<div id="app"></div>',
      `<div id="dev-splash" role="status"><span class="dev-splash__sizer">Old</span><span class="dev-splash__typed"></span></div>`,
    ).replace('</head>', `<link rel="stylesheet" href="${SPLASH_CSS}" />\n</head>`)
    const { root } = splashProject(page)
    const { read } = await buildFixture({ root, plugins: [devSplash({ game: 'My Game' })] })
    const html = read('index.html')
    expect(count(html, 'id="dev-splash"')).toBe(1)
    expect(html).toContain('>Old</span>')
    expect(html).not.toContain('My Game')
  })

  it('touches only its page', async () => {
    const { root, write } = splashProject()
    write('other.html', PAGE)
    const out = tempDir()
    const { build } = await import('vite')
    await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [devSplash()],
      build: {
        outDir: out,
        emptyOutDir: true,
        rollupOptions: { input: [path.join(root, 'index.html'), path.join(root, 'other.html')] },
      },
    })
    expect(fs.readFileSync(path.join(out, 'index.html'), 'utf8')).toContain('id="dev-splash"')
    expect(fs.readFileSync(path.join(out, 'other.html'), 'utf8')).not.toContain('id="dev-splash"')
  })

  it('refuses game and words together, and a missing portrait file', () => {
    expect(() => devSplash({ game: 'A', words: ['b', 'Games'] })).toThrow(/not both/)
    const { root } = splashProject()
    return expect(
      buildFixture({ root, plugins: [devSplash({ portrait: 'nope.webp' })] }),
    ).rejects.toThrow(/no portrait/)
  })
})

describe('devSplash in dev', () => {
  it('serves the page with the markup, and the portrait', async () => {
    const { root } = splashProject()
    const server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      server: { port: 0, strictPort: false, host: '127.0.0.1' },
      plugins: [devSplash({ game: 'My Game' })],
    })
    await server.listen()
    try {
      const origin = String(server.resolvedUrls?.local[0] ?? '').replace(/\/$/, '')
      const html = await (await fetch(`${origin}/`)).text()
      expect(html).toContain('<span class="dev-splash__sizer">My Game</span>')
      expect(html).toContain(`href="${SPLASH_CSS}"`)
      const img = await fetch(`${origin}/${SPLASH_PORTRAIT}`)
      expect(img.headers.get('content-type')).toBe('image/webp')
      expect(Buffer.from(await img.arrayBuffer())).toEqual(fs.readFileSync(SPLASH_PORTRAIT_FILE))
    } finally {
      await server.close()
    }
  })
})
