# Changelog

## Unreleased

- **New: a script rule for `headers()`, off by default.** `scripts: true` adds
  `script-src 'self' 'wasm-unsafe-eval' https://static.cloudflareinsights.com; object-src 'none';
  base-uri 'self'` to the `/*` Content-Security-Policy, after `frame-ancestors`, so an HTML
  injection cannot run script. `scripts: { hosts, wasm, webAnalytics, reportOnly }` adds script
  origins, drops wasm or the Web Analytics beacon, or sends the rule as Report-Only.
  `runtime/worker/security-headers.ts` takes the same option, and `scriptPolicy()` gives the
  directives. See [docs/build.md](docs/build.md#headersoptions-_headers).
- **To take it:** nothing changes until a site passes `scripts`. To turn it on, build, serve
  `dist/` with its `_headers` and play with the console open. A site Worker with a copy of
  `security-headers.ts` copies it again and passes the same `scripts`.

- **New: a perf probe kit.** See [docs/perf.md](docs/perf.md).
  - `perfConfig` in `@ummgames/dev/playwright` is the probe's own config: the production build
    on `vite preview`, only `perf.spec.ts` (`PERF_SPEC`), never a reused server.
  - `@ummgames/dev/testing` gains `measureFrames` (throttle the CPU, load, settle, read the
    handle, optionally keep a CPU profile), `coldLoad` (first frame on a throttled network),
    `cpuProfile`, `throttleCpu`, `throttleNetwork`, `waitForFrames`, `readPerfHandle`,
    `formatFrames`, and the presets `PERF_DEVICES` (desktop, phone at CPU 4x) and `NETWORKS`
    (fast and slow 4G).
  - `runtime/dev/perf-handle.ts` puts the `window.__pf` handle the helpers read: `frames`,
    `stats()` from the perf recorder, and the game's own readings.
- **New: `umm-dev perf top <profile> [n]`.** Sums a `.cpuprofile`'s self time by function and
  prints the top ones, or every row with `--json`. A sample's time is the gap to the next
  sample, as DevTools counts it.
- **New: `runtime/render/bake.ts`.** Merges a three.js part's per-material meshes into one
  vertex-coloured draw per plain finish, keeping glows, see-through, textured and named
  materials (`keepApart`) as their own draws, with a hook for the game's shader
  (`onMaterial`). `bakeInPlace` leaves sockets, hidden and skinned meshes where they are. It
  imports `three`.
- **Changed: a runtime file may import a package the game already has.** Rule 4 now allows the
  packages in `RUNTIME_PACKAGES` (`three`), which the kit keeps as exact devDependencies so the
  runtime typecheck covers them. `umm-dev copy` says when the game's package.json does not list
  one: `imports three, which the game's package.json does not list: add it`.
- **To take them:** nothing changes until a game uses them. A game with its own probe moves its
  config onto `perfConfig`, its steps onto the helpers, and its profile script onto
  `umm-dev perf top`. A game with its own baker of this shape copies `render/bake.ts` with
  `--force` over it and passes its rules as options.

## 0.17.0 (2026-11-19)

- **New: `portal.endpoints` for `umm-dev portal check`.** Origins the build may send to, such as
  a play stats Worker. The check answers each request to one with a 204 itself, so nothing reaches
  the network, and lists it in the run's `posted` in `report.json`. Before this, a portal build
  with telemetry failed every run on "asked other hosts". Any other host still fails.
- **To take it:** nothing. A game whose portal build sends play stats adds the Worker's origin.

## 0.16.1 (2026-11-19)

- **Fix: `runtime/stats` types a union of events.** `Pushed<E>` and a spec's `event` return were a
  plain `Omit` of the union, which keeps only the fields every event shares, so pushing an event
  with its own fields failed to typecheck. Both are now `Unstamped<E>`, which omits per member.
- **Fix: copying `runtime/stats` no longer warns** that `worker.ts` imports files that are not
  beside it. The warning came from an example in a comment.
- **To take it:** `umm-dev copy stats` again over an untouched copy.

## 0.16.0 (2026-11-19)

- **New: play stats.** `runtime/stats/` is a game's play telemetry, copied with
  `umm-dev copy stats`: `batch.ts` checks a batch through the game's own spec (its version, its
  batch fields, its events) and keeps nothing else; `client.ts` queues events in the page and
  sends them by beacon after the first input, every 30 s and as the page hides; `worker.ts` is
  the Cloudflare Worker that matches the origin to a site and keeps each batch in R2 with no IP.
  `@ummgames/dev/stats` is the report's shared half: day ranges, rclone pulls, sessions, a
  median and a text table. See [docs/stats.md](docs/stats.md).
- **To take it:** nothing. A game with its own stats pipeline of this shape can copy the folder
  and write its events as a `StatsSpec`.

## 0.15.0 (2026-11-15)

