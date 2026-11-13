// @ts-check
/**
 * The portal build: what a game ships to a web game portal such as CrazyGames, which serves the
 * build from a path of its own inside an iframe and blocks every other host.
 *
 * - `portalSdk` loads the portal's SDK script first thing in `<head>`.
 * - `portalPrune` drops chunks nothing in the build loads any more.
 * - `portalSiteOnly` strips the elements marked as pointing at the game's own site.
 * - `portalAssets` copies a listed set of `public/` files into a build with `publicDir: false`.
 * - `portalNoSelect` turns text selection off on the page, as CrazyGames' rules ask.
 * - `portalCheck` reads the written folder and fails the build when it breaks the portal's
 *   upload rules: the file and size limits, `index.html` at the top, relative URLs, no source
 *   maps and no site-only files.
 *
 * Every plugin applies to `vite build` only. A game adds them when the mode is its portal mode:
 * `...(mode === PORTAL_MODE ? [portalSdk(), portalPrune(), portalSiteOnly(), portalCheck()] : [])`.
 */
import fs from 'node:fs'
import path from 'node:path'

/** The Vite mode the runtime's `build-target.ts` reads as the portal build. */
export const PORTAL_MODE = 'portal'

/** CrazyGames' HTML5 SDK v3 (https://docs.crazygames.com/sdk/intro/). */
export const CRAZYGAMES_SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js'

/**
 * CrazyGames' upload limits (https://docs.crazygames.com/requirements/technical/): 1,500 files,
 * and 50 MB downloaded before play. Without the SDK, or when the whole build downloads before
 * play, the whole build counts as that first download, so the whole build is held to it. MB here
 * is 1,000,000 bytes, the stricter reading.
 */
export const CRAZYGAMES_LIMITS = Object.freeze({ files: 1500, bytes: 50_000_000 })

/** The first download a game may have to be shown on CrazyGames' mobile homepage: 20 MB. */
export const CRAZYGAMES_MOBILE_BYTES = 20_000_000

/** Files a site build carries that mean nothing to a portal: Cloudflare's rules files. */
export const SITE_FILES = Object.freeze(['_headers', '_redirects', '_routes.json'])

/**
 * Inject the portal SDK's `<script>` at the top of `<head>`, before the game's own script, as
 * CrazyGames' docs ask.
 * @param {{ url?: string }} [options]
 * @returns {import('vite').Plugin}
 */
export function portalSdk({ url = CRAZYGAMES_SDK_URL } = {}) {
  return {
    name: 'umm:portal-sdk',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'script', attrs: { src: url }, injectTo: 'head-prepend' }],
  }
}

/**
 * The style `portalNoSelect` adds: no text selection on `body`, with the `-webkit-`, `-moz-` and
 * `-ms-` prefixes. CrazyGames' technical rules ask a game to stop a long press or a drag from
 * selecting the page, which on a phone pops up the copy menu over play.
 */
export const NO_SELECT_CSS =
  'body{-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none}'

/**
 * The `user-select: none` rule for `selector`, prefixed.
 * @param {string} [selector]
 */
export function noSelectCss(selector = 'body') {
  if (!selector.trim() || /[{}<]/.test(selector)) throw new Error(`bad selector: ${selector}`)
  return NO_SELECT_CSS.replace(/^body/, selector.trim())
}

/**
 * Add a `<style>` to `<head>` that turns text selection off on `body` (or `selector`), with every
 * prefix. A game whose own CSS turns it back on for a text field keeps that: the rule is a plain
 * type selector, so any class or id rule wins over it.
 * @param {{ selector?: string }} [options]
 * @returns {import('vite').Plugin}
 */
export function portalNoSelect({ selector = 'body' } = {}) {
  const css = noSelectCss(selector)
  return {
    name: 'umm:portal-no-select',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'style', children: css, injectTo: 'head' }],
  }
}

/**
 * @typedef {object} EmittedFile
 * @property {string} fileName
 * @property {string | null} text A chunk's code or a text asset's source; null for binaries.
 * @property {boolean} entry An entry chunk, always kept.
 * @property {boolean} isChunk
 */

/**
 * File names of the non-entry JS chunks no other emitted file mentions. Repeats until stable,
 * so a chain of orphans goes too.
 * @param {readonly EmittedFile[]} files
 * @returns {string[]}
 */
export function orphanChunks(files) {
  /** @type {Set<string>} */
  const gone = new Set()
  /** @param {string} name */
  const base = (name) => name.slice(name.lastIndexOf('/') + 1)
  for (;;) {
    const live = files.filter((f) => !gone.has(f.fileName))
    const next = live.filter(
      (f) =>
        f.isChunk && !f.entry && !live.some((o) => o !== f && o.text?.includes(base(f.fileName))),
    )
    if (next.length === 0) return [...gone]
    for (const f of next) gone.add(f.fileName)
  }
}

