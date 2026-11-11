// @ts-check
/**
 * The provenance header `umm-dev copy` stamps on line 1 of every copied runtime file, and the
 * hashing `umm-dev drift` compares it with.
 *
 *   // Copied from ummgames-dev v0.1.0 runtime/dev/fuzzy.ts (sha256 0123456789abcdef). Owned here now; `umm-dev drift` compares.
 *
 * The hash is the first 16 hex digits of the SHA-256 of the body: everything after the header
 * line, with CRLF read as LF so a checkout's line endings never count as a change.
 */
import crypto from 'node:crypto'
import path from 'node:path'

/** @typedef {{ open: string, close: string }} CommentStyle */

/** @type {CommentStyle} */
const SLASH = { open: '//', close: '' }
/** @type {CommentStyle} */
const BLOCK = { open: '/*', close: ' */' }
/** @type {CommentStyle} */
const MARKUP = { open: '<!--', close: ' -->' }
/** @type {CommentStyle} */
const HASH = { open: '#', close: '' }

/** Comment syntax per file extension. A file type missing here cannot carry a header. */
export const COMMENT_STYLES = /** @type {Record<string, CommentStyle>} */ ({
  '.ts': SLASH,
  '.tsx': SLASH,
  '.mts': SLASH,
  '.cts': SLASH,
  '.js': SLASH,
  '.jsx': SLASH,
  '.mjs': SLASH,
  '.cjs': SLASH,
  '.glsl': SLASH,
  '.wgsl': SLASH,
  '.vert': SLASH,
  '.frag': SLASH,
  '.css': BLOCK,
  '.html': MARKUP,
  '.svg': MARKUP,
  '.xml': MARKUP,
  '.md': MARKUP,
  '.sh': HASH,
  '.py': HASH,
  '.yaml': HASH,
  '.yml': HASH,
  '.toml': HASH,
})

// Only a release tag and plain path segments (no `.` or `..`): a game file's header must never
// steer a read or a fetch outside runtime/.
const HEADER_RE =
  /Copied from ummgames-dev (v\d+\.\d+\.\d+(?:-[\w.]+)?) (runtime(?:\/[\w-][\w.-]*)+) \(sha256 ([0-9a-f]{16})\)/

/**
 * A release tag: `v1.2.3` or `v1.2.3-rc.1`.
 * @param {string} v
 */
export const isSafeVersion = (v) => /^v\d+\.\d+\.\d+(-[\w.]+)?$/.test(v)

/**
 * A posix path under runtime/ of plain segments: no `.`, `..`, empty or odd segments.
 * @param {string} p
 */
export function isSafeRuntimePath(p) {
  const parts = p.split('/')
  return (
    parts.length > 1 &&
    parts[0] === 'runtime' &&
    parts.slice(1).every((s) => /^[\w-][\w.-]*$/.test(s) && s !== '.' && s !== '..')
  )
}

/**
 * @param {string} file
 * @returns {CommentStyle | null}
 */
export function commentStyleFor(file) {
  return COMMENT_STYLES[path.extname(file).toLowerCase()] ?? null
}

/** @param {string} text */
export function normalizeEol(text) {
  return text.replace(/\r\n/g, '\n')
}

/**
 * First 16 hex of the body's SHA-256, CRLF read as LF.
 * @param {string} body
 */
export function bodyHash(body) {
  return crypto.createHash('sha256').update(normalizeEol(body), 'utf8').digest('hex').slice(0, 16)
}

/**
 * The header line for a copy of `runtimePath` (posix, starting `runtime/`), without its newline.
 * @param {{ file: string, version: string, runtimePath: string, hash: string }} p
 */
export function makeHeader({ file, version, runtimePath, hash }) {
  const style = commentStyleFor(file)
  if (!style) throw new Error(`no comment syntax known for ${path.extname(file) || file}`)
  const text = `Copied from ummgames-dev ${version} ${runtimePath} (sha256 ${hash}). Owned here now; \`umm-dev drift\` compares.`
  return `${style.open} ${text}${style.close}`
}

/**
 * Split a copied file into its header fields and its body. `null` when line 1 is not a header.
 * @param {string} text
 * @returns {{ version: string, runtimePath: string, hash: string, header: string, body: string } | null}
 */
