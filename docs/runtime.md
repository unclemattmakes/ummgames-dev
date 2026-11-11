# Runtime code: copy and drift

Code that ships inside a game's build lives in `runtime/`, as TypeScript: the perf HUD, the dev
command bar, the gamepad profiles, the loading splash, the pure core of a procedural music
sequencer. It is **copied**, not linked. `umm-dev copy` writes a file into the game with a header on line 1, and from then on
the copy is the game's to change. `umm-dev drift` reports how far each copy has moved from the
version it came from, and how far the installed version has moved since. Reach for it when a game
wants one of these files, and when the game bumps the kit's tag.

The same two commands also copy from **the game's own sources**: git checkouts on the same
machine, named in the game's config, for code that several games share but that cannot be public
(see "Copying from the game's own sources" below).

## Quick start

From the game's root (`npx umm-dev` under npm):

```sh
pnpm exec umm-dev copy --list                 # what this version ships
pnpm exec umm-dev copy dev/perf-recorder.ts   # one file, to src/dev/perf-recorder.ts
pnpm exec umm-dev drift                       # a line per copy
```

When it works, copy prints a line per file and drift calls the copy `current`:

```
written  src/dev/perf-recorder.ts  (from dev/perf-recorder.ts)

1 runtime copies in /path/to/game; installed @ummgames/dev v0.1.0

  src/dev/perf-recorder.ts  v0.1.0   current
```

**Where a copy lands.** Without `--to`, a file goes to `<runtime.into>/<its path under runtime/>`,
and `runtime.into` is `src`. So `runtime/dev/perf-hud.ts` lands at `src/dev/perf-hud.ts`. A
game that keeps the file somewhere else (a HUD at `src/debug/perf-hud.ts`, say) must name that
path:

```sh
pnpm exec umm-dev copy dev/perf-hud.ts --to src/debug/perf-hud.ts
```

Without `--to`, copy finds nothing at `src/dev/perf-hud.ts`, writes a second copy there,
says `written`, and exits 0. Run with `--dry-run` first whenever the game already has the file.

## `umm-dev copy`

```
umm-dev copy <runtime path> [--to <path in game>] [--force] [--dry-run]
umm-dev copy --from <source> <path> [--ref <commit-ish>] [--to <path in game>] [--force] [--dry-run]
umm-dev copy [--from <source>] --list
```

`<runtime path>` is a file or a folder under `runtime/`, with or without the `runtime/` prefix:
`dev/fuzzy.ts`, `runtime/dev`, `input`. A folder names every file under it.

| Option | Value | Default | What it does |
|---|---|---|---|
| `--to` | a path from the game root | `<runtime.into>/<path under runtime/>` | Where it goes. A trailing `/`, an existing folder, or a folder copy means "inside this folder"; otherwise it is the file's exact path. Relative to the game root, not the current folder. |
| `--force` | | off | Overwrite a copy that was changed here. Overwrite a file that is not a copy only when `<runtime path>` names that one file. |
| `--dry-run` | | off | Say what would be written; write nothing. Refusals still show. |
| `--from` | a name in `runtime.sources` | | Copy from that source instead of `runtime/`. `<path>` is a file or folder in the source's checkout, read at its `ref`. The default destination is `<runtime.into>/<path>`. |
| `--ref` | a commit-ish | the source's `ref` | With `--from`: read at this instead, such as a branch not merged yet. Drift still compares with the source's `ref`, so the copy shows as `changed upstream` until the branch lands and it is copied again. |
| `--list` | | | List the runtime files this version ships, and exit. With `--from`, list the files the source has at its `ref`. |
| `-h`, `--help` | | | Print the usage. |

**Destinations.**

| Command | Writes |
|---|---|
| `copy dev/fuzzy.ts` | `src/dev/fuzzy.ts` |
| `copy dev` | `src/dev/<each file>` |
| `copy boot/dev-splash.ts --to src/boot/splash.ts` | `src/boot/splash.ts` |
| `copy input --to src/boot/` | `src/boot/pad-profiles.ts` |
| `copy dev --to src/tools/dev/` | `src/tools/dev/<each file>` |

**Outcomes.** One line per file:

| Outcome | Meaning |
|---|---|
| `written` | Nothing was there; the copy is new. |
| `updated` | An untouched copy (or, with `--force`, a changed one) was replaced. |
| `current` | The file already matches, header and all. Nothing written. |
| `refused` | Not written. The line says why, on stderr. |
| `would-write` | `--dry-run`: this file would be written or updated. |

After writing, copy names any relative import that has no file beside the copy:
`imports ./registry, which is not beside it: copy that too`. Copy that sibling to the same folder.

**Exit codes.**

| Code | When |
|---|---|
| 0 | Every file written, updated or already current; also `--list`, `--help`, and a `--dry-run` that would refuse nothing. |
| 1 | Some file was refused, or, with `--dry-run`, would be. A folder copy still writes the files it can. |
| 2 | A usage error, or no runtime file or folder by that name. |

**Copy never clobbers work.** Over an existing file it writes only when that file is an untouched
copy: its body still hashes to its header. That is how a game takes an upstream change.

- **A copy changed here** needs `--force`.
- **A file that is not a copy** (the game's own code, or a copy from before these headers) needs
  `--force` and a `<runtime path>` that names that one file. A folder copy never overwrites one,
  even with `--force`, and lists it as refused.

### Taking over a file the game already has

A game that wrote its own version of a runtime file (or copied one by hand before these headers)
adopts the kit's version one file at a time:

```sh
pnpm exec umm-dev copy dev/perf-hud.ts --to src/debug/perf-hud.ts --dry-run
pnpm exec umm-dev copy dev/perf-hud.ts --to src/debug/perf-hud.ts --force
```

```
refused  src/debug/perf-hud.ts: exists and is not a copy; --force overwrites
updated  src/debug/perf-hud.ts  (from dev/perf-hud.ts)
         imports ./perf-recorder, which is not beside it: copy that too
```

1. Name the game's file with `--to`, even when it sits at the default path.
2. Diff the game's old file against the copy (`git diff`) and carry over anything the game
   needs. The game's changes then sit below the header, and drift reports them as
   `changed here`.
3. Copy the siblings it names, with `--to` pointing at the same folder.

A file whose name the game uses for unrelated code is not taken over: copy the runtime file to
another path with `--to`.

### Taking an upstream change

After the game bumps the kit's tag:

```sh
pnpm exec umm-dev drift
```

```
  src/debug/perf-hud.ts  v0.1.0   changed upstream
                                  take it: umm-dev copy dev/perf-hud.ts --to src/debug/perf-hud.ts
  src/dev/fuzzy.ts       v0.1.0   changed here and upstream
                                  merge by hand: umm-dev drift --diff
```

- **`changed upstream`:** run the line drift prints. The copy is untouched, so it updates in
  place with no `--force`.
- **`changed here and upstream`:** the game changed its copy and the kit changed the original.
  Read `umm-dev drift --diff`, then decide. To keep the game's changes on the new version: save
  them (`drift --diff` shows them), run the same copy with `--force`, and apply them again. Drift
  then reports `changed here` against the new tag.
- **`changed here`:** nothing to take. The copy is the game's.

Take each file with the `--to` that drift prints. A folder copy (`copy dev`) writes only to the
default paths: it updates copies there, and writes a second copy of any file the game keeps
elsewhere.

### Examples

```sh
umm-dev copy dev                                     # every file in runtime/dev/, to src/dev/
umm-dev copy input/pad-profiles.ts                   # one file, to src/input/pad-profiles.ts
umm-dev copy boot/dev-splash.ts --to src/boot/splash.ts
umm-dev copy dev --to src/tools/dev/                 # a folder, into another folder
umm-dev copy dev/fuzzy.ts --to src/dev/fuzzy.ts --force   # replace one changed copy
umm-dev copy --from net client/net.ts --to src/net/net.ts  # a file from the game's source "net"
umm-dev copy --from net --list                       # what that source has
```

### Copying from the game's own sources

Some code is shared by several games but cannot go in this public package: it names a game, a
host or a service, or it is not ready to be public. Keep it in one private repo, the **source**,
and copy it into each game the same way as a runtime file. The copies carry a header, so drift
can say which games hold an old copy.

1. Name the source in each game's `umm-dev.config.mjs`. `repo` is the path to its git checkout;
   a relative path is read from the game's main checkout, so it means the same folder from every
   worktree.

   ```js
   export default defineConfig({
     runtime: { sources: { net: { repo: '../network', ref: 'main' } } },
   })
   ```

2. Commit the change in the source. Copy reads committed work only, through git at `ref`, so an
   unfinished edit in the source's working tree never leaks into a game.
3. Copy it into each game, with the game's path:

   ```sh
   pnpm exec umm-dev copy --from net client/net.ts --to src/net/net.ts
   ```

   Line 1 names the source, the commit that last changed the file, and its path:

   ```ts
   // Copied from net 1a2b3c4d5e6f client/net.ts (sha256 0123456789abcdef). Change it there and copy it again; `umm-dev drift` compares.
   ```

4. `umm-dev drift` in each game then says `current`, or `changed upstream` with the line that
   takes the new version.

**Change it in the source, not in a game.** A copy changed in a game says `changed here`, and the
next copy refuses it without `--force`, as with a runtime copy.

**On another machine,** or in a checkout without the source beside it, drift calls each source
copy `source not found` and the game still builds: the copies are ordinary files. Nothing is
installed and no token is needed.

**This package never names a source.** The names and paths live only in each game's config.


## `umm-dev drift`

```
umm-dev drift [--json] [--diff] [--strict]
```

It finds every copy by its header and compares three hashes: the header's (the body when it was
copied), the body's now, and the installed `runtime/` file's. For a copy from one of the game's
own sources, the third is the source's file at its `ref`, read through git.

