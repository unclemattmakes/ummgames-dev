# Changelog

## Unreleased

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