export function parseCopy(text) {
  const nl = text.indexOf('\n')
  const first = (nl === -1 ? text : text.slice(0, nl)).replace(/\r$/, '')
  const m = HEADER_RE.exec(first)
  if (!m || !isSafeRuntimePath(/** @type {string} */ (m[2]))) return null
  return {
    version: /** @type {string} */ (m[1]),
    runtimePath: /** @type {string} */ (m[2]),
    hash: /** @type {string} */ (m[3]),
    header: first,
    body: nl === -1 ? '' : text.slice(nl + 1),
  }
}

/**
 * The whole text `copy` writes: header, then the source as it is (LF endings).
 * @param {{ file: string, version: string, runtimePath: string, source: string }} p
 */
export function stamp({ file, version, runtimePath, source }) {
  const body = normalizeEol(source)
  return `${makeHeader({ file, version, runtimePath, hash: bodyHash(body) })}\n${body}`
}

// A copy from one of the game's own sources (`runtime.sources`): the source's name, the commit
// that last changed the file, and its path in that checkout. Only plain names, a hex commit and
// plain path segments: the header is data from the game, and drift reads git with it.
const SOURCE_HEADER_RE =
  /Copied from ([A-Za-z0-9][\w-]*) ([0-9a-f]{7,40}) ((?:[\w-][\w.-]*)(?:\/[\w-][\w.-]*)*) \(sha256 ([0-9a-f]{16})\)/

/**
 * A source's name as a game's config gives it: a letter or digit, then letters, digits, `_`, `-`.
 * `ummgames-dev` is taken: it names this package in a kit copy's header.
 * @param {string} name
 */
export const isSafeSourceName = (name) =>
  /^[A-Za-z0-9][\w-]*$/.test(name) && name !== 'ummgames-dev'

/** @param {string} commit */
export const isSafeCommit = (commit) => /^[0-9a-f]{7,40}$/.test(commit)

/**
 * A posix path inside a source checkout, of plain segments: no `.`, `..`, empty or odd segments.
 * @param {string} p
 */
export function isSafeSourcePath(p) {
  return p.split('/').every((s) => /^[\w-][\w.-]*$/.test(s) && s !== '.' && s !== '..')
}

/**
 * The header line for a copy of `srcPath` from the source `name` at `commit`, without its newline.
 * @param {{ file: string, name: string, commit: string, srcPath: string, hash: string }} p
 */
export function makeSourceHeader({ file, name, commit, srcPath, hash }) {
  const style = commentStyleFor(file)
  if (!style) throw new Error(`no comment syntax known for ${path.extname(file) || file}`)
  const text = `Copied from ${name} ${commit} ${srcPath} (sha256 ${hash}). Change it there and copy it again; \`umm-dev drift\` compares.`
  return `${style.open} ${text}${style.close}`
}

/**
 * Split a copy from a source into its header fields and its body. `null` when line 1 is not a
 * source copy's header (a kit copy's header is not one).
 * @param {string} text
 * @returns {{ name: string, commit: string, srcPath: string, hash: string, header: string, body: string } | null}
 */
export function parseSourceCopy(text) {
  const nl = text.indexOf('\n')
  const first = (nl === -1 ? text : text.slice(0, nl)).replace(/\r$/, '')
  const m = SOURCE_HEADER_RE.exec(first)
  if (!m) return null
  const [, name, commit, srcPath, hash] = /** @type {string[]} */ (m)
  if (
    !isSafeSourceName(/** @type {string} */ (name)) ||
    !isSafeSourcePath(/** @type {string} */ (srcPath))
  )
    return null
  return {
    name: /** @type {string} */ (name),
    commit: /** @type {string} */ (commit),
    srcPath: /** @type {string} */ (srcPath),
    hash: /** @type {string} */ (hash),
    header: first,
    body: nl === -1 ? '' : text.slice(nl + 1),
  }
}

/**
 * The whole text a copy from a source gets: header, then the file as it is (LF endings).
 * @param {{ file: string, name: string, commit: string, srcPath: string, source: string }} p
 */
export function stampSource({ file, name, commit, srcPath, source }) {
  const body = normalizeEol(source)
  return `${makeSourceHeader({ file, name, commit, srcPath, hash: bodyHash(body) })}\n${body}`
}