| Option | Value | Default | What it does |
|---|---|---|---|
| `--json` | | off | Print `{ root, installed, copies: [...] }` instead of the table. |
| `--diff` | | off | After the table, show the changes for each copy that is not current. |
| `--strict` | | off | Exit 1 when any copy is not current (for CI). |
| `-h`, `--help` | | | Print the usage. |

| Status | Meaning | Next step |
|---|---|---|
| `current` | Unchanged here, and the installed file is the same. | None. |
| `changed here` | The game edited its copy. Upstream has not moved. | None: the copy is the game's. |
| `changed upstream` | The installed version's file differs from what was copied. | Run the `take it:` line drift prints. |
| `changed here and upstream` | Both moved. | Merge by hand; `--diff` shows both sides. |
| `no longer shipped` | The installed version has no such file. A source copy: the source has no such file at its `ref`. | None: the copy is wholly the game's. |
| `source not found` | A source copy whose source is not in `runtime.sources`, or whose checkout is not on this machine. | Name it in `runtime.sources`, or run drift where the source is. |

A status compares hashes, not versions. A copy taken at `v0.1.0` stays `current` under `v0.2.0`
when that file did not change.

**`--json`.** Each entry in `copies` has `file`, `source` (`null` for a runtime copy, else the
source's name), `runtimePath` (the path in its source), `version` (a tag, or a source's commit),
`hash`, `localHash`, `upstreamHash` (`null` when no longer shipped or the source is not found),
`changedHere`, `changedUpstream` and `status` (`current`, `changed-here`, `changed-upstream`,
`changed-both`, `gone-upstream` or `no-source`).

**`--diff`.** It shows the original against the game's copy, and the original against the
installed file. The original is free when only one side moved (it is the other side). When both
moved, drift needs the file at the header's tag:

1. `UMM_DEV_REPO`, if set, names a local clone: `git -C $UMM_DEV_REPO show <tag>:<path>`.
2. Otherwise it fetches `https://raw.githubusercontent.com/unclemattmakes/ummgames-dev/<tag>/<path>`,
   with an 8 s timeout.

Either way the text must hash to the header's hash, or it is not used. Offline, or with neither,
drift says why and diffs the copy against the installed file instead. A source copy's original
is the source's file at the header's commit, read through git; nothing is fetched.

**Exit codes.** Drift is information, not an error.

| Code | When |
|---|---|
| 0 | Reported, drifted or not. Also when there are no copies. |
| 1 | `--strict`, and some copy is not current. `source not found` counts. |
| 2 | A usage error. |

### Examples

```sh
umm-dev drift            # a line per copy
umm-dev drift --diff     # and the changes
umm-dev drift --json     # for a script
umm-dev drift --strict   # in CI: fail when a copy moved
UMM_DEV_REPO=../ummgames-dev umm-dev drift --diff   # diff offline, from a clone with tags
```

## `runtime/dev/`

Dev tools a game loads in its dev build: a frame-time recorder and HUD, a Ctrl/Cmd+K command bar
over a tool list, and a live tuner panel. Import them lazily from a dev-only path, so none of it
reaches the production entry chunk. `palette.ts` reaches every other file here, so copy the whole
folder (`umm-dev copy dev`) to use it.

| File | Imports |
|---|---|
| `perf-recorder.ts`, `fuzzy.ts`, `registry-types.ts`, `tuner-panel.ts` | nothing |
| `perf-hud.ts` | `perf-recorder` (types) |
| `registry.ts` | `registry-types` |
| `command-bar.ts` | `fuzzy`, `registry`, `registry-types` |
| `palette.ts` | `command-bar`, `perf-hud`, `registry`, `registry-types`, `tuner-panel` |

### `perf-recorder.ts`

**Exports:** `createPerfRecorder(capacity?, hitchMs?)`, `percentile(sorted, q)`,
`PERF_RING_CAPACITY` (600), `HITCH_THRESHOLD_MS` (33.4), and the types `PerfRecorder`,
`PerfStats`.

A ring of frame times. `sample(now)` records the time since the last call (the first call only
sets the baseline). `push(ms, now?)` records a measured value, such as GPU time. `stats()` gives
`fps`, `avgMs`, `p50Ms`, `p95Ms`, `p99Ms`, `minMs`, `maxMs`, `count` and `hitchCount` (frames over
`hitchMs`) over what the ring holds. `toCsv()` dumps `frame_index,t_ms,dt_ms`. `reset()` empties
it. `sample()` and `push()` allocate nothing; call `stats()` a few times a second, not per frame.

| Argument | Default | What it does |
|---|---|---|
| `capacity` | 600 | Samples in the ring: ten seconds at 60 Hz, less on a faster display. |
| `hitchMs` | 33.4 | A frame over this counts as a hitch. |

### `perf-hud.ts`

**Exports:** `createPerfHud(options?)`, `DEFAULT_BUDGET`, `formatCount(n)`, and the types
`PerfHud`, `PerfHudOptions`, `PerfBudget`, `RenderInfoLite`, `FrameCost`, `PerfDiagnostics`.

A fixed panel, hidden until `setVisible(true)`. `tick(stats, info?, cost?, gpu?)` draws it, and
returns at once while hidden. A row turns amber over its budget. It imports no renderer: pass the
renderer's counters as `RenderInfoLite`.

```ts
import { createPerfHud } from './dev/perf-hud'
import { createPerfRecorder } from './dev/perf-recorder'

const frames = createPerfRecorder()
const hud = createPerfHud({ budget: { drawCalls: 400 } })
hud.setVisible(new URLSearchParams(location.search).has('perf'))
let drawnAt = 0
function frame(now: number) {
  frames.sample(now)
  if (now - drawnAt > 250) {
    hud.tick(frames.stats())
    drawnAt = now
  }
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
```

| Option | Default | What it does |
|---|---|---|
| `budget` | `DEFAULT_BUDGET` | Merged over the 60 Hz default: `frameP95Ms` 16.7, `gpuP95Ms` 12, `simMs` 2, `renderMs` 4, `drawCalls` 250, `triangles` 750 000. |
| `parent` | `document.body` | Where the panel goes. |
| `id` | `'perf-hud'` | The panel's element id. |

### `registry-types.ts`, `registry.ts`, `fuzzy.ts`, `command-bar.ts`

**Exports:**
- `registry-types.ts`: `DEV_TOOL_GROUPS` and the types `DevTool`, `DevToolGroup`, `SceneTool`,
  `PanelTool`, `ToggleTool`, `ParamTool`, `ActionTool`.
- `registry.ts`: `runTool(tool)`, `buildUrl(mutations, href?)`, `urlHas(param, value?, search?)`,
  `toolHasState(tool)`, `toolIsOn(tool)`.
- `fuzzy.ts`: `fuzzyScore(query, text)`: lower is better, `null` for no match.
- `command-bar.ts`: `installCommandBar(tools, options?)`, `filterTools(tools, query)`, and the
  types `CommandBar`, `CommandBarOptions`.

A `DevTool` is one of five kinds: `scene` (sets `?param=value` and navigates), `panel` (opens a
docked panel), `toggle` (a live on/off), `param` (a boot-time URL param that reloads) and
`action` (a one-shot command). `group` is any string; `DEV_TOOL_GROUPS` holds the usual ones.

The bar opens and closes on Ctrl/Cmd+K. Esc closes it, the arrows move, Enter runs. Typed keys
never reach the game. `suspendKeys` is the game's hook: hold the game's keyboard when the bar
opens, and return the release.

```ts
import { installCommandBar } from './dev/command-bar'
import type { DevTool } from './dev/registry-types'

const tools: DevTool[] = [
  { id: 'action.respawn', label: 'Respawn player', group: 'Actions', kind: 'action', run: respawn },
  { id: 'scene.editor', label: 'Level editor', group: 'Scenes', kind: 'scene', param: 'edit' },
]
const bar = installCommandBar(tools, { suspendKeys: () => input.suspend() })
```

| Option | Default | What it does |
|---|---|---|
| `suspendKeys` | none | Called on open; the function it returns is called on close. |
| `placeholder` | `'Search dev tools…'` | The input's placeholder. |

The bar's colors read `--dev-ink`, `--dev-ink-dim`, `--dev-line`, `--dev-accent` and
`--dev-font-mono` when the page sets them.

### `tuner-panel.ts`

**Exports:** `openTunerPanel(set, onClose, options?)`, `saveTuning(set, saveUrl?)`, and the types
`TuningSet`, `TuningSpec`, `TuningField`, `TunerPanel`, `TunerPanelOptions`.

A slider and a number box per field of a `TuningSet`, docked top left. Edits write `set.values`
in place, so whatever reads that object feels them on its next step. **Save** POSTs the values as
JSON to `saveUrl(id)`; the game's dev server writes the file. **Revert** returns to `set.saved`,
**Defaults** to the spec's defaults, and **Copy** puts the JSON on the clipboard.

```ts
import { openTunerPanel } from './dev/tuner-panel'

const move = {
  id: 'move',
  title: 'Movement',
  spec: { speed: { label: 'Speed', default: 6, min: 0, max: 20, step: 0.1, unit: 'm/s' } },
  values: { speed: 6 },
  saved: { speed: 6 },
}
const panel = openTunerPanel(move, () => {})
```

| Option | Default | What it does |
|---|---|---|
| `saveUrl` | `` id => `/__dev/tuning/${id}` `` | Where Save POSTs. |
| `savedText` | `` id => `saved ${id}` `` | The status line after a save. |
| `id` | `'dev-tuner'` | The panel's element id. |

### `palette.ts`

**Exports:** `installDevPalette(tools, options?)`, `tunerTools(sets, options?)`,
`perfHudTool(hud, hint?)`, `paramTool(param, value, label, keywords?, group?)`, and the type
`DevPalette`.

The game owns its tool list. This gives it the tools most games share, and installs the bar.
Tuner panels share one dock: opening one closes the other, and running an open one again closes
it.

