// @ts-check
/**
 * The cast: fictional players drawn from weighted archetypes, each with a skill, a device, the
 * session second at which they first use each verb (or never), and the numbers the attention
 * model reads. Seeded: the same seed, verbs and archetypes give the same people.
 */
import { mulberry32, range, within } from './rng.mjs'

/** @typedef {import('./index.d.ts').Archetype} Archetype */
/** @typedef {import('./index.d.ts').Persona} Persona */
/** @typedef {import('./index.d.ts').VerbTable} VerbTable */
/** @typedef {import('./index.d.ts').CastOptions} CastOptions */

/**
 * Seven archetypes of a web portal's audience: young, casual, often on a school laptop or a phone.
 * Weights and ranges are judgement, set so a game like ours converts near 50% on desktop and 35%
 * on mobile with Day 1 near 3%. `coreAt` and `coreNever` time the game's core verb (the first
 * thing a player must find); a game whose core verb is much easier or harder overrides them.
 * @type {readonly Archetype[]}
 */
export const ARCHETYPES = Object.freeze([
  {
    name: 'tab hopper',
    weight: 22,
    device: 'either',
    fps: [0.5, 0.4, 0.1],
    age: [14, 30],
    skill: [0.25, 0.55],
    coreAt: [8, 25],
    coreNever: 0.15,
    learnPace: [1, 2.5],
    verbNever: 0.35,
    hook: [0.35, 0.7],
    boredom: [0.012, 0.022],
    gapTolerance: [10, 20],
    delight: [0.8, 1.2],
    loseQuit: [0.5, 0.8],
    betweenLeave: [0.2, 0.4],
    budget: [2, 10],
    d1: [0.01, 0.03],
  },
  {
    name: 'school chromebook kid',
    weight: 16,
    device: 'desktop',
    fps: [0.1, 0.4, 0.5],
    age: [9, 13],
    skill: [0.1, 0.45],
    coreAt: [10, 40],
    coreNever: 0.25,
    learnPace: [1.2, 3],
    verbNever: 0.4,
    hook: [0.55, 0.9],
    boredom: [0.01, 0.018],
    gapTolerance: [12, 24],
    delight: [1.1, 1.6],
    loseQuit: [0.25, 0.5],
    betweenLeave: [0.08, 0.2],
    budget: [6, 30],
    d1: [0.03, 0.07],
  },
  {
    name: 'merge fan',
    weight: 14,
    device: 'either',
    fps: [0.5, 0.4, 0.1],
    age: [16, 40],
    skill: [0.5, 0.8],
    coreAt: [4, 12],
    coreNever: 0,
    learnPace: [0.8, 1.6],
    verbNever: 0.15,
    hook: [0.5, 0.8],
    boredom: [0.01, 0.016],
    gapTolerance: [12, 20],
    delight: [0.9, 1.3],
    loseQuit: [0.3, 0.55],
    betweenLeave: [0.08, 0.18],
    budget: [5, 30],
    d1: [0.04, 0.08],
  },
  {
    name: 'tower defense fan',
    weight: 12,
    device: 'desktop',
    fps: [0.6, 0.35, 0.05],
    age: [15, 35],
    skill: [0.65, 0.95],
    coreAt: [4, 10],
    coreNever: 0,
    learnPace: [0.6, 1.2],
    verbNever: 0.05,
    hook: [0.45, 0.75],
    boredom: [0.012, 0.02],
    gapTolerance: [14, 24],
    delight: [0.7, 1.1],
    loseQuit: [0.15, 0.35],
    betweenLeave: [0.05, 0.12],
    budget: [10, 45],
    d1: [0.05, 0.1],
  },
  {
    name: 'mobile commuter',
    weight: 17,
    device: 'mobile',
    fps: [0.4, 0.45, 0.15],
    age: [17, 45],
    skill: [0.3, 0.6],
    coreAt: [10, 30],
    coreNever: 0.15,
    learnPace: [1.2, 2.5],
    verbNever: 0.35,
    hook: [0.4, 0.7],
    boredom: [0.012, 0.02],
    gapTolerance: [10, 18],
    delight: [0.8, 1.2],
    loseQuit: [0.45, 0.7],
    betweenLeave: [0.15, 0.3],
    budget: [3, 15],
    d1: [0.03, 0.06],
  },
  {
    name: 'mobile kid',
    weight: 13,
    device: 'mobile',
    fps: [0.15, 0.45, 0.4],
    age: [8, 13],
    skill: [0.05, 0.4],
    coreAt: [12, 45],
    coreNever: 0.3,
    learnPace: [1.5, 3],
    verbNever: 0.45,
    hook: [0.55, 0.9],
    boredom: [0.011, 0.02],
    gapTolerance: [10, 20],
    delight: [1.1, 1.6],
    loseQuit: [0.3, 0.55],
    betweenLeave: [0.1, 0.25],
    budget: [5, 25],
    d1: [0.03, 0.07],
  },
  {
    name: 'roguelite veteran',
    weight: 6,
    device: 'desktop',
    fps: [0.7, 0.3, 0],
    age: [20, 38],
    skill: [0.8, 1],
    coreAt: [3, 8],
    coreNever: 0,
    learnPace: [0.5, 1],
    verbNever: 0.02,
    hook: [0.4, 0.7],
    boredom: [0.014, 0.022],
    gapTolerance: [14, 26],
    delight: [0.6, 1],
    loseQuit: [0.1, 0.25],
    betweenLeave: [0.04, 0.1],
    budget: [15, 60],
    d1: [0.06, 0.12],
  },
])

