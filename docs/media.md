# Media: capture, cut, store, loop

Four commands make a game's footage, trailers, store art and site loops from the game itself.
Each one feeds the next:

| Command | Reads | Writes |
|---|---|---|
| `umm-dev capture` | a shots file | frames, an mp4 and a contact sheet per shot |
| `umm-dev cut` | an edit list over captured clips | one mp4 |
| `umm-dev store` | the game's store recipe and a portal preset | covers, icons, preview videos, a review sheet, a spec report |
| `umm-dev loop` | a cut or a store preview | a silent 720p faststart mp4 and its poster |

**Requirements:** `ffmpeg` and `ffprobe` on `PATH`. Capture and store also need Playwright's
Chromium (`pnpm exec playwright install chromium`); without it they use the installed Chrome,
then Edge. Capture starts the game's own Vite, so the game needs `vite` installed.

Every command takes `--help`. A failure exits non-zero with a message that says what to fix:
2 for a usage mistake, 1 for anything else.

## Settings

Each command reads its own section of the game's `umm-dev.config.mjs`. Paths are relative to
the game root, the nearest folder above the working directory that holds a `package.json`.

```js
import { defineConfig } from '@ummgames/dev'

export default defineConfig({
  capture: {
    debugGlobal: '__game',                  // the game's debug handle on window
    query: 'splash=0&quality=high',         // URL flags every shot gets
    ready: (game) => game?.frames > 60,     // runs in the page: see "Page hooks"
    size: [1920, 1080],
    dpr: 1.5,
    browser: { headless: false, channel: 'chrome', args: ['--enable-unsafe-webgpu'] },
  },
  store: { preset: 'crazygames', shots: 'tools/store/shots.json' /* ... */ },
  loop: { out: 'dist-site' },
})
```

`src/media/index.d.ts` types each section (`CaptureConfig`, `StoreConfig`, `LoopConfig`).

## `umm-dev capture`

```sh
umm-dev capture run-1                          # frames + mp4 to <out>/run-1/
umm-dev capture run-1 --sheet                  # plus sheet.jpg, a tile every 0.1 s
umm-dev capture run-1 --sheet --every 0.05 --crop 640:360:640:540   # tiles every 3 frames, cropped
umm-dev capture --all --file my-shots.json --out dist-store/capture
umm-dev capture run-1 --tag b && umm-dev capture --compare <out>/run-1 <out>/run-1@b
```

### How it stays frame-exact

Real-time recording drops frames, and nothing says which. Capture instead installs a virtual
clock before any game code runs. It replaces `requestAnimationFrame`, `performance.now` and
`Date.now`, and seeds `Math.random`. rAF callbacks then run only from the clock's own pump,
which goes through three phases:

1. **Boot.** The clock advances one virtual frame per real frame, so loading screens animate
   as usual. On the first frame at or past `bootFrames` where `ready` holds, the clock enters
   hold. With `hold: 'assign'`, it holds the moment the game assigns `debugGlobal`, and then
   waits, with time frozen, for `ready`.
2. **Hold.** Time freezes. rAF callbacks still run, so the game keeps drawing, but a fixed-step
   sim gains no ticks. The harness hides overlays and runs the prep hooks here. This frame is
   tick 0.
3. **Run.** Each pumped frame advances exactly `1/fps` s. Scheduled events fire on their exact
   frame, before that frame's callbacks. Each frame in the shot is grabbed, and the pump waits
   until Node has written it. After the last frame the clock holds again, so `expect` reads the
   last frame itself.

A slow GPU makes a capture slower, never choppier. Each run prints `N frames, 0 missing`, and a
missing frame fails the run. A virtual frame is `1000/fps` ms plus 1e-6 ms. Without that lead,
float error puts about half the frame deltas a hair under `1/fps`. A fixed-step accumulator
then steps 0 ticks, then 2, and the sim stutters even though the clock is perfect.

Two captures of one shot are the same footage. `--compare` checks this frame by frame, and
compares the `state` log too when both captures have one.

### Shots

A shots file is a JSON array. Times are seconds of game time from tick 0.

```jsonc
{
  "name": "run-1",            // the output folder
  "query": "level=1",         // extra URL flags; these win over capture.query
  "from": 1,                  // where recording starts (default 0)
  "dur": 3,                   // seconds to record
  "keys": [[0.5, "KeyW", 2]], // [atSec, KeyboardEvent.code, holdSec], on exact frames
  "run": [[1, "debug.player.boost = 10"]],   // JS run on an exact frame; `debug` is the debug global
  "pointer": [[1.2, "pointerdown", 400, 300], [1.3, "pointerup", 400, 300]], // CSS px on the canvas
  "hide": ["#hud"],           // handed to capture.hide (CSS selectors by default)
  "prep": "debug.camera.hold()",          // JS run at tick 0, after capture.prep
  "expect": "debug.player.mode === 'air'", // checked on the last frame; false fails the run
  "why": "what the frame is for",          // printed when expect fails, for whoever re-picks it
  "skip": 2,                  // real frames per game frame while recording
  "size": [1080, 1620],       // canvas px (default capture.size); the window is size / dpr
  "png": true                 // lossless PNG frames (stills, key art)
}
```

