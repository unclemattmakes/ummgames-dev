// @ts-check
/**
 * Two probes that ask the sim alone, with no attention model: where a run goes quiet (stretches
 * with no moment, by skill), and how long a run lasts with each verb turned off. Their numbers are
 * facts about the build, where the playtest's are a model's.
 */
import { clock, stepsPerSecond } from './day.mjs'
import { mean, median } from './report.mjs'

/** @typedef {import('./index.d.ts').PlayerView} PlayerView */

/**
 * A bot player's view: no persona, every verb known unless `off` names it.
 * @param {number} skill
 * @param {number} t
 * @param {ReadonlySet<string>} off
 * @returns {PlayerView}
 */
const botView = (skill, t, off) => ({
  persona: null,
  skill,
  t,
  slow: 1,
  has: (verb) => !off.has(verb),
})

/**
 * Plays one run with a bot and returns it, its time and its moments in order.
 * @template S, M
 * @param {import('./index.d.ts').PlaytestAdapter<S, M>} adapter
 * @param {{ run: number, seed: number, meta: M, skill: number, off: ReadonlySet<string>, seconds: number }} o
 * @param {(t: number, keys: readonly string[]) => void} [onMoments]
 */
function playRun(adapter, o, onMoments) {
  const perSecond = stepsPerSecond(adapter.dt)
  const state = adapter.start({
    run: o.run,
    seed: o.seed,
    meta: o.meta,
    skill: o.skill,
    persona: null,
  })
  const steps = Math.round(o.seconds * perSecond)
  let t = 0
  for (let i = 0; i < steps && !adapter.over(state); i++) {
    if (i % perSecond === 0) adapter.knobs?.(state, botView(o.skill, t, o.off))
    adapter.step(state)
    t += adapter.dt
    const keys = adapter.moments(state)
    if (keys.length) onMoments?.(t, keys)
  }
  const end = /** @type {'won' | 'lost' | 'going'} */ (
    !adapter.over(state) ? 'going' : adapter.won(state) ? 'won' : 'lost'
  )
  return { state, t, end }
}

/**
 * Stretches of `minGap` seconds or more with no moment, run after run, for a bot at each skill
 * with every verb it has. Between runs the adapter's `between` hook spends, as in a day.
 * @template S, M
 * @param {import('./index.d.ts').PlaytestAdapter<S, M>} adapter
 * @param {import('./index.d.ts').DeadStretchOptions} [options]
 * @returns {import('./index.d.ts').DeadStretchSkill[]}
 */
export function deadStretches(adapter, options = {}) {
  const skills = options.skills ?? [0.2, 0.5, 0.85]
  const runs = options.runs ?? 2
  const seed = options.seed ?? 41
  const minGap = options.minGap ?? 12
  const seconds = (options.minutes ?? 12) * 60
  const off = new Set(options.off ?? [])
  return skills.map((skill) => {
    const meta = /** @type {M} */ (adapter.meta?.())
    /** @type {import('./index.d.ts').DeadStretchRun[]} */
    const out = []
    for (let run = 0; run < runs; run++) {
      let last = 0
      /** @type {{ at: number, length: number }[]} */
      const gaps = []
      /** @type {Record<string, number>} */
      const tally = {}
      const played = playRun(
        adapter,
        { run, seed: seed + run, meta, skill, off, seconds },
        (t, keys) => {
          for (const k of keys) tally[k] = (tally[k] ?? 0) + 1
          if (t - last >= minGap) gaps.push({ at: last, length: t - last })
          last = t
        },
      )
      const got = adapter.between?.({ run, state: played.state, meta, skill, persona: null })
      out.push({
        run: run + 1,
        t: played.t,
        end: played.end,
        moments: tally,
        gaps,
        tail: played.t - last,
        bought: got === undefined ? null : Number(got),
        info: adapter.summary?.(played.state) ?? {},
      })
    }
    return { skill, runs: out }
  })
}

/**
 * @param {Record<string, number | string>} info
 */
const infoText = (info) =>
  Object.entries(info)
    .map(([k, v]) => `${k} ${typeof v === 'number' ? Number(v.toFixed(2)) : v}`)
    .join(', ')

/**
 * @param {readonly import('./index.d.ts').DeadStretchSkill[]} results
 * @param {{ minGap?: number }} [options] the `minGap` the probe ran with, for the heading
 */
