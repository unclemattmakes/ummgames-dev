// @ts-check
/**
 * A player's day: load, a misclick, then run after run of the game's own sim, with the
 * between-runs screen in between, until their attention or their time runs out. The attention
 * model drains interest each second (twice as fast in a drought, faster on a stuttering device)
 * and refills it on moments, each worth less every time it repeats.
 */
import { cast } from './cast.mjs'
import { mulberry32, range } from './rng.mjs'

/** @typedef {import('./index.d.ts').Persona} Persona */
/** @typedef {import('./index.d.ts').PlaytestDay} PlaytestDay */
/** @typedef {import('./index.d.ts').AttentionModel} AttentionModel */
/** @typedef {import('./index.d.ts').PlayerView} PlayerView */
/** @typedef {import('./index.d.ts').Milestone} Milestone */

/** @type {Readonly<AttentionModel>} */
export const MODEL = Object.freeze(
  /** @type {AttentionModel} */ ({
    loadDesktop: [0.9, 2.6],
    loadMobile: [1.8, 4.5],
    misclickDesktop: 0.05,
    misclickMobile: 0.08,
    interestCap: 1.2,
    habituation: 0.9,
    habituationFloor: 0.25,
    drought: 2,
    fpsDrag: { good: 1, ok: 1.1, poor: 1.4 },
    mobileHands: 1.3,
    poorFpsHands: 1.25,
    lossQuitCap: 0.95,
    earlyLoss: 120,
    earlyLossSting: 1.3,
    lossPenalty: 0.1,
    overtime: 180,
    betweenSeconds: 20,
    boughtLift: 0.08,
    nothingBoughtLeave: 0.15,
    traceEvery: 15,
    winMoment: 'runWin',
  }),
)

/** The labels a report and a day's `at` use, before a game's own. */
export const LABELS = Object.freeze({ lost: 'lost', between: 'between screen' })

/**
 * `m:ss`.
 * @param {number} t seconds
 */
