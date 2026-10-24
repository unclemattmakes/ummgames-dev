// @ts-check
/**
 * Are two captures of one shot the same footage? Compares the frame count, every frame's
 * sha256 and, when both have one, the per-frame state log (states.jsonl). Pixels can differ
 * while the state agrees (GPU scheduling, a texture that streamed in a frame later); the report
 * says which diverged, and from which frame.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { listFrames } from './util.mjs'

/** @param {string} f */
const sha = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex')

/** @param {string} dir */
function states(dir) {
  const f = path.join(dir, 'states.jsonl')
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : null
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {{ same: boolean, lines: string[] }}
 */
export function compareCaptures(a, b) {
  const fa = listFrames(a)
  const fb = listFrames(b)
  const n = Math.min(fa.length, fb.length)
  let firstPixel = -1
  let samePixels = 0
  for (let i = 0; i < n; i++) {
    if (sha(path.join(a, fa[i])) === sha(path.join(b, fb[i]))) samePixels++
    else if (firstPixel < 0) firstPixel = i
  }
  const lines = [
    `frames: ${fa.length} vs ${fb.length}`,
    `pixels: ${samePixels}/${n} frames bit-identical${firstPixel >= 0 ? `, first difference at frame ${firstPixel}` : ''}`,
  ]
  const sa = states(a)
  const sb = states(b)
  let sameStates = true
  if (sa && sb) {
    let first = -1
    let same = 0
    const m = Math.min(sa.length, sb.length)
    for (let i = 0; i < m; i++) {
      if (sa[i] === sb[i]) same++
      else if (first < 0) first = i
    }
    sameStates = same === m && sa.length === sb.length
    lines.push(
      `state: ${same}/${m} frames identical${first >= 0 ? `, first difference at frame ${first}` : ''}`,
    )
  } else lines.push('state: no states.jsonl on both sides (set capture.state to log one)')
  const same = fa.length === fb.length && samePixels === n && sameStates
  return { same, lines }
}
