import { describe, expect, it } from 'vitest'
import { cutLength, validateEdl } from '../../src/media/edl.mjs'

const ok = () => ({
  size: [1920, 1080],
  cover: { file: 'cover.png', hold: 0.8 },
  shots: [
    { clip: 'a', in: 0, dur: 2, dissolve: 0.5, beat: 'what it shows' },
    { clip: 'b', in: 1.5, dur: 2 },
    { clip: 'c', in: 0, dur: 3, wipeFrom: 'd', wipeAt: 2, wipe: 1 },
  ],
  fadeIn: 0.5,
  fadeOut: 1,
  $comment: 'comments are allowed',
})

/** @param {unknown} edl @param {{ font?: string }} [opts] */
const errs = (edl, opts) => validateEdl(edl, opts)

describe('validateEdl', () => {
  it('accepts a full edit list', () => {
    expect(errs(ok())).toEqual([])
  })

  it('needs an object with shots', () => {
    expect(errs([])).toEqual(['the edit list must be a JSON object with a "shots" array'])
    expect(errs({})).toContain('"shots" must be a non-empty array')
    expect(errs({ shots: [] })).toContain('"shots" must be a non-empty array')
  })

  it('names unknown fields, at the top and in a shot', () => {
    const e = errs({ ...ok(), fadeout: 1, shots: [{ clip: 'a', in: 0, dur: 1, durr: 2 }] })
    expect(e).toContain('unknown field "fadeout" (see docs/media.md)')
    expect(e).toContain('shots[0] (a): unknown field "durr"')
  })

  it('checks a shot’s clip, in and dur', () => {
    const e = errs({ shots: [{ in: -1, dur: 0 }] })
    expect(e).toContain('shots[0]: "clip" must name a captured clip')
    expect(e).toContain('shots[0]: "in" must be game seconds >= 0')
    expect(e).toContain('shots[0]: "dur" must be seconds > 0')
  })

  it('wants an even output size', () => {
    expect(errs({ ...ok(), size: [1081, 1920] })).toContain(
      '"size" must be even on both sides (x264 at yuv420p)',
    )
    expect(errs({ ...ok(), size: [1920] })).toContain('"size" must be [width, height] in px')
  })

  it('keeps dissolves inside both shots, and off a first shot with no cover', () => {
    const first = errs({ shots: [{ clip: 'a', in: 0, dur: 2, dissolve: 0.5 }] })
    expect(first[0]).toMatch(/nothing to dissolve from/)
    const long = errs({
      shots: [
        { clip: 'a', in: 0, dur: 1 },
        { clip: 'b', in: 0, dur: 3, dissolve: 1 },
      ],
    })
    expect(long).toContain('shots[1] (b): "dissolve" must be shorter than the shot before it')
  })

  it('checks a wipe', () => {
    const e = errs({ shots: [{ clip: 'a', in: 0, dur: 2, wipeFrom: 'b', wipe: 1, speed: 2 }] })
    expect(e).toContain('shots[0] (a): a wipe needs "wipeAt", seconds into the shot')
    expect(e).toContain('shots[0] (a): a wipe plays at speed 1, forwards')
    expect(errs({ shots: [{ clip: 'a', in: 0, dur: 2, wipeFrom: 'b', wipeAt: 0.5 }] })).toContain(
      'shots[0] (a): "wipeAt" must be between "wipe" (1) and "dur"',
    )
    expect(errs({ shots: [{ clip: 'a', in: 0, dur: 2, wipeAt: 1 }] })).toContain(
      'shots[0] (a): "wipeAt", "wipe" and "transition" need "wipeFrom"',
    )
  })

  it('wants a font for cards, from the edit list or the command line', () => {
    const edl = { ...ok(), cards: [{ text: 'Hello', at: 1, to: 2 }] }
    expect(errs(edl)).toContain(
      'cards need a font: set "font" to a .ttf or .otf file, or pass --font',
    )
    expect(errs(edl, { font: 'some.ttf' })).toEqual([])
    expect(errs({ ...edl, font: 'some.ttf' })).toEqual([])
  })

  it('checks overlays and music', () => {
    const e = errs({
      ...ok(),
      overlays: [{ file: 'logo.png', at: 2, to: 1, w: 0, x: 0 }],
      music: { file: 'm.opus', ranges: [[5, 4]] },
    })
    expect(e).toContain('overlays[0]: "at" and "to" must be seconds, at < to')
    expect(e).toContain('overlays[0]: "w" must be its width in output px')
    expect(e).toContain('overlays[0]: "y" must be px or an expression')
    expect(e).toContain('"music.ranges" must be [[from, to], ...] in source seconds, from < to')
  })

  it('keeps fades and overlays inside the cut', () => {
    const short = { shots: [{ clip: 'a', in: 0, dur: 1 }], fadeIn: 0.6, fadeOut: 0.6 }
    expect(errs(short)[0]).toMatch(/longer than the cut \(1\.00 s\)/)
    const late = {
      shots: [{ clip: 'a', in: 0, dur: 1 }],
      overlays: [{ file: 'l.png', at: 0, to: 2, w: 10, x: 0, y: 0 }],
    }
    expect(errs(late)[0]).toMatch(/ends at 2 s, after the cut/)
  })
})

describe('cutLength', () => {
  it('sums the cover and shots less each dissolve', () => {
    // 0.8 cover + 2 - 0.5 + 2 + 3
    expect(cutLength(/** @type {any} */ (ok()))).toBeCloseTo(7.3)
  })
  it('ignores a first shot’s dissolve without a cover, and honours length', () => {
    expect(
      cutLength({
        shots: [
          { clip: 'a', in: 0, dur: 2, dissolve: 1 },
          { clip: 'b', in: 0, dur: 2, dissolve: 0.5 },
        ],
      }),
    ).toBeCloseTo(3.5)
    expect(cutLength({ length: 4, shots: [{ clip: 'a', in: 0, dur: 9 }] })).toBe(4)
  })
})
