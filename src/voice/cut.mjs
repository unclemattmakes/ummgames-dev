// @ts-check
/**
 * Cutting takes with ffmpeg: a spoken take to a small mono piece between two times, and a sung
 * take to where its sound ends.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Seconds of fade in and fade out on each piece, so a cut never clicks. */
export const FADE_IN_S = 0.006
export const FADE_OUT_S = 0.012
/** The shortest piece `cut` makes, in seconds. */
export const MIN_PIECE_S = 0.05

/**
 * @param {string} file
 * @param {string} ffprobe
 */
function duration(file, ffprobe) {
  return Number(
    execFileSync(
      ffprobe,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
      {
        encoding: 'utf8',
      },
    ),
  )
}

/**
 * @typedef {{ ffmpeg?: string, ffprobe?: string, rate?: number, bitrate?: string }} CutOptions
 */

/**
 * Cuts [from, to] seconds of `src` to a mono mp3 piece, faded at both ends, and returns its bytes.
 * `filters` are ffmpeg audio filters that run after the fades (a spot tightens its pauses with
 * `silenceremove` and its pace with `atempo`). After each call, `cut.seconds` is the piece's
 * length, as ffprobe reads it. Each call works in its own temporary folder, so cuts can run at once.
 * @param {string} src resolved against the working directory
 * @param {number} from
 * @param {number} to
 * @param {string[]} [filters]
 * @param {CutOptions} [options] `rate` defaults to 22050, `bitrate` to `32k`
 * @returns {Buffer}
 */
export function cut(
  src,
  from,
  to,
  filters = [],
  { ffmpeg = 'ffmpeg', ffprobe = 'ffprobe', rate = 22050, bitrate = '32k' } = {},
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'umm-dev-cut-'))
  const tmp = path.join(dir, 'piece.mp3')
  const len = Math.max(MIN_PIECE_S, to - from)
  try {
    execFileSync(ffmpeg, [
      '-y',
      '-loglevel',
      'error',
      '-ss',
      from.toFixed(3),
      '-t',
      len.toFixed(3),
      '-i',
      path.resolve(src),
      '-af',
      [
        `afade=t=in:d=${FADE_IN_S},afade=t=out:st=${Math.max(0, len - FADE_OUT_S).toFixed(3)}:d=${FADE_OUT_S}`,
        ...filters,
      ].join(','),
      '-ac',
      '1',
      '-ar',
      String(rate),
      '-b:a',
      bitrate,
      tmp,
    ])
    const bytes = fs.readFileSync(tmp)
    cut.seconds = duration(tmp, ffprobe)
    return bytes
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
/** The length of the last piece `cut` made, in seconds. */
cut.seconds = 0

/** A sung take has ended once every window of it after that stays under this many dBFS. */
export const SOUND_END_DB = -60
/** Seconds in a window. A window, not a sample, so a lone click in the decoder's last frame is not sound. */
export const SOUND_END_WINDOW_S = 0.05
const SOUND_END_RATE = 48000

/**
 * Seconds from the start of `file` to where its sound ends: the end of the last window whose
 * level (RMS of the louder channel) is over `db`. 0 for a silent file. A break player lands that
 * moment on its spot's end.
 * @param {string} file
 * @param {{ ffmpeg?: string, db?: number, window?: number }} [options]
 * @returns {number} rounded to the millisecond
 */
export function soundEnds(
  file,
  { ffmpeg = 'ffmpeg', db = SOUND_END_DB, window = SOUND_END_WINDOW_S } = {},
) {
  const rate = SOUND_END_RATE
  const { stdout, status } = spawnSync(
    ffmpeg,
    ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '2', '-ar', String(rate), '-'],
    { maxBuffer: 1 << 28 },
  )
  if (status !== 0) throw new Error(`ffmpeg could not read ${file}`)
  // Copy into an aligned buffer: a Buffer's offset into its pool need not be a multiple of 4.
  const pcm = new Float32Array(Uint8Array.from(stdout).buffer)
  const frames = pcm.length >> 1
  const win = Math.round(rate * window)
  const floor = 10 ** (db / 20)
  for (let w = Math.ceil(frames / win) - 1; w >= 0; w--) {
    const sums = [0, 0]
    const to = Math.min(frames, (w + 1) * win)
    for (let i = w * win; i < to; i++) {
      sums[0] += pcm[2 * i] ** 2
      sums[1] += pcm[2 * i + 1] ** 2
    }
    if (Math.sqrt(Math.max(...sums) / (to - w * win)) > floor)
      return Math.round((to / rate) * 1000) / 1000
  }
  return 0
}

/**
 * Ships a sung take (a jingle from the music model): encodes `src` to `dest` as an mp3 at
 * `bitrate`, then returns `seconds`, its length to where its sound ends, for the game to time
 * the take by. With `trim`, the file is also cut there, so it holds no silent tail.
 * @param {string} src
 * @param {string} dest
 * @param {{ ffmpeg?: string, bitrate?: string, trim?: boolean, db?: number, window?: number }} [options]
 *   `bitrate` defaults to `96k`, `trim` to false
 * @returns {{ file: string, seconds: number }}
 */
export function shipSung(
  src,
  dest,
  { ffmpeg = 'ffmpeg', bitrate = '96k', trim = false, ...ends } = {},
) {
  const encode = (/** @type {string} */ from, /** @type {string[]} */ extra) =>
    execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', from, ...extra, '-b:a', bitrate, dest])
  fs.mkdirSync(path.dirname(path.resolve(dest)), { recursive: true })
  encode(src, [])
  const seconds = soundEnds(dest, { ffmpeg, ...ends })
  // Cut the source, not the encode, so the trimmed file is encoded once.
  if (trim && seconds > 0) encode(src, ['-t', seconds.toFixed(3)])
  return { file: dest, seconds }
}
