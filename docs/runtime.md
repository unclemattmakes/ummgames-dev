# Runtime code: copy and drift

Code that ships inside a game's build lives in `runtime/`, as TypeScript. A game does not import it
from `node_modules`; it **copies** a file in, and from then on the copy is the game's to change.
`umm-dev drift` shows how far each copy has moved, on both sides.

| Folder | What it holds |
|---|---|
| `runtime/dev/` | The perf recorder and HUD, the Ctrl/Cmd+K command bar over a dev tool registry, its fuzzy matcher, a live tuner panel, and the palette helpers that wire them together. |
| `runtime/input/` | `pad-profiles.ts`: remaps raw Valve pads (Steam Controller, Steam Deck) that arrive with `mapping: ""` to standard order, and picks the pad in use. |
| `runtime/boot/` | `dev-splash.ts` and `dev-splash.css`: the "Uncle Matt Makes: ___" loading splash. |
| `runtime/portal/` | The portal SDK adapter and build target. |

Each file imports nothing outside its own folder, so a folder copies as a unit. Each typechecks
under `runtime/tsconfig.json` (strict, Bundler resolution, DOM, `types: []`).

## `umm-dev copy`

```sh
umm-dev copy dev                      # every file in runtime/dev/, to src/dev/
umm-dev copy input/pad-profiles.ts    # one file, to src/input/pad-profiles.ts
umm-dev copy boot/dev-splash.ts --to src/boot/splash.ts
umm-dev copy dev --to src/tools/dev/  # a folder, into another folder
umm-dev copy --list                   # what this version ships
```

| Option | Effect |
|---|---|
| `--to <path>` | Where it goes, from the game root. A trailing `/`, an existing folder, or a folder copy means "inside this folder". Default: `<runtime.into>/<path under runtime/>`. |
| `--force` | Overwrite a copy that was changed here. A file that is not a copy is overwritten only when `<runtime path>` names that one file. |
| `--dry-run` | Say what would be written; write nothing. |
| `--list` | List the runtime files. |

Line 1 of every copy is a header, in the file type's comment syntax:

```ts
// Copied from ummgames-dev v0.1.0 runtime/dev/fuzzy.ts (sha256 9f2c1e0a7b3d4c55). Owned here now; `umm-dev drift` compares.
```

- **`v0.1.0`** is the installed package's version: the tag the original can be fetched at.
- **The hash** is the first 16 hex digits of the SHA-256 of everything after line 1, with CRLF
  read as LF, so a checkout's line endings never count as a change.

**Copy never clobbers work.** Over an existing file it writes only when that file is an untouched
copy (its body still hashes to its header), which is how a game takes an upstream change.
A copy changed here needs `--force`. A file that is not a copy (the game's own code, or a
copy from before these headers) needs `--force` **and** a path naming exactly that file:
`umm-dev copy dev --force` overwrites changed copies in the folder but never the game's own
files, and lists each one as refused. To adopt runtime code over files a game already has, copy
them one at a time (`umm-dev copy dev/fuzzy.ts --force`), leaving out any file whose name the
game uses for its own code (copy that one elsewhere with `--to`). After writing, it names any
relative import that has no file beside it: copy that sibling too.

File types: `.ts .tsx .js .mjs .cjs .glsl .wgsl` take `//`, `.css` takes `/* */`,
`.html .svg .xml .md` take `<!-- -->`, `.sh .py .yaml .toml` take `#`. JSON cannot carry a header,
so it cannot be copied.

The game's `umm-dev.config.mjs` can move the default folder:

```js
export default defineConfig({ runtime: { into: 'src/shared' } })
```

## `umm-dev drift`

```sh
umm-dev drift            # a line per copy
umm-dev drift --diff     # and the changes
umm-dev drift --json     # { root, installed, copies: [...] }
umm-dev drift --strict   # exit 1 when any copy is not current (CI)
```

