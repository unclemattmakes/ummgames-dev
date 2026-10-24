// @ts-check
/**
 * Meter an audio file: ffprobe reads its rate and channel count, ffmpeg decodes it to 32-bit
 * float (f32le) at that rate, and the samples stream into the meter as they arrive. Nothing is
 * resampled or remixed, so the true peak is the file's own.
 */
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { createMeter } from './meter.mjs'

const run = promisify(execFile)

/**
 * @param {string} file
 * @param {{ ffmpeg?: string, ffprobe?: string }} [bins]
 * @returns {Promise<{ sampleRate: number, channels: number }>}
 */
export async function probe(file, { ffprobe = 'ffprobe' } = {}) {
  const { stdout } = await run(ffprobe, [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=sample_rate,channels',
    '-of',
    'json',
    file,
  ])
  const stream = JSON.parse(stdout).streams?.[0]
  if (!stream) throw new Error(`${file}: no audio stream`)
  return { sampleRate: Number(stream.sample_rate), channels: Number(stream.channels) }
}

/**
 * @param {string} file
 * @param {{ ffmpeg?: string, ffprobe?: string }} [bins]
 * @returns {Promise<import('./meter.mjs').Loudness>}
 */
export async function meterFile(file, bins = {}) {
  const { sampleRate, channels } = await probe(file, bins)
  const meter = createMeter({ sampleRate, channels })
  const ff = spawn(
    bins.ffmpeg ?? 'ffmpeg',
    [
      '-v',
      'error',
      '-nostdin',
      '-i',
      file,
      '-map',
      '0:a:0',
      '-f',
      'f32le',
      '-acodec',
      'pcm_f32le',
      '-',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let err = ''
  ff.stderr.on('data', (d) => {
    err += d
  })
  // Chunks split floats anywhere: carry the odd bytes into the next one.
  let carry = Buffer.alloc(0)
  ff.stdout.on('data', (/** @type {Buffer} */ d) => {
    const buf = carry.length ? Buffer.concat([carry, d]) : d
    const whole = buf.length - (buf.length % (4 * channels))
    if (whole > 0) {
      const aligned = Buffer.from(buf.subarray(0, whole))
      meter.push(new Float32Array(aligned.buffer, aligned.byteOffset, whole / 4))
    }
    carry = Buffer.from(buf.subarray(whole))
  })
  const code = await new Promise((resolve, reject) => {
    ff.on('error', reject)
    ff.on('close', resolve)
  })
  if (code !== 0) throw new Error(`${file}: ffmpeg failed (${code}): ${err.trim()}`)
  return meter.result()
}