/**
 * Drop the chunks nothing loads. A build-target constant lets the bundler remove the `import()`
 * of a dev tool, but the tool may already be split into a chunk that is still written out. This
 * removes every non-entry JS chunk whose file name no other emitted file mentions.
 * @param {{ log?: boolean }} [options] `log: false` keeps the build quiet.
 * @returns {import('vite').Plugin}
 */
export function portalPrune({ log = true } = {}) {
  return {
    name: 'umm:portal-prune',
    apply: 'build',
    generateBundle(_options, bundle) {
      /** @type {EmittedFile[]} */
      const files = Object.values(bundle).map((o) =>
        o.type === 'chunk'
          ? { fileName: o.fileName, text: o.code, entry: o.isEntry, isChunk: true }
          : {
              fileName: o.fileName,
              text: typeof o.source === 'string' ? o.source : null,
              entry: false,
              isChunk: false,
            },
      )
      for (const name of orphanChunks(files)) {
        delete bundle[name]
        if (log) this.info(`dropped ${name}: nothing in the build loads it`)
      }
    },
  }
}

/**
 * `html` without the elements carrying `attribute`. One level deep: an element holding a nested
 * element of its own tag name is not matched correctly, so keep marked elements simple.
 * @param {string} html
 * @param {string} [attribute]
 * @returns {string}
 */
export function stripSiteOnly(html, attribute = 'data-site-only') {
  if (!/^[a-z][a-z0-9-]*$/i.test(attribute)) throw new Error(`bad attribute name: ${attribute}`)
  const re = new RegExp(
    `[ \\t]*<([a-z][a-z0-9]*)\\b[^>]*\\s${attribute}\\b[^>]*>[\\s\\S]*?<\\/\\1>[ \\t]*\\r?\\n?`,
    'gi',
  )
  return html.replace(re, '')
}

/**
 * Strip every element marked `data-site-only` (or `attribute`) from index.html. Portals such as
 * CrazyGames ban cross-promotion and links to a playable web version, so a line naming the
 * game's own site is marked and left out here.
 * @param {{ attribute?: string }} [options]
 * @returns {import('vite').Plugin}
 */
export function portalSiteOnly({ attribute = 'data-site-only' } = {}) {
  stripSiteOnly('', attribute)
  return {
    name: 'umm:portal-site-only',
    apply: 'build',
    transformIndexHtml: (html) => stripSiteOnly(html, attribute),
  }
}

/** @param {number} n */
const mb = (n) => `${(n / 1_000_000).toFixed(1)} MB`

/**
 * What breaks a limit, in words; empty when the build fits.
 * @param {readonly number[]} sizes Every file's size in bytes.
 * @param {{ files: number, bytes: number }} [limits]
 * @returns {string[]}
 */
export function overLimits(sizes, limits = CRAZYGAMES_LIMITS) {
  const bytes = sizes.reduce((a, b) => a + b, 0)
  /** @type {string[]} */
  const out = []
  if (sizes.length > limits.files) out.push(`${sizes.length} files (limit ${limits.files})`)
  if (bytes > limits.bytes) out.push(`${mb(bytes)} (limit ${mb(limits.bytes)})`)
  return out
}

/**
 * Every file under `dir`, relative to it with `/`, sorted. Leaves out dotfiles and dot folders,
 * `SITE_FILES` at the top, and any path starting with one of `exclude` (`'dev/'`, `'raw.psd'`).
 * For a portal build that carries most of `public/`.
 * @param {string} dir
 * @param {{ exclude?: readonly string[] }} [options]
 * @returns {string[]}
 */
export function publicFiles(dir, { exclude = [] } = {}) {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => path.relative(dir, path.join(d.parentPath, d.name)).replace(/\\/g, '/'))
    .filter((f) => !f.split('/').some((part) => part.startsWith('.')))
    .filter((f) => !SITE_FILES.includes(f))
    .filter((f) => !exclude.some((x) => f.startsWith(x)))
    .sort()
}

/**
 * @typedef {object} PortalAssetsOptions
 * @property {readonly string[] | ((root: string) => readonly string[] | Promise<readonly string[]>)} [paths]
 *   Files under `publicDir` the portal build needs, relative to it (`assets/hero.glb`). A
 *   function is called at build time with the project root, for a list read from the game.
 * @property {string} [publicDir] Relative to the root; default `public`.
 * @property {string} [missingHint] Added to the error naming a missing file.
 */

/**
 * Copy the listed `public/` files into a build that has `publicDir: false`. Which files a game
 * needs is the game's business; this takes the list.
 * @param {PortalAssetsOptions} [options]
 * @returns {import('vite').Plugin}
 */
