import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkAsset, checkKit, loadPreset, PRESETS, validatePreset } from '../../src/media/spec.mjs'

/**
 * @param {Partial<import('../../src/media/util.mjs').Probe> & { v?: object }} o
 * @returns {import('../../src/media/util.mjs').Probe}
 */
const probe = ({ v, ...o }) => ({
  file: '/kit/x',
  bytes: 1e6,
  format: 'mov,mp4,m4a,3gp,3g2,mj2',
  duration: 17,
  audio: [],
  ...o,
  video: {
    codec: 'h264',
    width: 1920,
    height: 1080,
    pixFmt: 'yuv420p',
    fps: 60,
    frames: 1020,
    ...v,
  },
})

const crazy = loadPreset('crazygames')

describe('presets', () => {
  it('every preset in presets/ is valid', () => {
    for (const f of fs.readdirSync(PRESETS).filter((f) => f.endsWith('.json'))) {
      const p = JSON.parse(fs.readFileSync(path.join(PRESETS, f), 'utf8'))
      expect(validatePreset(p), f).toEqual([])
    }
  })

  it('names the known presets when one is missing', () => {
    expect(() => loadPreset('no-such-portal')).toThrow(/use one of .*crazygames/)
  })

  it('reports a malformed preset', () => {
    expect(validatePreset({ name: 'x', assets: { a: { kind: 'gif', size: [1] } } })).toEqual([
      'a: "kind" must be image or video',
      'a: "size" must be a pair of numbers',
    ])
  })
})

describe('checkAsset', () => {
  const video = crazy.assets['preview-landscape']
  const cover = crazy.assets['cover-portrait']

  it('passes a preview that meets the spec', () => {
    expect(checkAsset(probe({}), video)).toEqual([])
  })

  it('fails a preview on size, length, sound, weight and codec', () => {
    const p = probe({
      duration: 21,
      bytes: 60e6,
      audio: [{ codec: 'aac' }],
      v: { width: 1280, height: 720, codec: 'hevc' },
    })
    expect(checkAsset(p, video)).toEqual([
      'is 1280x720, must be 1920x1080',
      'is 60.0 MB, over 50 MB: raise the edit list\'s "crf"',
      'runs 21.00 s, must be 15 to 20 s',
      'has an audio track, must be silent: drop "music" from the edit list',
      'is hevc, must be h264',
    ])
  })

  it('allows a hair of rounding on the length', () => {
    expect(checkAsset(probe({ duration: 20.016 }), video)).toEqual([])
  })

  it('checks an image’s size and format', () => {
    const png = probe({ duration: null, v: { codec: 'png', width: 800, height: 1200 } })
    expect(checkAsset(png, cover)).toEqual([])
    const gif = probe({ duration: null, v: { codec: 'gif', width: 800, height: 800 } })
    expect(checkAsset(gif, cover)).toEqual([
      'is 800x800, must be 800x1200',
      'is gif, must be png or jpg',
    ])
  })

  it('checks a minimum size and a frame rate', () => {
    expect(
      checkAsset(probe({ v: { width: 600, fps: 30 } }), {
        kind: 'video',
        minSize: [640, 360],
        fps: 60,
      }),
    ).toEqual(['is 600x1080, must be at least 640x360', 'runs at 30.00 fps, must be 60'])
  })
})

describe('checkKit', () => {
  it('lists every preset asset, fails on a missing required one', () => {
    const png = (/** @type {number} */ w, /** @type {number} */ h) =>
      probe({ file: `/kit/c-${w}.png`, duration: null, v: { codec: 'png', width: w, height: h } })
    const { ok, lines } = checkKit(crazy, {
      'cover-landscape': png(1920, 1080),
      'cover-portrait': png(800, 1200),
      'preview-landscape': probe({ file: '/kit/p.mp4' }),
      extra: png(10, 10),
    })
    expect(ok).toBe(false)
    expect(lines).toEqual([
      'ok       cover-landscape: c-1920.png',
      'ok       cover-portrait: c-800.png',
      'MISSING  cover-square (required)',
      'ok       preview-landscape: p.mp4',
      'skipped  preview-portrait',
      '??       extra: the preset has no spec of that id',
    ])
  })
})
