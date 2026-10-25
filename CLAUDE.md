# ummgames-dev

`@ummgames/dev`: the dev tools every Uncle Matt Makes game shares. One package, installed by each
game as a devDependency pinned to a tag. Read README.md for what is here and how a game uses it.

## Hard rules

1. **This repo is public.** It holds code and generic docs, nothing else. Never write a private
   repository's name, an unannounced game, a host, a bucket, an account id, a key, a home-directory
   path or a plan into any tracked file. Game-specific values live in each game's
   `umm-dev.config.mjs`, never here. `tests/public-names.test.mjs` fails on any name listed in the
   untracked `.private-names` file; keep that file current and never commit it. Commits use the
   GitHub noreply identity set in this repo's local git config, never a personal address.
2. **One package, no internal packages.** Everything ships as `@ummgames/dev`. pnpm cannot resolve
   `workspace:*` links when a game installs from git, so a second package here breaks every install.
3. **Linked code is JavaScript.** Everything under `bin/`, `src/` and `config/` is ESM `.mjs`, with
   `// @ts-check`, JSDoc types and hand-written `.d.ts` beside any public entry point. Node refuses
   to strip TypeScript inside `node_modules`, so a `.ts` file here fails in every game.
4. **Runtime code is copied, not linked.** `runtime/` holds the TypeScript that ships inside a game
   (splash, perf HUD, dev palette, gamepad profiles). A game takes a file with
   `umm-dev copy <runtime path>`, which stamps a header naming this repo, the path and the commit;
   `umm-dev drift` reports how far each copy has moved. Files in `runtime/` import nothing outside
   their own folder.
5. **No install-time scripts.** No `prepare`, `postinstall` or git-hook installer in package.json.
   A game installs this from git, and pnpm would run them in every worktree.
6. **A tool reads its game's settings from the game.** `loadConfig(section)` in `src/config.mjs`
   finds `umm-dev.config.mjs` at the game's root. Defaults are generic: no game's URL flags, debug
   global or paths.
7. **Docs move with the code.** Each `src/commands/<name>.mjs` exports `describe` and `run`, and its
   area has a page in `docs/` in the shared layout (docs/maintaining.md, "Writing docs"). A
   behaviour change updates four things in the same commit: the `--help` text, the options table,
   the `.d.ts` JSDoc and the Config table's defaults. A new config section also goes into
   `UmmDevConfig` in `src/index.d.ts`. `tests/docs.test.mjs` checks links, `--help` and Config
   tables; it does not check the prose, so read your own page against the code.
8. **Releases are tags.** Bump `version`, add a CHANGELOG entry, tag `v<version>`. Games pin
   `github:unclemattmakes/ummgames-dev#v<version>` and move when they choose. Never move a tag.

**Before changing anything, read docs/maintaining.md:** where each kind of thing goes, why each
rule exists, and how to release.

## Commands

`pnpm check` (typecheck, lint, unit tests) · `pnpm test:slow` (needs ffmpeg and Playwright's
Chromium) · `node bin/umm-dev.mjs help`.

## Layout

`bin/umm-dev.mjs` dispatcher · `src/commands/` one file per subcommand · `src/<area>/` the code
behind them · `src/vite/` Vite plugins (`@ummgames/dev/vite`) · `src/testing/` test helpers
(`@ummgames/dev/testing`) · `config/` Biome, tsconfig, Vitest and Playwright presets · `presets/`
platform specs as data · `runtime/` TypeScript to copy into a game · `docs/` one page per area ·
`tests/` Vitest; `*.slow.test.mjs` needs ffmpeg or a browser.
