// @ts-check
/**
 * `umm-dev perf top` and the self-time sum behind it, on a hand-made profile whose answer is
 * known: each sample's time is the gap to the next one, and the last runs to `endTime`.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { formatTop, selfTime } from '../../src/perf/profile.mjs'

const BIN = fileURLToPath(new URL('../../bin/umm-dev.mjs', import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'umm-perf-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

/** @param {string} functionName @param {string} url @param {number} lineNumber */
const frame = (functionName, url, lineNumber) => ({
  functionName,
  url,
  lineNumber,
  columnNumber: 0,
})

/** Times in microseconds. Samples: idle 1000, step 3000, step 2000, render 4000 (to endTime). */
const PROFILE = {
  nodes: [
    { id: 1, callFrame: frame('(root)', '', -1) },
    { id: 2, callFrame: frame('(idle)', '', -1) },
    { id: 3, callFrame: frame('step', 'http://localhost:4173/assets/sim/world.js?v=1', 41) },
    { id: 4, callFrame: frame('', 'http://localhost:4173/assets/render/view.js', 9) },
    { id: 5, callFrame: frame('step', 'http://localhost:4173/assets/sim/world.js', 41) },
  ],
  startTime: 1_000_000,
  endTime: 1_010_000,
  samples: [2, 3, 5, 4],
  timeDeltas: [0, 1000, 3000, 2000],
}

describe('selfTime', () => {
  it('sums each sample up to the next, one row per function and place, most first', () => {
    const { rows, totalMs } = selfTime(PROFILE)
    expect(totalMs).toBe(10)
    expect(rows.map((r) => [r.key, r.ms])).toEqual([
      ['step sim/world.js:42', 5],
      ['(anonymous) render/view.js:10', 4],
      ['(idle)', 1],
    ])
    expect(rows[0]?.share).toBe(0.5)
    expect(rows[2]).toMatchObject({ url: '', line: 0 })
  })

  it('formats the top n and a total', () => {
    const text = formatTop(selfTime(PROFILE), 2).split('\n')
    expect(text).toEqual([
      ' 50.0%       5.0 ms  step sim/world.js:42',
      ' 40.0%       4.0 ms  (anonymous) render/view.js:10',
      '100.0%      10.0 ms  total',
    ])
  })

  it('refuses something that is not a profile', () => {
    expect(() => selfTime(/** @type {any} */ ({ traceEvents: [] }))).toThrow(/not a CPU profile/)
  })
})

describe('umm-dev perf top', () => {
  const file = path.join(tmp, 'phone.cpuprofile')
  fs.writeFileSync(file, JSON.stringify(PROFILE))
  /** @param {string[]} args */
  const cli = (...args) =>
    spawnSync(process.execPath, [BIN, 'perf', ...args], { cwd: tmp, encoding: 'utf8' })

  it('prints the top n from a file relative to the folder it runs in', () => {
    const r = cli('top', 'phone.cpuprofile', '1')
    expect(r.status).toBe(0)
    expect(r.stdout.trimEnd().split('\n')).toEqual([
      ' 50.0%       5.0 ms  step sim/world.js:42',
      '100.0%      10.0 ms  total',
    ])
  })

  it('gives every row as JSON', () => {
    const r = cli('top', file, '--json')
    expect(r.status).toBe(0)
    expect(JSON.parse(r.stdout)).toMatchObject({
      totalMs: 10,
      rows: [{ ms: 5 }, { ms: 4 }, { ms: 1 }],
    })
  })

  it('exits 1 on a bad file and 64 on bad usage', () => {
    fs.writeFileSync(path.join(tmp, 'x.json'), '{}')
    expect(cli('top', 'x.json').status).toBe(1)
    expect(cli('top', 'missing.cpuprofile').status).toBe(1)
    expect(cli('top').status).toBe(64)
    expect(cli('bottom', file).status).toBe(64)
    expect(cli('top', file, 'ten').status).toBe(64)
  })
})