It finds copies by their header (through `git ls-files` in a checkout, so ignored output is
skipped; otherwise a walk that skips `node_modules`, `.git` and `dist*`) and compares three hashes:

| Status | Meaning | Next step |
|---|---|---|
| `current` | Unchanged here, and the installed `runtime/` file is the same. | None. |
| `changed here` | The game edited its copy. Upstream has not moved. | None: the copy is the game's. |
| `changed upstream` | The installed version's file differs from what was copied. | `umm-dev copy <path> --to <file>` takes it (the copy is untouched, so no `--force`). |
| `changed here and upstream` | Both moved. | Merge by hand; `--diff` shows both sides. |
| `no longer shipped` | The installed version has no such file. | None: the copy is wholly the game's. |

**`--diff`** shows the original against the game's copy, and the original against the installed
file. The original is free when only one side moved (it is the other side). When both moved,
drift needs the file at the header's tag:

1. `UMM_DEV_REPO`, if set, names a local clone: `git -C $UMM_DEV_REPO show <tag>:<path>`.
2. Otherwise it fetches `https://raw.githubusercontent.com/unclemattmakes/ummgames-dev/<tag>/<path>`.

Either way the text must hash to the header's hash, or it is not used. A header is data from
the game, so drift trusts only a tag of the form `v1.2.3` and a path of plain segments under
`runtime/` (no `.` or `..`). Every read stays inside the installed `runtime/`, and every
fetch stays inside this repo's `runtime/` at that tag. Offline, or with neither,
drift says why and diffs the copy against the installed file instead.

**Exit codes:** drift is information, not an error.

| Code | When |
|---|---|
| 0 | Reported, drifted or not. |
| 1 | `--strict`, and some copy is not current. |
| 2 | A usage error. |

## The runtime files

**`dev/perf-recorder.ts`.** A ring of frame times (600 samples by default). Call `sample(now)` per
rAF, or `push(ms)` for a measured value such as GPU time. `stats()` gives fps, p50/p95/p99,
min/max and hitches over `hitchMs` (default 33.4). It allocates nothing per frame.

**`dev/perf-hud.ts`.** A fixed panel fed by `tick(stats, info?, cost?, gpu?)`. A row turns amber
over its budget. `createPerfHud({ budget })` merges over a 60 Hz default.

**`dev/registry-types.ts`, `registry.ts`, `fuzzy.ts`, `command-bar.ts`.** A `DevTool` is a
scene, panel, toggle, param or action. `installCommandBar(tools, { suspendKeys })` opens on
Ctrl/Cmd+K. `suspendKeys` is the game's hook: hold its keyboard while the bar is open, and
return the release.

**`dev/tuner-panel.ts`.** Sliders over any object shaped like `TuningSet`. Save POSTs the values
to `saveUrl(id)` (default `/__dev/tuning/<id>`); the game's dev server writes the file.

**`dev/palette.ts`.** The game owns its tool list. This gives it `tunerTools(sets)`,
`perfHudTool(hud)` and `paramTool(param, value, label)`, and `installDevPalette(tools, options)`
installs the bar.

**`input/pad-profiles.ts`.** Read pads through `activeGamepad()`: standard order, the pad used
last, or null. `layout` says whether a Valve profile was applied.

**`boot/dev-splash.ts` and `dev-splash.css`.** The splash drives markup already in the page (its
doc comment has the markup; inline the CSS in `<head>`). Call it with the game's seams:

```ts
const splash = startDevSplash({
  root: document.getElementById('dev-splash'),
  portraitUrl: '/brand/portrait.webp', // the brand image; null for the wordmark alone
  words: ['stuff', 'simulations', 'Games'], // the last is the one it lands on
  waitForSteady: true, // go only after splash.steady() as well as splash.ready()
  onLift: () => iris.open(), // as the fade starts
})
// during boot: splash.progress(0.4) … splash.ready(); once frames are smooth: splash.steady()
// while splash.covering(), treat confirms as already held
```