`expect` turns a recipe into a test. When content moves under a shot, for example a jump that
lands sooner, the run fails and prints `why`. It does not quietly shoot the wrong frame.

A shot may carry other fields. The shot reaches the `prep` hook and `shotUrl` whole, so a
game can add fields of its own: a level, a replay or a camera.

Per shot, in `<out>/<name>/`, capture writes:
- the frames, `f00000.jpg` and on;
- `<name>.mp4`, x264 at `crf`;
- `meta.json`, with the URL, the counts and the boot frame it held at;
- `sheet.jpg`, with `--sheet`. Each tile is labelled with its game frame. Pick in-points from
  these, not by reasoning;
- `states.jsonl`, with a `state` hook.

### `capture` settings

| Key | Default | What |
|---|---|---|
| `url` | none | A running dev server's origin. Unset: capture starts Vite at the game root. |
| `vite` | none | A Vite config file for that server. |
| `port` | `5440` | Dev-server port. `CAPTURE_PORT` overrides it. A busy port stops the run at once: captures share the GPU, so run one at a time. |
| `path` | `/` | The page's path. |
| `query` | `''` | URL flags every shot gets, as a string or an object. A shot's own `query` wins. |
| `shotUrl` | none | Node function `(shot, { query, path }) => url` for games whose URL depends on shot fields. |
| `debugGlobal` | none | The game's debug handle on `window`. Hooks and shot JS get it as `debug`. |
| `ready` | always | Page hook `(debug, clock) => boolean`. |
| `hold` | `ready` | `ready` or `assign` (see above). |
| `bootFrames` | `60` | The earliest boot frame that can become tick 0. |
| `hide` | CSS selectors | Page hook `(names, debug) => void`, for a shot's `hide` list. |
| `prep` | none | Page hook `(shot, debug) => unknown`, run at tick 0 for every shot. |
| `state` | none | Page hook `(debug) => JSON`, logged on every frame to `states.jsonl`. |
| `fps` | `60` | Game frames per second. |
| `seed` | `1` | The `Math.random` seed. `null` leaves `Math.random` alone. |
| `skip` | `2` | Real frames per game frame while recording. |
| `size` | `[1920, 1080]` | Canvas pixels. |
| `dpr` | `1` | Device pixel ratio. The window is `size / dpr`. |
| `grab` | `canvas` | `canvas` copies the canvas (2D, WebGL or WebGPU). `page` screenshots the page, DOM included. |
| `canvas` | `canvas` | The canvas's selector. |
| `keyTarget` | `window` | Where key events go: `window`, `document` or `canvas`. |
| `quality` | `0.92` | JPEG quality. |
| `crf` | `16` | x264 CRF of each shot's mp4. It is a source for cuts, so near-lossless. |
| `shots` | `shots.json` | The shots file. |
| `out` | `test-results/capture` | The output folder. A test runner may empty `test-results/`, so keep footage you need with `--out`. |
| `font` | fontconfig's | Font file for the sheets' labels. |
| `browser` | headless | `{ headless, channel, args }` for Chromium. A WebGPU game usually wants `headless: false`, `channel: 'chrome'` and `--enable-unsafe-webgpu`. |
| `bootTimeout` | `180` | Seconds to wait for `ready`. |

### Page hooks

`ready`, `hide`, `prep` and `state` run in the page, not in Node. Capture sends each hook's
source text to the page, so a hook must not use anything from the config file's scope. Write it
as an arrow function, a function, or a string of one.

## `umm-dev cut <edl.json>`

```sh
umm-dev cut trailer.json             # the cut
umm-dev cut trailer.json --draft     # fast encodes, to <out>-draft.mp4
umm-dev cut trailer.json --print     # print the ffmpeg commands; also what happens without ffmpeg
umm-dev cut trailer.json --check     # validate only
```

`cut` cuts each shot to its own near-lossless segment. Each segment is exactly `dur` seconds
at `fps`, re-timed from game frames, so a shot's `in` is game seconds into its clip. One final
pass then joins the segments and adds the overlays, cards, fades and music, encoded with
`+faststart`. `cut` checks the edit list before anything runs, and every message names the
field to fix.