export function formatDeadStretches(results, options = {}) {
  const minGap = options.minGap ?? 12
  const lines = []
  for (const s of results) {
    lines.push(`skill ${s.skill}`)
    for (const r of s.runs) {
      const info = infoText(r.info)
      lines.push(
        `  run ${r.run}: ${clock(r.t)} ${r.end === 'going' ? 'still going' : r.end}${info ? `, ${info}` : ''}${r.bought === null ? '' : `, ${r.bought} bought after`}`,
        `    moments ${
          Object.entries(r.moments)
            .map(([k, n]) => `${k} ${n}`)
            .join(', ') || 'none'
        }`,
        `    stretches of ${minGap} s+ with none: ${r.gaps.map((g) => `${clock(g.at)}+${Math.round(g.length)}s`).join(', ') || 'none'}${r.tail >= minGap ? `; then ${Math.round(r.tail)} s to the end` : ''}`,
      )
    }
  }
  return lines.join('\n')
}

/**
 * The default variants: every verb, each later verb off on its own, then every later verb off.
 * @param {import('./index.d.ts').VerbTable} verbs
 * @returns {Record<string, readonly string[]>}
 */
export function ablationVariants(verbs) {
  const later = Object.keys(verbs.later)
  /** @type {Record<string, readonly string[]>} */
  const out = { 'every verb': [] }
  for (const v of later) out[`no ${v}`] = [v]
  if (later.length > 1) out[verbs.core ? `only ${verbs.core}` : 'no verbs'] = later
  return out
}

/**
 * How long one run lasts, by skill, with each variant's verbs turned off: the verbs that decide
 * whether a run survives. Every seed plays the same run index from the same meta.
 * @template S, M
 * @param {import('./index.d.ts').PlaytestAdapter<S, M>} adapter
 * @param {import('./index.d.ts').AblationOptions<M>} [options]
 * @returns {import('./index.d.ts').AblationRow[]}
 */
export function verbAblation(adapter, options = {}) {
  const skills = options.skills ?? [0.1, 0.25, 0.4, 0.55, 0.7, 0.85]
  const seeds = options.seeds ?? 12
  const seed = options.seed ?? 500
  const run = options.run ?? 1
  const seconds = (options.minutes ?? 20) * 60
  const shortRun = options.short ?? 180
  const variants = options.variants ?? ablationVariants(adapter.verbs)
  /** @type {import('./index.d.ts').AblationRow[]} */
  const rows = []
  for (const skill of skills) {
    for (const [variant, offList] of Object.entries(variants)) {
      const off = new Set(offList)
      /** @type {number[]} */
      const times = []
      /** @type {Record<string, number[]>} */
      const infos = {}
      let lost = 0
      for (let s = 0; s < seeds; s++) {
        const meta = /** @type {M} */ (options.meta ? options.meta() : adapter.meta?.())
        const played = playRun(adapter, { run, seed: seed + s, meta, skill, off, seconds })
        times.push(played.t)
        if (played.end === 'lost') lost++
        for (const [k, v] of Object.entries(adapter.summary?.(played.state) ?? {}))
          if (typeof v === 'number') {
            const list = infos[k] ?? []
            list.push(v)
            infos[k] = list
          }
      }
      rows.push({
        skill,
        variant,
        off: [...off],
        times,
        median: median(times),
        shortest: Math.min(...times),
        short: times.filter((t) => t < shortRun).length,
        lost,
        info: Object.fromEntries(Object.entries(infos).map(([k, v]) => [k, mean(v)])),
      })
    }
  }
  return rows
}

/**
 * @param {readonly import('./index.d.ts').AblationRow[]} rows
 * @param {{ run?: number, short?: number }} [options] what the probe ran with, for the wording
 */
export function formatVerbAblation(rows, options = {}) {
  const run = (options.run ?? 1) + 1
  const shortRun = options.short ?? 180
  const width = Math.max(0, ...rows.map((r) => r.variant.length))
  return rows
    .map((r) => {
      const info = infoText(r.info)
      return `skill ${String(r.skill).padEnd(4)} ${r.variant.padEnd(width)}  run ${run} lasts median ${clock(r.median)} (shortest ${clock(r.shortest)}), ${r.short} of ${r.times.length} under ${clock(shortRun)}, ${r.lost} lost${info ? `, mean ${info}` : ''}`
    })
    .join('\n')
}
