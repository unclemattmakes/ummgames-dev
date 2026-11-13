// @ts-check
/**
 * The third-party notices a game must show, read at build time from `node_modules` so they
 * always match what ships.
 *
 * What ships is `package.json`'s `dependencies` (devDependencies never reach the bundle). For
 * each one the virtual module (`virtual:licences` by default) carries its version, its SPDX
 * licence and the text of every LICENSE, LICENCE, COPYING and NOTICE file in its folder. A
 * package whose tarball leaves its licence out takes it from the game's fallback folder
 * (`licences/<scope>-<name>.LICENSE`); a dependency with neither fails the build, so a new one
 * cannot ship without its notice. With `page`, the same list is also written as a static page;
 * with `text`, as a plain-text notices file.
 */
import fs from 'node:fs'
import path from 'node:path'
import { escapeHtml } from './not-found.mjs'

/**
 * @typedef {object} Licence
 * @property {string} name
 * @property {string} version
 * @property {string} licence The package's `license`, an SPDX id.
 * @property {string} text Every licence and notice file in full, one after another.
 */

export const LICENCES_MODULE = 'virtual:licences'

/** LICENSE, LICENCE, COPYING, NOTICE, with or without an extension. */
const NOTICE_FILE = /^(licen[cs]e|copying|notice)(\.(md|txt))?$/i

/**
 * The fallback folder's file name for a package: `@scope/name` is `scope-name.LICENSE`.
 * @param {string} pkg
 */
export const fallbackName = (pkg) => `${pkg.replace(/^@/, '').replace('/', '-')}.LICENSE`

/**
 * @typedef {object} CollectOptions
 * @property {string} [fallbackDir] Relative to the root. Default `licences`.
 * @property {readonly string[]} [include] More packages to list, beyond `dependencies`.
 * @property {readonly string[]} [exclude] Dependencies to leave out (a types-only package).
 */

/**
 * @param {string} root The game's root, holding package.json and node_modules.
 * @param {CollectOptions} [options]
 * @returns {Licence[]}
 */
export function collectLicences(root, options = {}) {
  const { fallbackDir = 'licences', include = [], exclude = [] } = options
  const manifest = /** @type {{ dependencies?: Record<string, string> }} */ (
    JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  )
  const names = new Set([...Object.keys(manifest.dependencies ?? {}), ...include])
  for (const n of exclude) names.delete(n)
  return [...names].sort().map((name) => {
    const dir = path.join(root, 'node_modules', name)
    const pkg = /** @type {{ version: string, license?: string }} */ (
      JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    )
    // The licence first, then what it asks to be kept with it.
    const files = fs
      .readdirSync(dir)
      .filter((f) => NOTICE_FILE.test(f))
      .sort((a, b) => Number(/^notice/i.test(a)) - Number(/^notice/i.test(b)) || a.localeCompare(b))
      .map((f) => path.join(dir, f))
    const fallback = path.join(root, fallbackDir, fallbackName(name))
    if (files.length === 0 && fs.existsSync(fallback)) files.push(fallback)
    if (files.length === 0 || !pkg.license) {
      throw new Error(
        `${name} ships no licence file or no "license": add ${fallbackDir}/${fallbackName(name)}`,
      )
    }
    const text = files
      .map((f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n').trim())
      .join('\n\n')
    return { name, version: pkg.version, licence: pkg.license, text }
  })
}

/**
 * The list as a plain, script-free HTML page.
 * @param {readonly Licence[]} list
 * @param {{ title?: string, intro?: string }} [options]
 * @returns {string}
 */
export function licencesHtml(list, { title = 'Licences', intro = '' } = {}) {
  const items = list
    .map(
      (l) =>
        `<section>\n<h2>${escapeHtml(l.name)} ${escapeHtml(l.version)}</h2>\n<p>${escapeHtml(l.licence)}</p>\n<pre>${escapeHtml(l.text)}</pre>\n</section>\n`,
    )
    .join('')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 48rem; margin: 0 auto; padding: 2rem 1rem 4rem; }
  pre { white-space: pre-wrap; font-size: .85rem; }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
${intro ? `<p>${escapeHtml(intro)}</p>\n` : ''}${items}</main>
</body>
</html>
`
}

/**
 * The list as plain text, for a `notices.txt` beside the game: `header` first (the game's own
 * copyright), then each package's name, version and licence, and its notice files in full. A
 * licence such as three.js's MIT asks that its notice travel with every copy, and a minifier
 * drops the comment that carried it in the source, so the file is what keeps it with the build.
 * @param {readonly Licence[]} list
 * @param {{ header?: string, intro?: string }} [options]
 * @returns {string}
 */
export function licencesText(list, { header = '', intro = 'This game uses these packages.' } = {}) {
  const rule = '-'.repeat(72)
  const head = [header.trim(), intro.trim()].filter(Boolean).join('\n\n')
  const items = list.map((l) => `${rule}\n${l.name} ${l.version} (${l.licence})\n\n${l.text}\n`)
  return `${head ? `${head}\n\n` : ''}${items.join('\n')}`
}

/**
 * @typedef {CollectOptions & {
 *   module?: string,
 *   page?: string | false,
 *   pageTitle?: string,
 *   pageIntro?: string,
 *   text?: string | false,
 *   textHeader?: string,
 *   textIntro?: string,
 * }} LicencesOptions
 *   `module`: the virtual module's id. `page`: a file name to also emit the list as HTML
 *   (`licences.html`); off by default. `text`: a file name to also emit it as plain text
 *   (`notices.txt`), headed by `textHeader`; off by default.
 */

/**
 * `import { LICENCES } from 'virtual:licences'` gives the game the list; `page` writes it as a
 * page too, and `text` as a plain-text file. The root is Vite's.
 * @param {LicencesOptions} [options]
 * @returns {import('vite').Plugin}
 */
export function licences(options = {}) {
  const { module = LICENCES_MODULE, page = false } = options
  const resolved = `\0${module}`
  let root = process.cwd()
  /** @type {Licence[] | null} */
  let cache = null
  const list = () => {
    cache ??= collectLicences(root, options)
    return cache
  }
  return {
    name: 'umm:licences',
    configResolved(config) {
      root = config.root
      cache = null
    },
    resolveId: (id) => (id === module ? resolved : null),
    load(id) {
      if (id !== resolved) return null
      return `export const LICENCES = ${JSON.stringify(list())}`
    },
    generateBundle() {
      if (page) {
        /** @type {{ title?: string, intro?: string }} */
        const o = {}
        if (options.pageTitle) o.title = options.pageTitle
        if (options.pageIntro) o.intro = options.pageIntro
        this.emitFile({ type: 'asset', fileName: page, source: licencesHtml(list(), o) })
      }
      if (options.text) {
        /** @type {{ header?: string, intro?: string }} */
        const o = {}
        if (options.textHeader) o.header = options.textHeader
        if (options.textIntro !== undefined) o.intro = options.textIntro
        this.emitFile({ type: 'asset', fileName: options.text, source: licencesText(list(), o) })
      }
    },
  }
}
