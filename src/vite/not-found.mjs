// @ts-check
/**
 * The site's `404.html`. Cloudflare Pages serves `index.html` with status 200 for any path it
 * has no file for, unless the build has a top-level `404.html`: then it serves that with 404.
 * Without it a typo'd link boots the whole game, and a crawler indexes every path as the game.
 *
 * Plain HTML, no script, light and dark. Emitted by the build rather than kept in `public/`, so
 * a build with `publicDir: false` has it too.
 */

export const NOT_FOUND_FILE = '404.html'

/**
 * @typedef {object} NotFoundOptions
 * @property {string} [title] The tab's title. Default `Not found`.
 * @property {string} [heading]
 * @property {string} [message]
 * @property {string} [homeHref] Default `/`.
 * @property {string} [homeLabel] Default `Back to the game`.
 * @property {string} [html] The whole page, used as given instead of the template.
 */

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
 * @param {NotFoundOptions} [options]
 * @returns {string}
 */
export function notFoundHtml(options = {}) {
  if (options.html !== undefined) return options.html
  const {
    title = 'Not found',
    heading = 'There is nothing at this address',
    message = 'The link may have a typo in it, or the page has moved.',
    homeHref = '/',
    homeLabel = 'Back to the game',
  } = options
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; --fg: #1d2330; --bg: #f6f4ef; --muted: #5a6273; }
  @media (prefers-color-scheme: dark) { :root { --fg: #e8e6e1; --bg: #12151c; --muted: #a3a9b6; } }
  body { margin: 0; background: var(--bg); color: var(--fg);
         font: 17px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 42rem; margin: 0 auto; padding: 2.5rem 1rem 4rem; }
  h1 { font-size: 1.6rem; line-height: 1.25; margin: 0 0 .5rem; }
  p { color: var(--muted); }
  a { color: inherit; font-weight: 600; }
</style>
</head>
<body>
<main>
<h1>${esc(heading)}</h1>
<p>${esc(message)}</p>
<p><a href="${esc(homeHref)}">${esc(homeLabel)}</a></p>
</main>
</body>
</html>
`
}

/**
 * Emit `404.html` at the top of the build output. Nothing in dev, where Vite answers its own way.
 * @param {NotFoundOptions} [options]
 * @returns {import('vite').Plugin}
 */
export function notFoundPage(options = {}) {
  return {
    name: 'umm:not-found',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: NOT_FOUND_FILE, source: notFoundHtml(options) })
    },
  }
}

export { esc as escapeHtml }