export const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`

/**
 * Day 1 odds: the player's base odds, scaled by what today was. Reaching the between-runs screen
 * doubles it (it shows what tomorrow brings); a longer day raises it; leaving bored or on a loss
 * lowers it, and stopping because the time was up raises it.
 * @param {PlaytestDay} day
 */
export function day1Odds(day) {
  const minutes = day.played / 60
  return (
    day.persona.d1 *
    (day.between ? 2 : 0.5) *
    (minutes >= 8 ? 1.4 : minutes >= 3 ? 1 : 0.6) *
    (day.why === 'bored' ? 0.6 : day.why === 'lost' ? 0.8 : day.why === 'done' ? 1.25 : 1)
  )
}

/**
 * Whether moment `key` reaches milestone `m`.
 * @param {string} key
 * @param {Milestone} m
 */
export const reaches = (key, m) =>
  typeof m.moments === 'function' ? m.moments(key) : m.moments.includes(key)

/**
 * Steps per second of sim time.
 * @param {number} dt
 */
export const stepsPerSecond = (dt) => {
  const n = Math.round(1 / dt)
  if (!(n >= 1)) throw new Error(`playtest: dt ${dt} is not a fraction of a second`)
  return n
}

/**
 * One player's day through the game.
 * @template S, M
 * @param {import('./index.d.ts').PlaytestAdapter<S, M>} adapter
 * @param {Persona} p
 * @param {number} seed the cast's seed
 * @param {import('./index.d.ts').DayOptions} [options]
 * @returns {PlaytestDay}
 */
export function playDay(adapter, p, seed, options = {}) {
  const m = { ...MODEL, ...options.model }
  const labels = { ...LABELS, ...adapter.labels }
  const boredomScale = options.boredom ?? 1
  const milestones = adapter.milestones ?? []
  const values = adapter.momentValues
  const perSecond = stepsPerSecond(adapter.dt)
  const r = mulberry32(seed * 7919 + p.id)
  /** @type {PlaytestDay} */
  const day = {
    persona: p,
    played: 0,
    why: 'done',
    at: '',
    runs: 0,
    milestones: Object.fromEntries(milestones.map((x) => [x.name, -1])),
    between: false,
    continued: false,
    losses: 0,
    runLog: [],
    trace: [],
    lastGap: 0,
    d1: 0,
    back: false,
  }
  const mobile = p.device === 'mobile'
  const load = mobile ? range(r, ...m.loadMobile) : range(r, ...m.loadDesktop)
  if (load > p.loadPatience) return { ...day, why: 'load', at: `black page ${load.toFixed(1)} s` }
  // Some clicks are not meant: a wrong tile, a thumb on a scroll.
  if (r() < (mobile ? m.misclickMobile : m.misclickDesktop))
    return { ...day, why: 'misclick', at: '0:02' }

  let t = 0
  let interest = p.hook
  let lastMoment = 0
  /** @type {Map<string, number>} */
  const seen = new Map()
  const meta = /** @type {M} */ (adapter.meta?.())
  const fpsDrag = m.fpsDrag[p.fps]
  // A phone player's fingers are slower, and a stuttering frame slows everyone.
  const slow = (mobile ? m.mobileHands : 1) * (p.fps === 'poor' ? m.poorFpsHands : 1)
  /** @param {string} key */
  const enjoy = (key) => {
    const n = seen.get(key) ?? 0
    seen.set(key, n + 1)
    interest = Math.min(
      m.interestCap,
      interest + (values[key] ?? 0) * p.delight * Math.max(m.habituationFloor, m.habituation ** n),
    )
    lastMoment = t
  }
  /** @param {number} now @returns {PlayerView} */
  const view = (now) => ({
    persona: p,
    skill: p.skill,
    t: now,
    slow,
    has: (verb) => now >= (p.learn[verb] ?? Number.POSITIVE_INFINITY),
  })
  /** @param {S} state */
  const where = (state) => {
    const w = adapter.where?.(state)
    return w ? `, ${w}` : ''
  }

  for (let run = 0; ; run++) {
    const state = adapter.start({
      run,
      seed: seed * 1000 + p.id * 13 + run,
      meta,
      skill: p.skill,
      persona: p,
    })
    const start = t
    let gap = 0
    /** @type {'bored' | 'time' | null} */
    let left = null
    for (let i = 0; !adapter.over(state); i++) {
      if (i % perSecond === 0) adapter.knobs?.(state, view(t))
      adapter.step(state)
      t += adapter.dt
      for (const key of adapter.moments(state)) {
        for (const ms of milestones)
          if (day.milestones[ms.name] === -1 && reaches(key, ms)) day.milestones[ms.name] = t
        enjoy(key)
      }
      if (i % perSecond !== perSecond - 1) continue
      // Once a second: attention drains, faster in a long stretch with nothing new, faster on a
      // stuttering device.
      gap = Math.max(gap, t - lastMoment)
      const drought = t - lastMoment > p.gapTolerance ? m.drought : 1
      interest -= p.boredom * boredomScale * drought * fpsDrag
      if (Math.round(t) % m.traceEvery === 0) day.trace.push(Math.max(0, interest))
      if (interest <= 0) left = 'bored'
      else if (t > p.budget * 60 + m.overtime) left = 'time'
      if (left) break
    }
    const runT = t - start
    const won = !left && adapter.won(state)
    day.runs = run + 1
    day.runLog.push({
      n: run + 1,
      t: runT,
      end: left ? 'left' : won ? 'won' : 'lost',
      gap,
      info: adapter.summary?.(state) ?? {},
    })
    if (left) {
      day.why = left
      day.at = `run ${run + 1}, ${clock(runT)} in${where(state)}`
      break
    }
    if (won) enjoy(m.winMoment)
    else {
      day.losses++
      // A loss early in a run stings more.
      if (r() < Math.min(m.lossQuitCap, p.loseQuit * (runT < m.earlyLoss ? m.earlyLossSting : 1))) {
        day.why = 'lost'
        day.at = `run ${run + 1}, ${labels.lost} at ${clock(runT)}${where(state)}`
        break
      }
      interest -= m.lossPenalty
    }
    if (t > p.budget * 60) {
      day.why = 'done'
      day.at = `after run ${run + 1}, ${won ? 'a win' : 'a loss'}`
      break
    }
    // The between-runs screen.
    day.between = true
    const got = adapter.between?.({ run, state, meta, skill: p.skill, persona: p })
    const bought = got === undefined ? null : Number(got)
    if (bought) interest = Math.min(m.interestCap, interest + m.boughtLift * p.delight)
    if (r() < p.betweenLeave + (bought === 0 ? m.nothingBoughtLeave : 0)) {
      day.why = 'between'
      day.at = `${labels.between} after run ${run + 1}${bought === null ? '' : `, ${bought} bought`}`
      break
    }
    day.continued = true
    t += m.betweenSeconds
  }
  day.played = t
  day.lastGap = t - lastMoment
  day.d1 = (options.day1 ?? day1Odds)(day)
  day.back = r() < day.d1
  return day
}

/**
 * The whole playtest: a cast from the seed, then each player's day.
 * @template S, M
 * @param {import('./index.d.ts').PlaytestAdapter<S, M>} adapter
 * @param {import('./index.d.ts').PlaytestOptions} [options]
 * @returns {import('./index.d.ts').PlaytestResult}
 */
export function runPlaytest(adapter, options = {}) {
  const players = options.players ?? 100
  const seed = options.seed ?? 1
  const boredom = options.boredom ?? 1
  const people = cast({
    players,
    seed,
    verbs: adapter.verbs,
    archetypes: options.archetypes,
    firstNames: options.firstNames,
    lastNames: options.lastNames,
    defaults: options.castDefaults,
  })
  const days = people.map((p) =>
    playDay(adapter, p, seed, { boredom, model: options.model, day1: options.day1 }),
  )
  return { seed, players, boredom, days }
}

/**
 * `PLAYERS`, `CAST` (the seed) and `BOREDOM` from an environment, for a test file to pass
 * its environment. Missing or empty values keep the defaults: 100, 1, 1.
 * @param {Record<string, string | undefined>} env
 * @returns {{ players: number, seed: number, boredom: number }}
 */
export function playtestEnv(env) {
  /** @param {string} k @param {number} d */
  const num = (k, d) => {
    const v = env[k]
    if (v === undefined || v === '') return d
    const n = Number(v)
    if (!Number.isFinite(n)) throw new Error(`playtest: ${k}=${v} is not a number`)
    return n
  }
  return { players: num('PLAYERS', 100), seed: num('CAST', 1), boredom: num('BOREDOM', 1) }
}
