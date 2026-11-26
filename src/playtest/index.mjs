// @ts-check
/**
 * `@ummgames/dev/playtest`: a simulated playtest. Fictional players from weighted archetypes play
 * a game's real, deterministic sim through its bot, run after run, under a small model of
 * attention, and a report says where they left and why. Plus two sim-only probes: dead stretches
 * by skill, and run length with each verb turned off. Pure: no DOM, no node APIs, no engine.
 * See docs/playtest.md.
 */
export { ARCHETYPES, CAST_DEFAULTS, cast, FIRST_NAMES, LAST_INITIALS } from './cast.mjs'
export {
  clock,
  day1Odds,
  LABELS,
  MODEL,
  playDay,
  playtestEnv,
  reaches,
  runPlaytest,
  stepsPerSecond,
} from './day.mjs'
export {
  ablationVariants,
  deadStretches,
  formatDeadStretches,
  formatVerbAblation,
  verbAblation,
} from './probes.mjs'
export { formatReport, mean, median, WHYS } from './report.mjs'
export { mulberry32 } from './rng.mjs'