```ts
const { installDevPalette, perfHudTool, paramTool, tunerTools } = await import('./dev/palette')
const palette = installDevPalette(
  [
    ...tunerTools([move]),
    perfHudTool(hud),
    paramTool('backend', 'webgl2', 'Force WebGL2 backend', 'fallback'),
  ],
  { suspendKeys: () => input.suspend() },
)
```

| Function | Option | Default | What it does |
|---|---|---|---|
| `installDevPalette` | `suspendKeys`, `placeholder` | | Passed to the command bar. |
| `installDevPalette` | `tunerId` | `'dev-tuner'` | The tuner element `destroy()` removes. Match `tunerTools`' `id`. |
| `tunerTools` | `saveUrl`, `savedText`, `id` | | Passed to each tuner panel. |
| `tunerTools` | `hint` | `` set => `Live-edit the ${set.id} tuning` `` | The line under each tool. |
| `perfHudTool` | `hint` | `'Also ?perf=1'` | The line under the tool. The game reads `?perf` itself. |
| `paramTool` | `group` | `'Render'` | The group shown beside it. |

## `runtime/input/`

### `pad-profiles.ts`

**Exports:** `activeGamepad()`, `normalizedGamepads()`, `normalizeGamepad(pad)`,
`selectActiveGamepad(pads)`, `parseGamepadVendorProduct(id)`, and the types `NormalizedGamepad`,
`NormalizedButton`, `GamepadLike`, `PadLayout`.

Read pads through `activeGamepad()` instead of `navigator.getGamepads()[0]`. It returns the pad
used last, in the W3C standard order, or `null`. Raw Valve pads (Steam Controller, Steam Deck)
that arrive with `mapping: ""` are remapped to standard order; any other pad passes through.
`layout` says which: `'standard'`, `'steam-raw'`, `'steam-raw-2015'` or `'raw'`.

```ts
import { activeGamepad } from './input/pad-profiles'

const pad = activeGamepad()
if (pad?.buttons[0]?.pressed) jump()
const moveX = pad?.axes[0] ?? 0
```

No options. A Valve pad's grips and other extras sit at button 17 and up.

### `haptics.ts`

**Exports:** `createHaptics(effects, sink, options?)`, `padSink(getPads)`,
`phoneSink(enabled?, min?)`, `bothSinks(...sinks)`, `NO_HAPTICS`, and the types `Haptics`,
`HapticsOptions`, `HapticTable`, `HapticEffect`, `HapticSegment`, `HapticSink`, `HapticPad`.

Rumble, with a priority scheduler. A pad's `playEffect` cuts off whatever is running, so calling
it from several places has a light tick kill a heavy hit. Give the scheduler the game's table of
effects and one sink, and call only `trigger`. A stronger effect cuts in over a weaker one; a
weaker one is dropped while a stronger one runs; an equal one replaces it. `setHum` holds a
level under every effect (an engine, a boost), refreshed in short pulses. `setStrength` (a
slider), `setEnabled` (a switch) and `setHeld` (a pause or menu) stop what runs and drop
triggers. The scheduler is pure: it takes the time, so a test drives it with a fake clock.

The sinks touch the device and never throw. `padSink` sends dual-rumble (or the older `pulse`)
to the pads `getPads()` names at each burst: one, a list (both XR controllers), or null.
`phoneSink` uses `navigator.vibrate` for bursts with some weight (Android; iOS Safari has none).
One scheduler per player, each on their own pad's sink, keeps co-op rumble apart.

```ts
import { createHaptics, padSink, type HapticTable } from './input/haptics'

const EFFECTS: HapticTable<'hit' | 'dash'> = {
  hit: { priority: 2, segments: [{ at: 0, ms: 150, strong: 0.8, weak: 0.6 }] },
  dash: { priority: 1, segments: [{ at: 0, ms: 45, strong: 0, weak: 0.45 }] },
}
const rumble = createHaptics(EFFECTS, padSink(() => navigator.getGamepads()[0]))
rumble.trigger('hit', performance.now())
// every frame:
rumble.update(performance.now())
```

| Option | Default | What it does |
|---|---|---|
| `strength` | `1` | 0..1, scales every burst and the hum. 0 is off. |
| `humRefreshMs` | `100` | How often the hum is refreshed. |
| `humPulseMs` | `140` | How long each hum pulse runs; longer than the refresh, so no gap opens. |

### `stick.ts`

**Exports:** `shapeStick(x, y, shape, out)`, `clampUnit(out)`, `MOVE_STICK`, `CAMERA_STICK`, and
the types `StickShape`, `Vec2Out`.

Analog stick shaping, radial rather than per axis. A per-axis dead zone snaps a near-diagonal
onto the axes, so a shallow diagonal cannot be held. Here the dead zone is a circle: below
`inner` the stick reads 0, the length from `inner` to `outer` maps onto 0 to 1, and the
direction is kept exactly. That 0 to 1 is then raised to the power `curve`.

```ts
import { clampUnit, MOVE_STICK, shapeStick } from './input/stick'

const move = { x: 0, y: 0 }
shapeStick(pad.axes[0] ?? 0, pad.axes[1] ?? 0, MOVE_STICK, move) // writes into move
// keys: move.x = right - left; move.y = down - up; clampUnit(move)
```

| Export | What it does |
|---|---|
| `shapeStick(x, y, shape, out)` | Writes the shaped stick into `out` and returns it. A `NaN` reads as 0. Allocates nothing. |
| `clampUnit(out)` | Scales a direction longer than 1 down to 1, so a keyboard diagonal is not 41% faster. Shorter ones pass through. |
| `MOVE_STICK` | `{ inner: 0.18, outer: 0.92, curve: 1 }`: linear, so walk and run speeds follow the stick. |
| `CAMERA_STICK` | `{ inner: 0.2, outer: 0.95, curve: 1.6 }`: a softer centre for fine aim. |

**Shape input before a replay records it.** `shapeStick` uses `Math.hypot` and `**`, which
engines may round differently in the last bit. Record the shaped values, or the raw ones and
shape them inside the sim with `runtime/sim/det.ts`.

## `runtime/boot/`

### `dev-splash.ts` and `dev-splash.css`

**Exports:** `startDevSplash(options)`, `splashWords(game, words?)`, `splashWordsIn(root)`,
`createSteadyWatch(options?)`, `SPLASH_WORDS`, `SPLASH_TIMINGS`, `STEADY_WATCH`, the pure timing
functions `splashBeats`, `splashFrameAt`, `splashFrameCut`, `landedAfterLoad` and `fadeAt`, and
the types `DevSplash`, `DevSplashOptions`, `SplashTimings`, `SplashBeat`, `SplashFrame`,
`SteadyWatch`, `SteadyWatchOptions`.