```jsonc
{
  "clips": "dist-store/capture",   // capture's --out (default test-results/capture)
  "clipFps": 60,                   // the clips' game frames per second
  "size": [1920, 1080],            // output frame; clips are scaled to cover, then cropped
  "fps": 60,
  "out": "dist-video/trailer.mp4",
  "crf": 18,
  "maxMB": 50,                     // fail if the result is bigger
  "length": 30,                    // trim the end to this (default: the shots' sum)
  "cover": { "file": "dist-store/cover-landscape-1920x1080.png", "hold": 0.8 },
  "shots": [
    { "clip": "run-1", "in": 3.3, "dur": 2 },
    { "clip": "run-2", "in": 1, "dur": 2, "dissolve": 0.5 },  // cross-dissolve INTO this shot
    { "clip": "run-3", "in": 0, "dur": 2, "speed": 0.5, "reverse": true },
    { "clip": "run-4", "in": 0, "dur": 2, "crop": "960:1080:480:0", "grade": "eq=saturation=1.2" },
    { "clip": "night", "wipeFrom": "day", "in": 6, "dur": 4, "wipeAt": 2, "wipe": 1,
      "transition": "wiperight" },  // matched wipe: both clips at the same game time
    { "clip": "run-5", "in": 0, "dur": 2, "beat": "what this in-point must show" }
  ],
  "overlays": [{ "file": "dist-store/logo.png", "at": 0.3, "to": 9.8, "w": 230,
                 "x": 1640, "y": 846, "fade": 0.5, "opacity": 0.95 }],
  "font": "assets/fonts/ui.ttf",   // for cards; none is bundled (or pass --font)
  "cards": [{ "text": "Ten levels", "at": 4.3, "to": 7.5, "y": "h*0.14", "size": 72,
              "color": "white", "fade": 0.4 }],
  "fadeIn": 0.5, "fadeOut": 1.5,
  "music": { "file": "assets/music/theme.opus", "ranges": [[8, 48], [196, 212]],
             "fadeOut": 3, "gain": 1 }   // omit music for a silent cut with no audio track
}
```

- **`crop`** is `w:h:x:y` in clip pixels, applied before the scale. Use it to reframe a
  landscape clip for a portrait cut.
- **`grade`** is any ffmpeg filter chain.
- **Wipes.** Virtual-time captures of one shot line up frame for frame, so a wipe between two
  versions of a scene, such as two editions or two lighting setups, holds.
- **Music.** `cut` splices the ranges in order with a 60 ms crossfade, then fades the end.
- **Cards** are centred text drawn with the font file you give.
- **Comments.** Keys starting with `$` or `_` are comments, and so are a shot's `beat` and
  `note`. `cut` rejects any other unknown key.

## `umm-dev store`

```sh
umm-dev store                        # preflight, capture, stills, cut, review, check
umm-dev store --no-capture           # rebuild from the captures already made
umm-dev store --only cover-shot     # re-capture that shot alone, then rebuild everything
umm-dev store --steps check          # only the spec report
```

`store` runs a game's store recipe end to end, in six steps:

1. **Preflight.** ffmpeg is on PATH. The templates are there. The edit lists, shots and preset
   are valid. The game's own `preflight` hook passes.
2. **Capture.** Every shot in `store.shots` goes to `<out>/capture`, with contact sheets. A shot
   whose `expect` fails stops the kit.
3. **Stills.** Chromium renders each still from the game's template.
4. **Cut.** Each video's edit list is cut. An edit list without `clips` or `out` uses the kit's
   capture folder and `<out>/<edl stem>.mp4`.
5. **Review.** `<out>/review/<video>-beats.jpg` shows each shot's in-point frame, captioned with
   its clip, its time and its `beat`. After a content change, check that every frame still shows
   its beat. To re-pick a frame, look at that clip's contact sheet.
6. **Check.** Every output is checked against the preset. Each asset gets a line: `ok`, `FAIL`
   with the reason, `MISSING` (required) or `skipped`. Then the preset's rules to check by eye.
   The command exits 1 on any FAIL or MISSING.

### `store` settings

