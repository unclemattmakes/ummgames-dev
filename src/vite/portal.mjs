// @ts-check
/**
 * The portal build: what a game ships to a web game portal such as CrazyGames, which serves the
 * build from a path of its own inside an iframe and blocks every other host.
 *
 * - `portalSdk` loads the portal's SDK script first thing in `<head>`.
 * - `portalPrune` drops chunks nothing in the build loads any more.
 * - `portalSiteOnly` strips the elements marked as pointing at the game's own site.
 * - `portalAssets` copies a listed set of `public/` files in and holds the build to the portal's
 *   upload limits.
 *
 * Every plugin applies to `vite build` only. A game adds them when the mode is its portal mode:
 * `...(mode === PORTAL_MODE ? [portalSdk(), portalPrune(), portalSiteOnly()] : [])`.
 */
import fs from 'node:fs'
import path from 'node:path'

/** The Vite mode the runtime's `build-target.ts` reads as the portal build. */
export const PORTAL_MODE = 'portal'

/** CrazyGames' HTML5 SDK v3 (https://docs.crazygames.com/sdk/intro/). */
export const CRAZYGAMES_SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js'

/** The origins CrazyGames frames a game from, as CSP `frame-ancestors` sources. */
export const CRAZYGAMES_ORIGINS = Object.freeze([
  'https://crazygames.com',
  'https://*.crazygames.com',
])

/**
 * CrazyGames' upload limits (https://docs.crazygames.com/requirements/technical/): 1,500 files
 * and 50 MB downloaded before play. A build whose first download is the whole build is held to
 * the first-download limit.
 */
export const CRAZYGAMES_LIMITS = Object.freeze({ files: 1500, bytes: 50 * 1024 * 1024 })

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
  return {
    name: 'umm:portal-site-only',
    apply: 'build',
    transformIndexHtml: (html) => stripSiteOnly(html, attribute),
  }
}

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

/** @param {number} n */
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`

/**
 * @typedef {object} PortalAssetsOptions
 * @property {readonly string[] | ((root: string) => readonly string[] | Promise<readonly string[]>)} [paths]
 *   Files under `publicDir` the portal build needs, relative to it (`assets/hero.glb`). A
 *   function is called at build time with the project root, for a list read from the game.
 * @property {string} [publicDir] Relative to the root; default `public`.
 * @property {string} [missingHint] Added to the error naming a missing file.
 * @property {{ files: number, bytes: number } | false} [limits] Default CrazyGames' limits.
 */

/**
 * Copy the listed `public/` files into a build that has `publicDir: false`, and fail the build
 * when the output breaks the portal's upload limits. Which files a game needs is the game's
 * business; this takes the list.
 * @param {PortalAssetsOptions} [options]
 * @returns {import('vite').Plugin}
 */
export function portalAssets(options = {}) {
  const { publicDir = 'public', missingHint = '', limits = CRAZYGAMES_LIMITS } = options
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
    writeBundle(_options, bundle) {
      if (!limits) return
      const sizes = Object.values(bundle).map((o) =>
        o.type === 'chunk' ? Buffer.byteLength(o.code) : Buffer.byteLength(o.source),
      )
      const over = overLimits(sizes, limits)
      if (over.length > 0) this.error(`the portal build is over its limits: ${over.join(', ')}`)
    },
  }
}
