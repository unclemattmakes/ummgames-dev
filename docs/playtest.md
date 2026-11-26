# Simulated playtest

A hundred fictional players through a game's real sim. Each player is drawn from a weighted
archetype of a web portal's audience, gets a skill, a device, a time at which they find each of
the game's verbs (or never), and a small attention meter. Then they play: load, the first click,
run after run with the game's bot at their skill, the between-runs screen (a shop, an upgrade
tree), until their attention, their patience or their minutes run out. A report says where they
left, why, and how each kind of player fared.

Two probes ask the sim alone, with no attention model:
- **dead stretches:** the stretches of 12 s or more with no moment, run after run, by skill;
- **verb ablation:** how long a run lasts with each verb turned off, by skill.

**The game is real; the people are invented.** Where the sim says something (run lengths, dead
stretches, which verb keeps a run alive), it is a fact about the build. Where the attention model
says something (conversion, playtime, Day 1), it is a comparison between beats and between kinds
of player, never a forecast of a portal's dashboard. The archetypes and the model are judgement,
set so a game like ours converts near 50% on desktop and 35% on mobile with Day 1 near 3%. It
does not see the look, the sound, the feel of a drag on glass, whether words on screen are read,
or frame hitches. Only real play and real stats judge those.

| Part | What it is |
|---|---|
| `cast`, `ARCHETYPES` | The fictional players, from a seed |
| `runPlaytest`, `playDay` | The day loop and the attention model |
| `formatReport` | The text report |
| `deadStretches`, `verbAblation` | The two sim-only probes, and their `format…` |

It needs a sim that is deterministic (a seed and the inputs replay a run) and a bot that plays
it at a skill from 0 to 1 with knobs per verb. It is pure: no DOM, no node APIs, no engine. It
runs in a game's Vitest lab config like any probe, and is never a gate.

## Quick start

1. Give the bot a knobs object it reads on every tick, so the playtest can turn verbs on as a
   player finds them. `knobsFor(skill)` gives the bot's own behaviour.
2. Write the adapter, `tests/lab/playtest-adapter.ts` (below).
3. Write the probe, `tests/lab/playtest.test.ts`:
   ```ts
   import { mkdirSync, writeFileSync } from 'node:fs'
   import { formatReport, playtestEnv, runPlaytest } from '@ummgames/dev/playtest'
   import { it } from 'vitest'
   import { adapter } from './playtest-adapter'

   it('playtest', () => {
     const result = runPlaytest(adapter, playtestEnv(process.env))
     mkdirSync('captures/playtest', { recursive: true })
     writeFileSync(`captures/playtest/cast-${result.seed}.json`, JSON.stringify(result.days, null, 1))
     console.log(formatReport(result, adapter))
   })
   ```
4. Add a script, `"playtest": "vitest run -c vitest.lab.config.ts tests/lab/playtest.test.ts"`,
   and run it. `CAST=2` draws a different hundred, `PLAYERS=300` more of them, `BOREDOM=0.6` the
   gentler model.

The adapter, for a sim with `newRun`, `step`, `createBot` and `knobsFor`:

```ts
import type { PlaytestAdapter } from '@ummgames/dev/playtest'
import { type BotKnobs, createBot, knobsFor } from '@/sim/bot'
import { DT } from '@/sim/config'
import { newRun, step, type World } from '@/sim/step'

type Meta = { coins: number; upgrades: Record<string, number> }
type Run = { w: World; bot: ReturnType<typeof createBot>; k: BotKnobs }

export const adapter: PlaytestAdapter<Run, Meta> = {
  dt: DT,
  // The core verb is timed by each archetype; the rest by when the screen first offers them.
  verbs: { core: 'jump', later: { dash: 20, block: 45, special: { at: 120, mobile: 1.5 } } },
  // What each moment restores before habituation. Unlisted moments still end a dead stretch.
  momentValues: { coin: 0.03, kill: 0.07, combo: 0.2, bossDown: 0.4, runWin: 0.25 },
  milestones: [{ name: 'first combo', moments: ['combo'], short: 'combo' }],
  labels: { lost: 'died', between: 'shop' },
  meta: () => ({ coins: 0, upgrades: {} }),
  start: ({ run, seed, meta, skill }) => {
    const k = knobsFor(skill)
    return { w: newRun({ seed, runs: run, upgrades: meta.upgrades }), bot: createBot(skill, k), k }
  },
  knobs: (s, v) => {
    Object.assign(s.k, knobsFor(v.skill))
    s.k.think *= v.slow
    if (!v.has('dash')) s.k.dash = false
    if (!v.has('block')) s.k.blockAfter = Number.POSITIVE_INFINITY
    if (!v.has('special')) s.k.special = false
  },
  step: (s) => step(s.w, s.bot.tick(s.w)),
  moments: (s) => {
    const out = s.w.events.map((e) => e.kind)
    s.w.events.length = 0
    return out
  },
  over: (s) => s.w.over,
  won: (s) => s.w.won,
  between: ({ state, meta }) => {
    meta.coins += state.w.coins
    return buyCheapest(meta) // how many things it bought
  },
  where: (s) => `room ${s.w.room}, hp ${s.w.hp}`,
  summary: (s) => ({ room: s.w.room, kills: s.w.kills }),
}
```