export function portalAssets(options = {}) {
  if ('limits' in options) {
    throw new Error('portalAssets: limits moved to portalCheck() in 0.11.0')
  }
  const { publicDir = 'public', missingHint = '' } = options
  let root = process.cwd()
  return {
    name: 'umm:portal-assets',
    apply: 'build',
    configResolved(config) {
      root = config.root
    },
    async generateBundle() {
      const given = options.paths ?? []
      const list = [...(typeof given === 'function' ? await given(root) : given)].sort()
      for (const rel of new Set(list)) {
        const name = rel.replace(/\\/g, '/').replace(/^\/+/, '')
        const file = path.join(root, publicDir, name)
        if (name.split('/').includes('..') || !fs.existsSync(file)) {
          this.error(
            `${name} is missing from ${publicDir}/${missingHint ? `: ${missingHint}` : ''}`,
          )
        }
        this.emitFile({ type: 'asset', fileName: name, source: fs.readFileSync(file) })
      }
    },
  }
}

/**
 * @typedef {object} PortalReport
 * @property {number} files How many files the folder holds.
 * @property {number} bytes Their total size.
 * @property {boolean} mobile Whether the total fits `CRAZYGAMES_MOBILE_BYTES`.
 * @property {string[]} problems What breaks the portal's rules, one line each; empty when none.
 */

/**
 * Read a written portal build and say what breaks the portal's upload rules:
 * - more files or bytes than `limits` allows;
 * - no `index.html` at the top of the folder;
 * - a root-absolute `src` or `href` in `index.html` (`/assets/x.js`), which the portal's own path
 *   breaks: build with `base: './'`;
 * - a source map (`.map`), a dotfile or a site file (`_headers`);
 * - an element still marked `data-site-only` (or `attribute`) in `index.html`.
 * @param {string} dir
 * @param {{ limits?: { files: number, bytes: number } | false, attribute?: string }} [options]
 * @returns {PortalReport}
 */
export function checkPortalBuild(
  dir,
  { limits = CRAZYGAMES_LIMITS, attribute = 'data-site-only' } = {},
) {
  /** @type {string[]} */
  const problems = []
  if (!fs.existsSync(dir)) {
    return { files: 0, bytes: 0, mobile: true, problems: [`${dir} does not exist`] }
  }
  const all = fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => {
      const full = path.join(d.parentPath, d.name)
      return { rel: path.relative(dir, full).replace(/\\/g, '/'), size: fs.statSync(full).size }
    })
    .sort((a, b) => (a.rel < b.rel ? -1 : 1))
  const sizes = all.map((f) => f.size)
  const bytes = sizes.reduce((a, b) => a + b, 0)
  if (limits) problems.push(...overLimits(sizes, limits))
  for (const { rel } of all) {
    if (rel.endsWith('.map')) problems.push(`${rel}: a source map (set build.sourcemap: false)`)
    else if (rel.split('/').some((p) => p.startsWith('.'))) problems.push(`${rel}: a dotfile`)
    else if (SITE_FILES.includes(rel)) problems.push(`${rel}: a site file the portal ignores`)
  }
  const index = path.join(dir, 'index.html')
  if (!fs.existsSync(index)) {
    problems.push('no index.html at the top of the folder')
  } else {
    const html = fs.readFileSync(index, 'utf8')
    for (const m of html.matchAll(/\s(?:src|href)\s*=\s*["']?(\/(?!\/)[^"'\s>]*)/gi)) {
      problems.push(`index.html: ${m[1]} is root-absolute (set base: './')`)
    }
    if (new RegExp(`\\s${attribute}\\b`, 'i').test(html)) {
      problems.push(`index.html: an element marked ${attribute} is still there`)
    }
  }
  return { files: all.length, bytes, mobile: bytes <= CRAZYGAMES_MOBILE_BYTES, problems }
}

/**
 * Fail the build when the written folder breaks the portal's upload rules (`checkPortalBuild`),
 * and print one line on its size either way. It reads the folder on disk after Vite writes it,
 * so files copied from an enabled `publicDir` count too.
 * @param {{ limits?: { files: number, bytes: number } | false, attribute?: string, log?: boolean }} [options]
 * @returns {import('vite').Plugin}
 */
export function portalCheck(options = {}) {
  const { log = true, ...check } = options
  let outDir = 'dist'
  return {
    name: 'umm:portal-check',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    writeBundle(output) {
      const dir = output.dir ?? outDir
      const report = checkPortalBuild(dir, check)
      const limit = check.limits === undefined ? CRAZYGAMES_LIMITS : check.limits
      if (log) {
        const of = limit ? ` of ${limit.files}` : ''
        const ofBytes = limit ? ` of ${mb(limit.bytes)}` : ''
        this.info(
          `${report.files}${of} files, ${mb(report.bytes)}${ofBytes}; ` +
            `${report.mobile ? 'fits' : 'over'} the ${mb(CRAZYGAMES_MOBILE_BYTES)} mobile homepage size`,
        )
      }
      if (report.problems.length > 0) {
        this.error(`the portal build breaks the portal's rules:\n  ${report.problems.join('\n  ')}`)
      }
    },
  }
}
