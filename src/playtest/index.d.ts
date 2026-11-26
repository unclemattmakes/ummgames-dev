/**
 * `@ummgames/dev/playtest`: a simulated playtest. Fictional players from weighted archetypes play
 * a game's real, deterministic sim through its bot, run after run, under a small model of
 * attention, and a report says where they left and why. Plus two sim-only probes: dead stretches
 * by skill, and run length with each verb turned off.
 *
 * The game is real; the people are invented. Read the sim's numbers (run lengths, dead stretches,
 * which verb keeps a run alive) as facts about the build, and the model's (conversion, playtime,
 * Day 1) as a comparison between beats and kinds of player, never a forecast. See docs/playtest.md.
 */

export type Device = 'desktop' | 'mobile'
/** Frames the device holds in a busy scene: 'good' 50+, 'ok' 30 to 50, 'poor' under 30. */
export type Fps = 'good' | 'ok' | 'poor'
/** A `[lo, hi]` range a value is drawn from, uniformly. */
export type Range = readonly [number, number]

/** A kind of player. Every range is drawn uniformly per player. */
export interface Archetype {
  name: string
  /** Relative share of the cast. */
  weight: number
  /** 'either': a phone with `CAST_DEFAULTS.mobileShare` (0.45). */
  device: Device | 'either'
  /** Chances of a 'good', 'ok' and 'poor' frame rate, summing to 1. */
  fps: readonly [number, number, number]
  age: Range
  /** 0 to 1: what the game's bot does with it is the game's call. */
  skill: Range
  /** Session seconds to first use the core verb (`VerbTable.core`), and the chance of never. */
  coreAt: Range
  coreNever: number
  /** How quickly the later verbs come: 1 is the table's timetable, 2 twice as slow. */
  learnPace: Range
  /** Chance each later verb is never found. */
  verbNever: number
  /** Interest at the first frame, 0 to 1. */
  hook: Range
  /** Interest lost per second with nothing new happening. */
  boredom: Range
  /** Seconds without a moment before boredom doubles. */
  gapTolerance: Range
  /** How much a moment restores, as a multiplier on its value. */
  delight: Range
  /** Chance a lost run ends the session (raised for a loss early in a run). */
  loseQuit: Range
  /** Chance of leaving at the between-runs screen instead of playing on. */
  betweenLeave: Range
  /** Minutes they have today. */
  budget: Range
  /** Base chance of coming back tomorrow, before what happened today. */
  d1: Range
}

/**
 * The game's verbs: names it chooses. `core` is the one verb an archetype times directly (the
 * first thing to find, such as a drag or a jump). Each later verb has the session second it is
 * first offered on screen, which a player's `learnPace` and a per-player jitter stretch, and an
 * optional stretch on a phone (1.5 for a key that is a button there). The order of `later` is the
 * order of the draws, so it is part of the seed.
 */
export interface VerbTable {
  core?: string | null
  later: Record<string, number | { at: number; mobile?: number }>
}

/** One fictional player. */
export interface Persona {
  id: number
  name: string
  age: number
  archetype: string
  device: Device
  fps: Fps
  skill: number
  /** Session seconds at which each verb is first used; Infinity: never found (null in JSON). */
  learn: Record<string, number>
  /** Seconds they wait on a black page before leaving. */
  loadPatience: number
  hook: number
  boredom: number
  gapTolerance: number
  delight: number
  loseQuit: number
  betweenLeave: number
  budget: number
  d1: number
}

export interface CastOptions {
  players: number
  seed: number
  verbs: VerbTable
  /** Default `ARCHETYPES`. Extend with `[...ARCHETYPES, mine]`, or replace. */
  archetypes?: readonly Archetype[]
  firstNames?: readonly string[]
  lastNames?: readonly string[]
  defaults?: Partial<typeof CAST_DEFAULTS>
}

