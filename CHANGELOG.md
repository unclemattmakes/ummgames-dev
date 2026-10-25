# Changelog

## Unreleased

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
