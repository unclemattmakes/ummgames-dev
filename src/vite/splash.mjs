// @ts-check
/**
 * The Uncle Matt Makes loading splash's page side. `runtime/boot/dev-splash.ts` (copied into
 * the game) drives markup already in the page; this plugin writes that markup into the game's
 * index.html, so it is in the served HTML and up from the first paint:
 * - the `#dev-splash` block, with one sizer per word, built from the game's name;
 * - a `<link rel="stylesheet">` to the game's copy of `dev-splash.css`;
 * - the brand portrait, served in dev and emitted in the build, named on the `<img>` as
 *   `data-src`, which the runtime reads.
 *
 * A page that already has a `#dev-splash` is left as it is, so hand-written markup keeps
 * working. A portrait the game keeps at the same path in `public/` wins over the kit's.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** The kit's words, the last one the label's. Kept equal to `runtime/boot/dev-splash.ts`'s. */
export const SPLASH_WORDS = Object.freeze([
  'stuff',
  'simulations',
  'automata',
  'critter cams',
  '3d prints',
  'doughnuts',
  'mistakes',
  'Games',
])

/** Where the portrait is served, under the site's base. */
export const SPLASH_PORTRAIT = 'brand/uncle-matt-circle.webp'

/** The kit's portrait on disk. */
export const SPLASH_PORTRAIT_FILE = fileURLToPath(
  new URL('./brand/uncle-matt-circle.webp', import.meta.url),
)

/** Where `umm-dev copy boot` puts the stylesheet, as the page links it. */
export const SPLASH_CSS = '/src/boot/dev-splash.css'

/** @type {Record<string, string>} */
const IMAGE_TYPES = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
}

/**
 * The kit's words with the game's name typed just before the last one.
 * @param {string} game
 * @param {readonly string[]} [words]
 * @returns {string[]}
 */
export const splashWords = (game, words = SPLASH_WORDS) => [
  ...words.slice(0, -1),
  game,
  ...words.slice(-1),
]

/** @param {string} s */
const esc = (s) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      /** @type {Record<string, string>} */ ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c] ?? c,
  )

/**
 * @typedef {object} SplashMarkupOptions
 * @property {readonly string[]} [words] The blank's words, one sizer each. Default `SPLASH_WORDS`.
 * @property {string | null} [portraitSrc] The `<img>`'s `data-src`; null leaves the `<img>` out.
 * @property {string} [url] A line under the bar, each `.` in amber. None by default.
 * @property {string} [note] The game's own HTML under the lockup: what it is about, its controls.
 *   Written as given, so it must come from the game's config, never from a player.
 * @property {string} [loading] A word over the bar, such as `Loading`, so the bar does not read as
 *   another underline. None by default.
 */

/**
 * The `#dev-splash` block, as `runtime/boot/dev-splash.ts` reads it.
 * @param {SplashMarkupOptions} [options]
 * @returns {string}
 */
export function splashMarkup(options = {}) {
  const words = options.words ?? SPLASH_WORDS
  checkWords(words)
  const last = esc(/** @type {string} */ (words.at(-1)))
  const img = options.portraitSrc
    ? `\n    <img class="dev-splash__portrait" alt="" width="384" height="384" decoding="async" data-src="${esc(options.portraitSrc)}" />`
    : ''
  const sizers = words
    .map((w) => `\n        <span class="dev-splash__sizer">${esc(w)}</span>`)
    .join('')
  const url = options.url
    ? `\n  <p class="dev-splash__url">${options.url.split('.').map(esc).join('<span>.</span>')}</p>`
    : ''
  const note = options.note ? `\n  <div class="dev-splash__note">${options.note}</div>` : ''
  const loading = options.loading
    ? `\n  <p class="dev-splash__loading" aria-hidden="true">${esc(options.loading)}</p>`
    : ''
  return `<div id="dev-splash" role="status" aria-label="Uncle Matt Makes: ${last}. Loading.">
  <div class="dev-splash__lockup">${img}
    <h1 class="dev-splash__mark">
      Uncle Matt Makes:
      <span class="dev-splash__blank" aria-hidden="true">${sizers}
        <span class="dev-splash__line"><span class="dev-splash__typed"></span><span class="dev-splash__caret"></span></span>
      </span>
      <span class="visually-hidden">${last}</span>
    </h1>
  </div>${note}${loading}
  <div class="dev-splash__bar" aria-hidden="true"><div class="dev-splash__fill"></div></div>${url}
</div>`
}

/** @param {readonly string[]} words */
function checkWords(words) {
  if (words.length === 0) throw new Error('dev-splash: words is empty')
  for (const w of words)
    if (typeof w !== 'string' || w.trim() === '' || /[\r\n]/.test(w))
      throw new Error(`dev-splash: a word must be one line of text, got ${JSON.stringify(w)}`)
}

/**
 * @typedef {object} InjectSplashOptions
 * @property {readonly string[]} [words]
 * @property {string | null} [portraitSrc]
 * @property {string} [url]
 * @property {string} [note]
 * @property {string} [loading]
 * @property {string | false} [css] The stylesheet's href; false links none. Default `SPLASH_CSS`.
 */

/**
 * `html` with comments and the contents of `<script>` and `<style>` blanked to spaces, so a tag
 * named there is not taken for the real one. Offsets match `html`.
 * @param {string} html
 * @returns {string}
 */