- **New: `runtime/audio/mix.ts`, a mixer a game copies.** `createMix(ctx, options)` builds named
  buses at levels in dB into a glue compressor, a limiter, an optional soft clip and a master
  trim, on a live `AudioContext` or an `OfflineAudioContext`. Chosen buses dip under talk
  (`mix.talk(at, talking)`), chosen buses skip the glue, a shared room can be added, and
  `mix.solo` renders one stem. Imports only `pitch.ts`. See
  [docs/runtime.md](docs/runtime.md#mixts).
- **New in docs/audio.md: rendering a game's sound offline,** a window at a time with
  `OfflineAudioContext.suspend(t)`, not every note up front.
- **To take it:** nothing. A game with its own mixer of this shape can run
  `umm-dev copy audio/mix.ts audio/pitch.ts` and pass its level table as `buses`.
- **New: `@ummgames/dev/voice`, the shared half of a game's voice tools.** `call` makes one
  ElevenLabs request with the key read in one place (the environment, `.env.local`, then the
  Windows user variables, never printed) and waits out a 429. `transcribe` returns Scribe's
  words with times, `wordsOf` compares a take's text with what was heard, and `inPool` runs takes
  a few at a time. `cut` cuts a spoken take to a mono piece and reports its length; `soundEnds`
  and `shipSung` ship a sung take with its seconds to where its sound ends, optionally trimmed
  there. See [docs/voice.md](docs/voice.md).
- **To take it:** nothing. A game with its own copies of these helpers can import them instead;
  its paths now resolve against the working directory.
- **New: `runtime/audio/voice.ts`, a voice player a game copies.** `VoiceBins` fetches each
  speaker's bin once; `VoicePlayer` decodes a piece when a line says it, keeps the last 40, gives
  the floor to the newest line (one still decoding loses its turn), fades the line before, drops a
  line more than 0.5 s late, and splices several pieces as one line. `overlap` lines talk over
  the floor; `board` and `schedule` let a game keep its own boards and layouts. Every outcome
  goes to `log`. See [docs/voice.md](docs/voice.md#the-player-runtimeaudiovoicets).
- **New in `@ummgames/dev/voice`: the take loop and bins.** `wordList` and `misses` count the
  words a take got wrong, `takeKey` keys a take by what made it, `bestTake` tries seeds until
  a take is clean and keeps the closest, and `packBins` and `writeBins` ship pieces in the
  player's format.
- **The player, after three games moved onto it.** `VoiceBins` takes an `onError(bin, reason)`.
  `say` takes `data`, handed to a game's own `schedule`, and `onStart({ when, ends })`. `hush`
  now stops an overlap line still decoding. A line holds the floor until its `ends`, so a burst
  after the words is faded with it. `VoiceContext` includes `createBuffer`, for a `board`.
- **`packBins(pieces, { bin: false })`** leaves the bin off each cue. **`encodeWav(chans, { bits:
  16 })`** writes 16-bit; 24 stays the default.
- **`transcribe` takes the audio's bytes** as well as a path, and `fields` for more form fields
  (`{ tag_audio_events: 'false' }`) and `type` and `name` for its media type and file name.
- **To take them:** a game with a voice player copied from another game runs
  `umm-dev copy audio/voice.ts` and follows "Adopting the player in a game" in docs/voice.md.

## 0.14.1 (2026-11-14)

- **Fix: the kit's own docs page is no longer read as a questions file.** The page was
  `docs/questions.md`, a name `umm-dev questions` reads, so run over a folder holding the kit it
  listed five of the page's format notes as open questions. The page is now
  [docs/answering.md](docs/answering.md), and a test checks that the kit holds no file the
  scan reads.
- **To take it:** nothing. An `ANSWERS.md` written by 0.14.0 names the old page in its header;
  read docs/answering.md instead.

## 0.14.0 (2026-11-14)

- **New: `umm-dev questions`, a page for answering agents' questions.** It reads every
  questions file (`docs/QUESTIONS.md`, `questions-for-<name>.md` and the like) in a repo, or in
  every repo under a folder with `--root ..`, and shows one card at a time: the question, its
  context and its recommendation. `Y` goes with the recommendation, `N` says no, `/` then
  `Enter` answers in your own words, `D` drops a stale question, `S` puts one off, `U` undoes.
  A list view answers rows with one click. Each answer is written at once to `ANSWERS.md`
  beside the questions file, for the repo's next session to fold into its decision log.
  `umm-dev questions list` prints the same as text or JSON. The parser reads the shapes these
  files already have, so none needs rewriting. See [docs/answering.md](docs/answering.md).
- **The agents' paste block** in [docs/agents.md](docs/agents.md) has a line on questions and
  answers.
- **To take it:** nothing to change. To have agents read answers back, paste the new line from
  docs/agents.md into the game's CLAUDE.md.

## 0.13.1 (2026-11-14)

- **Fix: a note's touch line keeps its row on a touch screen.** 0.13.0 showed a
  `dev-splash__touch` line with `display: revert`, which dropped `dev-splash__controls`' flex row,
  so its items stacked. Each device's lines are now hidden on the other device instead.
- **A short screen** (440 px tall or less, such as a phone on its side) sets the note closer and
  smaller, so it keeps clear of the loading word.
- **To take it:** copy `runtime/boot/dev-splash.css` again (`umm-dev copy`).

## 0.13.0 (2026-11-14)

- **New: the splash can say what the game is, and that it is loading.** `devSplash` takes
  `note`, the game's own HTML under the lockup (what it is about, its controls), and `loading`,
  a word over the bar with dots that count up, so the bar no longer reads as another underline
  under the typed word. Both are off by default, so a game that passes neither looks the same.
  `dev-splash.css` styles a note's `<p>` lines, `<kbd>` keycaps and a
  `<ul class="dev-splash__controls">` row, and shows a line marked `dev-splash__keys` only with a
  mouse and keys and one marked `dev-splash__touch` only on a touch screen. `#dev-splash` is now a
  column, which changes nothing with the lockup alone. See [docs/build.md](docs/build.md).
- **To take it:** copy `runtime/boot/dev-splash.css` again (`umm-dev copy`), then pass `note` or
  `loading`. Without the new copy, the note shows unstyled.

## 0.12.1 (2026-11-13)

- **Fix: a slow CrazyGames SDK init no longer silences the portal.** `createPortalSdk` gave up on
  `init()` after `initWaitMs` (5 s) and returned the stub for good, so the portal heard no
  `loadingStart`, `loadingStop` or `gameplayStart`. In CrazyGames' own QA preview on 2026-11-13,
  init took 7 to 9 s (with an ad blocker on), and the QA checklist read "First gameplay start: No"
  for Bitto's First Job. Now boot still plays on at `initWaitMs`, but with a stand-in that joins
  the SDK when `init()` ends and replays `loadingStart`, `loadingStop`, `gameplayStart`, the
  feedback context and the listeners. A fast init and a failed init behave as before.
  `latePortal(ready, warn)` is exported for a game that builds its own. The fake portal answers
  `init()` at once, which is why `portalCheck` never saw this.
- **To take it:** copy `runtime/portal/portal-sdk.ts` again (`umm-dev copy`), rebuild the portal
  build, and check it in CrazyGames' QA preview: its Log tab should list `gameplayStart`.

## 0.12.0 (2026-11-12)

Three things each game's CrazyGames build had grown a copy of are in the kit now. Nothing in a
game must change; each is opt-in. See [docs/portal.md](docs/portal.md).

- **New: `umm-dev portal check`** (`runPortalCheck` in `@ummgames/dev/testing`). It builds the
  portal folder if `portal.build` is set, holds it to `checkPortalBuild`, scans its code for the
  game's `portal.forbidden` words, then opens it in the fake portal in Chrome once per run: by
  default CrazyGames' smallest desktop frame, 907 x 510, with the SDK and with the SDK blocked.
  Each run waits for `portal.ready`, shoots the title, runs the game's `portal.play` steps, and
  fails on a console error, another host, a missing file, a socket, a load over 20 s, or SDK
  calls out of order (`init` first, `loadingStart` then `loadingStop`, no `gameplayStart` before
  it or twice in a row, a `gameplayStart` once play ran). `noAds` fails any ad request, for a
  Basic Launch. A run with `touch: true` is an emulated phone. `--cpu` draws in software with no
  GPU lease. Stills and `report.json` go to `test-results/portal-check/`. A new `portal` section
  in `umm-dev.config.mjs` holds the settings.
- **New: `portalNoSelect()`** in `@ummgames/dev/vite`. It adds
  `body{-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none}` to
  the portal build's `<head>`, as CrazyGames' technical rules ask. `NO_SELECT_CSS` and
  `noSelectCss(selector)` are exported too.
- **New: `licences({ text: 'notices.txt', textHeader })`** writes every shipped package's notice
  into one plain-text file at the top of the build, under the game's own copyright lines. It is
  read from `node_modules` like the rest, so three.js's MIT notice, which the minifier drops from
  the bundle, ships whenever `three` is a dependency. Use it in the site build as well as the
  portal build. `licencesText(list, { header, intro })` is the same text as a function.
- **To switch a game over:** replace its own portal runner with a `portal` section and
  `umm-dev portal check`, its hand-written `user-select` style with `portalNoSelect()`, and its
  hand-written `notices.txt` with `licences({ text: 'notices.txt', textHeader })`. Pass
  `include: ['@ummgames/dev']` to list the kit's own licence for its copied runtime code.

## 0.11.3 (2026-11-12)

- **The copyright holder is UMM LLC.** `LICENSE` and `package.json`'s `author` named "Uncle Matt
  Makes"; Matt formed UMM LLC on 2026-11-12 and asked for the games' copyright to name it, and the
  kit's runtime code ships inside every game. The licence stays MIT. "Uncle Matt Makes" stays the
  brand: the splash, the descriptions and the docs keep it.

## 0.11.2 (2026-11-12)

- **`presets/crazygames.json`: both preview videos are required.** CrazyGames' covers page, read
  2026-11-12, marks the landscape (1080p, 16:9) and portrait (1080p, 2:3) videos mandatory at
  submission. `umm-dev store` now fails a kit without them.
- **docs/portal.md:** with `publicDir` off, Vite does not rebase a root-absolute link to a public
  file in `index.html`, so `portalCheck` fails it; write it relative. And keep a game's adapter
  glue as plain functions, since an object the code writes to keeps the adapter in the site
  bundle. Both found by a game adopting 0.11.1.

## 0.11.1 (2026-11-12)

- **`runtime/portal/portal-sdk.ts`: the two top-level `Object.freeze` calls are marked
  `/* @__PURE__ */`.** A game that imports the adapter and calls it only under `if (PORTAL)` kept a
  bare `Object.freeze({...})` statement in its site bundle, because the bundler treats the call as a
  side effect. That shifted minified names, so the site build was no longer byte for byte the same.
  With the marks, the site bundle drops both. Re-copy with `umm-dev copy portal`.

## 0.11.0 (2026-11-12)

The web portal tools are back, checked against CrazyGames' rules as they read on 2026-11-12, and
the shared sim, input, audio and Worker runtime files (under "Also in 0.11.0"). Nothing in a game
must change. See [docs/portal.md](docs/portal.md).

**Why they came back.** 0.2.0 removed them, and each game that ships to a portal then kept its
own copy. One copy here is easier to keep right. The plugins and the fake portal are 0.1.2's, the
adapter is 0.1.2's with its late-ad mute fix, and what the games' copies grew since (a size line
on every build, a public folder listed by rule) is folded in.

- **`@ummgames/dev/vite`:** `portalSdk`, `portalPrune`, `portalSiteOnly` and `portalAssets` as in
  0.1.x, and `PORTAL_MODE`, `CRAZYGAMES_SDK_URL`, `CRAZYGAMES_LIMITS`, `orphanChunks`,
  `stripSiteOnly`, `overLimits`.
- **New: `portalCheck()`.** It reads the folder Vite wrote, `publicDir` copies included, and fails
  the build on more than 1,500 files or 50 MB, no `index.html` at the top, a root-absolute `src`
  or `href` in `index.html`, a source map, a dotfile, a `_headers`, or a `data-site-only` element
  left in. It prints the size on every build, and whether it fits the 20 MB mobile homepage.
  `checkPortalBuild(dir)` is the same check as a function.
- **New: `publicFiles(dir, { exclude })`**, every file in `public/` but dotfiles, site files and
  the excluded prefixes, for `portalAssets({ paths })`. `SITE_FILES` and
  `CRAZYGAMES_MOBILE_BYTES` are exported too.
- **Changed from 0.1.x:** `portalAssets` no longer checks limits; `limits` there throws when the
  config loads, pointing at `portalCheck`. The limits are decimal: 50 MB is 50,000,000 bytes, not
  52,428,800, the stricter reading of CrazyGames' "50MB". `CRAZYGAMES_ORIGINS` is not back: the
  portal hosts the files, so the portal build carries no `_headers`.
- **`runtime/portal/`** (`umm-dev copy portal`): `build-target.ts` (`PORTAL`) and
  `portal-sdk.ts`. The adapter keeps 0.1.2's calls and adds `rewardedAd()` (true only when the ad
  played to the end), `hasAdblock()`, `progress(percent)`, `setContext()`, `settings()` and
  `onSettings()`, `device`, `locale`, and `storage`, which saves through the SDK's data module and
  falls back to `localStorage`. The portal's `muteAudio` setting now mutes the game through the
  same `setMuted` an ad uses, from boot. With the SDK missing, blocked, slow or disabled, every
  call is a no-op and the game plays on: a Basic Launch needs no SDK.
- **`@ummgames/dev/testing`:** `fakePortal`, `fakeSdkScript`, `PORTAL_HOST` and
  `CRAZYGAMES_SDK_URL`. The fake SDK gains rewarded ads, settings, the data module, system info
  and `hasAdblock`; the portal gains `data()` and `setSettings()`. `applyHeaders` is gone with
  the portal's `_headers`.
- docs/portal.md is back, rewritten for the above.

**What a game must change:** nothing. A game that kept a copy of 0.1.x's portal code can drop it
for these: the 0.1.x calls are unchanged, but move `portalAssets({ limits })` to `portalCheck()`.
A game that takes the new `sim/rng.ts` calls `unitOnSphere(rng, out)` where it called
`rng.unit(out)` (below).

### Also in 0.11.0

- **`runtime/sim/sphere.ts`: `unitOnSphere(rng, out)`, out of `rng.ts`.** `Rng.unit` called
  `Math.cos` and `Math.sin`, so a sim whose guard test bans engine trig could not copy `rng.ts`. The
  direction is now a free function in its own file, with the same two draws in the same order; a game
  that called `rng.unit(out)` calls `unitOnSphere(rng, out)`. A test keeps engine trig out of `rng.ts`
  and `det.ts`.

- **New runtime files a game copies: `sim/rng.ts`, `sim/det.ts`, `sim/fixed-step.ts`,
  `input/stick.ts`, `audio/synth.ts` and `worker/security-headers.ts`.** Each was a file several
  games held their own copies of. The kit's file gives the same outputs as those copies: the same
  draws for a seed, the same floats to the bit, the same headers in the same order. Golden tests
  taken from the copies hold it there (`tests/runtime/sim-goldens.mjs`). Where copies differed, the
  difference is an option, not a fix: `new Rng(seed, { zeroSeed: GOLDEN_SEED, emptyPick:
  'undefined' })` keeps a copy that swapped a seed of 0 and returned `undefined` from an empty
  `pick`. `securityHeaders()` takes `headers()`'s `framedBy` and `rules` and returns exactly its
  `/*` set, for what a site Worker's script answers, which `_headers` never reaches; a kit test
  fails if the two differ. `audio/synth.ts` imports `audio/pitch.ts`. Nothing changes for a game
  until it takes a copy. docs/runtime.md, "`runtime/sim/`" and the other new sections, including
  how a game moves onto each.

- **`umm-dev copy --from <source>`: copy from the game's own sources.** Code that several games
  share but that cannot be public now copies like a runtime file. A game names each source in
  `runtime.sources` (`{ <name>: { repo, ref } }`), a git checkout on the same machine. Copy reads
  committed work at `ref` through git, and stamps the source's name, the commit that last changed
  the file, its path and its hash. `umm-dev drift` reads `runtime.sources` too, compares each such
  copy with the source at `ref`, diffs against the file at the header's commit, and calls a copy
  whose source is not on this machine `source not found`. A relative `repo` is read from the
  game's main checkout, so it works from every worktree. Nothing changes for a game without
  sources. `--ref` reads one copy at another commit-ish, such as a branch not merged yet.
  docs/runtime.md, "Copying from the game's own sources".

- **`headers()` sends `nosniff` and a referrer policy.** The set left both to Cloudflare Pages,
  which sends them itself, but every game site is on Workers static assets, which sends neither, so
  four sites and tv.ummgames.com went without them. A site with its own `_headers` that already has
  them (Blazewing's) is unchanged. Rebuild and deploy a site to pick it up.

- **`headers({ framedBy })`.** Exact `https://` origins that may frame the site build beside its own,
  for a station that airs a game. They join `frame-ancestors 'self'`, and `X-Frame-Options` is left
  out. Anything but an exact `https://` origin throws when the config loads. Without it, nothing
  changes.

- docs/audio.md: **the 0.10.0 note on recording sound calls was wrong.** It said the `state` hook
  records a game's sound calls frame by frame. The hook runs only on recorded frames, so calls from
  before the clip opens would all land on frame 0, and the route was never tested. The page now says
  the kit doesn't record them yet, that the mix bus is the last stage only, and what `cut` needs from
  an edit planned in beats.

## 0.10.2 (2026-11-04)

Fixes found by the release gate failing on a shared machine. Nothing in a game must change, but a
shot's first frames can move: see the first entry.

- `capture`: **a slow page load moved the game along.** The clock counted boot frames from the
  moment the page opened, so a game whose script arrived 532 real frames late (seen on a busy
  machine) was 532 frames younger at tick 0, and every frame of the shot differed from the last
  capture's, though `states.jsonl` agreed. Boot time now starts when the game first asks for a frame,
  or when the page finishes loading if it never does. `bootFrames` counts from there.
  `tests/media/media.slow.test.mjs` holds the game's script back to prove it, and its compare tests
  no longer need an earlier test: run alone, they printed `pixels: 0/0`.
- `gpu run`: **the watchdog starved on a busy machine.** It inherited `gpu.priority`, so the query
  that finds a dead run's command tree ran below normal and took more than 12 s. The command ran on,
  and the next waiter reclaimed the lease on top of it. It now raises itself to normal first.
- `gpu run`: **a waiter could crash the holder on Windows.** Replacing the holder file while a waiter
  was reading it threw `EPERM`, and the run died holding the lease until a reclaim. It now waits
  the read out. A waiter taking the lock while the last one was being deleted died the same way.

## 0.10.1 (2026-11-04)

The toy host and the shot check, fixed for a phone. A game with a copy of `toy-host.ts` should take
the new one (`umm-dev drift` prints the line).

- `runtime/making-of/toy-host.ts`: **a toy could stay on its poster on screen.** `near` fires only on
  crossing its margin, so a toy evicted inside the margin had nothing to bring it back, and a reader
  who scrolled back a little found an empty frame. A toy now mounts on reaching the screen too.
- `createLiveSet`: `seen` gave a place to anything it saw, so 2D toys filled the 3D cap and were then
  disposed as if they held a context. Only what was admitted holds a place now. A toy admitted while
  off screen no longer counts as on screen, which had kept it from ever being evicted.
- A toy evicted while its `mount` was running used to land on its poster, uncounted by the cap. It is
  now dropped when `mount` returns.
- `umm-dev making-of shot`: centres each stage and reads it before shooting the toy. A toy taller
  than the screen left its stage off the top, the capture's own scroll woke the toy above, and the
  page moved mid-capture: "drew nothing" for a toy that had drawn. It also waits for a stage the page
  builds after `load`.
- A clean shot does not prove the host. It passes each toy once, and the stuck poster needs a reader
  who comes back, so `tests/making-of/shot.slow.test.mjs` walks a page down and back instead.
## 0.10.0 (2026-11-04)

A mix bus. Nothing in a game must change.

**The kit could meter a soundtrack and put one in a cut, but not make one.** A tool that renders
its own stems now has the rest in `@ummgames/dev/audio`. See
[docs/audio.md](docs/audio.md#the-mix-bus).

- `master`, `limit`, `duck`, `phone`, `peakAt`, `gain`, `dbToGain`, `biquad`, `pass`, `shelf` and
  `encodeWav`, on plain channel arrays at any sample rate. The limiter's detector is the meter's
  true-peak interpolator.
- `Loudness` gains `range`, the loudness range in LU, so `umm-dev loudness --json` rows carry it too.
- docs/audio.md says how a soundtrack goes into `umm-dev cut`, and how the `state` hook records a
  game's sound calls frame by frame during a capture.

## 0.9.0 (2026-11-04)

A shared making-of core. Nothing in a game must change.

**Games that built a making-of each kept a fork of the same plumbing.** It now lives here, so a fix
reaches them all. See [docs/making-of.md](docs/making-of.md).

- `@ummgames/dev/making-of`: `createMakingOf(options)`, the site's Vite plugin, with the site's
  name, nav, footer, chapter list and the game's own page passes as options; and the source pass
  behind `data-const` and `data-snippet`, which reads numbers statically and cuts code by name,
  including JSON paths and `Class.member`.
- `umm-dev making-of shot`: loads every page in Chrome, shoots each toy, and exits 1 on a toy that
  drew nothing, a console error, or an element past the screen's edge.
- `createImportGraph` in `@ummgames/dev/testing`: the static import walker a site's guards use.
- `runtime/making-of/`: the toy host, controls, a 2D canvas, the page starters and a base
  stylesheet with tokens a game overrides.
- `typescript` joins the optional peers. Only `@ummgames/dev/making-of` needs it.
- **What a game may change:** nothing is required. A game with its own making-of can follow the
  quick start in [docs/making-of.md](docs/making-of.md) and delete its forks. Two things differ from
  the forks: a snippet's path links to a repo only when the game passes `source.repoBlob`, and
  `createToyClock` takes the game's step as an argument.

## 0.8.0 (2026-11-01)

A shared rumble scheduler. Nothing in a game must change.

- `runtime/input/haptics.ts`: rumble with a priority scheduler, so a light tick never cuts off a
  heavy hit. The game passes its own table of effects; the scheduler is pure (it takes the time),
  and `padSink`, `phoneSink` and `bothSinks` are the only code that touches a device. A hum under
  the effects, a strength slider, an on/off switch and a hold for pauses. Grown from a game's own
  copy; see [docs/runtime.md](docs/runtime.md#hapticsts).
- **What a game may change:** nothing is required. A game with its own rumble code can take
  `umm-dev copy input/haptics.ts` and keep its effects table beside it.
- `devSplash` and `injectSplash` skip a `<body>`, `</head>` or `id="dev-splash"` named inside a
  comment, `<script>` or `<style>`. Before, a comment naming `<body>` in the head put the whole
  splash inside the head's `<style>` (found moving platformer onto the plugin).
- Games track `main` instead of pinning a tag. Install lines name no tag
  (`github:unclemattmakes/ummgames-dev`); the lockfile still records the commit, and
  `pnpm update @ummgames/dev` moves a game to the newest. Tags are still cut for the changelog
  and for `umm-dev drift`, which fetches originals by tag.
- LICENSE says the MIT licence does not cover the Uncle Matt Makes portrait
  (`src/vite/brand/uncle-matt-circle.webp`): it is the brand mark, all rights reserved.

## 0.7.0 (2026-11-01)

The loading splash's page side moves into the kit. Nothing in a game must change.

**A game names itself once and the kit writes the splash.** Each game that showed the splash
kept its own copy of the markup (one sizer per word, kept in step with its word list by hand),
its own copy of the portrait, and its own steady watch. These now come from the kit.

- New Vite plugin `devSplash(options?)` in `@ummgames/dev/vite`. It writes the `#dev-splash`
  block first in `<body>` of `index.html`, with a sizer per word built from `game`, and links
  the game's copy of `dev-splash.css` before Vite reads the page, in dev and build. It serves
  the brand portrait in dev, emits it in the build at `brand/uncle-matt-circle.webp`, and names
  it on the `<img>` as `data-src`. Options: `game`, `words`, `portrait` (`true`, a path, or
  `false`), `portraitPath`, `css`, `url` and `page`. A page with its own `#dev-splash` keeps
  it, and a portrait at the same path in `public/` wins. Its helpers `splashWords`,
  `splashMarkup` and `injectSplash` and the constants `SPLASH_WORDS`, `SPLASH_PORTRAIT`,
  `SPLASH_PORTRAIT_FILE` and `SPLASH_CSS` are exported too. See
  [docs/build.md](docs/build.md#devsplashoptions-the-loading-splashs-page).
- `runtime/boot/dev-splash.ts`: `splashWords(game, words?)`, `splashWordsIn(root)`, and
  `createSteadyWatch(options?)` with `STEADY_WATCH` (`frameMs` 34, `frames` 20, `giveUpMs`
  3000). `startDevSplash` with no `words` types the sizers' words, and with no `portraitUrl`
  loads the `<img>`'s `data-src`. Passing either works as before, and markup with no
  `data-src` still means no portrait.
- **What a game may change:** nothing is required. A game with the hand-written splash takes
  the new `dev-splash.ts` (`umm-dev drift` prints the line), adds `devSplash({ game })`, and
  deletes its markup, stylesheet link, portrait, word list and steady watch:
  [docs/runtime.md, adopting the splash](docs/runtime.md#adopting-the-splash).

## 0.6.1 (2026-10-31)

A fix to `cut`. Nothing in a game must change.

**An overlay or card that ends with the cut stays on to the last frame.** Before, every overlay
and card faded out over its last `fade` seconds, so an end logo either faded away as the cut ended
or had to come on with no fade at all
([#1](https://github.com/unclemattmakes/ummgames-dev/issues/1)). Now one whose `to` is the
cut's length fades in only; the cut's own `fadeOut` still fades everything. One that ends earlier
fades in and out as before.

- **What a game may change:** nothing is required. An edit list that set `fade: 0` on an end
  logo to keep it on screen can now give it a fade-in. One that relied on an end overlay fading
  out before the last frame should end it a little earlier, or use the cut's `fadeOut`.

## 0.6.0 (2026-10-30)

A shared procedural music core and a shared leaderboard-server core. Nothing in a game must
change.

**A shared core for procedural music.** Five games each wrote their own step sequencer with the
same pure parts: scale degrees, where a step falls in its bar and form, when a song or a layer
may change, and the look-ahead clock. `runtime/audio/` now holds all four, with no Web Audio and
no clock, so a game copies them and keeps only its voices, patches and tracks.

- New runtime file `runtime/audio/form.ts`: `position` (bar, beat, phrase, pass, first and last
  bar of a step), `sectionAt` and `FORM` (`A B A2 D`), `lineAt` (a melody written a bar at a
  time), `holdSteps` (how long a note holds), `hitAt` (drum strings, with `DRUM_WEIGHTS` or the
  game's own), `swingOffset`, `stepsToGrid`, `snapToGrid` and `resumeBar`.
- New runtime file `runtime/audio/conductor.ts`: `Conductor`, which holds the song and the level
  and lands each change only on its line (a song on a bar or phrase line, a rise and a fall on
  the boundary the options give, or one a change names), and `levelFor` (intensity to level,
  with hysteresis). After a stall it waits for the next line queued, so nothing changes mid-bar.
- `runtime/audio/pitch.ts`: `chordTones(scale, root, size?)`, and the scales `LYDIAN`,
  `MIXOLYDIAN` and `PHRYGIAN_DOMINANT`.
- `runtime/audio/step-clock.ts`: `advanceSteps` takes a step length per step (`StepLength`, a
  number or a function of the step), so a tempo can change on a bar line. A number works as
  before.
- See [docs/runtime.md](docs/runtime.md#runtimeaudio).
- **What a game may change:** nothing is required. A game with copies of `pitch.ts` or
  `step-clock.ts` sees them as `changed upstream` in `umm-dev drift`, and takes them with the line
  drift prints. A game with its own sequencer copies `form.ts` and `conductor.ts`
  (`umm-dev copy audio`) and moves to them a piece at a time.

**A shared leaderboard-server core to copy, and a D1 binding for tests.** Games that run their
own board on a Cloudflare Worker over D1 can take the parts every board does the same way,
instead of keeping drifting copies of each other's.

- New runtime folder `runtime/board/`: capped body reads and JSON refusals (`http.ts`), SHA-256
  owner-key and salted-sender hashes with IPv6 folded to its /64 (`digest.ts`), random ids
  (`ids.ts`), the generated-handle word lists (`handles.ts`), fixed-window rate limits in a
  `rate` table (`rate.ts`), the `rate`, `blocks` and `admin_log` schema with `schemaProblems`
  (`schema.ts`), blocks and the admin log (`moderation.ts`), the bearer-token admin door with
  block and log routes (`admin.ts`), and the front of a submit with a per-day stored cap
  (`submit.ts`). The game keeps its runs table, validator, board keys and public routes, and
  meets the core through `defineBoard(config)` (`board.ts`): its block kinds, its own sweep and
  its refusal shape. Copy it with `umm-dev copy board`. See [docs/board.md](docs/board.md).
- New in `@ummgames/dev/testing`: `createD1(options?)`, a D1 binding over `node:sqlite` with a
  migrations folder applied, and `parameterCount(sql)`. It keeps D1's behaviours a test could
  otherwise pass without: SQL compiled at run time, `D1_TYPE_ERROR` on `undefined`, a wrong
  number of bindings refused, per-statement `changes`, blobs as number arrays, a batch rolled
  back whole. Needs node 22.13 or later, and loads `node:sqlite` only when called.
- **What a game may change:** nothing is required. A game with its own board can move onto the
  core a piece at a time ([docs/board.md](docs/board.md#moving-a-games-own-board-onto-the-core)).
  Its rate rows start again once if they counted hours rather than ms.

## 0.5.0 (2026-10-30)

**A shared GLB shrink pass, and Web Audio sequencer helpers to copy.** Games that carried their
own glTF optimize script, meshopt decoder or pitch helpers can use these instead.

- New command `umm-dev gltf optimize <file...> [--level medium|high] [--no-keep-extras]
  [--dry-run]`: dedup, weld, prune and meshopt compression, rewriting each GLB in place and
  printing a size line per file. It never joins or flattens meshes, so node extras survive, and
  it writes a file only when the result is smaller, so a second run leaves it alone.
  See [docs/gltf.md](docs/gltf.md).
- New entry point `@ummgames/dev/gltf`: `createGltfIO()` (a NodeIO with `ALL_EXTENSIONS` and
  both meshopt codecs), `decodeMeshoptGlb(glb)` (a KHR_ or EXT_meshopt_compression GLB as a
  plain one, since glTF-Transform 4.5 cannot read KHR) and `optimizeGlb(file, opts)`.
- `@gltf-transform/core`, `/extensions`, `/functions` (4.5.1) and `meshoptimizer` (1.3.0) are
  new optional peer dependencies. They are imported only when a glTF function runs, so a game
  that never uses glTF installs nothing new, and `umm-dev` starts without them.
- New runtime folder `runtime/audio/`: `pitch.ts` (`note`, `dbToGain`, `degree` and six scales)
  and `step-clock.ts` (`advanceSteps`, a look-ahead step cursor that skips onto the grid after a
  stall instead of playing a burst of late steps, and `createTicker`). Copy them with
  `umm-dev copy audio`. See [docs/runtime.md](docs/runtime.md#runtimeaudio).
- **What a game may change:** nothing is required. A game that wants `umm-dev gltf` adds the four
  glTF packages (`pnpm add -D @gltf-transform/core@4.5.1 @gltf-transform/extensions@4.5.1
  @gltf-transform/functions@4.5.1 meshoptimizer@1.3.0`); it may then replace its own optimize
  script or meshopt decoder with the kit's.

## 0.4.0 (2026-10-29)

**A hung command can no longer hold the GPU lease for hours.** Under the default
`gpu.overrun: 'warn'`, a run still warns at the end of its booking, and now stops its own
command once it is `gpu.overrunGraceMinutes` (default 30) past it, exiting 124. Before, a live
holder was never stopped: on one machine a capture that hung on its third shot held the lease
for 12.5 hours, with every other session queued behind it, until someone released it by hand.
No waiter takes the lease from a live holder; the holder's own `gpu run` stops itself.

- New `gpu` key: `overrunGraceMinutes` (default `30`). `0` stops at the booking, as `'kill'` does.
- The end-of-booking warning names when the run will be stopped, and a waiter behind a
  `umm-dev` holder past its booking is told the holder stops itself.
- **What a game may change:** nothing is required. A run that is genuinely longer than its
  booking plus 30 minutes is now stopped: book what it takes (`--long` over 45m), or raise
  `overrunGraceMinutes`. A game on `overrun: 'kill'` sees no change.

## 0.3.0 (2026-10-25)

**`store` can archive the previous kit.** A new opt-in `archive` step, run first, zips the last
kit (all of `<out>` but `<out>/capture`) to `<archiveDir>/<out>-<YYYY-MM-DD>.zip` before
anything overwrites it. The date is when the kit's captures were made; a second archive of one
date gets `-2`, `-3` and on. Run it with `umm-dev store --archive`, alone with
`--steps archive`, or on every run with `store.archive: true`.

- New `store` keys: `archive` (default `false`) and `archiveDir` (default `'store-archive'`).
- Capture's `meta.json` now records `capturedAt`, an ISO time. For captures made before this,
  the archive step uses the `meta.json` file's time.
- `@ummgames/dev/media` exports `archiveKit`, `captureDate` and `writeZip` (a dependency-free zip
  writer; no zip64, so under 4 GB).
- **What a game may change:** nothing is required. A game that wants a dated history of its
  store kits adds `store-archive/` to `.gitignore` (or commits it on purpose) and runs
  `umm-dev store --archive`, or sets `archive: true`.

## 0.2.2 (2026-10-25)

**`cut` joins a dissolve that follows a hard cut.** An edit list with a hard cut (no `dissolve`)
and any `dissolve` after it failed in the final pass with `First input link main timebase
(1/1000000) do not match the corresponding second input link xfade timebase`: the hard cut's
`concat` changes the stream's timebase, and `xfade` needs both inputs on one. Such a join now puts
every segment on ffmpeg's default timebase first. Joins without that mix build the same commands
as before.

- **What a game may change:** nothing is required. An edit list that turned its hard cuts into
  short dissolves to get round this can use hard cuts again.
- The README and `docs/upgrading.md` install lines name the current tag again (0.2.1 left them
  on `v0.2.0`).

## 0.2.1 (2026-10-25)

**capture and store draw on the GPU by default.** With no `capture.browser.channel`, the browser
is now the installed Chrome, then Edge, then Playwright's Chromium (it was Playwright's Chromium
first). Playwright's headless shell draws WebGL in software (SwiftShader), which made a 3D
game's capture about 20x slower; the installed Chrome uses the GPU while still headless. Each
game had been finding this out for itself and setting `channel: 'chrome'`.

- Capture checks the WebGL renderer once per run and warns when it is a software one
  (SwiftShader, llvmpipe, WARP), with the fix.
- Falling back to Playwright's Chromium is logged, since it means software drawing.
- **What a game may change:** nothing is required. `browser: { channel: 'chrome' }` in
  `umm-dev.config.mjs` is now the default and can go. A game that wants Playwright's own build
  sets `channel: 'chromium'`. Footage from Chrome can differ by a few pixels from the headless
  shell's, so a game comparing against old captures should re-capture its reference once.

## 0.2.0 (2026-10-25)

**The web portal tools are removed.** The kit now covers a game's own site build only. A game
that ships to a portal keeps that code itself, or stays on 0.1.x.

- **Gone from `@ummgames/dev/vite`:** `portalSdk`, `portalPrune`, `portalSiteOnly`,
  `portalAssets`, `stripSiteOnly`, `orphanChunks`, `overLimits`, `PORTAL_MODE`,
  `CRAZYGAMES_SDK_URL`, `CRAZYGAMES_ORIGINS` and `CRAZYGAMES_LIMITS`.
- **Gone from `@ummgames/dev/testing`:** `fakePortal`, `fakeSdkScript`, `PORTAL_HOST` and
  `CRAZYGAMES_SDK_URL`. `headersFor` stays, now documented in `docs/build.md`.
- **Gone from `runtime/`:** `runtime/portal/` (`portal-sdk.ts`, `build-target.ts`). A game's
  copies keep working; `umm-dev drift` reports them as `no longer shipped`.
- **`headers()` is for the site build only.** `target` and `frameAncestors` are removed, and
  `securityHeaders()` takes no options. Passing either option throws when the config loads, so
  an old portal config fails instead of shipping headers that refuse the portal's frame.
- `docs/portal.md` is removed.
- **The store kit stays.** `umm-dev store` and `presets/crazygames.json` are unchanged; their
  docs say "storefront" where they said "portal".

**What a game must change:**
- Any import of the names above: move that code into the game, or keep the game on `v0.1.2`.
- `headers({ target: 'portal' })`: drop `headers()` from that build and write its `_headers`
  yourself. The site build's `headers()` is unchanged.
- Copies of `runtime/portal/` fail `umm-dev drift --strict`, which counts `no longer shipped` as
  drift. Delete each copy's line 1 header: the file is the game's own from then on.
- Nothing for a game that uses only the site build plugins, the media chain, the agent tools,
  guards or presets.

**Dependencies:** this repo's own Vite moves to 8.3.5 and Vitest to 4.1.12, clearing the audit
advisories against 8.2.1 and 4.1.10. The `vite` peer range games see is unchanged (`>=7`).
Two GPU lease tests no longer depend on how fast the machine starts processes.

## 0.1.2 (2026-10-24)

- **The paste block in `docs/agents.md` keeps every `@` inside backticks.** Claude Code reads a
  bare `@path` in a CLAUDE.md as a file import, and the block had three bare
  `@ummgames/dev` mentions. A docs test now holds the block, and this repo's CLAUDE.md, to that
  rule. A game that pasted the v0.1.1 block can wrap those three mentions by hand.

## 0.1.1 (2026-10-24)

**A full documentation pass,** for people and for AI agents.
- **One layout for every area page:**
  1. what it is for;
  2. Quick start;
  3. options tables;
  4. Config tables with defaults;
  5. file formats;
  6. how it works;
  7. Troubleshooting with the real messages;
  8. For agents.
- **New pages:**
  - `docs/README.md`, the map of every page;
  - `getting-started.md`;
  - `adopting.md`, for a game with its own copies;
  - `upgrading.md`;
  - `agents.md`, with a block to paste into a game's CLAUDE.md;
  - `troubleshooting.md`;
  - `known-issues.md`, the bugs found in this pass and not yet fixed, with workarounds;
  - `maintaining.md`.
- **Corrections from adopting the kit in a real npm game by following only the docs:**
  - the agents block works with either package manager;
  - typechecking `umm-dev.config.mjs` needs `allowJs`, and the file in the tsconfig's `include`;
  - the presets' tools must be installed by the game;
  - Playwright empties capture's default output folder;
  - the portal spec needs its own Playwright config;
  - `store --steps check` lists what a portal needs.
- `CHANGELOG.md` now ships in the package.
- `CaptureClock` types `ready`'s second argument.
- `tests/docs.test.mjs` checks that every link and anchor resolves, every command's `--help`
  runs, and every config section has a Config table.

**`defineConfig` is typed.** `UmmDevConfig` covers every section, and every section's type is
exported. With `// @ts-check` in `umm-dev.config.mjs`, a misspelt section or key is a type error.

**Fixes:**
- `--help` after a subcommand prints the usage and runs nothing. `gpu wait --help` used to wait.
- A hook skips the denylist when `guard.denylist` is `false`, as it does for `null`. It used to
  fail every commit.
- `copy`'s refusal names the `--to` it needs. Followed literally, the old hint wrote to the
  default path.

**Runtime files: comments only.** The doc comments changed in five files:
- `runtime/portal/portal-sdk.ts`;
- `runtime/portal/build-target.ts`;
- `runtime/input/pad-profiles.ts`;
- `runtime/boot/dev-splash.ts`;
- `runtime/dev/palette.ts`.

No code changed in any of them. After moving to the release that carries this, `umm-dev drift`
shows untouched copies of these files as `changed upstream`; `umm-dev copy` updates them in
place.

## 0.1.0 (2026-10-24)

The first release. These are tools that each game used to keep its own drifting copy of, merged into one package.

- **Media.**
  - `umm-dev capture` records in virtual time: every frame exact, seeded randomness, `expect` checks.
  - `umm-dev cut` cuts from an edit list: dissolves, wipes, cards, reframing, `--print` without ffmpeg.
  - `umm-dev store` makes a portal store kit from the game's own templates, checked against `presets/crazygames.json`.
  - `umm-dev loop` makes a site loop and its poster.
- **Portal and build.**
  - `@ummgames/dev/vite` holds the portal SDK injection, prune and site-only plugins, and `headers` with a portal build that the portal can frame.
  - It also holds the 404 page, licences, and the app icon and share card.
  - `@ummgames/dev/testing` provides `fakePortal`.
- **Agent kit.**
  - `umm-dev gpu` is a machine-wide GPU lease. It shares its lock format with the older per-repository `gpu.sh` scripts.
  - `umm-dev worktree` hydrates a worktree, or removes it after safety checks.
  - `umm-dev merge` resolves markdown conflicts, by hand or as a merge driver.
  - `umm-dev guard` checks em dashes, CLAUDE.md size and a path denylist, and installs git hooks.
- **Runtime code, copied rather than linked.**
  - `umm-dev copy` and `umm-dev drift` copy runtime files into a game and report how far each copy has moved.
  - `runtime/portal/` holds the CrazyGames SDK adapter.
    - Multiplayer is optional.
    - An ad that starts after the no-show wait now mutes the game, and unmutes it when it ends.
  - The first runtime sources: `runtime/dev/` (the dev palette, perf HUD and recorder, tuner), `runtime/input/pad-profiles.ts`, and `runtime/boot/dev-splash.ts`.
- **Presets.** Biome, tsconfig, Vitest and Playwright.
- **Audio.** `umm-dev loudness` and `@ummgames/dev/audio`, a BS.1770 meter.
- **Reviewed before release.**
  - `worktree remove` refuses nested worktrees, unreachable detached commits and hidden untracked files.
  - The watchdog never kills a pid that another process may have reused.
  - Capture output paths, drift headers and URLs are confined to their folders.
  - `guard install-hooks` and `copy --force` overwrite only what they wrote or what was named.
