/** `@ummgames/dev/playtest`: the cast, the attention loop, the report and the two probes, on a fake sim. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ARCHETYPES,
  ablationVariants,
  cast,
  day1Odds,
  deadStretches,
  formatDeadStretches,
  formatReport,
  formatVerbAblation,
  MODEL,
  playDay,
  playtestEnv,
  runPlaytest,
  verbAblation,
} from '../../src/playtest/index.mjs'

/** @typedef {import('../../src/playtest/index.d.ts').Persona} Persona */
/** @typedef {{ t: number, run: number, shield: boolean, out: string[], length: number }} FakeRun */
/** @typedef {{ coins: number }} FakeMeta */

/** @type {import('../../src/playtest/index.d.ts').VerbTable} */
const VERBS = { core: 'tap', later: { shield: 30, dash: { at: 10, mobile: 2 } } }

/**
 * A fake sim on a 0.25 s step, so every time is exact. A run lasts `length` seconds (`shielded`
 * with the shield on) and is won with the shield on. `pingAt` says when a 'ping' moment lands.
 * @param {{ length?: number, shielded?: number, pingAt?: (t: number) => boolean, between?: (ctx: any) => number }} [o]
 * @returns {import('../../src/playtest/index.d.ts').PlaytestAdapter<FakeRun, FakeMeta>}
 */
const fake = (o = {}) => ({
  dt: 0.25,
  verbs: VERBS,
  momentValues: { ping: 0.1 },
  milestones: [{ name: 'first ping', moments: ['ping'], short: 'P' }],
  labels: { lost: 'crashed', between: 'shop' },
  meta: () => ({ coins: 0 }),
  start: ({ run }) => ({ t: 0, run, shield: false, out: [], length: o.length ?? 30 }),
  knobs: (s, v) => {
    s.shield = v.has('shield')
  },
  step: (s) => {
    s.t += 0.25
    if (o.pingAt?.(s.t)) s.out.push('ping')
  },
  moments: (s) => s.out.splice(0),
  over: (s) => s.t >= (s.shield && o.shielded ? o.shielded : s.length),
  won: (s) => s.shield,
  between:
    o.between ??
    (({ meta }) => {
      meta.coins += 10
      return 1
    }),
  summary: (s) => ({ length: s.t }),
})

/**
 * A desktop player with a good frame rate who never misclicks the way these tests run.
 * @param {Partial<Persona>} [over]
 * @returns {Persona}
 */
const person = (over = {}) => ({
  id: 0,
  name: 'Test P.',
  age: 20,
  archetype: 'test',
  device: 'desktop',
  fps: 'good',
  skill: 0.5,
  learn: { tap: 0, shield: Number.POSITIVE_INFINITY, dash: Number.POSITIVE_INFINITY },
  loadPatience: 100,
  hook: 0.5,
  boredom: 1 / 64,
  gapTolerance: 1000,
  delight: 1,
  loseQuit: 0,
  betweenLeave: 0,
  budget: 60,
  d1: 0.05,
  ...over,
})

/** No misclicks, so a day's first draws never end it. */
const sure = { model: { misclickDesktop: 0 } }

describe('cast', () => {
  it('is the same people for the same seed, and others for another', () => {
    const a = cast({ players: 50, seed: 7, verbs: VERBS })
    expect(cast({ players: 50, seed: 7, verbs: VERBS })).toEqual(a)
    expect(cast({ players: 50, seed: 8, verbs: VERBS })).not.toEqual(a)
    expect(a.map((p) => p.id)).toEqual([...Array(50).keys()])
  })

  it('draws archetypes by weight and keeps their devices', () => {
    const people = cast({ players: 6000, seed: 1, verbs: VERBS })
    const total = ARCHETYPES.reduce((s, a) => s + a.weight, 0)
    for (const a of ARCHETYPES) {
      const mine = people.filter((p) => p.archetype === a.name)
      expect(mine.length / people.length, a.name).toBeCloseTo(a.weight / total, 1)
      if (a.device !== 'either')
        expect(
          mine.every((p) => p.device === a.device),
          a.name,
        ).toBe(true)
    }
    const either = people.filter(
      (p) => ARCHETYPES.find((a) => a.name === p.archetype)?.device === 'either',
    )
    expect(either.filter((p) => p.device === 'mobile').length / either.length).toBeCloseTo(0.45, 1)
  })

  it('never draws a weight of 0, and keeps every number inside its range', () => {
    const base = /** @type {import('../../src/playtest/index.d.ts').Archetype} */ (ARCHETYPES[0])
    /** @type {import('../../src/playtest/index.d.ts').Archetype[]} */
    const archetypes = [
      { ...base, name: 'never', weight: 0 },
      { ...base, name: 'sure', weight: 1, coreNever: 0, verbNever: 0, learnPace: [1, 1] },
    ]
    const people = cast({ players: 300, seed: 3, verbs: VERBS, archetypes })
    expect(people.every((p) => p.archetype === 'sure')).toBe(true)
    for (const p of people) {
      expect(p.learn.tap).toBeGreaterThanOrEqual(base.coreAt[0])
      expect(p.learn.tap).toBeLessThan(base.coreAt[1])
      expect(p.learn.shield).toBeGreaterThanOrEqual(30 * 0.8)
      expect(p.learn.shield).toBeLessThan(30 * 1.4)
      // The phone stretch: 2x for dash on a phone.
      const dash = p.device === 'mobile' ? 20 : 10
      expect(p.learn.dash).toBeGreaterThanOrEqual(dash * 0.8)
      expect(p.learn.dash).toBeLessThan(dash * 1.4)
      expect(p.skill).toBeGreaterThanOrEqual(base.skill[0])
      expect(p.skill).toBeLessThan(base.skill[1])
      expect(p.loadPatience).toBeGreaterThanOrEqual(p.device === 'mobile' ? 3 : 4)
    }
  })

  it('marks a verb never found as Infinity', () => {
    const base = /** @type {import('../../src/playtest/index.d.ts').Archetype} */ (ARCHETYPES[0])
    const archetypes = [{ ...base, coreNever: 1, verbNever: 1 }]
    for (const p of cast({ players: 20, seed: 1, verbs: VERBS, archetypes }))
      expect(Object.values(p.learn)).toEqual([Infinity, Infinity, Infinity])
  })

  it('draws no core verb when the game has none', () => {
    const [p] = cast({ players: 1, seed: 1, verbs: { later: { jump: 5 } } })
    expect(Object.keys(p?.learn ?? {})).toEqual(['jump'])
  })
})

