// @ts-check
/**
 * `umm-dev drift`: find every copied runtime file in a game by its header, and say how far each
 * has moved on both sides of the copy.
 *
 * - **Here:** the body's hash against the header's (the game edited its copy).
 * - **Upstream:** the installed `runtime/` file's hash against the header's (this package has
 *   moved on since the copy was taken).
 *
 * When both moved, the diff needs the original: the file at the header's tag, read from a local
 * clone named by `UMM_DEV_REPO`, or fetched from the public repo. Offline, the diff falls back
 * to comparing the copy with the installed file.
 *
 * A copy from one of the game's own sources (`runtime.sources`) is compared the same way, with the
 * source's file at its ref as upstream and the file at the header's commit as the original, both
 * read through git from the source's checkout. Nothing is fetched for it.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import {
  bodyHash,
  commentStyleFor,
  isSafeRuntimePath,
  isSafeVersion,
  parseCopy,
  parseSourceCopy,
} from './header.mjs'
import { PACKAGE_ROOT, packageVersion, readRuntime, toPosix } from './source.mjs'
import { readSource } from './sources.mjs'

export const RAW_BASE = 'https://raw.githubusercontent.com/unclemattmakes/ummgames-dev'

/** Folders a scan never enters when the game is not a git checkout. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'test-results', 'coverage', '.vite'])

/**
 * @typedef {'current' | 'changed-here' | 'changed-upstream' | 'changed-both' | 'gone-upstream' | 'no-source'} DriftStatus
 * @typedef {{
 *   file: string,
 *   source: string | null,
 *   runtimePath: string,
 *   version: string,
 *   hash: string,
 *   localHash: string,
 *   upstreamHash: string | null,
 *   changedHere: boolean,
 *   changedUpstream: boolean,
 *   status: DriftStatus,
 * }} DriftEntry
 */

/**
 * The game's files, relative to `root` (posix). Git's view when the game is a checkout, so
 * ignored build output never counts; otherwise a walk that skips the usual output folders.
 * @param {string} root
 * @returns {string[]}
 */
export function gameFiles(root) {
  try {
    const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out.split('\n').filter((f) => f && fs.existsSync(path.join(root, f)))
  } catch {
    /** @type {string[]} */
    const files = []
    /** @param {string} dir */
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('dist')) walk(path.join(dir, e.name))
        } else files.push(toPosix(path.relative(root, path.join(dir, e.name))))
      }
    }
    walk(root)
    return files
  }
}

/** @param {string} file */
function firstLine(file) {
  const fd = fs.openSync(file, 'r')
  try {
    const buf = Buffer.alloc(512)
    const n = fs.readSync(fd, buf, 0, buf.length, 0)
    return buf.subarray(0, n).toString('utf8').split('\n')[0] ?? ''
  } finally {
    fs.closeSync(fd)
  }
}

/**
 * Every copy in the game and how it stands. `sources` is the game's `runtime.sources`, resolved:
 * a copy from a source missing there, or not on this machine, is `no-source`.
 * @param {{ root: string, pkgRoot?: string, sources?: Record<string, import('./sources.mjs').Source> }} p
 * @returns {DriftEntry[]}
 */
export function scanDrift({ root, pkgRoot = PACKAGE_ROOT, sources = {} }) {
  /** @type {DriftEntry[]} */
  const entries = []
  for (const file of gameFiles(root)) {
    if (!commentStyleFor(file)) continue
    const abs = path.join(root, file)
    if (!firstLine(abs).includes('Copied from ')) continue
    const copy = readCopy(fs.readFileSync(abs, 'utf8'))
    if (!copy) continue
    const localHash = bodyHash(copy.body)
    const src = copy.source === null ? undefined : sources[copy.source]
    const reachable = copy.source === null || (src !== undefined && fs.existsSync(src.repo))
    /** @type {string | null} */
    let upstream = null
    if (copy.source === null) upstream = readRuntime(copy.runtimePath, pkgRoot)
    else if (src && reachable) upstream = readSource(src, copy.runtimePath)
    const upstreamHash = upstream === null ? null : bodyHash(upstream)
    const changedHere = localHash !== copy.hash
    const changedUpstream = reachable && upstreamHash !== copy.hash
    /** @type {DriftStatus} */
    let status = 'current'
    if (!reachable) status = 'no-source'
    else if (upstreamHash === null) status = 'gone-upstream'
    else if (changedHere && changedUpstream) status = 'changed-both'
    else if (changedHere) status = 'changed-here'
    else if (changedUpstream) status = 'changed-upstream'
    entries.push({
      file,
      source: copy.source,
      runtimePath: copy.runtimePath,
      version: copy.version,
      hash: copy.hash,
      localHash,
      upstreamHash,
      changedHere,
      changedUpstream,
      status,
    })
  }
  return entries.sort((a, b) => a.file.localeCompare(b.file))
}

/**
 * @typedef {(url: string, timeoutMs: number) => Promise<{ ok: boolean, status: number, text(): Promise<string> }>} Fetcher
 */

/**
 * GET over node:https with its own socket, closed when done. (Global fetch keeps a pooled socket
 * that can still be closing when the CLI exits, which aborts Node on Windows.)
 * @type {Fetcher}
 */
export function httpsGet(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent: false, headers: { 'user-agent': 'umm-dev' } }, (res) => {
      /** @type {Buffer[]} */
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('error', reject)
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        const status = res.statusCode ?? 0
        resolve({ ok: status >= 200 && status < 300, status, text: async () => body })
      })
    })
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`no answer in ${timeoutMs} ms`)))
    req.on('error', reject)
  })
}

