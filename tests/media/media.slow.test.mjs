/**
 * End to end: capture the fixture game (a 2D canvas served by Vite), cut it, loop it, and run
 * its store kit, checking every output with ffprobe. Needs ffmpeg and a Chromium.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as capture from '../../src/commands/capture.mjs'
import * as cut from '../../src/commands/cut.mjs'
import * as loop from '../../src/commands/loop.mjs'
import * as store from '../../src/commands/store.mjs'
import { probe } from '../../src/media/util.mjs'

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'game')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'umm-dev-media-e2e-'))
const game = path.join(tmp, 'game')
const cap = path.join(tmp, 'capture')
const FONT = [
  'C:/Windows/Fonts/arial.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/Library/Fonts/Arial.ttf',
].find((f) => fs.existsSync(f))

/** Run a command in the copied game, quietly; resolve to its exit code and what it said. */
async function umm(/** @type {{ run: Function }} */ cmd, /** @type {string[]} */ argv) {
  /** @type {string[]} */
  const said = []
  const out = vi.spyOn(console, 'log').mockImplementation((...a) => said.push(a.join(' ')))
  const err = vi.spyOn(console, 'error').mockImplementation((...a) => said.push(a.join(' ')))
  try {
    const code = await cmd.run(argv, { cwd: game })
    return { code, text: said.join('\n') }
  } finally {
    out.mockRestore()
    err.mockRestore()
  }
}

/** moov before mdat: the file plays before it has fully loaded. @param {string} f */
const faststart = (f) => {
  const b = fs.readFileSync(f)
  return b.indexOf('moov') < b.indexOf('mdat')
}

beforeAll(() => {
  fs.cpSync(FIXTURE, game, { recursive: true })
})
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