const blankInert = (html) =>
  html.replace(
    /<!--[\s\S]*?-->|(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi,
    (all, open, _tag, body, close) =>
      open ? open + ' '.repeat(body.length) + close : ' '.repeat(all.length),
  )

/**
 * `html` with `insert` placed where `pattern` first matches outside comments, scripts and
 * styles: before the match, or after it with `after`. null when it does not match.
 * @param {string} html
 * @param {RegExp} pattern
 * @param {string} insert
 * @param {boolean} after
 * @returns {string | null}
 */
function insertAt(html, pattern, insert, after) {
  const m = pattern.exec(blankInert(html))
  if (!m) return null
  const at = after ? m.index + m[0].length : m.index
  return html.slice(0, at) + insert + html.slice(at)
}

/**
 * `html` with the stylesheet link at the end of `<head>` and the markup first in `<body>`. A
 * page that already has a `#dev-splash`, or already links the stylesheet, keeps its own. A
 * `<body>`, `</head>` or `#dev-splash` named inside a comment, script or style does not count.
 * @param {string} html
 * @param {InjectSplashOptions} [options]
 * @returns {string}
 */
export function injectSplash(html, options = {}) {
  const css = options.css === undefined ? SPLASH_CSS : options.css
  let out = html
  if (css && !blankInert(out).includes(css)) {
    const link = `  <link rel="stylesheet" href="${esc(css)}" />\n  `
    const linked = insertAt(out, /<\/head\s*>/i, link, false)
    if (linked === null) throw new Error('dev-splash: the page has no </head>')
    out = linked
  }
  if (!/\bid\s*=\s*["']?dev-splash["'\s>]/i.test(blankInert(out))) {
    const marked = insertAt(out, /<body(?=[\s>/])[^>]*>/i, `\n${splashMarkup(options)}`, true)
    if (marked === null) throw new Error('dev-splash: the page has no <body>')
    out = marked
  }
  return out
}

/**
 * @typedef {object} DevSplashOptions
 * @property {string} [game] The game's name, typed just before the last word.
 * @property {readonly string[]} [words] The whole word list instead. Not with `game`.
 * @property {boolean | string} [portrait] true: the kit's portrait (the default). A path,
 *   relative to Vite's root or absolute: the game's own image. false: no portrait.
 * @property {string} [portraitPath] Where the portrait is served, under the base. Default
 *   `brand/<its file name>`: `brand/uncle-matt-circle.webp` for the kit's.
 * @property {string | false} [css] The href of the game's copy of `dev-splash.css`, as
 *   index.html links it. Default `/src/boot/dev-splash.css`. false links none.
 * @property {string} [url] A line under the bar, such as the label's site. None by default.
 * @property {string} [note] The game's own HTML under the lockup, written as given. None by default.
 * @property {string} [loading] A word over the bar, such as `Loading`. None by default.
 * @property {string} [page] The HTML page that gets the splash, relative to Vite's root.
 *   Default `index.html`.
 */

/**
 * Write the splash's markup and stylesheet link into the page; serve the portrait in dev and
 * emit it in a build.
 * @param {DevSplashOptions} [options]
 * @returns {import('vite').Plugin}
 */
export function devSplash(options = {}) {
  if (options.game !== undefined && options.words !== undefined)
    throw new Error('dev-splash: pass game or words, not both')
  if (options.game !== undefined && options.game.trim() === '')
    throw new Error('dev-splash: game is empty')
  const words = options.words ?? (options.game ? splashWords(options.game) : SPLASH_WORDS)
  checkWords(words)
  const portrait = options.portrait ?? true
  const page = (options.page ?? 'index.html').replace(/\\/g, '/').replace(/^\//, '')
  let root = process.cwd()
  let base = '/'
  let publicDir = ''
  const file = () =>
    portrait === true ? SPLASH_PORTRAIT_FILE : path.resolve(root, /** @type {string} */ (portrait))
  const servedAt = () =>
    (options.portraitPath ?? `brand/${path.basename(file())}`)
      .replace(/\\/g, '/')
      .replace(/^\//, '')
  /** The game keeps its own file at that path in `public/`: Vite serves and copies that one. */
  const gameHasOwn = () => !!publicDir && fs.existsSync(path.join(publicDir, servedAt()))
  const href = () => (base === './' || base === '' ? servedAt() : `${base}${servedAt()}`)
  return {
    name: 'umm:dev-splash',
    configResolved(config) {
      root = config.root
      base = config.base
      publicDir = config.publicDir
      if (portrait !== false && !fs.existsSync(file()))
        throw new Error(`dev-splash: no portrait at ${file()}`)
    },
    configureServer(server) {
      if (portrait === false) return
      server.middlewares.use((req, res, next) => {
        const at = (req.url ?? '').split('?')[0] ?? ''
        const name = servedAt()
        if ((at !== `${base}${name}` && at !== `/${name}`) || gameHasOwn()) return next()
        try {
          const bytes = fs.readFileSync(file())
          res.setHeader(
            'Content-Type',
            IMAGE_TYPES[path.extname(name).toLowerCase()] ?? 'application/octet-stream',
          )
          res.end(bytes)
        } catch (e) {
          next(e)
        }
      })
    },
    generateBundle() {
      if (portrait === false || gameHasOwn()) return
      this.emitFile({ type: 'asset', fileName: servedAt(), source: fs.readFileSync(file()) })
    },
    transformIndexHtml: {
      // Before Vite reads the page, so the injected stylesheet link is bundled like the game's own.
      order: 'pre',
      handler(html, ctx) {
        const rel = path.relative(root, ctx.filename).replace(/\\/g, '/')
        if (rel !== page) return html
        return injectSplash(html, {
          words,
          portraitSrc: portrait === false ? null : href(),
          css: options.css === undefined ? SPLASH_CSS : options.css,
          ...(options.url ? { url: options.url } : {}),
          ...(options.note ? { note: options.note } : {}),
          ...(options.loading ? { loading: options.loading } : {}),
        })
      },
    },
  }
}
