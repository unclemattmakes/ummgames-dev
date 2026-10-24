// @ts-check
/**
 * Shared plumbing for the media commands: running ffmpeg (or printing what would run),
 * ffprobe, argument parsing and the serialisation of page-side hooks.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

/** An error whose message tells the user what to fix; the commands print it and exit 1. */
export class MediaError extends Error {}

/** @param {string} bin */
export function hasBin(bin) {
  const r = spawnSync(bin, ['-version'], { stdio: 'ignore' })
  return r.status === 0
}

/** Quote one argument for a POSIX shell line (only for `--print` output). @param {string} a */
export function shellQuote(a) {
  return /^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replaceAll("'", `'\\''`)}'`
}

/**
 * Run ffmpeg quietly, throwing a MediaError on failure.
 * @param {string[]} args
 * @param {{ cwd?: string, print?: boolean, log?: (line: string) => void }} [opts]
 */
export function ffmpeg(args, opts = {}) {
  const full = ['-hide_banner', '-v', 'error', '-y', ...args]
  if (opts.print) {
    ;(opts.log ?? console.log)(`ffmpeg ${full.map(shellQuote).join(' ')}`)
    return
  }
  const r = spawnSync('ffmpeg', full, { cwd: opts.cwd, encoding: 'utf8', maxBuffer: 1 << 26 })
  if (r.error) throw new MediaError(`could not run ffmpeg (${r.error.message}): put it on PATH`)
  // fontconfig on Windows builds warns on every drawtext; that is not an error.
  const said = (r.stderr ?? '').split('\n').filter((l) => l.trim() && !/fontconfig/i.test(l))
  if (r.status !== 0) {
    throw new MediaError(`ffmpeg failed (exit ${r.status}):\n${said.join('\n')}`)
  }
}

/**
 * ffmpeg writing raw bytes to stdout (a frame for analysis).
 * @param {string[]} args
 * @returns {Buffer}
 */
export function ffmpegBytes(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args, '-'], {
    maxBuffer: 1 << 28,
  })
  if (r.error) throw new MediaError(`could not run ffmpeg (${r.error.message}): put it on PATH`)
  if (r.status !== 0) throw new MediaError(`ffmpeg failed: ${String(r.stderr).trim()}`)
  return r.stdout
}

/**
 * @typedef {object} Probe
 * @property {string} file
 * @property {number} bytes
 * @property {string} format     ffprobe's format_name (`mov,mp4,...`, `png_pipe`, `image2`)
 * @property {number | null} duration  seconds, or null for a still
 * @property {{ codec: string, width: number, height: number, pixFmt: string, fps: number | null, frames: number | null } | null} video
 * @property {{ codec: string }[]} audio
 */

/**
 * @param {string} file
 * @returns {Probe}
 */
export function probe(file) {
  if (!fs.existsSync(file)) throw new MediaError(`no file ${file}`)
  const r = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file],
    { encoding: 'utf8', maxBuffer: 1 << 24 },
  )
  if (r.error) throw new MediaError(`could not run ffprobe (${r.error.message}): put it on PATH`)
  if (r.status !== 0) throw new MediaError(`ffprobe could not read ${file}: ${r.stderr.trim()}`)
  const j = JSON.parse(r.stdout)
  /** @type {any[]} */
  const streams = j.streams ?? []
  const v = streams.find((s) => s.codec_type === 'video')
  const rate = (/** @type {string | undefined} */ s) => {
    if (!s) return null
    const [a, b] = s.split('/').map(Number)
    return b ? a / b : a || null
  }
  const dur = Number(j.format?.duration)
  return {
    file,
    bytes: fs.statSync(file).size,
    format: String(j.format?.format_name ?? ''),
    duration: Number.isFinite(dur) && dur > 0 ? dur : null,
    video: v
      ? {
          codec: String(v.codec_name),
          width: Number(v.width),
          height: Number(v.height),
          pixFmt: String(v.pix_fmt ?? ''),
          fps: rate(v.avg_frame_rate) ?? rate(v.r_frame_rate),
          frames: v.nb_frames ? Number(v.nb_frames) : null,
        }
      : null,
    audio: streams.filter((s) => s.codec_type === 'audio').map((s) => ({ codec: s.codec_name })),
  }
}