| Key | Default | What |
|---|---|---|
| `preset` | `crazygames` | A preset in `presets/` by name, or a path to one. |
| `out` | `dist-store` | The output folder. Keep it out of git. |
| `shots` | none | The kit's shots file. Unset: no capture step. |
| `sheetEvery` | `0.5` | Seconds between the kit's contact-sheet tiles. |
| `stills` | `[]` | The stills (below). |
| `videos` | `[]` | `{ edl, spec? }`: an edit list each, and the preset asset id it is checked as (default: the edit list's stem; `false` for none). |
| `preflight` | none | Node function `async ({ root, store }) => string[]`. Each string returned is a problem that stops the kit. |

### Stills

A still is rendered from an HTML or SVG template in the game:

```js
stills: [
  {
    name: 'cover-landscape',          // the file stem, and the preset asset id unless `spec`
    template: 'tools/store/cover.html',
    w: 1920, h: 1080,                  // CSS px of the page; the output size
    scale: 2,                          // rendered at 2x, then downscaled with lanczos
    sizes: [[1080, 1620]],             // more sizes from the same render
    keepRender: true,                  // also keep the 2x render (key art for press)
    plates: { main: 'cover-shot', alt: 'cover-shot-night' },  // capture shots: their last frame
    inline: { TITLE_FONT: 'node_modules/@fontsource/some-font/files/latin-400.woff2' },
    data: { title: { x: 0.05, y: 0.15, size: 0.1 } },
  },
  { name: 'logo', spec: false, template: 'tools/store/cover.html', w: 1800, h: 1000,
    clip: '.logo', pad: 60, data: { logoOnly: true } },          // cropped to an element
  { name: 'icon', spec: false, template: 'tools/store/icon.svg', w: 512, h: 512, scale: 1,
    sizes: [[256, 256], [192, 192], [180, 180], [64, 64], [32, 32], [16, 16]] },
]
```

Before the template's scripts run, `window.STORE` holds:
- the still's `data`;
- its `name`, `w` and `h`;
- `plates`: each named capture shot's last frame, as a data URL.

`__TOKEN__` in the template becomes the data URL of the file `inline.TOKEN` names. A template
that draws late sets `window.READY = false` at the top of its script, and `true` when it is
done. Otherwise the render waits for fonts and images. Transparency is kept where nothing is
drawn. Each still writes `<name>-<w>x<h>.png`, plus one file for each of `sizes`. A still with
`clip` writes `<name>.png`.

The template is the game's art. The tool supplies the mechanism around it: plates, tokens,
the 2x render, the sizes and the checks.

### Presets

A preset is a portal's asset rules as data. `presets/crazygames.json` is one. A second portal
is a second file of the same shape. A game can also point `store.preset` at its own file.

```jsonc
{
  "name": "A Portal",
  "sources": ["https://portal.example/docs/assets"],   // where the rules come from
  "checked": "2026-10-20",                             // when someone last read them
  "assets": {
    "cover-landscape": { "kind": "image", "size": [1920, 1080], "formats": ["png", "jpg"], "required": true },
    "preview-landscape": { "kind": "video", "size": [1920, 1080], "seconds": [15, 20],
                           "audio": false, "maxMB": 50, "codecs": ["h264"], "fps": 60 }
  },
  "rules": ["What a person must check by eye: no border, no text but the title."]
}
```

An asset can set:
- `size` (exact) or `minSize`;
- `formats`: `png`, `jpg` or `webp`;
- `seconds` as `[min, max]`;
- `audio`: `false` means no audio track at all;
- `maxMB`;
- `codecs`, as ffprobe names them;
- `fps`;
- `required`.

## `umm-dev loop <video.mp4 | edl.json>`

```sh
umm-dev loop dist-store/preview-landscape.mp4             # dist-site/preview-landscape.mp4 + .poster.webp
umm-dev loop trailer.json --name home --poster-at 2.5     # cut an edit list first
```

`loop` makes the clip a games site shows on a card:
- a silent H.264 (high, yuv420p) mp4 at CRF 30, with `+faststart`, so it plays before it has
  fully loaded;
- its long edge capped at 720 px, never upscaled;
- a poster beside it, `<stem>.poster.webp`, so the card shows a still before the video plays.

To pick the poster frame, `loop` samples frames across the clip and keeps the one with the most
detail, with brightness breaking ties. A clip that fades up from black, or flashes white, does
not end up with a flat poster. `--poster-at` picks the time instead.

| Key | Default | What |
|---|---|---|
| `out` | `dist-site` | Output folder. |
| `edge` | `720` | Long-edge cap in px. |
| `crf` | `30` | x264 CRF. |
| `posterFormat` | `webp` | `webp` or `jpg`. |
| `posterQuality` | `80` | 0 to 100. |
| `samples` | `[0.15, 0.4, 0.65]` | Fractions of the clip tried for the poster. |
| `posterAt` | none | Seconds into the clip for the poster. |

## Adopting it in a game

1. Add `@ummgames/dev` as a pinned devDependency, and `vite` and `playwright` if the game
   lacks them.
2. Write the `capture` section: the debug global, the URL flags, `ready`, the size and dpr, and
   the browser flags a WebGPU game needs. Point `shots` at the game's shots file. Most games'
   shots files work unchanged. Game-specific fields move into `prep`, `run` or `shotUrl`.
3. Point the scripts at the commands, for example `"capture": "umm-dev capture"` and
   `"store:remake": "umm-dev store"`.
4. Delete the game's own copies of the capture runner, the trailer cutter and the store runner.
   Keep the recipe: the shots, the edit lists, the templates and the config.