/**
 * The public repo's URL for a runtime file at a tag: each segment encoded, and the result checked
 * to still sit under this repo's runtime/ at that tag. `null` when it would not.
 * @param {string} version
 * @param {string} runtimePath
 */
export function rawUrl(version, runtimePath) {
  if (!isSafeVersion(version) || !isSafeRuntimePath(runtimePath)) return null
  const url = `${RAW_BASE}/${[version, ...runtimePath.split('/')].map(encodeURIComponent).join('/')}`
  const prefix = `${new URL(RAW_BASE).pathname}/${encodeURIComponent(version)}/runtime/`
  const parsed = new URL(url)
  return parsed.host === 'raw.githubusercontent.com' && parsed.pathname.startsWith(prefix)
    ? url
    : null
}

/**
 * The file as it was at `version`: from the clone `UMM_DEV_REPO` names, else from the public
 * repo. Checked against the header's hash, so a wrong tag or an edited clone never passes for
 * the original.
 * @param {{
 *   runtimePath: string,
 *   version: string,
 *   hash: string,
 *   env?: Record<string, string | undefined>,
 *   fetch?: Fetcher,
 *   timeoutMs?: number,
 * }} p
 * @returns {Promise<{ text: string, from: string } | { text: null, why: string }>}
 */
export async function fetchOriginal({
  runtimePath,
  version,
  hash,
  env = process.env,
  fetch = httpsGet,
  timeoutMs = 8000,
}) {
  if (!isSafeVersion(version) || !isSafeRuntimePath(runtimePath))
    return { text: null, why: `refusing an unsafe header: ${version} ${runtimePath}` }
  /** @type {string[]} */
  const tried = []
  const repo = env.UMM_DEV_REPO
  if (repo) {
    try {
      const text = execFileSync('git', ['-C', repo, 'show', `${version}:${runtimePath}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      if (bodyHash(text) === hash) return { text, from: `UMM_DEV_REPO at ${version}` }
      tried.push(`UMM_DEV_REPO at ${version} does not match the header's hash`)
    } catch {
      tried.push(`UMM_DEV_REPO has no ${version}:${runtimePath}`)
    }
  }
  const url = rawUrl(version, runtimePath)
  if (url === null) {
    tried.push(`refusing to fetch ${runtimePath} at ${version}`)
    return { text: null, why: tried.join('; ') }
  }
  try {
    const res = await fetch(url, timeoutMs)
    if (!res.ok) tried.push(`${url} answered ${res.status}`)
    else {
      const text = await res.text()
      if (bodyHash(text) === hash) return { text, from: url }
      tried.push(`${url} does not match the header's hash`)
    }
  } catch (e) {
    tried.push(`${url} unreachable (${e instanceof Error ? e.message : String(e)})`)
  }
  return { text: null, why: tried.join('; ') }
}

/** What each status means, for the report. */
export const STATUS_TEXT = /** @type {Record<DriftStatus, string>} */ ({
  current: 'current',
  'changed-here': 'changed here',
  'changed-upstream': 'changed upstream',
  'changed-both': 'changed here and upstream',
  'gone-upstream': 'no longer shipped',
  'no-source': 'source not found',
})

/**
 * @param {DriftEntry} e
 * @returns {string | null} the next step, when there is one
 */
export function advice(e) {
  const short =
    e.source === null
      ? e.runtimePath.slice('runtime/'.length)
      : `--from ${e.source} ${e.runtimePath}`
  switch (e.status) {
    case 'changed-upstream':
      return `take it: umm-dev copy ${short} --to ${e.file}`
    case 'changed-both':
      return 'merge by hand: umm-dev drift --diff'
    case 'gone-upstream':
      return e.source === null
        ? 'the installed version no longer has it: the copy is wholly the game’s'
        : `source ${e.source} no longer has it at its ref: the copy is wholly the game’s`
    case 'no-source':
      return `name ${e.source} in runtime.sources, with the path to its checkout, to compare it`
    default:
      return null
  }
}

/**
 * A copied file's header and body, of either kind: `source` is `null` for a copy of this
 * package's runtime/, else the source's name; `version` is the tag or the commit.
 * @param {string} text
 * @returns {{ source: string | null, runtimePath: string, version: string, hash: string, body: string } | null}
 */
export function readCopy(text) {
  const kit = parseCopy(text)
  if (kit)
    return {
      source: null,
      runtimePath: kit.runtimePath,
      version: kit.version,
      hash: kit.hash,
      body: kit.body,
    }
  const own = parseSourceCopy(text)
  if (own)
    return {
      source: own.name,
      runtimePath: own.srcPath,
      version: own.commit,
      hash: own.hash,
      body: own.body,
    }
  return null
}

/**
 * A source copy's original: the file at the header's commit, read from the source's checkout and
 * checked against the header's hash.
 * @param {DriftEntry} e
 * @param {Record<string, import('./sources.mjs').Source>} sources
 * @returns {{ text: string, from: string } | { text: null, why: string }}
 */
export function sourceOriginal(e, sources) {
  const src = e.source === null ? undefined : sources[e.source]
  if (!src) return { text: null, why: `no source ${e.source} in runtime.sources` }
  const text = readSource(src, e.runtimePath, e.version)
  if (text === null) return { text: null, why: `${src.repo} has no ${e.version}:${e.runtimePath}` }
  if (bodyHash(text) !== e.hash)
    return { text: null, why: `${e.version}:${e.runtimePath} does not match the header's hash` }
  return { text, from: `source ${e.source} at ${e.version}` }
}

/** @param {string} [pkgRoot] */
export function installedVersion(pkgRoot = PACKAGE_ROOT) {
  return packageVersion(pkgRoot)
}