The probes, in the same lab file:

```ts
import { deadStretches, formatDeadStretches, formatVerbAblation, verbAblation } from '@ummgames/dev/playtest'

it('dead stretches', () => console.log(formatDeadStretches(deadStretches(adapter))))
it('verb ablation', () => console.log(formatVerbAblation(verbAblation(adapter))))
```

## The adapter

`PlaytestAdapter<S, M>`: `S` is the game's own per-run state (a world, a bot, its knobs), `M` its
meta state across runs, which the between hook mutates in place.

| Field | Required | What it is |
|---|---|---|
| `dt` | yes | Seconds one `step` advances. `Math.round(1 / dt)` steps make a second. |
| `verbs` | yes | `{ core?, later }`. `core` names the verb each archetype times with `coreAt` and `coreNever`. `later` maps each other verb to the session second the screen first offers it, or `{ at, mobile }` with a stretch on a phone. The order of `later` is part of the seed. |
| `momentValues` | yes | Moment name to the interest it restores. A moment not listed restores 0 but still ends a dead stretch. |
| `milestones` | no | `{ name, moments, short? }`: the session time of a player's first of these moments. `moments` is a list or a test. A `short` puts it on the by-archetype line. |
| `labels` | no | `{ lost, between }`: the words for a lost run and the between-runs screen. Default `'lost'`, `'between screen'`. |
| `meta()` | no | A fresh meta state, once per day (and per skill in a probe). |
| `start(ctx)` | yes | Start a run. `ctx`: `run` (0 first), `seed`, `meta`, `skill`, and `persona` (null in a probe). |
| `knobs(state, view)` | no | Set the bot's knobs. Called before the first step and once a second. `view.has(verb)` is whether this player uses it yet; `view.slow` is 1, more on a phone or a poor frame rate; `view.persona` is null in a probe. |
| `step(state)` | yes | One sim step with the bot's input. |
| `moments(state)` | yes | The moments since the last call, by name, clearing them. Called after every step. |
| `over(state)`, `won(state)` | yes | Whether the run has ended, and whether it was won. |
| `between(ctx)` | no | The between-runs screen after a finished run: spend, and return how many things were bought (or a boolean). Without it, the screen still counts as reached, with no lift and no nothing-bought penalty. |
| `where(state)` | no | Where the run is, appended to a day's `at`. |
| `summary(state)` | no | Numbers kept with each run in the day's log and averaged in the ablation. |

In a day, a player's knobs come from what they have learnt. In a probe there is no player:
`view.has` is true for every verb the probe does not turn off, so `knobs` gives the bot its
skill's own behaviour minus those verbs.

## `runPlaytest(adapter, options?)`

A cast from the seed, then each player's day. Returns `{ seed, players, boredom, days }`.

| Option | Default | What it does |
|---|---|---|
| `players` | `100` | How many. |
| `seed` | `1` | The cast's seed. Every draw in a day derives from it. |
| `boredom` | `1` | Scales every player's boredom: the sensitivity check. Run `0.6` beside `1`; a finding that holds under both is the model's, not one setting's. |
| `archetypes` | `ARCHETYPES` | Replace, or extend with `[...ARCHETYPES, mine]`. |
| `firstNames`, `lastNames` | `FIRST_NAMES`, `LAST_INITIALS` | The names drawn. |
| `castDefaults` | `CAST_DEFAULTS` | `mobileShare` `0.45`, `loadPatienceDesktop` `[4, 15]`, `loadPatienceMobile` `[3, 12]`, `verbJitter` `[0.8, 1.4]`. |
| `model` | `MODEL` | Any of the attention model's numbers (below). |
| `day1` | `day1Odds` | Replaces the Day 1 formula. |

