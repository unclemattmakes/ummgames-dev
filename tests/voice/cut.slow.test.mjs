/**
 * The ffmpeg half of `@ummgames/dev/voice`: ffmpeg makes takes with known ends, and the cuts are
 * read back with ffprobe.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { cut, shipSung, soundEnds } from '../../src/voice/index.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'umm-dev-voice-cut-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

/** @param {string} name @param {string} source lavfi graph */
function make(name, source) {
  const file = path.join(tmp, name)
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', source, file])
  return file
}

/** @param {string} file */
const probe = (file) =>
  JSON.parse(
    execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'stream=channels,sample_rate:format=duration',
        '-of',
        'json',
        file,
      ],
      { encoding: 'utf8' },
    ),
  )

// A tone for 1.5 s, then 1.5 s of silence.
const TONE_THEN_SILENCE =
  'aevalsrc=if(lt(t\\,1.5)\\,0.3*sin(2*PI*440*t)\\,0)|if(lt(t\\,1.5)\\,0.3*sin(2*PI*440*t)\\,0):s=44100:d=3'

describe('cut', () => {
  it('cuts a mono 22050 Hz piece and reports its length', () => {
    const take = make('take.mp3', 'sine=f=440:d=3:sample_rate=44100')
    const bytes = cut(take, 0.5, 1.5)
    const out = path.join(tmp, 'piece.mp3')
    fs.writeFileSync(out, bytes)
    const p = probe(out)
    expect(p.streams[0].channels).toBe(1)
    expect(p.streams[0].sample_rate).toBe('22050')
    expect(cut.seconds).toBeGreaterThan(0.95)
    expect(cut.seconds).toBeLessThan(1.1)
  })

  it('runs its filters after the fades', () => {
    const take = make('take2.mp3', 'sine=f=440:d=3:sample_rate=44100')
    cut(take, 0, 2, ['atempo=2'])
    expect(cut.seconds).toBeGreaterThan(0.95)
    expect(cut.seconds).toBeLessThan(1.1)
  })
})

describe('soundEnds', () => {
  it('finds where a tone stops, not where the file does', () => {
    const wav = make('tail.wav', TONE_THEN_SILENCE)
    expect(soundEnds(wav)).toBeCloseTo(1.5, 1)
  })

  it('reads silence as 0', () => {
    expect(soundEnds(make('silence.wav', 'anullsrc=r=44100:cl=stereo:d=1'))).toBe(0)
  })
})

describe('shipSung', () => {
  it('encodes the take and returns its seconds to the end of its sound', () => {
    const src = make('jingle.wav', TONE_THEN_SILENCE)
    const dest = path.join(tmp, 'out', 'jingle.mp3')
    const r = shipSung(src, dest)
    expect(r.file).toBe(dest)
    expect(r.seconds).toBeCloseTo(1.5, 1)
    expect(Number(probe(dest).format.duration)).toBeGreaterThan(2.9)
  })

  it('cuts the silent tail with trim', () => {
    const src = make('jingle2.wav', TONE_THEN_SILENCE)
    const dest = path.join(tmp, 'jingle2.mp3')
    const r = shipSung(src, dest, { trim: true })
    expect(r.seconds).toBeCloseTo(1.5, 1)
    expect(Number(probe(dest).format.duration)).toBeLessThan(1.7)
  })
})
