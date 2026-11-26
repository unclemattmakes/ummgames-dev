// @ts-check
/**
 * The playtest's text report: the funnel by device, why they left, when the bored ones left, each
 * archetype, how runs went by skill band, when milestones landed, and the interest trace.
 */
import { clock, LABELS, MODEL } from './day.mjs'

/** @typedef {import('./index.d.ts').PlaytestDay} PlaytestDay */

/**
 * @param {number} n
 * @param {number} of
 */
const pct = (n, of) => `${of ? Math.round((100 * n) / of) : 0}%`

/**
 * The middle value (the upper one of an even count), or 0 for none.
 * @param {readonly number[]} xs
 */
export const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? (s[Math.floor(s.length / 2)] ?? 0) : 0
}

/** @param {readonly number[]} xs */
export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

/**
 * Seconds as `4.2 s` under a minute, `m:ss` from there.
 * @param {number} t
 */
const short = (t) => (t < 60 ? `${t.toFixed(1)} s` : clock(t))

/** The order a report lists reasons in. */
export const WHYS = /** @type {const} */ ([
  'load',
  'misclick',
  'bored',
  'lost',
  'between',
  'done',
  'time',
])

/** Skill bands for the runs section: [from, to), the last including 1. */
const BANDS = /** @type {const} */ ([
  [0, 0.35],
  [0.35, 0.65],
  [0.65, 1.01],
])

/**
 * The report as text, one line per row.
 * @param {import('./index.d.ts').PlaytestResult} result
 * @param {import('./index.d.ts').ReportOptions} [adapter] the adapter, or just its labels and milestones
 * @returns {string}
 */
export function formatReport(result, adapter = {}) {
  const { days } = result
  const labels = { ...LABELS, ...adapter.labels }
  const milestones = adapter.milestones ?? []
  const every = adapter.traceEvery ?? MODEL.traceEvery
  /** @param {(typeof WHYS)[number]} w */
  const why = (w) => (w === 'lost' ? labels.lost : w === 'between' ? labels.between : w)
  const lines = [
    `Simulated playtest, cast ${result.seed}, ${result.players} players, boredom x${result.boredom}`,
  ]
  for (const dev of /** @type {const} */ (['desktop', 'mobile', 'all'])) {
    const ds = days.filter((d) => dev === 'all' || d.persona.device === dev)
    const conv = ds.filter((d) => d.played >= 60)
    lines.push(
      `${dev}: ${ds.length} players, conversion ${pct(conv.length, ds.length)}, mean play ${(mean(ds.map((d) => d.played)) / 60).toFixed(1)} min (of those past a minute ${(mean(conv.map((d) => d.played)) / 60).toFixed(1)}), median ${(median(ds.map((d) => d.played)) / 60).toFixed(1)}, ${labels.between} ${pct(ds.filter((d) => d.between).length, ds.length)}, Day 1 expected ${(100 * mean(ds.map((d) => d.d1))).toFixed(1)}% (drawn ${ds.filter((d) => d.back).length})`,
    )
  }

  lines.push('', 'Why they left')
  const pad = Math.max(...WHYS.map((w) => why(w).length))
  for (const w of WHYS) {
    const ds = days.filter((d) => d.why === w)
    if (ds.length)
      lines.push(
        `  ${why(w).padEnd(pad)} ${String(ds.length).padStart(3)}  median at ${clock(median(ds.map((d) => d.played)))}`,
      )
  }

  lines.push('', 'Left bored: when, by session minute')
  /** @type {Map<number, number>} */
  const buckets = new Map()
  for (const d of days.filter((x) => x.why === 'bored')) {
    const m = Math.floor(d.played / 60)
    buckets.set(m, (buckets.get(m) ?? 0) + 1)
  }
  for (const [m, n] of [...buckets].sort((a, b) => a[0] - b[0]))
    lines.push(`  ${m}-${m + 1} min ${'#'.repeat(n)} ${n}`)

  lines.push('', 'By archetype')
  const names = [...new Set(days.map((d) => d.persona.archetype))]
  const width = Math.max(0, ...names.map((a) => a.length))
  for (const a of names) {
    const ds = days.filter((d) => d.persona.archetype === a)
    const reached = milestones
      .filter((m) => m.short)
      .map(
        (m) =>
          `  ${m.short} ${pct(ds.filter((d) => (d.milestones[m.name] ?? -1) >= 0).length, ds.length).padStart(4)}`,
      )
      .join('')
    const left = WHYS.map((w) => `${why(w)} ${ds.filter((d) => d.why === w).length}`)
      .filter((s) => !s.endsWith(' 0'))
      .join(', ')
    lines.push(
      `  ${a.padEnd(width)} ${String(ds.length).padStart(3)}  conv ${pct(ds.filter((d) => d.played >= 60).length, ds.length).padStart(4)}  mean ${(mean(ds.map((d) => d.played)) / 60).toFixed(1).padStart(4)} min  ${labels.between} ${pct(ds.filter((d) => d.between).length, ds.length).padStart(4)}${reached}  D1 ${(100 * mean(ds.map((d) => d.d1))).toFixed(1)}%  left: ${left}`,
    )
  }

  lines.push('', 'Runs: how they went')
  const runs = days.flatMap((d) => d.runLog.map((x) => ({ ...x, skill: d.persona.skill })))
  /** @param {typeof runs} xs */
  const ends = (xs) =>
    `${xs.filter((x) => x.end === 'won').length} won, ${xs.filter((x) => x.end === 'lost').length} ${labels.lost} (${xs.filter((x) => x.end === 'lost' && x.t < 180).length} inside 3 min), ${xs.filter((x) => x.end === 'left').length} left mid-run`
  /** @param {typeof runs} xs */
  const finished = (xs) => clock(median(xs.filter((x) => x.end !== 'left').map((x) => x.t)))
  for (const n of [1, 2, 3, 4]) {
    const rs = runs.filter((x) => x.n === n)
    if (!rs.length) continue
    lines.push(
      `  run ${n}: ${rs.length} started, ${ends(rs)}; finished runs median ${finished(rs)}, longest dead stretch median ${median(rs.map((x) => x.gap)).toFixed(0)} s`,
    )
    for (const [lo, hi] of BANDS) {
      const b = rs.filter((x) => x.skill >= lo && x.skill < hi)
      if (b.length)
        lines.push(
          `    skill ${lo} to ${Math.min(1, hi)}: ${b.length}, ${ends(b)}, finished median ${finished(b)}`,
        )
    }
  }

  if (milestones.length) {
    lines.push('', 'Milestones (session time, of those who got there)')
    for (const m of milestones) {
      const ts = days.map((d) => d.milestones[m.name] ?? -1).filter((x) => x >= 0)
      lines.push(
        ts.length
          ? `  ${m.name}: ${ts.length} players, median ${short(median(ts))}, slowest ${short(Math.max(...ts))}`
          : `  ${m.name}: nobody`,
      )
    }
  }

  lines.push('', `Mean interest of those still playing, every ${2 * every} s (0 to 1.2)`)
  for (let i = 0; i < 40; i += 2) {
    const v = days.map((d) => d.trace[i]).filter((x) => x !== undefined)
    if (v.length < 3) break
    lines.push(
      `  ${clock((i + 1) * every)} ${String(v.length).padStart(3)} playing  ${'='.repeat(Math.round(mean(v) * 40))} ${mean(v).toFixed(2)}`,
    )
  }
  return lines.join('\n')
}
