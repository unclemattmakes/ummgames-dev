# Changelog

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