/** The seven archetypes of a web portal's audience: young, casual, school laptops and phones. */
export declare const ARCHETYPES: readonly Archetype[]
export declare const FIRST_NAMES: readonly string[]
export declare const LAST_INITIALS: readonly string[]
export declare const CAST_DEFAULTS: Readonly<{
  /** Share of an 'either' archetype on a phone. 0.45. */
  mobileShare: number
  /** Seconds on a black page before leaving, desktop. [4, 15]. */
  loadPatienceDesktop: Range
  /** The same on a phone. [3, 12]. */
  loadPatienceMobile: Range
  /** Each later verb's time is stretched by a draw in this range. [0.8, 1.4]. */
  verbJitter: Range
}>

/** `players` people from `seed`. Deterministic: the same options give the same cast. */
export declare function cast(options: CastOptions): Persona[]

/** The attention model's numbers. `MODEL` holds the defaults; a game overrides any of them. */
export interface AttentionModel {
  /** Seconds to the first frame, by device. [0.9, 2.6] and [1.8, 4.5]. */
  loadDesktop: Range
  loadMobile: Range
  /** Chance the first click was not meant. 0.05 and 0.08. */
  misclickDesktop: number
  misclickMobile: number
  /** Interest never rises past this. 1.2. */
  interestCap: number
  /** A moment seen n times before is worth habituation^n of its value... 0.9. */
  habituation: number
  /** ...but never less than this share. 0.25. */
  habituationFloor: number
  /** Boredom multiplier once a stretch with no moment passes the player's gapTolerance. 2. */
  drought: number
  /** Boredom multiplier by frame rate. good 1, ok 1.1, poor 1.4. */
  fpsDrag: Record<Fps, number>
  /** `PlayerView.slow` on a phone, 1.3, times this on a poor frame rate, 1.25. */
  mobileHands: number
  poorFpsHands: number
  /** A loss's quit chance is loseQuit, times 1.3 for a run under 120 s, capped at 0.95. */
  lossQuitCap: number
  earlyLoss: number
  earlyLossSting: number
  /** Interest lost on a loss they play on from. 0.1. */
  lossPenalty: number
  /** Seconds past the budget at which they stop mid-run ('time'). 180. */
  overtime: number
  /** Seconds the between-runs screen takes. 20. */
  betweenSeconds: number
  /** Interest gained when the between hook bought something, times delight. 0.08. */
  boughtLift: number
  /** Added to betweenLeave when the between hook bought nothing. 0.15. */
  nothingBoughtLeave: number
  /** Seconds between interest trace points. 15. */
  traceEvery: number
  /** The moment enjoyed on a won run. 'runWin'. */
  winMoment: string
}
export declare const MODEL: Readonly<AttentionModel>

/** What `knobs` sees: who is playing and what they know at this second. */
export interface PlayerView {
  /** Null in the probes: a bare bot at `skill`. */
  persona: Persona | null
  skill: number
  /** Session seconds (a probe: seconds into the run). */
  t: number
  /** How much slower their hands are: 1, more on a phone or a poor frame rate. */
  slow: number
  /**
   * Whether they use this verb yet. In a day: once their learn time has passed. In a probe:
   * every verb except those the probe turns off.
   */
  has(verb: string): boolean
}

export interface StartContext<M> {
  /** 0 for a day's first run. */
  run: number
  /** The run's seed, derived from the cast's seed, the player and the run. */
  seed: number
  /** The day's meta state, from `meta()`, as the between hook left it. */
  meta: M
  skill: number
  /** Null in the probes. */
  persona: Persona | null
}

export interface BetweenContext<S, M> {
  run: number
  /** The run that just ended. */
  state: S
  /** Mutate it: the next `start` gets the same object. */
  meta: M
  skill: number
  persona: Persona | null
}

/** A named first: the session time a player first had any of these moments. */
export interface Milestone {
  name: string
  moments: readonly string[] | ((key: string) => boolean)
  /** A few letters for the by-archetype line, which lists only milestones that have one. */
  short?: string
}

/**
 * Words the report and a day's `at` use for the two game-shaped exits. Defaults: 'lost',
 * 'between screen'.
 */
export interface PlaytestLabels {
  /** A lost run, as a past participle: 'lost', 'wrecked', 'fell'. */
  lost?: string
  /** The between-runs screen: 'shop', 'upgrade tree'. */
  between?: string
}

/**
 * What a game writes. `S` is its own per-run state (a world, a bot, the bot's knobs), `M` its
 * meta state across runs (currency, upgrades), mutated in place.
 */