The "Uncle Matt Makes: ___" loading splash. The blank types a word at a time and lands on the
last word, over a load bar. It drives markup already in the page, so it is up from the first
paint. The `devSplash()` Vite plugin writes that markup and links the stylesheet
([build.md](build.md#devsplashoptions-the-loading-splashs-page)); a game without it links
`dev-splash.css` in `<head>` and puts this in `<body>`, with one sizer per word:

```html
<div id="dev-splash" role="status" aria-label="Uncle Matt Makes: Games. Loading.">
  <div class="dev-splash__lockup">
    <img class="dev-splash__portrait" alt="" width="384" height="384" decoding="async" />
    <h1 class="dev-splash__mark">Uncle Matt Makes:
      <span class="dev-splash__blank" aria-hidden="true">
        <span class="dev-splash__sizer">stuff</span>
        <span class="dev-splash__sizer">Games</span>
        <span class="dev-splash__line"><span class="dev-splash__typed"></span><span
          class="dev-splash__caret"></span></span>
      </span>
      <span class="visually-hidden">Games</span>
    </h1>
  </div>
  <div class="dev-splash__bar" aria-hidden="true"><div class="dev-splash__fill"></div></div>
</div>
```

```ts
import { createSteadyWatch, startDevSplash } from './boot/dev-splash'

const splash = startDevSplash({
  root: document.getElementById('dev-splash'),
  onLift: () => title.start(),
})
// during boot: splash.progress(0.4) … splash.ready()
const steady = createSteadyWatch()
// every frame after ready(): if (splash.covering() && steady.step(dtMs)) splash.steady()
// while splash.covering(), treat every confirm as already held
// on a boot error: splash.fail()
```

It goes once `ready()` (and `steady()`, by default) have been called and the last word has held
for `holdMs`, or on a skip after `ready()`. A skip is a click, a tap, Enter, Space or a pad's A.
With `prefers-reduced-motion`, it shows the last word at once.

| Option | Default | What it does |
|---|---|---|
| `root` | required | The `#dev-splash` element. `null`, or markup missing `.dev-splash__typed` or `.dev-splash__fill`, removes it and returns a splash that does nothing. |
| `portraitUrl` | the `<img>`'s `data-src` | The brand image. `null`, or absent with no `data-src`, removes the `<img>` and leaves the wordmark. |
| `words` | the sizers' words, else `SPLASH_WORDS` | The blank's words; the last is the one it lands on. Absent, it types what the sizers spell, so the markup is the one list. |
| `timings` | `SPLASH_TIMINGS` | Merged over the defaults: `holdMs` 1200, `fadeMs` 500, `faceWaitMs` 600, and the typing speeds. |
| `waitForSteady` | `true` | Wait for `steady()` as well as `ready()`. |
| `onLift` | none | Called as the fade starts. |
| `onGone` | none | Called once it is removed from the page. |
| `font` | `'700 1em Bitter'` | The face it waits for (up to `faceWaitMs`) before typing; `null` not to wait. The game serves the font. |
| `mark` | `'boot:title'` | A `performance.mark` set as it lifts; `null` for none. |
| `skipKeys` | `['Enter', ' ']` | `KeyboardEvent.key` values that skip. |
| `padSkip` | `true` | Whether a pad's A (button 0) skips. |
| `now` | `performance.now` | The clock, for tests. |

| Export | What it does |
|---|---|
| `splashWords(game, words?)` | `words` (default `SPLASH_WORDS`) with `game` just before the last: `['stuff', …, 'mistakes', 'My Game', 'Games']`. The plugin's `game` option uses the same rule. |
| `splashWordsIn(root)` | The words the sizers under `root` spell, trimmed, in order; `[]` when there are none. |
| `createSteadyWatch(options?)` | `{ step(frameMs) }`, true once frames are steady: a run of `frames` frames at or under `frameMs`, or `giveUpMs` of frame time in all. Once true it stays true. `STEADY_WATCH` is `{ frameMs: 34, frames: 20, giveUpMs: 3000 }`; `options` merge over it. |

### Adopting the splash

A game shows the splash with two copied files, one plugin and a few lines of boot code.

1. **Copy the runtime files** to `src/boot/dev-splash.ts` and `src/boot/dev-splash.css`:
   ```sh
   pnpm exec umm-dev copy boot
   ```
2. **Add the plugin** in `vite.config`, naming the game:
   ```js
   import { devSplash } from '@ummgames/dev/vite'
   plugins: [devSplash({ game: 'My Game', url: 'example.com' })]
   ```
   It writes the markup and the stylesheet link into `index.html` and serves the portrait. A game
   that keeps the stylesheet elsewhere passes `css: '/<its path>'`.
3. **Serve the face.** The lockup is set in Bitter 700. Import it in the entry, for example
   `import '@fontsource/bitter/latin-700.css'` (with `@fontsource/bitter` pinned in
   `dependencies`). Without it the splash waits `faceWaitMs` and falls back to Georgia.
4. **Start it in the entry, and feed it the boot:**
   ```ts
   import { createSteadyWatch, startDevSplash } from './boot/dev-splash'

   const splash = startDevSplash({ root: document.getElementById('dev-splash') })
   boot(splash).catch((e) => {
     console.error(e)
     splash.fail()
   })
   // in boot: splash.progress(f) as it loads, then splash.ready()
   // in the frame loop, from ready() on:
   //   if (splash.covering() && steady.step(dtMs)) splash.steady()
   //   while splash.covering(), read no input: the press that skips it is not a press on the game
   ```
5. **Leave it off where a load must not wait,** such as a capture or a bot run: remove the
   element and pass `root: null`, which returns a splash that does nothing.
   ```ts
   const el = document.getElementById('dev-splash')
   if (!wanted) el?.remove()
   const splash = startDevSplash({ root: wanted ? el : null })
   ```

**Moving a game with the hand-written splash onto the plugin.** Take the new runtime copy
(`umm-dev drift` prints the line), add `devSplash({ game })` with the game's `url` if it shows
one, then delete:
- the whole `#dev-splash` block and the `dev-splash.css` link in `index.html`;
- `public/brand/uncle-matt-circle.webp` (or wherever the game keeps the portrait);
- the game's word list, portrait URL and steady watch, and the `words` and `portraitUrl` it
  passes to `startDevSplash`. Import `createSteadyWatch` from the runtime copy instead.

Until the hand-written block is gone the plugin adds nothing, so the steps can land in any order.

## `runtime/audio/`

The pure core of a procedural music sequencer: the pitch arithmetic, where a step falls in its
bar, phrase and form, a conductor that decides which song plays and how many layers of it, and
the look-ahead clock that decides when each step is queued. None of those touches Web Audio or
reads a clock, so a test or an offline render can replay it exactly. `synth.ts` adds a set of
instruments on Web Audio for a sequencer that wants them. The sequencer itself (its tracks, its
mix, its `queue(step, at)`) stays the game's own. Only `synth.ts` imports another file
(`pitch.ts`), so any other one can be copied alone (`umm-dev copy audio`, or one file by name).

| File | Imports | What it decides |
|---|---|---|
| `pitch.ts` | nothing | Which note: scale degrees, chords, frequencies. |
| `form.ts` | nothing | Where a step is: bar, beat, phrase, section of the form; reads of melody lines and drum strings. |
| `conductor.ts` | nothing | What plays: the song and the level, changed only on bar or phrase lines. |
| `step-clock.ts` | nothing | When: queues each step at its exact audio time. |
| `synth.ts` | `pitch.ts` | How it sounds: drums, bass, pads, plucks, a lead and stabs on Web Audio. |

**How a sequencer puts them together.** The game's timer calls `advanceSteps`; for each step it
asks the conductor what plays, finds the step's place in the form, and plays its own patterns:

```ts
import { Conductor } from './audio/conductor'
import { FORM, hitAt, lineAt, position, sectionAt, swingOffset } from './audio/form'
import { degree, note } from './audio/pitch'
import { advanceSteps, createTicker } from './audio/step-clock'

const conductor = new Conductor({ song: 'meadow', thresholds: [0, 0.3, 0.6], hysteresis: 0.05 })
const cursor = { step: 0, next: ctx.currentTime + 0.05 }
const stepLen = () => 60 / TRACKS[conductor.song].bpm / 4 // read after each step: tempo follows the song

const ticker = createTicker(() => {
  advanceSteps(cursor, ctx.currentTime, stepLen, 0.12, (step, at) => {
    const plan = conductor.at(step)
    const t = TRACKS[plan.song]
    const pos = position(step, t.progression.length)
    const section = sectionAt(FORM, pos.bar, t.progression.length)
    const when = at + swingOffset(step, stepLen(), t.swing)
    const chord = t.progression[pos.inPhrase] ?? 0
    if (plan.newSong) crash(when) // the game's own voices from here on
    if (plan.level >= 1 && hitAt(t.kick, pos.i) > 0) kick(when)
    const m = section === 'D' ? null : lineAt(t.lead, pos.bar, pos.i)
    if (plan.level >= 2 && m != null) lead(note(t.root + degree(t.scale, chord + m)), when)
  })
}, 25)
ticker.start()
// every frame: conductor.setIntensity(heat); on a boss: conductor.cue('boss')
```

### `pitch.ts`

**Exports:** `note(semi)`, `dbToGain(db)`, `degree(scale, d)`, `chordTones(scale, root, size?)`,
and the scales `MINOR`, `HARMONIC_MINOR`, `PHRYGIAN`, `DORIAN`, `MAJOR`, `LYDIAN`, `MIXOLYDIAN`,
`PHRYGIAN_DOMINANT` and `PENTATONIC_MINOR`.

| Export | What it does |
|---|---|
| `note(semi)` | The frequency in Hz of the note `semi` semitones from A4, in equal temperament: `440 * 2 ** (semi / 12)`. `note(3)` is C5, 523.25 Hz. For a MIDI note `m`, `note(m - 69)`. |
| `dbToGain(db)` | A gain factor from decibels: `10 ** (db / 20)`. |
| `degree(scale, d)` | Scale degree `d` as semitones above the tonic. `d` is any integer: 0 is the tonic, and degrees past the end or below 0 wrap into the next octave up or down. With `MINOR`, degree 7 is 12 and degree -1 is -2. |
| `chordTones(scale, root, size?)` | The chord stacked in thirds on degree `root`, as semitones above the tonic: `size` notes (default 3, a triad; 4 adds the seventh). `chordTones(MINOR, 5)` is `[8, 12, 15]`. |
| `MINOR` and the other scales | Semitone offsets from the tonic, one octave, as `readonly number[]`. |

**Melodies above the chord.** Sequencers here write a melody as scale degrees above each bar's
chord root, so one line fits every chord: the note is `root + degree(scale, chord + m)`.

### `form.ts`

**Exports:** `position(step, phraseBars, stepsPerBar?)`, `sectionAt(form, bar, phraseBars)`,
`lineAt(line, bar, i, stepsPerBar?)`, `holdSteps(line, pos, max, wrap?)`,
`hitAt(pattern, i, weights?)`, `swingOffset(step, stepLen, swing)`, `stepsToGrid(step, grid)`,
`snapToGrid(t, origin, len, to)`, `resumeBar(bars, phraseBars, from)`, the constants
`STEPS_PER_BAR` (16), `STEPS_PER_BEAT` (4), `FORM` and `DRUM_WEIGHTS`, and the types `Position`,
`Section`, `DrumWeights`.

A step is a sixteenth, counted from the song's bar 0. A phrase is one trip round the chord
progression, `phraseBars` long. The form plays one section per phrase and repeats.

| Export | What it does |
|---|---|
| `position(step, phraseBars)` | `{ step, bar, i, beat, onBeat, inPhrase, pass, firstBar, lastBar }`: `i` is the step in its bar, `pass` the phrase count, `lastBar` the turnaround bar. A negative step counts back: step -1 is bar -1, `i` 15. |
| `sectionAt(form, bar, phraseBars)` | The form's section for `bar`. `FORM` is `['A', 'B', 'A2', 'D']`: the tune, its answer, the tune with a harmony, a breakdown. A game passes its own (a boss form with no breakdown, say). Bars before 0 count as 0. Throws a `RangeError` on an empty form. |
| `lineAt(line, bar, i)` | Step `i` of a line written a bar at a time: a 32 step line plays its first half on even bars and its second on odd ones. A line shorter than a bar repeats within it. `undefined` for an empty line. |
| `holdSteps(line, pos, max, wrap?)` | How many steps the note at `pos` holds: until the next note (`null` and `undefined` are rests), at most `max`. Without `wrap` the line's end stops it; with it, the count runs round. |
| `hitAt(pattern, i, weights?)` | The hit at step `i` of a drum string, a character a step, repeating. `DRUM_WEIGHTS` is `{ X: 1, x: 0.75, o: 0.35 }`; other characters rest. Pass `{ x: 1, o: 0.45 }` for a two-weight kit. |
| `swingOffset(step, stepLen, swing)` | Seconds late an odd step plays: `swing * stepLen`, 0 on even steps. |
| `stepsToGrid(step, grid)` | Steps to the next multiple of `grid`, 0 on it: `stepsToGrid(step, 4)` is the steps to the next beat. |
| `snapToGrid(t, origin, len, to)` | Time `t` snapped to a grid of `len` seconds counted from `origin` (step 0's time): `'nearest'` or `'next'`. For landing a cue on a beat. |
| `resumeBar(bars, phraseBars, from)` | Where to carry a song on when it restarts `bars` (fractional) after its bar 0: `'top'` is 0, `'bar'` the next bar line (a quarter bar late still counts as this one), `'phrase'` the next phrase. |

### `conductor.ts`

**Exports:** `Conductor`, `levelFor(v, prev, thresholds, hysteresis?)`, and the types
`ConductorOptions`, `StepPlan`, `PendingCue`, `Boundary`.

The conductor holds two choices: the **song** (whatever the game switches between on bar lines:
a track, its boss variant, a biome's section) and the **level** (how many layers play, 0 and
up). The game asks for a change whenever it likes; the conductor holds it until its line. The
sequencer calls `at(step)` for every step it queues, and plays what the plan says.

| Member | What it does |
|---|---|
| `new Conductor(options)` | Starts on `options.song`, at `options.level` (default 0). |
| `cue(song, on?)` | Change song on the next bar line (`'bar'`, the default) or phrase line (`'phrase'`). A later cue replaces a waiting one; cueing the song playing cancels it. |
| `setLevel(level, when?)` | Ask for a level. A rise waits for `rise`, a fall for `fall`, unless `when` (`'step'`, `'beat'` or `'bar'`) says otherwise: a hit can knock the music back on the next beat. Asking again before it lands replaces it. |
| `setIntensity(v, when?)` | Ask for the level intensity `v` reaches on `thresholds`, held by `hysteresis`. Returns that level. |
| `at(step)` | The `StepPlan` for `step`: `{ step, bar, i, song, songBar, level, newSong, levelChange }`. `newSong` is true on the step a cue lands (never on the first step); `levelChange` is the level minus the last step's. |
| `song`, `level`, `target`, `pending`, `plan` | What plays, the level asked for, the waiting cue, and the last plan (`null` before the first step). |
| `levelFor(v, prev, thresholds, hysteresis?)` | The pure rule `setIntensity` uses: the highest level whose threshold `v` reaches, holding `prev` while `v` is within `hysteresis` under its threshold. |

| Option | Default | What it does |
|---|---|---|
| `song` | required | The song it starts on. |
| `level` | `0` | The level it starts at. |
| `thresholds` | `[0]` | For `setIntensity`: where each level comes in, 0 to 1, rising. |
| `hysteresis` | `0` | For `setIntensity`: how far under its threshold a level holds. |
| `rise` | `'bar'` | When a rise is heard: `'step'`, `'beat'` or `'bar'`. |
| `fall` | `'bar'` | When a fall is heard. `'step'` strips a layer at once, so the loss is heard. |
| `stepsPerBar` | `16` | Steps in a bar. |
| `stepsPerBeat` | `4` | Steps in a beat. |
| `phraseBars` | `8` | Bars in a phrase, for `cue(song, 'phrase')`. Phrase lines count from step 0. |

**A change lands only on its line.** A song changes on a step that is on a bar (or phrase) line,
and a level on a step on its boundary. After a stall the step clock skips steps; a change whose
line was skipped waits for the next line it queues, so nothing changes mid-bar. The first step
asked for, and a step before the last (a restart), count as on every line.

**Policy stays in the game.** What raises the level (speed, a combo, a boss's health), a floor
under a boss or a cap in a tutorial, a lift into a drop, which song a place plays: the game
computes these and calls `setLevel` or `cue`. Set them inside the step callback, before
`at(step)`, to have them land on that step's line.

```ts
import { MINOR, degree, note } from './audio/pitch'

const root = -9 // C4, 9 semitones under A4
const hz = note(root + degree(MINOR, 4)) // the fifth: G4
```

### `step-clock.ts`

**Exports:** `advanceSteps(cursor, now, stepLen, lookahead, onStep, stallSkip?)`,
`createTicker(fn, ms)`, and the types `StepCursor`, `StepLength`, `Ticker`.

A timer wakes every few tens of milliseconds and calls `advanceSteps`. It calls
`onStep(step, at)` for every step that starts before `now + lookahead`, with `at` the step's
exact audio time, and moves the cursor past them. The sequencer schedules its notes at `at`, so
the timing comes from the audio clock and the timer's jitter does not reach the music. It
returns how many steps it queued.

**After a stall it skips.** When the cursor has fallen more than `stallSkip` behind `now` (a tab
in the background throttles timers to once a second; a long frame stalls them), it jumps forward
to the first step on the grid at or after `now` and plays from there. The missed steps are never
queued, so there is no burst of late notes. `cursor.step` still counts them, so bar and phrase
positions stay where they would have been.

```ts
import { advanceSteps, createTicker, type StepCursor } from './audio/step-clock'

const sixteenth = 60 / bpm / 4
const cursor: StepCursor = { step: 0, next: ctx.currentTime + 0.05 }
const ticker = createTicker(() => {
  advanceSteps(cursor, ctx.currentTime, sixteenth, 0.12, (step, at) => queue(step, at))
}, 25)
ticker.start()
// on pause: ticker.stop(); on resume: cursor.next = ctx.currentTime + 0.05, then ticker.start()
```

| Argument | Default | What it does |
|---|---|---|
| `cursor` | required | `{ step, next }`: the next step to queue and its start time. Changed in place. |
| `now` | required | The current time on the audio clock, seconds: `ctx.currentTime`. |
| `stepLen` | required | Seconds per step: `60 / bpm / 4` for sixteenths. Or a function of the step, for a tempo that changes: it is asked for each step's length after that step's `onStep`, so a tempo changed on a bar line holds from that step. Every length over 0, or it throws a `RangeError`. |
| `lookahead` | required | How far ahead to queue, seconds. Longer than the timer's period, so no step falls between two ticks: about 0.1 for a 25 ms timer. |
| `onStep` | required | Called as `onStep(step, at)` for each step, in order. |
| `stallSkip` | `0.05` | How far behind `now`, seconds, the cursor may fall before it skips instead of playing late. |

**Offline.** To render into an `OfflineAudioContext` (a music check, a capture), drive it in one
call: `advanceSteps(cursor, 0, stepLen, seconds, onStep, Infinity)`.

`createTicker(fn, ms)` wraps `setInterval(fn, ms)`. `start()` does nothing while it is running
and `stop()` nothing while it is stopped, so neither needs a check first. `running` says which.

## `runtime/sim/`

The deterministic core of a sim that replays from a seed and its inputs: seeded random numbers,
math that gives the same float on every engine, and the fixed-step clock that runs it. A replay
recorded in one browser plays the same in another, in a desktop build and on a server only if the
sim draws from `rng.ts`, does its trig through `det.ts`, and steps at a fixed rate. No file
imports another.

| File | Imports | What it decides |
|---|---|---|
| `rng.ts` | nothing | Every random draw, from a seed. |
| `det.ts` | nothing | Trig, `exp`, `ln` and powers, to the last bit. |
| `fixed-step.ts` | nothing | How many sim steps a display frame runs, and the blend between the last two. |

**Keep the engine out of the sim.** A test in the game that greps its sim folder for
`Math.random`, `Date.now`, `performance.now`, `Math.sin(`, `Math.cos(`, `Math.atan2(`,
`Math.exp(`, `Math.pow(` and `**` keeps it that way. `Math.sqrt`, `Math.floor`, `Math.abs`,
`Math.min` and `Math.max` are exact everywhere and fine to use.

### `rng.ts`

**Exports:** `Rng`, `mulberry32(seed)`, `range(rng, lo, hi)`, `pick(rng, items)`,
`pickWeighted(rng, items)`, `hash3(a, b, c, seed)`, `hashSeed(...parts)`,
`seedFromString(text)` (also as `seedFromText`), `GOLDEN_SEED`, and the types `RngFn`,
`RngOptions`.

One generator, mulberry32, whose whole state is one 32-bit number, in two styles. For the same
seed both give the same draws.

```ts
import { hashSeed, mulberry32, pick, Rng } from './sim/rng'

const rng = new Rng(hashSeed(runSeed, level, 7)) // a stream of its own per level
const x = rng.range(-4, 4)
const lane = rng.int(0, 2) // 0, 1 or 2
if (rng.chance(0.25)) spawn(rng.pick(KINDS))
save.rng = rng.state // and later: rng.state = save.rng

const draw = mulberry32(seed) // the function style: draw() is in [0, 1)
const kind = pick(draw, KINDS)
```

| `Rng` member | What it does |
|---|---|
| `new Rng(seed, options?)` | Starts from `seed >>> 0`. A seed of 0 starts at `options.zeroSeed` (default 0). |
| `next()` | Uniform in [0, 1). Every other member is built on it. |
| `range(lo, hi)` | In [lo, hi). One draw. |
| `int(n)` | 0 to n - 1: `Math.floor(next() * n)`. One draw. |
| `int(lo, hi)` | lo to hi, both included. One draw. |
| `chance(p)` | True with probability `p`. One draw. |
| `pick(list)` | One item, uniformly. One draw. Throws when the draw lands on `undefined` (an empty list), unless `options.emptyPick` is `'undefined'`. |
| `weighted(weights)` | An index by weight; negative weights count as 0. One draw, or -1 and no draw when no weight is over 0. |
| `shuffle(list)` | Shuffles in place (Fisher-Yates from the end) and returns the list. `length - 1` draws. |
| `unit(out)` | A uniform direction on the unit sphere, into `out`. Two draws. Uses `Math.cos` and `Math.sin`, so the last bit can differ between engines. |
| `state` | The whole generator. Read it to save; set it (taken `>>> 0`) to carry on from there. |

| `RngOptions` | Default | What it does |
|---|---|---|
| `zeroSeed` | `0` | Where a seed of 0 starts. mulberry32 handles 0 like any other seed; pass `GOLDEN_SEED` (`0x9e3779b9`) for a sim that has always swapped 0 out. |
| `emptyPick` | `'throw'` | `'undefined'` makes `pick` return `undefined` (typed as the item) instead of throwing, for a sim that has always carried on. |

| Function | What it does |
|---|---|
| `mulberry32(seed)` | A bare generator, `() => number` in [0, 1) (an `RngFn`). The same draws as `new Rng(seed)`. |
| `range(rng, lo, hi)`, `pick(rng, items)` | As the members, on an `RngFn`. `pick` throws on an empty list. |
| `pickWeighted(rng, items)` | One of `[item, weight]` pairs by weight, which need not sum to 1. One draw; the last item is the fallback. Throws on an empty list. |
| `hash3(a, b, c, seed)` | A stateless hash of three integers and a seed to [0, 1): the same cell of a grid always gets the same value, in any order of visiting. |
| `hashSeed(...parts)` | Mixes numbers (each floored) into one 32-bit seed: FNV-1a over their four low bytes. For a stream per level, per room, per wave. |
| `seedFromString(text)` | A 32-bit seed from text, such as a `?seed=` or a daily date: FNV-1a over its UTF-16 code units. `seedFromText` is the same function. |

**Adopting it over a game's own copy.** Every function here gives the draws of the copies it
came from, held by golden tests (`tests/runtime/sim-goldens.mjs`). Where those copies differed,
the difference is an option, not a fix:
- **A copy whose constructor swaps a seed of 0** (`seed >>> 0 || 0x9e3779b9`) keeps that with
  `zeroSeed: GOLDEN_SEED`, and one whose `pick` returns `undefined` on an empty list keeps that
  with `emptyPick: 'undefined'`. Pass them from a small subclass in the game, so its call sites
  stay `new Rng(seed)`:
  ```ts
  import { GOLDEN_SEED, Rng as KitRng } from './rng-kit'
  export class Rng extends KitRng {
    constructor(seed: number) {
      super(seed, { zeroSeed: GOLDEN_SEED, emptyPick: 'undefined' })
    }
  }
  ```
- **A copy whose `Rng` is the function type** (`type Rng = () => number`) re-exports `RngFn` under
  that name from its barrel: `export { type RngFn as Rng, mulberry32, pick } from './rng'`.
  `export *` would bring the class `Rng` instead.
- **`state` is an accessor,** not an own property, so `JSON.stringify(rng)` and a spread do not
  carry it. Save `rng.state` itself.

### `det.ts`

**Exports:** `M` (`sin`, `cos`, `tan`, `atan`, `atan2`, `asin`, `acos`, `exp`, `ln`, `hypot`,
`tanh`), `sq(x)`, `powi(x, n)`, `powf(x, p)`.

The language leaves `Math.sin` and the rest to each engine, and engines differ: two of them
disagreed on about 3% of sines, enough to turn the same inputs into a different run within
seconds. These use only `+ - * /` and `Math.sqrt`, which IEEE 754 fixes exactly, so they return
the same float everywhere. The kernels are FreeBSD msun's (from Sun's fdlibm), cut down for the
small angles a sim uses.

```ts
import { M, powf } from './sim/det'

const heading = M.atan2(dy, dx)
x += M.cos(heading) * speed * dt
const dist = M.hypot(dx, dy, dz)
const ease = powf(t, 2.2)
```

| Export | What it does |
|---|---|
| `M.sin`, `M.cos`, `M.tan` | Reduced by whole quarter turns against a two-part pi/2, then fdlibm's kernels. `tan` is `sin / cos`. Keep angles small: there is no big-number reduction. |
| `M.atan`, `M.atan2(y, x)` | fdlibm's atan. `atan2` keeps the signs of zero as `Math.atan2` does. |
| `M.asin`, `M.acos` | Through `atan2` and `Math.sqrt`. |
| `M.exp` | Clamped to -700..700, then fdlibm's kernel and an exact power of two. |
| `M.ln` | For a finite `x` over 0. At 0, below it or at `Infinity` it never returns: guard the input. |
| `M.hypot(x, y, z?)` | `Math.sqrt(x * x + y * y + z * z)`. No overflow guard, unlike `Math.hypot`. |
| `M.tanh` | Through `exp`. |
| `sq(x)`, `powi(x, n)` | `x * x`; `x` multiplied `n` times (a whole `n`, 0 or more). |
| `powf(x, p)` | `exp(p * ln(x))` for `x` over 0, and 0 for `x` at 0 or below. For curves; engines disagree on `**`. |

**Bit for bit, not close.** The golden tests compare exact floats over chosen inputs, and a
fingerprint of every output over a sweep of thousands of inputs per function, so a change of one
ulp anywhere fails. They were taken from the games' copies before the kit had this file. Never
"improve" a constant here: every replay recorded against it would change.

### `fixed-step.ts`

**Exports:** `createFixedStepper(options?)`, `SIM_HZ` (120), `SIM_DT` (`1 / 120`), and the types
`FixedStepper`, `FixedStepperOptions`, `FrameAdvance`.

The sim advances in exact steps; the display draws once a frame and blends the last two sim
states by `alpha`. It is pure: the caller passes each frame's elapsed seconds.

```ts
import { createFixedStepper } from './sim/fixed-step'

const stepper = createFixedStepper()
let last = performance.now()
function frame(now: number) {
  const { steps, alpha } = stepper.advance((now - last) / 1000)
  last = now
  for (let i = 0; i < steps; i++) sim.step(readInput())
  render(sim, alpha)
  requestAnimationFrame(frame)
}
// when the tab comes back: stepper.reset()
```

`advance(seconds)` returns `{ steps, alpha, dropped }`, the same object every frame. A `NaN`,
negative or infinite frame counts as 0. A tolerance of `1e-9` of a step makes a 60 Hz frame run
exactly two 120 Hz steps, not one and three in turn. `alpha` stays under 1. `reset()` forgets
the time carried over, and `stepSeconds` reads the step length back.

| Option | Default | What it does |
|---|---|---|
| `stepSeconds` | `SIM_DT` | Seconds per sim step. |
| `maxStepsPerFrame` | `8` | Most steps in one frame. Past it the backlog is dropped, not carried, and `dropped` is true. |
| `maxFrameSeconds` | `0.25` | Longest frame counted. A longer one (a tab switch, a breakpoint) is clamped to it, and `dropped` is true. |

### `synth.ts`

**Exports:** `createKit(ctx, noise)`, `noiseBuffer(ctx, seconds?)`, `impulse(ctx, seconds, decay)`,
`driveCurve(amount)`, `softClipCurve(n?)`, `softClip(x, knee?)`, `FLOOR`, and the types `Kit`,
`Note`. Imports `note` from `pitch.ts`: copy both.

A sequencer's instruments on Web Audio, synthesised from oscillators and one shared noise buffer,
so nothing is sampled. Every voice stops its sources at a fixed time and disconnects its own nodes
when its last source ends, so the graph does not grow.

```ts
import { createKit, noiseBuffer, softClipCurve } from './audio/synth'

const kit = createKit(ctx, noiseBuffer(ctx))
const clip = new WaveShaperNode(ctx, { curve: softClipCurve() })
clip.connect(ctx.destination)
kit.kick(at, 0.8, clip)
kit.bass({ semi: -21, at, dur: 0.2, vol: 0.6 }, clip, 'sawtooth', 300)
```

| Voice | Arguments | Sound |
|---|---|---|
| `kick` | `at, vol, out` | A sine dropping from 160 to 38 Hz, with a noise click for small speakers. |
| `snare` | `at, vol, out` | Band-passed noise and a falling triangle. |
| `clap` | `at, vol, out` | Three quick noise slaps and a short tail. |
| `hat` | `at, vol, out, open?` | High-passed noise, 0.04 s closed or 0.26 s open. |
| `crash` | `at, vol, out` | High-passed noise over 1.6 s. |
| `tom` | `semi, at, vol, out` | A sine at `note(semi)` falling to 60%. |
| `riser` | `at, dur, vol, out` | Band-passed noise sweeping 400 Hz to 7 kHz and growing over `dur`: the build into a drop. |
| `bass` | `note, out, wave, cutoff` | Two detuned `wave` oscillators through a resonant low-pass, plus a sine sub. |
| `pad` | `semis, at, dur, vol, out, cutoff, width` | A held chord of detuned saws, spread left and right by `width` (0 to 1). |
| `pluck` | `note, out, wave, cutoff, pan` | A short filtered note, panned. |
| `lead` | `note, out, wave, cutoff` | Two detuned oscillators with a delayed vibrato and a decay to 75%. |
| `stab` | `semis, at, dur, vol, out` | A chord of detuned saws under a closing filter. |

A `Note` is `{ semi, at, dur, vol }`: semitones from A4, a start time on the context's clock,
seconds, a level.

| Export | What it does |
|---|---|
| `noiseBuffer(ctx, seconds?)` | Mono white noise, default 1 s. Make one per context and pass it to `createKit`; every noise voice loops it from a random offset. |
| `impulse(ctx, seconds, decay)` | A stereo reverb impulse for a `ConvolverNode`: noise fading as `(1 - t) ** decay`, different in each ear. |
| `driveCurve(amount)` | A tanh drive curve for a `WaveShaperNode`, `amount` 0 (nearly clean) to 1 (heavy), still reaching plus or minus 1 at full input. Cached per hundredth. |
| `softClipCurve(n?)` | The output's safety clipper, `n` points (default 2048): straight through below 0.7, then a tanh knee that stays under 0.93. |
| `softClip(x, knee?)` | One sample of that shape, for a game that builds its own curve: `x` up to `knee` (default 0.7), then the tanh shoulder. |
| `FLOOR` | `0.0001`, the lowest level an exponential ramp is sent to; it cannot reach 0. |

**Not deterministic.** The noise comes from `Math.random`, and the voices from the audio clock.
Nothing here feeds a sim.

## `runtime/sim/`

The deterministic core of a sim that replays from a seed and its inputs: seeded random numbers,
math that gives the same float on every engine, and the fixed-step clock that runs it. A replay
recorded in one browser plays the same in another, in a desktop build and on a server only if the
sim draws from `rng.ts`, does its trig through `det.ts`, and steps at a fixed rate. No file
imports another.

| File | Imports | What it decides |
|---|---|---|
| `rng.ts` | nothing | Every random draw, from a seed. |
| `det.ts` | nothing | Trig, `exp`, `ln` and powers, to the last bit. |
| `fixed-step.ts` | nothing | How many sim steps a display frame runs, and the blend between the last two. |

**Keep the engine out of the sim.** A test in the game that greps its sim folder for
`Math.random`, `Date.now`, `performance.now`, `Math.sin(`, `Math.cos(`, `Math.atan2(`,
`Math.exp(`, `Math.pow(` and `**` keeps it that way. `Math.sqrt`, `Math.floor`, `Math.abs`,
`Math.min` and `Math.max` are exact everywhere and fine to use.

### `rng.ts`

**Exports:** `Rng`, `mulberry32(seed)`, `range(rng, lo, hi)`, `pick(rng, items)`,
`pickWeighted(rng, items)`, `hash3(a, b, c, seed)`, `hashSeed(...parts)`,
`seedFromString(text)` (also as `seedFromText`), `GOLDEN_SEED`, and the types `RngFn`,
`RngOptions`.

One generator, mulberry32, whose whole state is one 32-bit number, in two styles. For the same
seed both give the same draws.

```ts
import { hashSeed, mulberry32, pick, Rng } from './sim/rng'

const rng = new Rng(hashSeed(runSeed, level, 7)) // a stream of its own per level
const x = rng.range(-4, 4)
const lane = rng.int(0, 2) // 0, 1 or 2
if (rng.chance(0.25)) spawn(rng.pick(KINDS))
save.rng = rng.state // and later: rng.state = save.rng

const draw = mulberry32(seed) // the function style: draw() is in [0, 1)
const kind = pick(draw, KINDS)
```

| `Rng` member | What it does |
|---|---|
| `new Rng(seed, options?)` | Starts from `seed >>> 0`. A seed of 0 starts at `options.zeroSeed` (default 0). |
| `next()` | Uniform in [0, 1). Every other member is built on it. |
| `range(lo, hi)` | In [lo, hi). One draw. |
| `int(n)` | 0 to n - 1: `Math.floor(next() * n)`. One draw. |
| `int(lo, hi)` | lo to hi, both included. One draw. |
| `chance(p)` | True with probability `p`. One draw. |
| `pick(list)` | One item, uniformly. One draw. Throws when the draw lands on `undefined` (an empty list), unless `options.emptyPick` is `'undefined'`. |
| `weighted(weights)` | An index by weight; negative weights count as 0. One draw, or -1 and no draw when no weight is over 0. |
| `shuffle(list)` | Shuffles in place (Fisher-Yates from the end) and returns the list. `length - 1` draws. |
| `unit(out)` | A uniform direction on the unit sphere, into `out`. Two draws. Uses `Math.cos` and `Math.sin`, so the last bit can differ between engines. |
| `state` | The whole generator. Read it to save; set it (taken `>>> 0`) to carry on from there. |

| `RngOptions` | Default | What it does |
|---|---|---|
| `zeroSeed` | `0` | Where a seed of 0 starts. mulberry32 handles 0 like any other seed; pass `GOLDEN_SEED` (`0x9e3779b9`) for a sim that has always swapped 0 out. |
| `emptyPick` | `'throw'` | `'undefined'` makes `pick` return `undefined` (typed as the item) instead of throwing, for a sim that has always carried on. |

| Function | What it does |
|---|---|
| `mulberry32(seed)` | A bare generator, `() => number` in [0, 1) (an `RngFn`). The same draws as `new Rng(seed)`. |
| `range(rng, lo, hi)`, `pick(rng, items)` | As the members, on an `RngFn`. `pick` throws on an empty list. |
| `pickWeighted(rng, items)` | One of `[item, weight]` pairs by weight, which need not sum to 1. One draw; the last item is the fallback. Throws on an empty list. |
| `hash3(a, b, c, seed)` | A stateless hash of three integers and a seed to [0, 1): the same cell of a grid always gets the same value, in any order of visiting. |
| `hashSeed(...parts)` | Mixes numbers (each floored) into one 32-bit seed: FNV-1a over their four low bytes. For a stream per level, per room, per wave. |
| `seedFromString(text)` | A 32-bit seed from text, such as a `?seed=` or a daily date: FNV-1a over its UTF-16 code units. `seedFromText` is the same function. |

**Adopting it over a game's own copy.** Every function here gives the draws of the copies it
came from, held by golden tests (`tests/runtime/sim-goldens.mjs`). Where those copies differed,
the difference is an option, not a fix:
- **A copy whose constructor swaps a seed of 0** (`seed >>> 0 || 0x9e3779b9`) keeps that with
  `zeroSeed: GOLDEN_SEED`, and one whose `pick` returns `undefined` on an empty list keeps that
  with `emptyPick: 'undefined'`. Pass them from a small subclass in the game, so its call sites
  stay `new Rng(seed)`:
  ```ts
  import { GOLDEN_SEED, Rng as KitRng } from './rng-kit'
  export class Rng extends KitRng {
    constructor(seed: number) {
      super(seed, { zeroSeed: GOLDEN_SEED, emptyPick: 'undefined' })
    }
  }
  ```
- **A copy whose `Rng` is the function type** (`type Rng = () => number`) re-exports `RngFn` under
  that name from its barrel: `export { type RngFn as Rng, mulberry32, pick } from './rng'`.
  `export *` would bring the class `Rng` instead.
- **`state` is an accessor,** not an own property, so `JSON.stringify(rng)` and a spread do not
  carry it. Save `rng.state` itself.

### `det.ts`

**Exports:** `M` (`sin`, `cos`, `tan`, `atan`, `atan2`, `asin`, `acos`, `exp`, `ln`, `hypot`,
`tanh`), `sq(x)`, `powi(x, n)`, `powf(x, p)`.

The language leaves `Math.sin` and the rest to each engine, and engines differ: two of them
disagreed on about 3% of sines, enough to turn the same inputs into a different run within
seconds. These use only `+ - * /` and `Math.sqrt`, which IEEE 754 fixes exactly, so they return
the same float everywhere. The kernels are FreeBSD msun's (from Sun's fdlibm), cut down for the
small angles a sim uses.

```ts
import { M, powf } from './sim/det'

const heading = M.atan2(dy, dx)
x += M.cos(heading) * speed * dt
const dist = M.hypot(dx, dy, dz)
const ease = powf(t, 2.2)
```

| Export | What it does |
|---|---|
| `M.sin`, `M.cos`, `M.tan` | Reduced by whole quarter turns against a two-part pi/2, then fdlibm's kernels. `tan` is `sin / cos`. Keep angles small: there is no big-number reduction. |
| `M.atan`, `M.atan2(y, x)` | fdlibm's atan. `atan2` keeps the signs of zero as `Math.atan2` does. |
| `M.asin`, `M.acos` | Through `atan2` and `Math.sqrt`. |
| `M.exp` | Clamped to -700..700, then fdlibm's kernel and an exact power of two. |
| `M.ln` | For a finite `x` over 0. At 0, below it or at `Infinity` it never returns: guard the input. |
| `M.hypot(x, y, z?)` | `Math.sqrt(x * x + y * y + z * z)`. No overflow guard, unlike `Math.hypot`. |
| `M.tanh` | Through `exp`. |
| `sq(x)`, `powi(x, n)` | `x * x`; `x` multiplied `n` times (a whole `n`, 0 or more). |
| `powf(x, p)` | `exp(p * ln(x))` for `x` over 0, and 0 for `x` at 0 or below. For curves; engines disagree on `**`. |

**Bit for bit, not close.** The golden tests compare exact floats over chosen inputs, and a
fingerprint of every output over a sweep of thousands of inputs per function, so a change of one
ulp anywhere fails. They were taken from the games' copies before the kit had this file. Never
"improve" a constant here: every replay recorded against it would change.

### `fixed-step.ts`

**Exports:** `createFixedStepper(options?)`, `SIM_HZ` (120), `SIM_DT` (`1 / 120`), and the types
`FixedStepper`, `FixedStepperOptions`, `FrameAdvance`.

The sim advances in exact steps; the display draws once a frame and blends the last two sim
states by `alpha`. It is pure: the caller passes each frame's elapsed seconds.

```ts
import { createFixedStepper } from './sim/fixed-step'

const stepper = createFixedStepper()
let last = performance.now()
function frame(now: number) {
  const { steps, alpha } = stepper.advance((now - last) / 1000)
  last = now
  for (let i = 0; i < steps; i++) sim.step(readInput())
  render(sim, alpha)
  requestAnimationFrame(frame)
}
// when the tab comes back: stepper.reset()
```

`advance(seconds)` returns `{ steps, alpha, dropped }`, the same object every frame. A `NaN`,
negative or infinite frame counts as 0. A tolerance of `1e-9` of a step makes a 60 Hz frame run
exactly two 120 Hz steps, not one and three in turn. `alpha` stays under 1. `reset()` forgets
the time carried over, and `stepSeconds` reads the step length back.

| Option | Default | What it does |
|---|---|---|
| `stepSeconds` | `SIM_DT` | Seconds per sim step. |
| `maxStepsPerFrame` | `8` | Most steps in one frame. Past it the backlog is dropped, not carried, and `dropped` is true. |
| `maxFrameSeconds` | `0.25` | Longest frame counted. A longer one (a tab switch, a breakpoint) is clamped to it, and `dropped` is true. |

## `runtime/board/`

The shared core of a leaderboard server on a Cloudflare Worker over D1: capped body reads,
owner-key and salted-address hashes, generated handles, fixed-window rate limits, blocks, the
admin log and the bearer-token admin door. The game keeps its runs table, validator and routes,
and meets the core through `defineBoard`. Copy the folder (`umm-dev copy board`). It has its own
page: [board.md](board.md).

## `runtime/making-of/`

A making-of site's toy host, its controls, a 2D canvas, what a page's script calls, and a base
stylesheet with tokens a game overrides. It has its own page: [making-of.md](making-of.md).

## Config: `runtime`

In the game's `umm-dev.config.mjs`. `umm-dev copy` reads it; `umm-dev drift` reads `sources`.

```js
import { defineConfig } from '@ummgames/dev'

export default defineConfig({ runtime: { into: 'src/shared' } })
```

| Key | Type | Default | What it does |
|---|---|---|---|
| `into` | string | `'src'` | The folder, from the game root, that a copy without `--to` goes under: `<into>/<path under runtime/>`, or `<into>/<path in the source>` with `--from`. |
| `sources` | object | `{}` | The game's own sources, by name: `{ <name>: { repo, ref } }`. `repo` is the path to a git checkout, read from the game's main checkout when relative. `ref` is the commit-ish files are read at, default `'HEAD'`. A name is letters, digits, `_` and `-`, and not `ummgames-dev`. |

## File formats

### The copy header

Line 1 of every copy, in the file type's comment syntax:

```ts
// Copied from ummgames-dev v0.1.0 runtime/dev/fuzzy.ts (sha256 1872b1d747ecb7a2). Owned here now; `umm-dev drift` compares.
```

| Field | Example | What it is |
|---|---|---|
| version | `v0.1.0` | The installed package's version when it was copied: the tag the original can be fetched at. `v` and three numbers, with an optional `-suffix`. |
| runtime path | `runtime/dev/fuzzy.ts` | The file in this package. Plain segments under `runtime/`: no `.` or `..`. |
| hash | `1872b1d747ecb7a2` | The first 16 hex digits of the SHA-256 of the body when it was copied. |

A copy from one of the game's own sources has the source's name where `ummgames-dev` is, the
commit that last changed the file (12 hex digits) where the version is, and the file's path in
the source where the runtime path is:

```ts
// Copied from net 1a2b3c4d5e6f client/net.ts (sha256 0123456789abcdef). Change it there and copy it again; `umm-dev drift` compares.
```

The commit is the one that last changed the file, not the source's newest, so copying an
unchanged file again writes the same header.

- **The body** is everything after line 1. The hash reads CRLF as LF, so a checkout's line
  endings never count as a change. Copy writes LF.
- **The header is data from the game.** Drift trusts only a version and a path of those forms.
  Every read stays inside the installed `runtime/`, and every fetch inside this repo's
  `runtime/` at that tag. A file whose line 1 does not parse is not a copy.

| Comment syntax | Extensions |
|---|---|
| `// …` | `.ts .tsx .mts .cts .js .jsx .mjs .cjs .glsl .wgsl .vert .frag` |
| `/* … */` | `.css` |
| `<!-- … -->` | `.html .svg .xml .md` |
| `# …` | `.sh .py .yaml .yml .toml` |

**JSON cannot be copied.** It has no comments, so it cannot carry a header. Copy refuses a
destination of any type missing above (`no comment syntax for .json`). `runtime/tsconfig.json`
and `runtime/env.d.ts` are the folder's own tooling and are never listed.

## How it works

- **Copy** resolves the runtime path to files, plans each destination, and stamps each file:
  header, then the source with LF endings. Over an existing file it compares the body's hash
  with the header's before it writes.
- **Drift** lists the game's files (`git ls-files --cached --others --exclude-standard` in a
  checkout, so ignored files are skipped; otherwise a walk that skips `node_modules`, `.git`,
  `dist*`, `test-results`, `coverage` and `.vite`). It keeps each file whose line 1 is a header,
  and compares the three hashes.
- **A source** is read only through git: `git ls-tree` at its `ref` to list, `git show <ref>:<path>`
  to copy and compare, `git show <commit>:<path>` for an original, and `git log -1` for the
  header's commit. The working tree is never read. A relative `repo` resolves from the folder
  holding the game's git data (`git rev-parse --git-common-dir`), which is the main checkout from
  any linked worktree.
- **The game root** is the nearest folder at or above the current one holding a `package.json`.
- **Each runtime file imports nothing outside its own folder**, so a folder copies as a unit.
  Each typechecks under `runtime/tsconfig.json` (strict, Bundler resolution, DOM, `types: []`).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| A second copy appears under `src/<folder>/`, beside the game's own. | Copied without `--to`; the game keeps the file elsewhere. | Delete the new file (it is untouched). Copy again with `--to <the game's path>`. |
| `refused  <file>: exists and is not a copy; --force overwrites` | The game has its own file at the destination. | To replace it: `umm-dev copy <path> --to <file> --force`. To keep it: copy elsewhere with `--to`. |
| `refused  <file>: exists and is not a copy; a folder copy never overwrites it, even with --force (name the file: umm-dev copy <path> --to <file> --force)` | A folder copy reached the game's own file. | Run the command the hint gives, if the kit's version should replace the game's. Leave it if the file is game-specific. |
| `refused  <file>: changed here since it was copied (umm-dev drift --diff shows how); --force overwrites` | The game edited its copy. | `umm-dev drift --diff`. Keep it, or replace that one file with `--to <file> --force`. |
| `refused  <file>: no comment syntax for .json` | The destination's type cannot carry a header. | Use a destination with an extension from the table above. |
| `umm-dev copy: no runtime file or folder "<path>". umm-dev copy --list shows them.` | No such runtime path. | `umm-dev copy --list`. |
| `imports ./<name>, which is not beside it: copy that too` | The copy needs a sibling file. | Copy the sibling into the same folder. |
| `umm-dev copy: no source "<name>" in runtime.sources` | `--from` names a source the game's config does not. | Add it to `runtime.sources`, or fix the name. |
| `umm-dev copy: source "<name>": <path> is not on this machine` | The source's checkout is not where `repo` says. | Clone it there, or fix `repo`. A relative `repo` is read from the game's main checkout. |
| A source copy says `source not found` in drift. | The same, seen by drift. | As above. The copy still builds; only the comparison is missing. |
| A change made in the source does not reach the copy. | It is not committed, or not on `ref`. | Commit it on the branch `ref` names, then copy again. |
| `(the original at <tag> is not available: <url> unreachable (...))` | Drift is offline, or the tag is not on the public repo. | Set `UMM_DEV_REPO` to a local clone with its tags. Until then the diff is against the installed file. |
| `(the original at <tag> is not available: UMM_DEV_REPO has no <tag>:<path>; ...)` | The clone lacks that tag. | `git -C $UMM_DEV_REPO fetch --tags`. |
| `no runtime copies in <root>`, though there are copies. | Their line 1 was edited, or git ignores them. | Restore the header (take the file again with `--to <file> --force`), or stop ignoring the folder. |
| A merged copy still says `changed here and upstream`. | Its header still names the old tag and hash. | Take the new version with `--to <file> --force`, then apply the game's changes again. |
| A replay or a seeded level comes out different after a game takes `sim/rng.ts` over its own copy. | Its copy swapped a seed of 0 for `0x9e3779b9`, or its `pick` returned `undefined` on an empty list. | Construct with `{ zeroSeed: GOLDEN_SEED, emptyPick: 'undefined' }` (see "Adopting it over a game's own copy"). |
| A game's code no longer typechecks where it calls a draw `rng()`, after taking `sim/rng.ts`. | Its `Rng` was the function type, and `export *` now brings the class. | Re-export `type RngFn as Rng` by name from the game's barrel. |
| A replay or a seeded level comes out different after a game takes `sim/rng.ts` over its own copy. | Its copy swapped a seed of 0 for `0x9e3779b9`, or its `pick` returned `undefined` on an empty list. | Construct with `{ zeroSeed: GOLDEN_SEED, emptyPick: 'undefined' }` (see "Adopting it over a game's own copy"). |
| A game's code no longer typechecks where it calls a draw `rng()`, after taking `sim/rng.ts`. | Its `Rng` was the function type, and `export *` now brings the class. | Re-export `type RngFn as Rng` by name from the game's barrel. |
| `portal-sdk.ts` or `build-target.ts` says `no longer shipped`. | 0.2.0 removed `runtime/portal/`. | Nothing: the copy is the game's now. Delete its line 1 header if drift should stop listing it. |

## For agents

- **Never edit or remove line 1 of a copy.** It is how drift finds the copy, and what it compares
  against. Edit below it.
- **Run `umm-dev drift` after editing a copy, and before bumping the kit's tag.** Report what it
  says.
- **Never edit `node_modules/@ummgames/dev`.** A change there is lost on the next install and
  never reaches other games. Fix the game's copy, and report the kit bug upstream.
- **Take files one at a time, with `--to <the game's path>`.** The default destination is
  `<runtime.into>/<path under runtime/>`: `src/dev/perf-hud.ts` for `dev/perf-hud.ts`. A game that keeps the file anywhere else gets a second copy. Run
  `--dry-run` first and check every path it prints.
- **Never pass `--force` to a folder copy.** It overwrites every changed copy in the folder.
- **Change a source copy in its source, never in a game.** Commit it there, then run
  `umm-dev copy --from <source> <path> --to <the game's path>` in each game that has it.
- **Never write a source's name or path into this package.** They belong in each game's config.
- **Upgrade with drift's own lines.** After a bump, run each `take it:` line as printed. Treat
  `changed here and upstream` as a decision for the user, not a `--force`.