describe.sequential('capture, cut, loop, store', () => {
  it('captures a shot frame-exact, keys landing on their frame', async () => {
    const r = await umm(capture, ['move', '--sheet', '--out', cap])
    expect(r.code, r.text).toBe(0)
    expect(r.text).toContain('[move] 30 frames, 0 missing')
    const dir = path.join(cap, 'move')
    const mp4 = probe(path.join(dir, 'move.mp4'))
    expect(mp4.video).toMatchObject({ codec: 'h264', width: 320, height: 180, frames: 30 })
    expect(mp4.video?.fps).toBe(60)
    expect(mp4.video?.pixFmt).toBe('yuv420p')
    expect(fs.existsSync(path.join(dir, 'sheet.jpg'))).toBe(true)
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'))
    expect(meta).toMatchObject({ frames: 30, expected: 30, missing: 0, heldAtBootFrame: 20 })
    // Space at 0.3 s from tick 0 is game frame 18; the shot starts after frame 6 (from 0.1 s),
    // so grabbed frame 11 is the first red one.
    const states = fs
      .readFileSync(path.join(dir, 'states.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
    expect(states.findIndex((s) => s.color === 'red')).toBe(11)
  })

  it('captures the same footage twice', async () => {
    expect((await umm(capture, ['move', '--tag', 'again', '--out', cap])).code).toBe(0)
    const r = await umm(capture, [
      '--compare',
      path.join(cap, 'move'),
      path.join(cap, 'move@again'),
    ])
    expect(r.text).toContain('pixels: 30/30 frames bit-identical')
    expect(r.text).toContain('state: 30/30 frames identical')
    expect(r.code).toBe(0)
  })

  it('fails a shot whose expect is unmet, and says why', async () => {
    const shots = path.join(tmp, 'bad-shots.json')
    fs.writeFileSync(
      shots,
      JSON.stringify([
        { name: 'early', dur: 0.1, expect: "debug.color === 'red'", why: 'red by now' },
      ]),
    )
    const r = await umm(capture, ['early', '--file', shots, '--out', cap])
    expect(r.code).toBe(1)
    expect(r.text).toContain("expect false: debug.color === 'red'")
    expect(r.text).toContain('the frame is for: red by now')
  })

  it('cuts dissolves, a wipe, speed, reverse, a reframe, an overlay and a card', async () => {
    const edl = {
      clips: cap,
      size: [320, 180],
      out: path.join(tmp, 'out', 'cut.mp4'),
      fadeIn: 0.1,
      fadeOut: 0.1,
      shots: [
        { clip: 'move', in: 0, dur: 0.25 },
        { clip: 'move', in: 0.1, dur: 0.25, dissolve: 0.1, speed: 0.5 },
        { clip: 'move@again', wipeFrom: 'move', in: 0, dur: 0.3, wipeAt: 0.2, wipe: 0.1 },
        { clip: 'move', in: 0, dur: 0.2, reverse: true, crop: '160:90:0:45' },
      ],
      overlays: [
        { file: path.join(cap, 'move', 'f00000.jpg'), at: 0.1, to: 0.5, w: 64, x: 8, y: 8 },
      ],
      ...(FONT
        ? { font: FONT, cards: [{ text: "It's 100%: done", at: 0.2, to: 0.8, size: 20 }] }
        : {}),
    }
    const file = path.join(tmp, 'edl.json')
    fs.writeFileSync(file, JSON.stringify(edl))
    const r = await umm(cut, [file])
    expect(r.code, r.text).toBe(0)
    const p = probe(edl.out)
    expect(p.duration).toBeCloseTo(0.9, 2)
    expect(p.video).toMatchObject({ codec: 'h264', width: 320, height: 180, frames: 54 })
    expect(p.video?.pixFmt).toBe('yuv420p')
    expect(p.audio).toEqual([])
    expect(faststart(edl.out)).toBe(true)

    const printed = await umm(cut, [file, '--print'])
    expect(printed.code).toBe(0)
    expect(printed.text.match(/^ffmpeg /gm)).toHaveLength(5)
  })

  it('cuts a dissolve that follows a hard cut', async () => {
    const edl = {
      clips: cap,
      size: [320, 180],
      out: path.join(tmp, 'out', 'cut-then-dissolve.mp4'),
      shots: [
        { clip: 'move', in: 0, dur: 0.25 },
        { clip: 'move', in: 0.1, dur: 0.25 },
        { clip: 'move', in: 0, dur: 0.25, dissolve: 0.1 },
      ],
    }
    const file = path.join(tmp, 'edl-cut-then-dissolve.json')
    fs.writeFileSync(file, JSON.stringify(edl))
    const r = await umm(cut, [file])
    expect(r.code, r.text).toBe(0)
    expect(probe(edl.out).duration).toBeCloseTo(0.65, 2)
  })

  it('makes a silent faststart loop and a poster, never upscaled', async () => {
    const r = await umm(loop, [path.join(tmp, 'out', 'cut.mp4'), '--out', path.join(tmp, 'site')])
    expect(r.code, r.text).toBe(0)
    const mp4 = path.join(tmp, 'site', 'cut.mp4')
    const p = probe(mp4)
    expect(p.video).toMatchObject({ codec: 'h264', width: 320, height: 180, pixFmt: 'yuv420p' })
    expect(p.audio).toEqual([])
    expect(faststart(mp4)).toBe(true)
    const poster = probe(path.join(tmp, 'site', 'cut.poster.webp'))
    expect(poster.video).toMatchObject({ codec: 'webp', width: 320, height: 180 })
  })

  it('runs the store kit against its preset', async () => {
    const r = await umm(store, [])
    expect(r.code, r.text).toBe(0)
    expect(r.text).toContain('ok       cover-wide: cover-wide-320x180.png')
    expect(r.text).toContain('ok       preview: preview.mp4')
    const kit = path.join(game, 'dist-store')
    expect(probe(path.join(kit, 'icon-32x32.png')).video).toMatchObject({ width: 32, height: 32 })
    expect(probe(path.join(kit, 'preview.mp4')).duration).toBeCloseTo(1, 2)
    expect(probe(path.join(kit, 'review', 'preview-beats.jpg')).video).toMatchObject({
      width: 1280,
      height: 360,
    })
  })

  it('fails the kit when an output breaks the preset', async () => {
    const preset = JSON.parse(fs.readFileSync(path.join(game, 'tiny-portal.json'), 'utf8'))
    preset.assets.preview.seconds = [15, 20]
    fs.writeFileSync(path.join(game, 'tiny-portal.json'), JSON.stringify(preset))
    const r = await umm(store, ['--steps', 'check'])
    expect(r.code).toBe(1)
    expect(r.text).toContain('FAIL     preview: preview.mp4 runs 1.00 s, must be 15 to 20 s')
  })
})
