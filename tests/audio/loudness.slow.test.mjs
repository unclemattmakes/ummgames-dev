/**
 * `umm-dev loudness` end to end: ffmpeg makes files with known answers, the command meters them,
 * and ffmpeg's own ebur128 filter is the second opinion on a signal with no easy answer.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { meterFile } from '../../src/audio/decode.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const BIN = path.join(ROOT, 'bin/umm-dev.mjs')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'umm-dev-loudness-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

/** @param {string} name @param {string} source lavfi graph @param {string[]} [extra] */
function make(name, source, extra = []) {
  const file = path.join(tmp, name)
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', source, ...extra, file])
  return file
}

/** @param {string[]} args */
function umm(...args) {
  try {
    return {
      code: 0,
      out: execFileSync(process.execPath, [BIN, ...args], { cwd: tmp, encoding: 'utf8' }),
    }
  } catch (e) {
    const err = /** @type {{ status: number, stdout: string, stderr: string }} */ (e)
    return { code: err.status, out: `${err.stdout}${err.stderr}` }
  }
}

// -20 dBFS is an amplitude of 0.1.
const SINE = 'aevalsrc=0.1*sin(2*PI*1000*t)|0.1*sin(2*PI*1000*t):s=48000:d=8'

describe('umm-dev loudness', () => {
  it('meters a stereo 1 kHz sine at -20 dBFS as -20 LUFS and -20 dBTP', async () => {
    const wav = make('sine.wav', SINE, ['-c:a', 'pcm_f32le'])
    const m = await meterFile(wav)
    expect(m.channels).toBe(2)
    expect(m.integrated).toBeCloseTo(-20, 1)
    expect(m.truePeak).toBeCloseTo(-20, 1)
    expect(m.momentaryMax).toBeCloseTo(-20, 1)

    const ok = umm('loudness', wav, '--target', '-20', '--tolerance', '0.5')
    expect(ok.code).toBe(0)
    expect(ok.out).toMatch(/-20\.0 +-20\.0 +-20\.0 +\S*sine\.wav/)
    const loud = umm('loudness', wav, '--target', '-14')
    expect(loud.code).toBe(1)
    expect(loud.out).toMatch(/out of range: integrated -20\.0 LUFS is not -14 ±1/)
    expect(umm('loudness', wav, '--max-peak', '-21').code).toBe(1)
  })

  it('meters silence as -inf, and fails any target', () => {
    const wav = make('silence.wav', 'anullsrc=r=44100:cl=mono', ['-t', '3'])
    const json = JSON.parse(umm('loudness', wav, '--json').out)
    expect(json[0]).toMatchObject({ integrated: null, truePeak: null, channels: 1, ok: true })
    expect(umm('loudness', wav, '--target', '-16').code).toBe(1)
  })

  it('agrees with ffmpeg’s ebur128 on noise through a compressed file', async () => {
    const file = make(
      'noise.ogg',
      'anoisesrc=d=10:c=pink:r=44100:a=0.3,volume=enable=between(t\\,3\\,6):volume=0.2',
      ['-ac', '2', '-c:a', 'libvorbis'],
    )
    const ours = await meterFile(file)
    const { stderr } = spawnSync(
      'ffmpeg',
      ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
      { encoding: 'utf8' },
    )
    const summary = stderr.slice(stderr.lastIndexOf('Summary:'))
    const theirs = (/** @type {RegExp} */ re) =>
      Number(/** @type {string[]} */ (re.exec(summary))[1])
    expect(ours.integrated).toBeCloseTo(theirs(/I:\s+(-?[\d.]+) LUFS/), 0)
    expect(Math.abs(ours.integrated - theirs(/I:\s+(-?[\d.]+) LUFS/))).toBeLessThan(0.1)
    expect(Math.abs(ours.truePeak - theirs(/Peak:\s+(-?[\d.]+) dBFS/))).toBeLessThan(0.2)
  })

  it('exits 2 on usage errors and unreadable files', () => {
    expect(umm('loudness').code).toBe(2)
    expect(umm('loudness', 'x.wav', '--target', 'loud').code).toBe(2)
    expect(umm('loudness', path.join(tmp, 'missing.wav')).code).toBe(2)
  })
})