`playtestEnv(process.env)` reads `PLAYERS`, `CAST` (the seed) and `BOREDOM`. `playDay(adapter,
persona, seed, options?)` plays one player. `cast({ players, seed, verbs, ... })` draws the cast
alone.

### The archetypes

| Archetype | Weight | Device | Skill | Minutes |
|---|---|---|---|---|
| tab hopper | 22 | either | 0.25 to 0.55 | 2 to 10 |
| school chromebook kid | 16 | desktop | 0.1 to 0.45 | 6 to 30 |
| merge fan | 14 | either | 0.5 to 0.8 | 5 to 30 |
| tower defense fan | 12 | desktop | 0.65 to 0.95 | 10 to 45 |
| mobile commuter | 17 | mobile | 0.3 to 0.6 | 3 to 15 |
| mobile kid | 13 | mobile | 0.05 to 0.4 | 5 to 25 |
| roguelite veteran | 6 | desktop | 0.8 to 1 | 15 to 60 |

Each also has a frame rate spread, an age, the core verb's timing, a learning pace, a chance of
never finding each later verb, a hook, a boredom rate, a gap tolerance, a delight, a chance of
quitting on a loss and of leaving at the between screen, and a Day 1 base. `cast.mjs` has every
range. A player finds a later verb at its offer time times their pace times a jitter in
`[0.8, 1.4]`, times its `mobile` stretch on a phone.

### The attention model

Interest starts at the player's hook. Once a second it drops by their boredom, times
`BOREDOM`, times `drought` (2) once the stretch with no moment passes their gap tolerance, times
the frame rate's drag. A moment adds its value times their delight times `habituation` (0.9) to
the power of how often they have had it, never under `habituationFloor` (0.25) of it. At 0 they
leave bored.

| `MODEL` key | Default | What it does |
|---|---|---|
| `loadDesktop`, `loadMobile` | `[0.9, 2.6]`, `[1.8, 4.5]` | Seconds to the first frame. Past their patience they leave ('load'). |
| `misclickDesktop`, `misclickMobile` | `0.05`, `0.08` | Chance the first click was not meant ('misclick'). |
| `interestCap` | `1.2` | Interest never rises past this. |
| `habituation`, `habituationFloor` | `0.9`, `0.25` | A repeat moment's worth. |
| `drought` | `2` | Boredom multiplier past the gap tolerance. |
| `fpsDrag` | `{ good: 1, ok: 1.1, poor: 1.4 }` | Boredom multiplier by frame rate. |
| `mobileHands`, `poorFpsHands` | `1.3`, `1.25` | `view.slow`: multiply the bot's reaction times by it. |
| `lossQuitCap`, `earlyLoss`, `earlyLossSting` | `0.95`, `120`, `1.3` | A loss quits with the player's chance, times 1.3 for a run under 120 s, at most 0.95 ('lost'). |
| `lossPenalty` | `0.1` | Interest lost on a loss they play on from. |
| `overtime` | `180` | Seconds past their minutes at which they stop mid-run ('time'). Out of minutes after a run is 'done'. |
| `betweenSeconds` | `20` | Seconds the between screen takes. |
| `boughtLift`, `nothingBoughtLeave` | `0.08`, `0.15` | Interest gained when something was bought (times delight); leave chance added when nothing was. |
| `traceEvery` | `15` | Seconds between interest trace points. |
| `winMoment` | `'runWin'` | The moment enjoyed on a won run: give it a value in `momentValues`. |

**Day 1** (`day1Odds`): the player's base, times 2 if they reached the between screen (else
0.5), times 1.4 for 8 minutes or more (1 for 3 to 8, 0.6 under 3), times 0.6 if they left bored,
0.8 on a loss, 1.25 when their minutes ran out. `back` is a draw against it.

## `formatReport(result, adapter?)`

The text the probe prints. Pass the adapter for its labels and milestones.

| Section | What it says |
|---|---|
| The funnel | By desktop, mobile and all: conversion (a minute played), mean and median play, share who reached the between screen, Day 1 expected and drawn. |
| Why they left | Each reason, with its count and the median session time. |
| Left bored | A histogram by session minute. Where it piles up is the beat that loses them. |
| By archetype | Each archetype's conversion, play, between screen, milestones with a `short`, Day 1, and why they left. |
| Runs | Runs 1 to 4: won, lost (and lost inside 3 minutes), left mid-run, finished length, longest dead stretch; then by skill band 0 to 0.35, 0.35 to 0.65, 0.65 to 1. |
| Milestones | How many reached each, the median and the slowest. |
| Interest | The mean interest of those still playing, every 30 s, as a bar. A drop marks a beat that goes quiet; a jump, one that lands. |

