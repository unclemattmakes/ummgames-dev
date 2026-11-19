/** `@ummgames/dev/stats`: days, the pull, reading days back and grouping sessions. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  daysOf,
  median,
  parseReportArgs,
  pullDays,
  readDays,
  sessionsOf,
  table,
  tally,
} from '../../src/stats/index.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'umm-dev-stats-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

describe('parseReportArgs and daysOf', () => {
  it('reads the shared flags and leaves the rest', () => {
    expect(
      parseReportArgs([
        '2026-11-01..2026-11-03',
        '--site',
        'portal',
        '--no-pull',
        '--json',
        '--wide',
      ]),
    ).toEqual({
      range: '2026-11-01..2026-11-03',
      days: null,
      sites: ['portal'],
      all: false,
      pull: false,
      json: true,
      rest: ['--wide'],
    })
  })
  const today = new Date(Date.UTC(2026, 10, 19, 3))
  it('covers today, a range and the last N days', () => {
    expect(daysOf({ today })).toEqual(['2026-11-19'])
    expect(daysOf({ range: '2026-10-30..2026-11-02' })).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ])
    expect(daysOf({ days: 3, today })).toEqual(['2026-11-17', '2026-11-18', '2026-11-19'])
  })
  it('throws on a bad day or count', () => {
    expect(() => daysOf({ range: 'yesterday' })).toThrow(/YYYY-MM-DD/)
    expect(() => daysOf({ days: 0 })).toThrow(/whole number/)
  })
})

describe('pullDays and readDays', () => {
  it('copies only the days the bucket has, then reads them back', () => {
    /** @type {string[][]} */
    const calls = []
    const pulled = pullDays({
      remote: 'r2:bucket',
      cache: tmp,
      days: ['2026-11-18', '2026-11-19'],
      run: (cmd, args) => {
        calls.push([cmd, ...args])
        if (args[0] === 'lsf') return '2026-11-17/\n2026-11-19/\n'
        const dir = path.join(/** @type {string} */ (args[2]), 's1')
        fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(path.join(dir, '0000.json'), '{"n":1}')
        return ''
      },
    })
    expect(pulled).toEqual(['2026-11-19'])
    expect(calls[1]).toEqual([
      'rclone',
      'copy',
      'r2:bucket/2026-11-19',
      path.join(tmp, '2026-11-19'),
    ])
    expect(readDays(tmp, ['2026-11-18', '2026-11-19'])).toEqual([{ n: 1 }])
  })
})

describe('sessionsOf', () => {
  /** @param {string} sid @param {number} seq @param {string} site @param {number[]} ts */
  const kept = (sid, seq, site, ts) => ({
    sid,
    seq,
    build: 'b',
    site,
    browser: 'chrome',
    events: ts.map((t, i) => ({ e: 'x', t, dev: i === ts.length - 1 ? 'touch' : 'mouse' })),
  })
  const raw = [
    kept('a', 1, 'portal', [9]),
    kept('a', 0, 'portal', [1, 5]),
    kept('b', 0, 'site', [2]),
    'junk',
  ]
  /** @param {unknown} r */
  const parse = (r) => (typeof r === 'object' && r !== null ? /** @type {any} */ (r) : null)

  it('groups by session in time order, counts refusals and keeps to the sites asked', () => {
    const { sessions, rejected } = sessionsOf(raw, { parse, sites: ['portal'] })
    expect(rejected).toBe(1)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.events.map((/** @type {{ t: number }} */ e) => e.t)).toEqual([1, 5, 9])
    expect(sessions[0]?.device).toBe('touch')
    expect(sessionsOf(raw, { parse, sites: null }).sessions).toHaveLength(2)
  })
})

describe('median, tally and table', () => {
  it('sums', () => {
    expect(median([])).toBeNull()
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 2, 3])).toBe(2.5)
    expect(tally(['a', 'b', 'a'])).toEqual({ a: 2, b: 1 })
  })
  it('pads a table', () => {
    expect(
      table(
        ['room', 'n'],
        [
          ['one', 12],
          ['three', null],
        ],
      ),
    ).toBe('room    n\none    12\nthree   -')
  })
})
