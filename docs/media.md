# Media: capture, cut, store, loop

The media chain makes a game's footage, trailers, store art and site loops from the game itself,
so they can be re-made whenever the game changes. Reach for it when a game needs a clip of real
play, a trailer, a storefront's covers and preview videos, or the short loop a site shows on a
card.
Each command feeds the next:

| Command | Reads | Writes |
|---|---|---|
| `umm-dev capture` | a shots file | frames, an mp4 and a contact sheet per shot |
| `umm-dev cut` | an edit list over captured clips | one mp4 |
| `umm-dev store` | the game's store recipe and a storefront preset | covers, icons, preview videos, a review sheet, a spec report |
| `umm-dev loop` | a cut or a store preview | a silent 720p faststart mp4 and its poster |

**Linked.** All four commands and `@ummgames/dev/media` run from `node_modules`. Nothing here
ships in a game's build.

**Requirements:**
- `ffmpeg` and `ffprobe` on `PATH`.
- Capture and store need `vite` and `playwright` in the game's devDependencies. Under npm, the
  `playwright` that `@playwright/test` brings also works.
- They also need a Chromium: run `pnpm exec playwright install chromium`. Without Playwright's
  own Chromium, they use the installed Chrome, then Edge.

**Keep footage out of `test-results/`.** It is capture's default output, and `cut`'s default
clip folder. **Playwright empties it at the start of every e2e run.** If the game runs Playwright,
set `capture.out` (and each edit list's `clips`) to a folder of its own, such as `captures/`, and
gitignore it.

**Paths.** Paths in `umm-dev.config.mjs` and inside an edit list are relative to the game root:
the nearest folder at or above the working directory that holds a `package.json`. Paths given on
the command line (`--file`, `--out`, `--font`, the edit list, the loop's input) are relative to
the working directory.

## Quick start

Install the kit, Vite and Playwright in the game:

```sh
pnpm add -D github:unclemattmakes/ummgames-dev#v0.2.0 vite playwright
pnpm exec playwright install chromium
```

Capture needs a page that Vite serves, and a debug handle on `window` for the hooks to read. A
real game sets `debugGlobal` to its own handle. This is the smallest game that works, as
`index.html` and `main.js` at the game root:

```html
<!doctype html>
<html lang="en">
  <body style="margin: 0; overflow: hidden">
    <canvas style="display: block; width: 100vw; height: 100vh"></canvas>
    <script type="module" src="./main.js"></script>
  </body>
</html>
```

```js
const canvas = document.querySelector('canvas')
canvas.width = innerWidth * devicePixelRatio
canvas.height = innerHeight * devicePixelRatio
const ctx = canvas.getContext('2d')
const game = { frames: 0, color: 'white' }
addEventListener('keydown', (e) => {
  if (e.code === 'Space') game.color = 'red'
})
const t0 = performance.now()
function frame(now) {
  game.frames++
  ctx.fillStyle = '#123'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = game.color
  ctx.fillRect(((now - t0) / 1000) * 200, canvas.height / 2 - 30, 60, 60)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
window.__game = game
```

`umm-dev.config.mjs` at the game root names the handle and says when the game is ready:

```js
import { defineConfig } from '@ummgames/dev'

export default defineConfig({
  capture: {
    debugGlobal: '__game',
    ready: (game) => game?.frames > 30,
    size: [1280, 720],
  },
})
```

`shots.json` records 2 s, presses Space at 1 s, and checks that the game saw it:

```json
[
  {
    "name": "intro",
    "dur": 2,
    "keys": [[1, "Space", 0.1]],
    "expect": "debug.color === 'red'",
    "why": "Space at 1 s turns the square red"
  }
]
```

`trailer.json` is an edit list over that capture:

```json
{
  "size": [1280, 720],
  "out": "dist-video/trailer.mp4",
  "shots": [
    { "clip": "intro", "in": 0, "dur": 1.5 },
    { "clip": "intro", "in": 0.5, "dur": 1.5, "dissolve": 0.5, "speed": 0.5 }
  ],
  "fadeIn": 0.3,
  "fadeOut": 0.5
}
```

Then capture, cut and loop:

```sh
pnpm exec umm-dev capture intro --sheet
pnpm exec umm-dev cut trailer.json
pnpm exec umm-dev loop dist-video/trailer.mp4
```

**When it works,** each command exits 0 and prints what it wrote:

```
[intro] http://localhost:5440/
[intro] 120 frames, 0 missing
  test-results/capture/intro/intro.mp4
  test-results/capture/intro/sheet.jpg
...
wrote dist-video/trailer.mp4 (2.50 s, 1280x720, 0.0 MB)
wrote dist-site/trailer.mp4 (0.01 MB)
wrote dist-site/trailer.poster.webp (from 0.38 s)
```

Open `test-results/capture/intro/sheet.jpg`. Each tile is labelled with its game frame, and the
square is red from tile `f61` on.

## `umm-dev capture`

```
umm-dev capture <shot...> [options]
umm-dev capture --all [options]
umm-dev capture --list [--file <shots.json>]
umm-dev capture --compare <dirA> <dirB>
```

Records each named shot of the shots file in virtual time: every frame exact, none dropped. It
starts the game's own Vite (or uses `capture.url`), opens Chromium, and writes one folder per
shot. A shot whose `expect` fails, or that loses a frame, fails the run.

| Option | Value | Default | What it does |
|---|---|---|---|
| `<shot...>` | shot names | none | The shots to capture. Name at least one, or pass `--all`. |
| `--file` | path | `capture.shots` (`shots.json`) | The shots file. |
| `--out` | folder | `capture.out` (`test-results/capture`) | The output folder. Each shot writes `<out>/<name>/`. |
| `--all` | flag | off | Capture every shot in the file. |
| `--sheet` | flag | off | Write a contact sheet per shot, each tile labelled with its game frame. |
| `--every` | seconds > 0 | `0.1` | Seconds between sheet tiles. Implies `--sheet`. |
| `--crop` | `w:h:x:y` | none | Crop each sheet tile, in canvas px. Implies `--sheet`. |
| `--igpu` | flag | off | Run Chromium on the integrated GPU. |
| `--tag` | folder-safe name | none | Write to `<name>@<tag>/` instead of `<name>/`, to compare two runs of one shot. |
| `--list` | flag | off | Print each shot's name and `why`, and exit. |
| `--compare` | flag, two folders | off | Compare two capture folders frame by frame, and their `states.jsonl` when both have one. |
| `-h`, `--help` | flag | off | Print the help. |

**Exit codes:** 0 when every shot passed (with `--compare`: the same footage). 1 when a shot failed
its `expect` or lost a frame, a named shot is not in the file, or setup failed (with `--compare`:
different footage). 2 on a usage mistake.

**What it writes,** in `<out>/<name>/`:
- the frames, `f00000.jpg` on (`.png` with the shot's `png`);
- `<name>.mp4`, x264 at `capture.crf`, when no frame is missing and there are more than 2;
- `meta.json`: the shot, its URL, `fps`, `size`, `frames`, `expected`, `missing`, `written`,
  `heldAtBootFrame` and `seed`;
- `sheet.jpg`, with `--sheet`. Pick in-points from its labels, not by reasoning about speed;
- `states.jsonl`, one line per frame, when `capture.state` is set.

The folder is emptied first, so a re-capture never mixes old frames with new.

```sh
pnpm exec umm-dev capture intro --sheet                       # one shot, with its contact sheet
pnpm exec umm-dev capture intro --every 0.05 --crop 640:360:320:180   # tiles every 3 frames, cropped
pnpm exec umm-dev capture --all --file store/shots.json --out dist-store/capture
pnpm exec umm-dev capture intro --tag a && pnpm exec umm-dev capture intro --tag b
pnpm exec umm-dev capture --compare test-results/capture/intro@a test-results/capture/intro@b
```

`--compare` prints three lines and a verdict. The `state` line compares `states.jsonl`, so it needs
`capture.state`:

```
frames: 120 vs 120
pixels: 120/120 frames bit-identical
state: 120/120 frames identical
SAME footage
```

## `umm-dev cut`

```
umm-dev cut <edl.json> [--draft] [--print] [--font <file>] [--check]
```

Cuts one mp4 from an edit list over captured clips: shots trimmed and re-timed from game frames,
sped, reversed, reframed or graded; joined with cuts, dissolves or matched wipes; then overlays,
text cards, fades and music. It validates the edit list before anything runs, and every message
names the field to fix.

| Option | Value | Default | What it does |
|---|---|---|---|
| `<edl.json>` | path | none | The edit list. Exactly one. |
| `--draft` | flag | off | Fast encodes (`veryfast`, CRF 24), written as `<out stem>-draft.mp4`. |
| `--print` | flag | off | Print the ffmpeg commands instead of running them. |
| `--font` | `.ttf` or `.otf` path | none | The cards' font when the edit list sets no `font`. |
| `--check` | flag | off | Validate the edit list, print `<file>: ok`, and exit. |
| `-h`, `--help` | flag | off | Print the help. |

**Exit codes:** 0 when the cut is written, printed or valid. 1 on an invalid edit list (with
`--check` too), a missing clip, an ffmpeg failure, or an output over `maxMB`. A file over `maxMB`
is still written. 2 on a usage mistake.

**Without ffmpeg,** `cut` prints the commands, starting with
`# ffmpeg is not on PATH: printing the commands instead of running them.`, writes nothing, and
exits 0.

```sh
pnpm exec umm-dev cut trailer.json --check     # validate only
pnpm exec umm-dev cut trailer.json             # the cut
pnpm exec umm-dev cut trailer.json --draft     # fast, to dist-video/trailer-draft.mp4
pnpm exec umm-dev cut trailer.json --print     # the ffmpeg commands, to run elsewhere
```

## `umm-dev store`

```
umm-dev store [--steps <list>] [--no-capture] [--only <shots>] [--draft] [--igpu]
```

Runs the game's store recipe end to end, in six steps. The recipe is the `store` section of
`umm-dev.config.mjs`, the shots, templates and edit lists it names, and a storefront preset.

1. **preflight.** ffmpeg and ffprobe are on `PATH`. The section names a still or a video. The
   shots file, templates, edit lists and preset are there and valid. The game's own `preflight`
   hook passes.
2. **capture.** Every shot in `store.shots` goes to `<out>/capture`, with a contact sheet every
   `sheetEvery` s. A shot that fails stops the kit. Without `store.shots`, the step is skipped.
3. **stills.** Chromium renders each still from its template.
4. **cut.** Each video's edit list is cut. An edit list without `clips` uses `<out>/capture`;
   without `out`, it writes `<out>/<edl stem>.mp4`.
5. **review.** `<out>/review/<edl stem>-beats.jpg` shows each shot's in-point frame, captioned
   with its clip, its `in` and its `beat`.
6. **check.** Every output is probed and checked against the preset. Each preset asset gets a
   line, then the preset's rules to check by eye.

| Option | Value | Default | What it does |
|---|---|---|---|
| `--steps` | comma-separated steps | all six | Run only these steps. They always run in the order above. |
| `--no-capture` | flag | off | Drop the capture step: rebuild from the captures already made. |
| `--only` | comma-separated shot names | all | Capture only these shots. The other steps still run. |
| `--draft` | flag | off | Fast video encodes, written as `<out stem>-draft.mp4`. The check step still checks the full-quality file, not the draft. |
| `--igpu` | flag | off | Capture on the integrated GPU. |
| `-h`, `--help` | flag | off | Print the help. |

**Exit codes:** 0 when the kit passes its preset. 1 on any `FAIL` or `MISSING` line, or when the
kit stops at preflight, capture, stills or cut. 2 on a usage mistake.

**Two steps answer two different questions:**
- **What does this storefront need?** Run `umm-dev store --steps check` before you build anything.
  With nothing made yet, it lists every required asset as `MISSING`, with its size and format.
  For CrazyGames, that is three covers (1920x1080, 800x1200 and 800x800, png or jpg). The
  preview videos are optional, but checked when made: 1920x1080 and 1080x1620, 15 to 20 s,
  silent, h264, at most 50 MB.
- **Can my recipe run?** That is `--steps preflight`. It checks only that the tools, files and
  templates are there. It says nothing about what the preset needs, and it prints `store done:`
  even though it made nothing.

**The check lines:**

| Line | Means | Fails the kit |
|---|---|---|
| `ok       <id>: <file>` | The file passes every check of its asset. | no |
| `FAIL     <id>: <file> <reasons>` | The file breaks a check. | yes |
| `MISSING  <id> (required)` | A required asset was not made. | yes |
| `skipped  <id>` | An optional asset was not made. | no |
| `??       <id>: the preset has no spec of that id` | Something was made under an id the preset lacks. | no |

```sh
pnpm exec umm-dev store                        # every step
pnpm exec umm-dev store --steps preflight      # is the recipe valid?
pnpm exec umm-dev store --no-capture           # rebuild from the captures already made
pnpm exec umm-dev store --only cover-shot      # re-capture that shot alone, then rebuild the rest
pnpm exec umm-dev store --steps check          # only the spec report
```

A passing run ends:

```
== check
  ok       cover-landscape: cover-landscape-1920x1080.png
  ok       cover-portrait: cover-portrait-800x1200.png
  ok       cover-square: cover-square-800x800.png
  ok       preview-landscape: preview-landscape.mp4
  skipped  preview-portrait
  by eye (CrazyGames):
    - Covers: no border, no text but the title, ...

store done: dist-store/
```

## `umm-dev loop`

```
umm-dev loop <video.mp4 | edl.json> [options]
```

Makes the clip a games site shows on a card:
- a silent H.264 (high profile, yuv420p) mp4 with `+faststart`, so it plays before it has fully
  loaded;
- its long edge capped at `edge` px, never upscaled;
- a poster beside it, `<stem>.poster.webp` (or `.jpg`), at the same size.

Give it a cut or a store preview. An input ending `.json` is an edit list: `loop` cuts it to a temp
file first, ignoring its `out`.

**The poster frame.** `loop` samples frames across the clip and keeps the one with the most
detail, brightness breaking ties. A clip that fades up from black, or flashes white, does not end
up with a flat poster. `--poster-at` picks the time instead.

| Option | Value | Default | What it does |
|---|---|---|---|
| `<input>` | `.mp4` or `.json` path | none | The video, or an edit list to cut first. Exactly one. |
| `--out` | folder | `loop.out` (`dist-site`) | The output folder. |
| `--name` | file stem | the input's stem | The output's stem: `<name>.mp4` and `<name>.poster.<fmt>`. |
| `--edge` | px | `loop.edge` (`720`) | The long-edge cap. |
| `--crf` | number | `loop.crf` (`30`) | x264 CRF. |
| `--poster` | `webp` or `jpg` | `loop.posterFormat` (`webp`) | The poster's format. |
| `--poster-at` | seconds | `loop.posterAt` (none: sampled) | Take the poster at this time instead of sampling. |
| `-h`, `--help` | flag | off | Print the help. |

**Exit codes:** 0 when both files are written. 1 when the input has no video, the loop would
overwrite its input, the edit list is invalid, or ffmpeg fails. 2 on a usage mistake.

```sh
pnpm exec umm-dev loop dist-store/preview-landscape.mp4    # dist-site/preview-landscape.mp4 + .poster.webp
pnpm exec umm-dev loop trailer.json --name home --poster-at 1.2   # cut the edit list first
pnpm exec umm-dev loop dist-video/trailer.mp4 --edge 480 --poster jpg --out dist-site/cards
```

## Library: `@ummgames/dev/media`

```js
import { checkAsset, cutEdl, loadPreset, probe, validateEdl } from '@ummgames/dev/media'
```

The code behind the four commands, for a game script that needs one piece: a cut from code, an
edit-list check in a unit test, a spec check in CI. `src/media/index.d.ts` types each export.
Relative paths resolve from the working directory, except where a function takes a `root`.

| Export | What it does |
|---|---|
| `CAPTURE_DEFAULTS`, `STORE_DEFAULTS`, `LOOP_DEFAULTS`, `EDL_DEFAULTS` | Each section's defaults, as the tables below list them. |
| `loadShots(file)` | Read and validate a shots file. Throws on a problem. |
| `validateShots(shots)` | A shots array's problems, as messages. Empty: valid. |
| `mergeQuery(...parts)` | Merge query strings or objects into one query string. The first value of a key wins. |
| `shotUrl(shot, cfg)` | A shot's page URL: path and query, without the origin. |
| `shotEvents(shot, fps)` | A shot's keys, pointer events and `run` lines, as game frames from tick 0. |
| `captureShots(run)` | Capture shots. Resolves to one result per shot: `{ name, dir, frames, ok, problems }`. |
| `clockScript(cfg)` | The virtual clock's init script, as source text. |
| `compareCaptures(a, b)` | Compare two capture folders: `{ same, lines }`. |
| `validateEdl(edl, { font? })` | An edit list's problems, as messages. Empty: valid. |
| `cutLength(edl)` | The cut's length in seconds. |
| `planCut(edl, ctx)` | Every ffmpeg command of a cut, built without touching the disk. |
| `cutEdl(edl, { root, draft?, print?, font?, log? })` | Cut an edit list. Throws on a problem. |
| `makeLoop(input, cfg)` | Make a site loop and its poster from an mp4. |
| `loadPreset(nameOrPath, root?)` | A preset by name (`crazygames`) or path. Throws when it is missing or invalid. |
| `checkAsset(probe, spec)` | One file's failures against one preset asset. Empty: it passes. |
| `checkKit(preset, made)` | The store's check lines for a set of probed files. |
| `probe(file)` | ffprobe a file: size, duration, video stream, audio streams. |
| `runStore(o)` | Run store steps. Resolves to `{ ok, report }`. |

**Errors.** A function that fails throws an `Error` whose message says what to fix.

```js
// tests/edit-lists.test.mjs: the trailer's edit list stays valid
import fs from 'node:fs'
import { validateEdl } from '@ummgames/dev/media'
import { expect, it } from 'vitest'

it('trailer.json is valid', () => {
  expect(validateEdl(JSON.parse(fs.readFileSync('trailer.json', 'utf8')))).toEqual([])
})
```

```js
// a cover checked against a storefront's spec
const preset = loadPreset('crazygames')
checkAsset(probe('dist-store/cover-square-800x800.png'), preset.assets['cover-landscape'])
// [ 'is 800x800, must be 1920x1080' ]
```

```js
// a cut from code, to a different output
const edl = JSON.parse(fs.readFileSync('trailer.json', 'utf8'))
cutEdl({ ...edl, out: 'dist-video/from-code.mp4' }, { root: process.cwd() })
```

## Config: `capture`

| Key | Type | Default | What it does |
|---|---|---|---|
| `url` | `string \| null` | `null` | A running dev server's origin, such as `http://localhost:5173`. `null`: capture starts Vite at the game root. |
| `vite` | `string \| null` | `null` | The Vite config file for that server. `null`: Vite's own lookup. |
| `port` | `number` | `5440` | The dev-server port. The `CAPTURE_PORT` environment variable overrides it. A busy port stops the run at once. Unused with `url`. |
| `path` | `string` | `'/'` | The page's path, before the query. |
| `query` | `string \| Record<string, string>` | `''` | URL flags every shot gets. A shot's own `query` wins over it. |
| `shotUrl` | `((shot, { query, path }) => string) \| null` | `null` | Node function that builds a shot's path and query. It replaces the default URL, and drops the shot's `query` unless it merges it in: see [The URL](#the-url-query-and-shoturl). |
| `debugGlobal` | `string \| null` | `null` | The name of the game's debug handle on `window`. Hooks and shot JS get it as `debug`. |
| `ready` | `((debug, clock) => boolean) \| string \| null` | `null` (always ready) | Page hook: the game is ready to shoot. |
| `hold` | `'ready' \| 'assign'` | `'ready'` | What ends boot. `'ready'`: the first frame at or past `bootFrames` where `ready` holds. `'assign'`: the moment the game assigns `window[debugGlobal]`; then capture waits, time frozen, for `ready`. Needs `debugGlobal`. |
| `bootFrames` | `number` | `60` | The earliest boot frame that can become tick 0, with `hold: 'ready'`. |
| `hide` | `((names, debug) => void) \| string \| null` | `null` (CSS selectors) | Page hook: hides a shot's `hide` list at tick 0. The default treats each name as a CSS selector and sets it `display: none`. |
| `prep` | `((shot, debug) => unknown) \| string \| null` | `null` | Page hook: runs at tick 0 for every shot, before the shot's own `prep`. What it returns is printed. |
| `state` | `((debug) => unknown) \| string \| null` | `null` | Page hook: runs on every recorded frame. What it returns goes to `states.jsonl`, one JSON line per frame, and `--compare` compares those lines. |
| `fps` | `number` | `60` | Game frames per second. |
| `seed` | `number \| null` | `1` | The `Math.random` seed. `null` leaves `Math.random` alone. |
| `skip` | `number` | `2` | Real frames per game frame while recording. Higher is slower, never choppier. |
| `size` | `[number, number]` | `[1920, 1080]` | The window in device pixels, for a shot without `size`. |
| `dpr` | `number` | `1` | Device pixel ratio. The window is `size / dpr` CSS px. |
| `grab` | `'canvas' \| 'page'` | `'canvas'` | `'canvas'` copies the canvas (2D, WebGL or WebGPU) at its own backing size. `'page'` screenshots the window, DOM included. |
| `canvas` | `string` | `'canvas'` | The canvas's CSS selector. Pointer events and `keyTarget: 'canvas'` use it too. |
| `keyTarget` | `'window' \| 'document' \| 'canvas'` | `'window'` | Where key events are dispatched. |
| `quality` | `number` | `0.92` | JPEG quality, 0 to 1. |
| `crf` | `number` | `16` | x264 CRF of each shot's mp4. It is a source for cuts, so near-lossless. |
| `shots` | `string` | `'shots.json'` | The shots file. |
| `out` | `string` | `'test-results/capture'` | The output folder. **Playwright empties `test-results/` on every e2e run:** a game that runs Playwright sets this to a folder of its own. |
| `font` | `string \| null` | `null` | Font file for the sheets' labels. `null`: fontconfig's default. |
| `browser` | `{ headless?: boolean, channel?: string, args?: string[] }` | `{ headless: true, channel: undefined, args: [] }` | Chromium's launch. A WebGPU game usually wants `headless: false`, `channel: 'chrome'` and `args: ['--enable-unsafe-webgpu']`. |
| `bootTimeout` | `number` | `180` | Seconds to wait for the game to become ready. |

**Merging.** A plain-object value merges over its default one level deep, so `browser: { args }`
keeps `headless: true`. Any other value, an array included, replaces the default.

**A canvas grab** records the canvas's own backing size. A game that sizes its canvas without
`devicePixelRatio` records frames smaller than `size`.

### Page hooks

`ready`, `hide`, `prep` and `state` run in the page, not in Node. Capture sends each hook's source
text to the page, so a hook must not use anything from the config file's scope: no imports, no
constants. Write it as an arrow function, a function, a method (`ready(game) { ... }`), or a
string of one.

- **`debug`** is `window[debugGlobal]`, or `undefined` without `debugGlobal`.
- **`clock`**, `ready`'s second argument, is the clock's state, `window.__ummClock`, typed
  `CaptureClock`.
  - `frames` is the virtual frame count.
  - `mode` is `'boot'`, `'hold'` or `'run'`.
  - `tick0` is the frame recording counts from.
  - Anything else on the object is internal.
- **A hook that throws** counts as `false` in `ready`, and logs `{ "error": ... }` in `state`. A
  `prep` that throws stops the run.

`shotUrl` is the one function that runs in Node, so it may import and use anything.

### The URL: `query` and `shotUrl`

**Without `shotUrl`,** a shot's URL is `path`, then the shot's `query` merged over
`capture.query`. When both set a flag, the shot's value wins:

```
capture.query: 'splash=0&debug=0'    shot.query: 'level=2&debug=1'
URL: /?level=2&debug=1&splash=0
```

**With `shotUrl`,** capture calls `shotUrl(shot, { query, path })` and uses what it returns.
`query` there is `capture.query` alone. **The shot's own `query` is dropped unless `shotUrl` merges
it in.** A `shotUrl` that returns `` `${path}?${query}` `` loses every shot's `query`, so the game
opens on its default level. `expect` catches it, if the shot has one.

This `shotUrl` adds a flag from a game-specific shot field (`map`) and keeps the shot's own
`query`. `mergeQuery` keeps the first value of each key, so the shot's flags win:

```js
import { defineConfig } from '@ummgames/dev'
import { mergeQuery } from '@ummgames/dev/media'

export default defineConfig({
  capture: {
    query: 'splash=0',
    shotUrl: (shot, { query, path }) =>
      `${path}?${mergeQuery(shot.query, shot.map ? { map: String(shot.map) } : null, query)}`,
  },
})
```

The shot `{ "name": "night", "query": "level=2", "map": "castle", "dur": 3 }` then opens
`/?level=2&map=castle&splash=0`. Capture prints each shot's URL as it starts (`[night] http://...`):
check it there. `shotUrl` returns the path and query only; capture puts the origin in front.

## Config: `store`

| Key | Type | Default | What it does |
|---|---|---|---|
| `preset` | `string` | `'crazygames'` | A preset in the kit's `presets/` by name, or a path to a `.json` (any value with a slash, or ending `.json`). |
| `out` | `string` | `'dist-store'` | The kit's output folder. Keep it out of git. |
| `shots` | `string \| null` | `null` | The kit's shots file. `null`: no capture step. |
| `sheetEvery` | `number` | `0.5` | Seconds between contact-sheet tiles of the kit's captures. |
| `stills` | `Still[]` | `[]` | The stills to render (below). |
| `videos` | `{ edl: string, spec?: string \| false }[]` | `[]` | An edit list each, and the preset asset id it is checked as. `spec` defaults to the edit list's stem; `false` checks nothing. |
| `preflight` | `((ctx: { root, store }) => string[] \| undefined \| Promise<string[] \| undefined>) \| null` | `null` | Node function run at preflight. Each string it returns is a problem that stops the kit. |

The capture step uses the `capture` section, with `store.shots` and `<out>/capture`. The stills
step renders headless, with `capture.browser.channel`.

### Stills

Each entry of `store.stills` renders one template into one or more PNGs:

| Field | Type | Default | What it does |
|---|---|---|---|
| `name` | `string` | required | The file stem, and the preset asset id unless `spec` is set. |
| `spec` | `string \| false` | `name` | The preset asset id it is checked as. `false`: not checked. |
| `template` | `string` | required | An `.html` or `.svg` file in the game. |
| `w`, `h` | `number` | required | The page's CSS px, and the main output's size. |
| `scale` | `number` | `2`, or `1` with `clip` | Device scale of the render. The render is downscaled with lanczos to each output size. |
| `sizes` | `[number, number][]` | none | More output sizes from the same render. |
| `keepRender` | `boolean` | `false` | Also keep the render at `scale`, `<name>-<w*scale>x<h*scale>.png`, as key art. |
| `plates` | `Record<string, string>` | none | A key in `STORE.plates` to a capture shot. The plate is that shot's last frame, from `<out>/capture`. |
| `inline` | `Record<string, string>` | none | A token to a file: `__TOKEN__` in the template becomes its data URL. |
| `data` | `Record<string, unknown>` | none | Anything the template reads from `window.STORE`. |
| `clip` | `string` | none | A CSS selector: crop the screenshot to that element's box. |
| `pad` | `number` | `0` | CSS px around the `clip` box. |
| `transparent` | `boolean` | `true` | Keep transparency where nothing is drawn. |

**Outputs.** A still writes `<name>-<w>x<h>.png`, plus `<name>-<W>x<H>.png` for each of `sizes`.
The check step checks `<name>-<w>x<h>.png` only. A still with `clip` writes `<name>.png` alone,
at `scale`, and is never checked.

```js
stills: [
  { name: 'cover-landscape', template: 'store/cover.html', w: 1920, h: 1080, plates: { main: 'cover-shot' } },
  { name: 'cover-portrait', template: 'store/cover.html', w: 800, h: 1200, plates: { main: 'cover-shot' } },
  { name: 'cover-square', template: 'store/cover.html', w: 800, h: 800, plates: { main: 'cover-shot' } },
  { name: 'logo', spec: false, template: 'store/cover.html', w: 1920, h: 1080, clip: '.logo', pad: 20,
    plates: { main: 'cover-shot' } },
  { name: 'icon', spec: false, template: 'store/icon.svg', w: 512, h: 512, scale: 1,
    sizes: [[192, 192], [32, 32]] },
],
```

## Config: `loop`

| Key | Type | Default | What it does |
|---|---|---|---|
| `out` | `string` | `'dist-site'` | The output folder. |
| `edge` | `number` | `720` | The long-edge cap in px. A smaller source keeps its size. |
| `crf` | `number` | `30` | x264 CRF. |
| `posterFormat` | `'webp' \| 'jpg'` | `'webp'` | The poster's format. |
| `posterQuality` | `number` | `80` | Poster quality, 0 to 100. |
| `samples` | `number[]` | `[0.15, 0.4, 0.65]` | Fractions of the clip tried for the poster. |
| `posterAt` | `number \| null` | `null` | Seconds into the clip for the poster. `null`: sample. |

## File formats

### Shots file

A JSON array. Each shot is one capture. Times are seconds of game time from tick 0, the frame
the clock held at once the game was ready.

| Field | Type | Default | What it does |
|---|---|---|---|
| `name` | `string` | required | The output folder. Letters, digits, `.`, `_`, `@`, `-`; unique; not only dots. |
| `dur` | `number` | required | Seconds to record, > 0. |
| `from` | `number` | `0` | Where recording starts. The frames before it run, but are not kept. |
| `query` | `string` | none | Extra URL flags. They win over `capture.query`. A `shotUrl` that does not merge them drops them. |
| `keys` | `[at, code, hold][]` | none | Key presses: `KeyboardEvent.code` down at `at`, up `hold` s later (at least one frame). |
| `run` | `[at, js][]` | none | JS run on that exact frame, with `debug` in scope. An expression, or statements. |
| `pointer` | `[at, type, x, y][]` | none | `pointerdown`, `pointermove` or `pointerup` at CSS px from the canvas's top left. |
| `hide` | `string[]` | none | Handed to `capture.hide` at tick 0. CSS selectors by default. |
| `prep` | `string` | none | JS run at tick 0, after `capture.prep`, with `debug` in scope. |
| `expect` | `string` | none | A JS expression checked on the last frame, with `debug` in scope. A falsy result or an error fails the shot. |
| `why` | `string` | none | What the frame is for. Printed when `expect` fails, and by `--list`. |
| `skip` | `number` | `capture.skip` | Real frames per game frame for this shot. |
| `size` | `[number, number]` | `capture.size` | The window in device pixels for this shot. |
| `png` | `boolean` | `false` | Lossless PNG frames, for stills and key art. |

**Other fields** are kept. The whole shot reaches `capture.prep` and `shotUrl`, so a game can add
its own: a level, a replay, a camera.

**Events.** Keys, pointer events and `run` lines fire on game frame `round(at * fps)`, before that
frame's rAF callbacks, whether or not the frame is recorded. A key event's `key` is the code too
(`KeyW`, not `w`). A `pointerdown` or `pointerup` also sends the matching mouse event, and a
`pointerup` sends a `click`.

**`expect` turns a recipe into a test.** When content moves under a shot, for example a jump
that lands sooner, the run fails and prints `why`. It does not quietly shoot the wrong frame.

```json
[
  {
    "name": "boost",
    "query": "level=2",
    "from": 0.5,
    "dur": 1,
    "keys": [[0.6, "Space", 0.2]],
    "run": [[0.7, "debug.boost = 10"]],
    "pointer": [[0.8, "pointerdown", 400, 300], [0.9, "pointerup", 400, 300]],
    "hide": ["#hud"],
    "prep": "debug.camera.hold()",
    "expect": "debug.player.mode === 'air'",
    "why": "the jump peaks at the end of the shot",
    "size": [1080, 1620],
    "png": true
  }
]
```

### Edit list

A JSON object. Keys starting with `$` or `_` are comments, and so are a shot's `beat` and `note`.
Any other unknown key is an error.

| Field | Type | Default | What it does |
|---|---|---|---|
| `shots` | `EdlShot[]` | required | The shots, in order (below). |
| `clips` | `string` | `'test-results/capture'`; in `store`, `<out>/capture` | The folder of captured clips. |
| `clipFps` | `number` | `60` | The clips' game frames per second. |
| `size` | `[number, number]` | `[1920, 1080]` | The output frame. Even on both sides. Clips are scaled to cover it, then cropped. |
| `fps` | `number` | `60` | The output frame rate. |
| `out` | `string` | `'dist-video/cut.mp4'`; in `store`, `<out>/<edl stem>.mp4` | The output file. Must end `.mp4`. |
| `crf` | `number` | `18` | The final x264 CRF, an integer from 0 to 51. |
| `maxMB` | `number` | none | Fail when the output is bigger. |
| `length` | `number` | the shots' length | Trim the end to this many seconds. It cannot make the cut longer than its shots. |
| `cover` | `{ file, hold }` | none | A still shown for the first `hold` s. The first shot's `dissolve` blends from it. |
| `overlays` | `Overlay[]` | none | Images over the cut (below). |
| `cards` | `Card[]` | none | Centred text (below). Needs a font. |
| `font` | `string` | none | A `.ttf` or `.otf` for the cards. None is bundled. `--font` gives one too. |
| `fadeIn`, `fadeOut` | `number` | `0` | Fades from and to black, in seconds. |
| `music` | `Music` | none | The audio track. Without it the cut is silent, with no audio track. |

**The cut's length** is the cover's `hold` plus every shot's `dur`, less each `dissolve`; or
`length`.

**A shot** (`EdlShot`):

| Field | Type | Default | What it does |
|---|---|---|---|
| `clip` | `string` | required | A capture's name. `cut` looks for `<clips>/<clip>/<clip>.mp4`, then `<clips>/<clip>.mp4`, then `<clips>/<clip>/list.txt`, then the bare frames. |
| `in` | `number` | required | Game seconds into the clip. |
| `dur` | `number` | required | Seconds in the cut. The shot uses `dur * speed` s of the clip. |
| `dissolve` | `number` | `0` | Seconds of cross-dissolve into this shot. Shorter than this shot and the one before. |
| `speed` | `number` | `1` | Playback speed. `0.5` is half speed. |
| `reverse` | `boolean` | `false` | Play the trimmed span backwards. |
| `crop` | `string` | none | `w:h:x:y` in clip px, applied before the scale. Reframes a landscape clip for a portrait cut. |
| `grade` | `string` | none | Any ffmpeg filter chain, after the scale, such as `eq=saturation=1.2`. |
| `wipeFrom` | `string` | none | A clip at the same game time that plays first, then wipes to `clip`. |
| `wipeAt` | `number` | required with `wipeFrom` | The wipe ends this many seconds into the shot. Between `wipe` and `dur`. |
| `wipe` | `number` | `1` | The wipe's length in seconds. |
| `transition` | `string` | `'wiperight'` | The wipe's ffmpeg `xfade` transition. |
| `beat` | `string` | none | What the in-point must show. The store's review sheet prints it. |
| `note` | `string` | none | A comment. |

**A wipe** plays at speed 1, forwards. Virtual-time captures of one shot line up frame for frame,
so a wipe between two versions of a scene, such as two lighting setups, holds.

**An overlay:** `file` (an image), `at` and `to` (seconds), `w` (width in output px), `x` and `y`
(output px, or an ffmpeg overlay expression such as `W-w-40`), `fade` (default `0.5`, in and out),
`opacity` (default `1`).

**A card:** `text`, `at` and `to` (seconds), `y` (px or a drawtext expression, default
`h*0.78-text_h/2`), `size` (default `72`), `color` (default `white`), `fade` (default `0.4`).

**Music:** `file`, `ranges` (`[[from, to], ...]` in source seconds, spliced in order with a 60 ms
crossfade), `fadeOut` (default `3`), `gain` (default `1`). Encoded as AAC at 256 kb/s.

```jsonc
{
  "clips": "dist-store/capture",
  "size": [1920, 1080],
  "out": "dist-video/trailer.mp4",
  "maxMB": 50,
  "cover": { "file": "dist-store/cover-landscape-1920x1080.png", "hold": 0.8 },
  "shots": [
    { "clip": "run-1", "in": 3.3, "dur": 2, "dissolve": 0.5, "beat": "the first jump" },
    { "clip": "run-2", "in": 1, "dur": 2, "speed": 0.5, "reverse": true },
    { "clip": "run-3", "in": 0, "dur": 2, "crop": "960:1080:480:0", "grade": "eq=saturation=1.2" },
    { "clip": "night", "wipeFrom": "day", "in": 6, "dur": 4, "wipeAt": 2, "wipe": 1 }
  ],
  "overlays": [{ "file": "art/logo.png", "at": 0.3, "to": 9.5, "w": 230, "x": "W-w-40", "y": 40 }],
  "font": "assets/fonts/ui.ttf",
  "cards": [{ "text": "Ten levels", "at": 4.3, "to": 7.5, "y": "h*0.14" }],
  "fadeIn": 0.5,
  "fadeOut": 1.5,
  "music": { "file": "assets/music/theme.opus", "ranges": [[8, 14], [196, 212]], "fadeOut": 3 }
}
```

### Store template

A still's `template` is an HTML or SVG file in the game. The template is the game's art; the
tool supplies the plates, tokens, render scale, sizes and checks around it.

- **`window.STORE`** is set before the template's scripts run. It holds the still's `data`, and
  its `name`, `w`, `h`, and `plates`: each named capture shot's last frame, as a data URL.
- **`__TOKEN__`** anywhere in the template becomes the data URL of the file `inline.TOKEN` names.
- **Readiness.** The render waits for fonts and images. A template that draws late sets
  `window.READY = false` at the top of its script, and `true` when it is done. The wait gives up
  after 60 s.
- **An SVG** without a `width` is given the still's `w` and `h`.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <style>
      body { margin: 0; }
      #stage { position: relative; overflow: hidden; }
      #stage img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      .logo { position: absolute; left: 6%; top: 10%; color: #fff; font: bold 8vh sans-serif; }
    </style>
  </head>
  <body>
    <div id="stage"><div class="logo">My Game</div></div>
    <script>
      window.READY = false
      const S = window.STORE
      const stage = document.getElementById('stage')
      stage.style.width = `${S.w}px`
      stage.style.height = `${S.h}px`
      const img = new Image()
      img.src = S.plates.main
      stage.prepend(img)
      img.decode().then(() => { window.READY = true })
    </script>
  </body>
</html>
```

### Preset

A storefront's asset rules as data. `presets/crazygames.json`, for the CrazyGames portal, is
one. A game can point
`store.preset` at its own file of the same shape.

| Field | Type | Default | What it does |
|---|---|---|---|
| `name` | `string` | required | The storefront's name, printed above the rules. |
| `sources` | `string[]` | none | Where the rules come from. |
| `checked` | `string` | none | When someone last read them. |
| `assets` | `Record<string, AssetSpec>` | required | Asset id to its checks (below). |
| `rules` | `string[]` | none | What a person must check by eye. Printed after the check. |

**An asset** (`AssetSpec`). Every check but `kind` is optional:

| Field | Type | What it checks |
|---|---|---|
| `kind` | `'image' \| 'video'` | Which checks apply. Required. |
| `size` | `[number, number]` | Exact pixels. |
| `minSize` | `[number, number]` | At least these pixels. |
| `formats` | `string[]` | Image only: `png`, `jpg` or `webp`. |
| `seconds` | `[min, max]` | Video only: the duration, inclusive, to 0.02 s. |
| `audio` | `boolean` | Video only: `false` means no audio track at all; `true` means one is needed. |
| `maxMB` | `number` | The file's size, in MB of 10^6 bytes. |
| `codecs` | `string[]` | Video only: codec names as ffprobe gives them (`h264`, `vp9`, `av1`). |
| `fps` | `number` | Video only: frames per second, to 0.01. |
| `required` | `boolean` | When it is not made: `MISSING`, which fails the kit. Otherwise `skipped`. |

```json
{
  "name": "A Store",
  "sources": ["https://store.example/docs/assets"],
  "checked": "2026-10-20",
  "assets": {
    "cover-landscape": { "kind": "image", "size": [1920, 1080], "formats": ["png", "jpg"], "required": true },
    "preview-landscape": { "kind": "video", "size": [1920, 1080], "seconds": [15, 20], "audio": false,
                           "maxMB": 50, "codecs": ["h264"], "fps": 60 }
  },
  "rules": ["No border, no text but the title."]
}
```

## How it works

### The virtual clock

Real-time recording drops frames, and nothing says which. Capture instead installs a virtual
clock before any game code runs. It replaces `requestAnimationFrame`, `performance.now` and
`Date.now`, and seeds `Math.random`. rAF callbacks then run only from the clock's own pump, in
three phases:

1. **Boot.** One virtual frame per real frame, so loading screens animate as usual. With
   `hold: 'ready'`, the clock holds on the first frame at or past `bootFrames` where `ready`
   holds. With `hold: 'assign'`, it holds the moment the game assigns `debugGlobal`, then waits
   for `ready`.
2. **Hold.** Time freezes. rAF callbacks still run, so the game keeps drawing, but a fixed-step
   sim gains no ticks. Capture runs `hide` and `prep` here. This frame is tick 0.
3. **Run.** Each pumped frame advances exactly `1/fps` s. Events fire on their frame, before its
   callbacks. Each recorded frame is grabbed, and the pump waits until Node has written it. After
   the last frame the clock holds again, so `expect` reads the last frame itself.

A slow GPU makes a capture slower, never choppier. A virtual frame is `1000/fps` ms plus 1e-6 ms.
Without that lead, float error puts about half the frame deltas a hair under `1/fps`, and a
fixed-step accumulator steps 0 ticks, then 2.

**Only those clocks are virtual.** `setTimeout`, `setInterval`, CSS animations, `<video>`, Web
Audio's clock and Workers run in real time. A game that times its sim with them does not stay in
step.

### Frame numbers

A sheet tile labelled `fN` is game frame N from tick 0. File `f00000` is game frame
`round(from * fps) + 1`. A cut's `in` is game seconds into the clip, so for a shot with `from: 0`,
tile `fN` is `in: (N - 1) / fps`: at 60 fps, `f61` is `in: 1`.

### The cut

Each shot is cut to its own near-lossless segment (CRF 10), exactly `dur` s at `fps`, in a
`.segs-<out stem>/` folder beside the output. One final pass joins the segments, adds the
overlays, cards, fades and music, and encodes with `+faststart`. The segment folder is deleted
afterwards, also when a command fails.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `(Playwright's Chromium is not installed: using the installed chrome)` | The game's Playwright wants a Chromium revision that is not downloaded, often after a Playwright upgrade. Capture falls back to the installed Chrome, then Edge. | Harmless if the capture passes. Run `pnpm exec playwright install chromium` in the game for its own build, or set `capture.browser.channel: 'chrome'` to use Chrome on purpose. |
| `could not start Chromium: ...` | No Chromium, Chrome or Edge would start. | `pnpm exec playwright install chromium`, or set `capture.browser.channel`. |
| `capture drives Chromium through Playwright: add playwright to the devDependencies ...` | `playwright` is not installed in the game. | `pnpm add -D playwright`. |
| `capture starts the game with Vite: add vite to the devDependencies` | `vite` is not installed, and `capture.url` is unset. | `pnpm add -D vite`, or set `capture.url` to a running server. |
| `port 5440 is in use: another capture is probably running on this machine.` | Another capture or server holds the port. | Wait for it, or set `CAPTURE_PORT=<n>` or `capture.port`. |
| `capture needs ffmpeg on PATH to encode its shots`, or `could not run ffmpeg (...): put it on PATH` | ffmpeg is not on `PATH`. | Install ffmpeg, then open a new shell. |
| `[<shot>] the game never became ready in 180 s: check capture.ready` | `ready` never returned true, or threw. A wrong `debugGlobal` makes `debug` undefined, and the hook throws. | Check `debugGlobal` against the name the game assigns. Run `ready`'s body in the browser console. |
| `... and that the game assigns window.null` | `hold: 'assign'` without `debugGlobal`. | Set `debugGlobal`, or use `hold: 'ready'`. |
| `[<shot>] capture.ready never held after the hold` | With `hold: 'assign'`, `ready` never held after the assignment. | Fix `ready`, or raise `bootTimeout`. |
| `config capture.ready must be a function, got object` | A hook is neither a function nor a string. | Write it as a function, or a string of one. |
| A hook fails with `<name> is not defined` | The hook uses something from the config file's scope. It runs in the page. | Inline the value in the hook, or read it from the game's debug handle. |
| `[<shot>] the clock stopped: no element matches canvas` | `capture.canvas` matches nothing. | Set `capture.canvas` to the canvas's selector. |
| `[<shot>] N of M frames missing` | The clock stopped, or the page crashed. | Read the lines before it: a page error or a clock error names the cause. |
| `[<shot>] expect false: <expr>`, then `the frame is for: <why>` | The shot no longer shows what it was for. | Look at the shot's `sheet.jpg`, then re-pick `from` and `dur`. Never loosen `expect` to pass. |
| `expect false` on a shot with a `query`, and the printed URL lacks its flags | `capture.shotUrl` drops the shot's `query`. | Merge `shot.query` in `shotUrl`: see [The URL](#the-url-query-and-shoturl). |
| `expect error: ... Cannot read properties of undefined` | `debug` is undefined: `debugGlobal` is unset or wrong. | Set `debugGlobal`. |
| `[<shot>] Failed to load resource: the server responded with a status of 404 (Not Found)` | Usually the browser asking for `/favicon.ico`. | Harmless. Add a favicon to silence it. |
| `--compare` says `DIFFERENT footage` | The game reads a real clock (timers, Web Audio, Workers) or unseeded randomness (`crypto.getRandomValues`), or the GPU drew differently. | Compare the `state` line: when the state agrees, only the pixels differ, on the GPU. |
| `--compare` says `SAME footage` with `frames: 0 vs 0` | Neither folder holds frames, often a mistyped path. | Check both paths. |
| `no shots file <file>: write one (docs/media.md, Shots), or set capture.shots or --file` | The shots file is not there. Under `store`, `store.shots` names it. | Write the file, or fix the path. |
| `no shot "<name>" in <file> (--list shows them)` | The name is not in the shots file. | `umm-dev capture --list`. |
| `unknown field "<key>" (see docs/media.md)` | The edit list has a key `cut` does not know, often a typo. | Fix the key, or start it with `$` or `_` to make it a comment. |
| `no clip "<clip>" in <dir>: capture it, or fix "clips" in the edit list` | The clip was never captured to `clips`. | Capture it with `--out <clips>`, or point `clips` at the capture folder. |
| `cards need a font: set "font" to a .ttf or .otf file, or pass --font` | The edit list has cards and no font. | Set `font`. `store` has no `--font`: set it in the edit list. |
| `shots[0] (<clip>): the first shot has nothing to dissolve from (add a "cover", or drop it)` | The first shot has a `dissolve` and there is no `cover`. | Add a `cover`, or drop the `dissolve`. |
| `"size" must be even on both sides (x264 at yuv420p)` | An odd width or height. | Use even sides. |
| `<out> is N MB, over "maxMB" M: raise "crf" in the edit list` | The cut is too big. The file is still written. | Raise `crf` a few steps, then cut again. |
| `cut` prints `wrote ... (15.00 s ...)`, but the file is shorter | A shot runs past the end of its clip (`in + dur * speed` is longer than the clip), or `length` is longer than the shots. | Keep each shot inside its clip (`meta.json` has `frames` and `fps`), or capture a longer clip. |
| `cut` exits 0 and writes nothing | ffmpeg is not on `PATH`, so `cut` printed the commands. | Install ffmpeg. Look for the `wrote` line. |
| `store stopped at preflight:`, then a list | The recipe has problems, one per line. | Fix each line, then run `umm-dev store --steps preflight`. |
| `the store section names no stills or videos: add them to umm-dev.config.mjs` | `store.stills` and `store.videos` are empty. | Add them. |
| `no preset "<name>": use one of crazygames or a path to a .json` | `store.preset` names no preset. | Use `crazygames`, or a path to a `.json`. |
| `no plate for "<shot>": capture it first (umm-dev capture <shot> --out <dir>)` | A still's plate shot has no frames in `<out>/capture`. | Run `umm-dev store --only <shot>`, which captures it from `store.shots`. |
| `still "<name>" never became ready (window.READY stayed false)` | The template never set `window.READY = true`, or an image never loaded. | Set `READY` when drawing is done. A page error, if any, is printed in place of the parenthesis. |
| `still "<name>": nothing matches <selector>` | The still's `clip` matches no element. | Fix `clip`. |
| `FAIL ... runs 13.50 s, must be 15 to 20 s` | The video is outside the preset's duration. | Change the `dur`s in its edit list, and check that no shot runs past its clip. |
| `FAIL ... has an audio track, must be silent: drop "music" from the edit list` | The preset wants a silent video. | Drop `music` from that edit list. |
| `MISSING  <id> (required)` | No still or video is checked as that id. | Add one, with `name` or `spec` set to the id. |
| `??       <id>: the preset has no spec of that id` | A still or video is checked under an id the preset lacks. | Set its `spec` to a preset id, or `spec: false`. |
| `the loop would overwrite its source <file>: set --out or --name` | The input and the output are the same file. | Pass `--out` or `--name`. |
| `<file> has no video to loop: pass an mp4 (a cut or a store preview)` | The input has no video stream. | Pass an mp4. |

## For agents

- **Never edit** `node_modules/@ummgames/dev`, including `presets/crazygames.json`. A game's own
  preset is a file in the game, named by `store.preset`.
- **The recipe is source; the output is not.** Edit the shots files, edit lists, templates and
  `umm-dev.config.mjs`. Never hand-edit captured frames, `meta.json` or any output.
- **Before running:** `umm-dev <command> --help` for the options, `umm-dev capture --list` for
  the shot names, `umm-dev cut <edl> --check` for an edit list, and `umm-dev store --steps
  preflight` for a store recipe.
- **Capture is GPU work.** Run one at a time. In a game that shares a GPU between sessions, wrap
  it: `pnpm exec umm-dev gpu run --name <task> -- pnpm exec umm-dev capture ...`.
- **Never weaken an `expect` to make a shot pass.** It failed because content moved. Read `why`,
  open the shot's `sheet.jpg`, and re-pick `from`, `dur` or `in` from the tile labels. Never pick
  frames by reasoning about game speed.
- **With `shotUrl`, merge `shot.query`.** After changing either, read the URL capture prints for
  each shot and check its flags.
- **Page hooks run in the page.** They cannot use imports or constants from the config file.
- **Check your own work:**
  - every capture prints `N frames, 0 missing` and exits 0;
  - `cut` prints a `wrote` line, and `ffprobe` gives the same duration;
  - `store` ends `store done:`, with no `FAIL` or `MISSING` line;
  - look at each `sheet.jpg` and `<out>/review/<edl stem>-beats.jpg`: each frame must show its
    `beat`.
- **Safe to delete and re-make:** `test-results/capture/`, `dist-store/`, `dist-video/`,
  `dist-site/`, any `<name>@<tag>/` capture folder and any `.segs-*` folder. Do not commit them
  unless the game says so.
- **Drafts are not for upload.** `--draft` writes `-draft.mp4` files, and `store --draft` does not
  check them.