## `deadStretches(adapter, options?)`

A bot at each skill plays runs in a row, with `between` after each, and the probe lists every
stretch of `minGap` seconds or more with no moment, the moments it counted, and the tail from the
last moment to the end. Returns one `{ skill, runs }` per skill; `formatDeadStretches` prints it.

| Option | Default | What it does |
|---|---|---|
| `skills` | `[0.2, 0.5, 0.85]` | The bots. |
| `runs` | `2` | Runs in a row per skill. |
| `seed` | `41` | Run n plays seed + n. |
| `minGap` | `12` | Seconds with no moment that count. |
| `minutes` | `12` | Longest a run plays. |
| `off` | none | Verbs the bot does not use. |

## `verbAblation(adapter, options?)`

The same run, by skill, with each variant's verbs turned off: which verbs decide whether a run
survives. Each row has the run lengths, the median, the shortest, how many were short and how
many were lost, and the mean of each `summary` number. `formatVerbAblation` prints one line a
row.

| Option | Default | What it does |
|---|---|---|
| `skills` | `[0.1, 0.25, 0.4, 0.55, 0.7, 0.85]` | The bots. |
| `seeds` | `12` | Seeds per skill and variant. |
| `seed` | `500` | The first seed. |
| `run` | `1` | Which run index (1 is the second run, often the first that can be lost). |
| `minutes` | `20` | Longest a run plays. |
| `short` | `180` | A run under this many seconds counts as short. |
| `meta` | `adapter.meta` | The meta each run starts from: what a player has bought by then. |
| `variants` | `ablationVariants(adapter.verbs)` | Name to verbs off: every verb, each later verb alone, then only the core verb. |

## File formats

`runPlaytest` returns plain data; the probe writes `days` as JSON. One `PlaytestDay` per player:
`persona` (a verb never found is `null` in JSON, Infinity in memory), `played` (session seconds),
`why` (`load`, `misclick`, `bored`, `lost`, `between`, `done`, `time`), `at` (where they were),
`runs`, `milestones` (seconds, -1 for never), `between`, `continued`, `losses`, `runLog` (each
run's `n`, `t`, `end`, longest `gap` and `info`), `trace`, `lastGap`, `d1`, `back`.

## How it works

- **Seeds.** The cast draws from `mulberry32(seed)` in a fixed order. A day draws from
  `mulberry32(seed * 7919 + id)`; run n of player `id` gets seed `seed * 1000 + id * 13 + n`.
  The game's sim draws from its own run seed, so the model's draws never move the sim's.
- **The loop.** Each step: `knobs` once a second, `step`, then each moment refills interest
  and may set a milestone. Once a second: the drain, the trace, and the bored or time check.
  After a run: a win's moment, or a loss's quit draw and penalty; the minutes check; the
  between hook, its lift and its leave draw; then 20 s and the next run.
- **Same seed, same report.** Nothing reads a clock or `Math.random`. A game moving its own
  copy of this loop onto the kit gets the same days for the same seed, as long as its verb
  table lists the verbs in the order its copy drew them.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Every player leaves at 0:00 with `load` | `loadPatience` is under the load time: a custom archetype or `castDefaults` with patience in minutes. It is seconds. |
| Nobody learns a verb | `has` reads `persona.learn[verb]`; a name in `knobs` that is not in `verbs` is never learnt. |
| The report's interest never drops | `moments` returns the same list every step: clear the events after reading them. |
| A run never ends | `over` never turns true; the day still ends at the player's minutes plus `overtime`. A probe stops at `minutes`. |
| `dt ... is not a fraction of a second` | `dt` is over 1 s or 0. |

## For agents

- Run it as a lab probe, never in `pnpm check`: a hundred days of a real sim take a minute or
  two.
- Report sim facts (run length, dead stretches, the ablation) as facts, and model numbers
  (conversion, playtime, Day 1) as comparisons between beats or casts. Say which is which.
- Check a finding against `BOREDOM=0.6` and a second `CAST` before acting on it.
- When the model and a real player disagree, the real player wins.