describe('the attention loop', () => {
  it('drains interest each second with nothing happening', () => {
    // 0.5 at 1/64 a second: gone at 32 s.
    const day = playDay(fake({ length: 1000 }), person(), 1, sure)
    expect(day.why).toBe('bored')
    expect(day.played).toBe(32)
    expect(day.runLog).toEqual([{ n: 1, t: 32, end: 'left', gap: 32, info: { length: 32 } }])
    expect(day.at).toBe('run 1, 0:32 in')
  })

  it('doubles the drain past the gap tolerance, and scales it by frame rate and BOREDOM', () => {
    // 10 s at 1/64, then 0.34375 at 2/64: 11 s more.
    expect(playDay(fake({ length: 1000 }), person({ gapTolerance: 10 }), 1, sure).played).toBe(21)
    const poor = { model: { misclickDesktop: 0, fpsDrag: { good: 1, ok: 1, poor: 2 } } }
    expect(playDay(fake({ length: 1000 }), person({ fps: 'poor' }), 1, poor).played).toBe(16)
    expect(playDay(fake({ length: 1000 }), person(), 1, { ...sure, boredom: 0.5 }).played).toBe(64)
    expect(MODEL.fpsDrag).toEqual({ good: 1, ok: 1.1, poor: 1.4 })
  })

  it('restores interest on a moment, worth 0.9^n of itself the nth time, never under a quarter', () => {
    const adapter = fake({ length: 1000, pingAt: (t) => t % 1 === 0 })
    const day = playDay(adapter, person({ boredom: 0.05 }), 1, {
      model: { misclickDesktop: 0, traceEvery: 1 },
    })
    let interest = 0.5
    /** @type {number[]} */
    const want = []
    for (let n = 0; interest > 0; n++) {
      interest = Math.min(1.2, interest + 0.1 * Math.max(0.25, 0.9 ** n))
      interest -= 0.05
      want.push(Math.max(0, interest))
    }
    expect(day.trace.length).toBe(want.length)
    day.trace.forEach((v, i) => {
      expect(v).toBeCloseTo(/** @type {number} */ (want[i]), 10)
    })
    expect(day.milestones).toEqual({ 'first ping': 1 })
  })

  it('leaves on a black page or a misclick before playing', () => {
    expect(playDay(fake(), person({ loadPatience: 0 }), 1).why).toBe('load')
    const day = playDay(fake(), person(), 1, { model: { misclickDesktop: 1 } })
    expect([day.why, day.played, day.runs]).toEqual(['misclick', 0, 0])
  })

  it('quits on a lost run, using the label', () => {
    const day = playDay(fake(), person({ loseQuit: 1, boredom: 1 / 1024 }), 1, {
      model: { misclickDesktop: 0, lossQuitCap: 1 },
    })
    expect([day.why, day.losses, day.between, day.at]).toEqual([
      'lost',
      1,
      false,
      'run 1, crashed at 0:30',
    ])
  })

  it('leaves at the between-runs screen', () => {
    const day = playDay(fake(), person({ betweenLeave: 1, boredom: 1 / 1024 }), 1, sure)
    expect([day.why, day.between, day.continued, day.at]).toEqual([
      'between',
      true,
      false,
      'shop after run 1, 1 bought',
    ])
  })

  it('turns a verb on once it is learnt, and stops when the minutes are up', () => {
    // Run 1 is lost at 30 s with no shield; the shop takes 20 s; run 2 starts at 50 with it.
    /** @type {number[]} */
    const coins = []
    const adapter = fake({
      between: ({ meta }) => {
        meta.coins += 10
        coins.push(meta.coins)
        return 1
      },
    })
    const p = person({ budget: 1, boredom: 1 / 1024, learn: { tap: 0, shield: 40, dash: 0 } })
    const day = playDay(adapter, p, 1, sure)
    expect(day.runLog.map((r) => r.end)).toEqual(['lost', 'won'])
    expect([day.why, day.at, day.played, day.continued, day.losses]).toEqual([
      'done',
      'after run 2, a win',
      80,
      true,
      1,
    ])
    // The meta carries over between runs.
    expect(coins).toEqual([10])
  })

  it('works out Day 1 odds from the day', () => {
    const base = playDay(fake(), person({ loseQuit: 1, boredom: 1 / 1024 }), 1, {
      model: { misclickDesktop: 0, lossQuitCap: 1 },
    })
    // No between screen x0.5, under 3 min x0.6, lost x0.8.
    expect(base.d1).toBeCloseTo(0.05 * 0.5 * 0.6 * 0.8, 12)
    expect(day1Odds({ ...base, between: true, played: 600, why: 'done' })).toBeCloseTo(
      0.05 * 2 * 1.4 * 1.25,
      12,
    )
  })
})