export interface PlaytestAdapter<S, M = undefined> {
  /** Seconds one `step` advances. Its inverse is the steps in a second, at least 1. */
  dt: number
  verbs: VerbTable
  /** How much each moment restores, before delight and habituation. Unlisted moments count 0. */
  momentValues: Record<string, number>
  milestones?: readonly Milestone[]
  labels?: PlaytestLabels
  /** A fresh meta state for a day (and for each skill in a probe). */
  meta?(): M
  start(ctx: StartContext<M>): S
  /**
   * Set the bot's knobs from the view: verbs not yet found off, hands slowed. Called before the
   * first step and once a second after.
   */
  knobs?(state: S, view: PlayerView): void
  /** One step of the sim with the bot's input. */
  step(state: S): void
  /** The moments since the last call, by name, clearing them. Called after every step. */
  moments(state: S): readonly string[]
  over(state: S): boolean
  won(state: S): boolean
  /**
   * The between-runs screen after a finished run: spend the meta currency and return how many
   * things were bought (or whether anything was). Omit it for a game with none: the screen still
   * counts as reached, with no lift and no nothing-bought penalty.
   */
  between?(ctx: BetweenContext<S, M>): number | boolean
  /** Where the run is, for a day's `at`: 'sector 2, hull 40%'. */
  where?(state: S): string
  /** Numbers to keep with each run in the day's log and the probes: rooms, kills. */
  summary?(state: S): Record<string, number | string>
}

export interface RunRecord {
  /** 1 for the first run. */
  n: number
  /** Seconds the run took. */
  t: number
  end: 'won' | 'lost' | 'left'
  /** Longest stretch with no moment, in seconds, sampled each second. */
  gap: number
  info: Record<string, number | string>
}

export type Why = 'load' | 'misclick' | 'bored' | 'lost' | 'between' | 'done' | 'time'

/** One player's day, as written to the JSON records. */
export interface PlaytestDay {
  persona: Persona
  /** Session seconds of play after the first frame. */
  played: number
  /**
   * load: a black page past their patience. misclick: gone at once. bored: interest hit 0.
   * lost: quit on a lost run. between: left at the between-runs screen. done: out of minutes
   * after a run. time: out of minutes mid-run, 3 minutes past the budget.
   */
  why: Why
  /** Where they were when they left. */
  at: string
  runs: number
  /** Session seconds of each milestone, -1 for never. */
  milestones: Record<string, number>
  /** Reached the between-runs screen at least once. */
  between: boolean
  /** Played on from it at least once. */
  continued: boolean
  losses: number
  runLog: RunRecord[]
  /** Interest every `traceEvery` seconds, floored at 0. */
  trace: number[]
  /** Seconds since the last moment when they left. */
  lastGap: number
  /** Expected Day 1 odds. */
  d1: number
  /** Drawn against d1. */
  back: boolean
}

export interface DayOptions {
  /** Scales every player's boredom: the sensitivity check. 1. */
  boredom?: number
  model?: Partial<AttentionModel>
  /** Replaces `day1Odds`. */
  day1?: (day: PlaytestDay) => number
}

export interface PlaytestOptions extends DayOptions {
  /** 100. */
  players?: number
  /** The cast's seed. 1. */
  seed?: number
  archetypes?: readonly Archetype[]
  firstNames?: readonly string[]
  lastNames?: readonly string[]
  castDefaults?: Partial<typeof CAST_DEFAULTS>
}

export interface PlaytestResult {
  seed: number
  players: number
  boredom: number
  days: PlaytestDay[]
}

/** Day 1 odds from the base d1: x2 if the between screen was reached (else x0.5), by length, by why. */
export declare function day1Odds(day: PlaytestDay): number
export declare const LABELS: Readonly<Required<PlaytestLabels>>
/** `m:ss`. */
export declare function clock(seconds: number): string
/** `Math.round(1 / dt)`; throws under 1. */
export declare function stepsPerSecond(dt: number): number
export declare function reaches(key: string, milestone: Milestone): boolean