/**
 * `node:util` parseArgs with a usage error the commands turn into exit 2.
 * @template {import('node:util').ParseArgsConfig['options']} O
 * @param {string[]} argv
 * @param {O} options
 */
export function parse(argv, options) {
  try {
    return parseArgs({ args: argv, options, allowPositionals: true, strict: true })
  } catch (e) {
    throw new UsageError(e instanceof Error ? e.message : String(e))
  }
}

export class UsageError extends Error {}

/**
 * The commands' shared error handling: usage errors exit 2, media errors exit 1, both with
 * their message; anything else is a bug and keeps its stack.
 * @param {string} usage
 * @param {() => Promise<number | void>} body
 * @returns {Promise<number>}
 */
export async function guard(usage, body) {
  try {
    return (await body()) ?? 0
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`${e.message}\n\n${usage}`)
      return 2
    }
    if (e instanceof MediaError) {
      console.error(e.message)
      return 1
    }
    throw e
  }
}

/**
 * A page-side hook from a game's config: a function (serialised with its source, so it must
 * not close over anything in Node) or a string of a function's source. Method shorthand
 * (`ready(d) { ... }` in an object literal) is turned back into a function expression.
 * @param {unknown} hook
 * @param {string} name   for the error message
 * @returns {string | null}
 */
export function pageFn(hook, name) {
  if (hook == null || hook === false) return null
  const src = typeof hook === 'function' ? hook.toString() : typeof hook === 'string' ? hook : null
  if (src == null) throw new MediaError(`config ${name} must be a function, got ${typeof hook}`)
  const s = src.trim()
  const m = /^(async\s+)?([A-Za-z_$][\w$]*)\s*\(/.exec(s)
  if (m && m[2] !== 'function') return `${m[1] ?? ''}function ${s.slice((m[1] ?? '').length)}`
  return s
}

/** @param {number} n @param {string} ext */
export const frameName = (n, ext) => `f${String(n).padStart(5, '0')}.${ext}`

/** The frame files of a capture folder, in order. @param {string} dir */
export function listFrames(dir) {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => /^f\d{5}\.(jpg|png)$/.test(f))
    .sort()
}

/** @param {string} root @param {string} p */
export const resolveFrom = (root, p) => path.resolve(root, p)

/** Escape a path for an ffmpeg filter argument (`fontfile=`, `textfile=`). @param {string} p */
export function filterPath(p) {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

/** Escape text for drawtext's `text='...'`. A straight `'` would end it, so it turns typographic. @param {string} t */
export function drawtextEscape(t) {
  return t.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, '\u2019').replace(/%/g, '\\%')
}

/** Read a JSON file with a message that names the file. @param {string} file */
export function readJson(file) {
  if (!fs.existsSync(file)) throw new MediaError(`no file ${file}`)
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    throw new MediaError(`${file} is not valid JSON: ${e instanceof Error ? e.message : e}`)
  }
}

/** A path relative to `root` for messages, forward slashes. @param {string} root @param {string} p */
export const rel = (root, p) => path.relative(root, p).replace(/\\/g, '/') || '.'

/**
 * Launch Chromium: Playwright's own build, or when that is not installed (and no channel was
 * asked for), the machine's Chrome, then Edge. Throws a MediaError saying how to install one.
 * @param {typeof import('playwright')} pw
 * @param {import('playwright').LaunchOptions} opts
 * @param {(line: string) => void} [log]
 */
export async function launchChromium(pw, opts, log = console.log) {
  const tries =
    opts.channel || opts.executablePath ? [opts.channel] : [undefined, 'chrome', 'msedge']
  let first = ''
  for (const channel of tries) {
    try {
      const b = await pw.chromium.launch({ ...opts, channel })
      if (channel && channel !== opts.channel)
        log(`(Playwright's Chromium is not installed: using the installed ${channel})`)
      return b
    } catch (e) {
      first ||= e instanceof Error ? e.message.split('\n')[0] : String(e)
    }
  }
  throw new MediaError(
    `could not start Chromium: ${first}\nrun \`pnpm exec playwright install chromium\`, or set capture.browser.channel`,
  )
}