describe('runPlaytest and the report', () => {
  const adapter = fake({ length: 90, pingAt: (t) => t % 7 === 0 })

  it('is the same for the same seed', () => {
    const a = runPlaytest(adapter, { players: 30, seed: 4 })
    expect(runPlaytest(adapter, { players: 30, seed: 4 })).toEqual(a)
    expect(a.days).toHaveLength(30)
    expect(JSON.parse(JSON.stringify(a)).days[0].persona.name).toBe(a.days[0]?.persona.name)
  })

  it('prints every section, in the words the game gave it', () => {
    const text = formatReport(runPlaytest(adapter, { players: 60, seed: 2 }), adapter)
    for (const s of [
      'Simulated playtest, cast 2, 60 players, boredom x1',
      'desktop: ',
      'mobile: ',
      'all: 60 players',
      'Why they left',
      'Left bored: when, by session minute',
      'By archetype',
      'Runs: how they went',
      'run 1: ',
      'first ping: ',
      'Mean interest of those still playing, every 30 s',
      ' shop ',
      ' crashed',
      '  P ',
    ])
      expect(text, s).toContain(s)
  })

  it('reads PLAYERS, CAST and BOREDOM', () => {
    expect(playtestEnv({})).toEqual({ players: 100, seed: 1, boredom: 1 })
    expect(playtestEnv({ PLAYERS: '20', CAST: '3', BOREDOM: '0.6' })).toEqual({
      players: 20,
      seed: 3,
      boredom: 0.6,
    })
    expect(() => playtestEnv({ CAST: 'x' })).toThrow(/CAST/)
  })
})

describe('the probes', () => {
  it('finds stretches with no moment', () => {
    const adapter = fake({ length: 40, pingAt: (t) => t === 5 || t === 20 || t === 22 })
    const [s] = deadStretches(adapter, { skills: [0.5], runs: 1 })
    expect(s?.runs[0]).toMatchObject({
      run: 1,
      t: 40,
      end: 'won',
      moments: { ping: 3 },
      gaps: [{ at: 5, length: 15 }],
      tail: 18,
      bought: 1,
    })
    expect(formatDeadStretches(deadStretches(adapter, { skills: [0.5], runs: 1 }))).toContain(
      'stretches of 12 s+ with none: 0:05+15s; then 18 s to the end',
    )
  })

  it('turns verbs off one at a time', () => {
    expect(ablationVariants(VERBS)).toEqual({
      'every verb': [],
      'no shield': ['shield'],
      'no dash': ['dash'],
      'only tap': ['shield', 'dash'],
    })
    const rows = verbAblation(fake({ length: 20, shielded: 60 }), { skills: [0.5], seeds: 3 })
    const by = Object.fromEntries(rows.map((r) => [r.variant, r]))
    expect(by['every verb']).toMatchObject({ median: 60, short: 3, lost: 0 })
    expect(by['no shield']).toMatchObject({ median: 20, shortest: 20, lost: 3 })
    expect(by['no dash']?.median).toBe(60)
    expect(formatVerbAblation(rows)).toContain('no shield   run 2 lasts median 0:20')
  })
})

it('keeps the core free of node APIs', () => {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/playtest')
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.mjs'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8')
    expect(src, f).not.toMatch(/from '(node:|fs|path|os|child_process)/)
    expect(src, f).not.toMatch(/\b(process|document|window)\./)
  }
})