/** One player's day. `seed` is the cast's. */
export declare function playDay<S, M>(
  adapter: PlaytestAdapter<S, M>,
  persona: Persona,
  seed: number,
  options?: DayOptions,
): PlaytestDay

/** A cast from `options.seed`, then every player's day. */
export declare function runPlaytest<S, M>(
  adapter: PlaytestAdapter<S, M>,
  options?: PlaytestOptions,
): PlaytestResult

/** `PLAYERS`, `CAST` and `BOREDOM` from `process.env` or similar. Defaults 100, 1, 1. */
export declare function playtestEnv(env: Record<string, string | undefined>): {
  players: number
  seed: number
  boredom: number
}

export interface ReportOptions {
  labels?: PlaytestLabels
  milestones?: readonly Milestone[]
  /** The model's traceEvery, if overridden. 15. */
  traceEvery?: number
}

/** The text report. Pass the adapter (or just its labels and milestones). */
export declare function formatReport(result: PlaytestResult, options?: ReportOptions): string
export declare const WHYS: readonly Why[]
/** The middle value, the upper of an even count; 0 for none. */
export declare function median(xs: readonly number[]): number
export declare function mean(xs: readonly number[]): number
export declare function mulberry32(seed: number): () => number

export interface DeadStretchOptions {
  /** [0.2, 0.5, 0.85]. */
  skills?: readonly number[]
  /** Runs in a row per skill, with `between` after each. 2. */
  runs?: number
  /** Run n plays seed + n. 41. */
  seed?: number
  /** Seconds with no moment that count as a stretch. 12. */
  minGap?: number
  /** Longest a run plays. 12. */
  minutes?: number
  /** Verbs the bot does not use. None. */
  off?: readonly string[]
}

export interface DeadStretchRun {
  run: number
  t: number
  end: 'won' | 'lost' | 'going'
  /** Count of each moment. */
  moments: Record<string, number>
  /** Each stretch: when it began (seconds into the run) and how long it was. */
  gaps: { at: number; length: number }[]
  /** Seconds from the last moment to the end of the run. */
  tail: number
  /** What `between` returned after it, or null with no hook. */
  bought: number | null
  info: Record<string, number | string>
}

export interface DeadStretchSkill {
  skill: number
  runs: DeadStretchRun[]
}

/** Stretches with no moment, by skill, for a bot with every verb its skill gives it. */
export declare function deadStretches<S, M>(
  adapter: PlaytestAdapter<S, M>,
  options?: DeadStretchOptions,
): DeadStretchSkill[]
export declare function formatDeadStretches(
  results: readonly DeadStretchSkill[],
  options?: { minGap?: number },
): string

export interface AblationOptions<M> {
  /** [0.1, 0.25, 0.4, 0.55, 0.7, 0.85]. */
  skills?: readonly number[]
  /** Seeds per skill and variant. 12. */
  seeds?: number
  /** The first seed. 500. */
  seed?: number
  /** Which run index to play: 1 is the second run. 1. */
  run?: number
  /** Longest a run plays. 20. */
  minutes?: number
  /** A run shorter than this many seconds counts as short. 180. */
  short?: number
  /** The meta to start each run from, fresh per seed: what a player has bought by then. `meta()`. */
  meta?: () => M
  /** Name to the verbs turned off. `ablationVariants(adapter.verbs)`. */
  variants?: Record<string, readonly string[]>
}

export interface AblationRow {
  skill: number
  variant: string
  off: string[]
  /** Each seed's run length. */
  times: number[]
  median: number
  shortest: number
  /** Runs under `short` seconds. */
  short: number
  /** Runs that ended lost (the rest won or hit `minutes`). */
  lost: number
  /** Mean of each numeric `summary` value. */
  info: Record<string, number>
}

/** Every verb; each later verb off on its own; then only the core verb (or none). */
export declare function ablationVariants(verbs: VerbTable): Record<string, readonly string[]>
/** How long a run lasts, by skill, with each variant's verbs off. */
export declare function verbAblation<S, M>(
  adapter: PlaytestAdapter<S, M>,
  options?: AblationOptions<M>,
): AblationRow[]
export declare function formatVerbAblation(
  rows: readonly AblationRow[],
  options?: { run?: number; short?: number },
): string