/** @type {readonly string[]} */
export const FIRST_NAMES = Object.freeze([
  'Ava',
  'Noah',
  'Mia',
  'Leo',
  'Zoe',
  'Eli',
  'Ivy',
  'Max',
  'Ana',
  'Kai',
  'Lia',
  'Sam',
  'Nia',
])

/** @type {readonly string[]} */
export const LAST_INITIALS = Object.freeze([
  'B.',
  'C.',
  'D.',
  'F.',
  'G.',
  'H.',
  'J.',
  'K.',
  'L.',
  'M.',
  'N.',
  'P.',
  'R.',
  'S.',
  'T.',
])

/** The cast's defaults, as `cast()` has them. */
export const CAST_DEFAULTS = Object.freeze({
  /** Share of an 'either' archetype on a phone. */
  mobileShare: 0.45,
  /** Seconds a player waits on a black page, by device. */
  loadPatienceDesktop: /** @type {readonly [number, number]} */ ([4, 15]),
  loadPatienceMobile: /** @type {readonly [number, number]} */ ([3, 12]),
  /** Each later verb's time is stretched by a draw in this range, per player. */
  verbJitter: /** @type {readonly [number, number]} */ ([0.8, 1.4]),
})

/**
 * A later verb's offer time and phone stretch, from its table entry.
 * @param {number | { at: number, mobile?: number }} v
 */
const offerOf = (v) => (typeof v === 'number' ? { at: v, mobile: 1 } : { mobile: 1, ...v })

/**
 * `n` players from a seed. The draw order is fixed (archetype, device, frame rate, learning pace,
 * the core verb, each later verb in the table's order, name, age, then the attention numbers), so
 * reordering `verbs.later` or the archetypes changes who is drawn.
 * @param {CastOptions} options
 * @returns {Persona[]}
 */
export function cast(options) {
  const {
    players,
    seed,
    verbs,
    archetypes = ARCHETYPES,
    firstNames = FIRST_NAMES,
    lastNames = LAST_INITIALS,
  } = options
  const d = { ...CAST_DEFAULTS, ...options.defaults }
  if (!archetypes.length) throw new Error('cast: no archetypes')
  const r = mulberry32(seed)
  const total = archetypes.reduce((s, a) => s + a.weight, 0)
  const later = Object.entries(verbs.later).map(([name, v]) => ({ name, ...offerOf(v) }))
  /** @type {Persona[]} */
  const out = []
  for (let id = 0; id < players; id++) {
    const roll = r() * total
    let sum = 0
    const a = /** @type {Archetype} */ (
      archetypes.find((x) => {
        sum += x.weight
        return roll < sum
      }) ?? archetypes[0]
    )
    /** @type {'desktop' | 'mobile'} */
    const device = a.device === 'either' ? (r() < d.mobileShare ? 'mobile' : 'desktop') : a.device
    const f = r()
    const fps = f < a.fps[0] ? 'good' : f < a.fps[0] + a.fps[1] ? 'ok' : 'poor'
    const pace = within(r, a.learnPace)
    /** @type {Record<string, number>} */
    const learn = {}
    if (verbs.core)
      learn[verbs.core] = r() < a.coreNever ? Number.POSITIVE_INFINITY : within(r, a.coreAt)
    for (const v of later) {
      const thumb = device === 'mobile' ? v.mobile : 1
      learn[v.name] =
        r() < a.verbNever
          ? Number.POSITIVE_INFINITY
          : v.at * pace * thumb * range(r, d.verbJitter[0], d.verbJitter[1])
    }
    out.push({
      id,
      name: `${firstNames[Math.floor(r() * firstNames.length)]} ${lastNames[Math.floor(r() * lastNames.length)]}`,
      age: Math.round(within(r, a.age)),
      archetype: a.name,
      device,
      fps,
      skill: within(r, a.skill),
      learn,
      loadPatience:
        device === 'mobile' ? within(r, d.loadPatienceMobile) : within(r, d.loadPatienceDesktop),
      hook: within(r, a.hook),
      boredom: within(r, a.boredom),
      gapTolerance: within(r, a.gapTolerance),
      delight: within(r, a.delight),
      loseQuit: within(r, a.loseQuit),
      betweenLeave: within(r, a.betweenLeave),
      budget: within(r, a.budget),
      d1: within(r, a.d1),
    })
  }
  return out
}
