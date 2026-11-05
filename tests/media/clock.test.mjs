// @ts-check
/**
 * The virtual clock's boot phase, on a stand-in for the page: a real page takes as long to load
 * as the machine allows, and that must not reach the game's time.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installClock } from '../../src/media/clock.mjs'

const FRAME_MS = 1000 / 60
const BOOT_FRAMES = 3

const realNow = performance.now
const realDateNow = Date.now

/** A page with the clock installed; `pump()` is one real browser frame. @param {string} readyState */
function page(readyState) {
  /** @type {FrameRequestCallback[]} */
  let frames = []
  /** @type {any} */
  const win = {
    requestAnimationFrame: (/** @type {FrameRequestCallback} */ cb) => frames.push(cb),
  }
  const doc = { readyState }
  vi.stubGlobal('window', win)
  vi.stubGlobal('document', doc)
  installClock({
    fps: 60,
    seed: null,
    skip: 1,
    bootFrames: BOOT_FRAMES,
    debugGlobal: null,
    hold: 'ready',
    ready: null,
    state: null,
    keyTarget: 'window',
    canvas: 'canvas',
    grab: 'canvas',
    format: 'jpeg',
    quality: 0.9,
    binding: 'grab',
  })
  const pump = () => {
    const due = frames
    frames = []
    for (const cb of due) cb(0)
  }
  return { win, doc, pump }
}

/** A game's own time once the clock holds, when its script ran `loadFrames` real frames in. */
function gameTimeAtHold(/** @type {number} */ loadFrames) {
  const { win, pump } = page('loading')
  for (let i = 0; i < loadFrames; i++) pump()
  const t0 = performance.now()
  let t = 0
  const frame = (/** @type {number} */ now) => {
    t = now - t0
    win.requestAnimationFrame(frame)
  }
  win.requestAnimationFrame(frame)
  for (let i = 0; i < 10; i++) pump()
  return t
}

afterEach(() => {
  vi.unstubAllGlobals()
  performance.now = realNow
  Date.now = realDateNow
})

describe('the clock during boot', () => {
  it('counts no frames while the page loads and no game has asked for one', () => {
    const { win, pump } = page('interactive')
    for (let i = 0; i < 50; i++) pump()
    expect(win.__ummClock.frames).toBe(0)
  })

  it('gives a game the same time however long its script took to arrive', () => {
    expect(gameTimeAtHold(500)).toBeCloseTo(gameTimeAtHold(0), 6)
    expect(gameTimeAtHold(0)).toBeCloseTo(BOOT_FRAMES * FRAME_MS, 3)
  })

  it('starts on the first frame a game asks for, before the page has finished loading', () => {
    const { win, pump } = page('loading')
    win.requestAnimationFrame(() => {})
    pump()
    pump() // nothing pending and still loading: time waits again
    expect(win.__ummClock.frames).toBe(1)
  })

  it('still reaches hold on a page that never asks for a frame', () => {
    const { win, doc, pump } = page('loading')
    pump()
    doc.readyState = 'complete'
    for (let i = 0; i < BOOT_FRAMES; i++) pump()
    expect(win.__ummClock.frames).toBe(BOOT_FRAMES)
    expect(win.__ummClock.mode).toBe('hold')
  })
})
