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
