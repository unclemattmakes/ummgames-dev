# Troubleshooting

These are the errors most likely to come up in any game, with what causes each and the fix. Each
area page has its own Troubleshooting table for the rest:
- [media](media.md#troubleshooting)
- [build](build.md#troubleshooting)
- [agent](agent.md#troubleshooting)
- [guard](guard.md#troubleshooting)
- [runtime](runtime.md#troubleshooting)
- [presets](presets.md#troubleshooting)
- [audio](audio.md#troubleshooting)

The messages below are copied from the code. Search this page for the start of yours.

**If the kit itself is misbehaving,** check [known-issues.md](known-issues.md) first. It lists
current bugs with workarounds.

## Installing and running

| Symptom | Cause | Fix |
|---|---|---|
| `Cannot find package '@ummgames/dev' imported from …/umm-dev.config.mjs` | The kit is not installed where the command runs: often a fresh worktree outside the main checkout | `pnpm install` there, or `umm-dev worktree hydrate` |
| `umm-dev: no command "<name>". Run umm-dev help.` | A typo, or a command from a newer version than the one pinned | `umm-dev help` lists what this version has; check the pinned tag in package.json |
| `Unknown option '--<x>'` and the usage | The option does not exist for that command or subcommand | `umm-dev <command> --help`. Usage errors exit 2, or 64 in `gpu`, `worktree` and `merge` |
| `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` | Something imported a `.ts` file from `node_modules/@ummgames/dev` | Import the package's documented entry points only. The `.ts` files under `runtime/` are for `umm-dev copy`, not for import |
| npm writes `git+ssh://git@github.com/…` into package-lock.json | npm's normal form for a GitHub dependency | Nothing to fix: npm falls back to HTTPS for this public repo, so machines without SSH keys install it too |

## Presets

| Symptom | Cause | Fix |
|---|---|---|
| `Found a nested root configuration, but there's already a root configuration.` | A second `biome.json` sits under the game's root | Give the nested file `"root": false` (and `"extends": "//"` to inherit the game's), or delete it |
| Biome cannot find an ignore file | The preset sets `vcs.useIgnoreFile`, and the game has no `.gitignore` or `.git` | Add a `.gitignore` |
| `TS6053: File '@ummgames/dev/tsconfig' not found` | A different specifier (`…/tsconfig.json`, `…/config/…`) or the kit is not installed | Use exactly `"extends": "@ummgames/dev/tsconfig"`; Biome likewise wants exactly `["@ummgames/dev/biome"]`, as an array |
| `TS2591: Cannot find name 'process'` or `TS2339: Property 'env' does not exist on type 'ImportMeta'` | TypeScript 6 and later load no `@types` unless `types` lists them | Add `"types": ["node"]` or `["vite/client"]` in the game's tsconfig |
| The Playwright web server ignores `--port` under npm | The preset's `devCommand` defaults to `pnpm dev` | Under npm, pass `devCommand: 'npm run dev --'` |

## Config

| Symptom | Cause | Fix |
|---|---|---|
| `Object literal may only specify known properties, and '<key>' does not exist in type '<Section>Config'` | A misspelt or unknown key, found by `// @ts-check` | Use the key from the section's Config table. The message often says "Did you mean …" |
| A setting seems ignored | It is in the wrong section, or the command reads the default because no root was found | Each command reads only its own section. The root is the nearest folder above the working directory with a package.json |
| `<name> is not defined` from a capture hook | Page hooks (`ready`, `prep`, `hide` and others) run in the browser, so they cannot use a variable from the config file | Pass data through the shot's fields or the game's debug global |
| A path in the config is wrong but the same path on the command line works | Config paths are relative to the game root; CLI paths to the working directory | Write config paths from the root |

## Browsers and ffmpeg

| Symptom | Cause | Fix |
|---|---|---|
| `(no installed Chrome or Edge: using Playwright's Chromium, which draws in software when headless)` | capture or store found no Chrome or Edge | Install Chrome; Playwright's headless shell draws WebGL in software, many times slower |
| `warning: WebGL draws in software here (…)`, or a 3D capture that crawls | The capture browser has no GPU | Install Chrome, or set `capture.browser.channel` to a browser that uses the GPU |
| `browserType.launch: Executable doesn't exist at …chromium_headless_shell-<rev>…` in an e2e run | The same mismatch, in the game's own Playwright tests | `E2E_CHANNEL=chrome`, or `pnpm exec playwright install chromium` |
| `could not start Chromium: …` | No Chrome, no Edge and no Playwright Chromium, or a sandbox blocking the launch | Install one of them; check the rest of the message |
| `could not run ffmpeg (…): put it on PATH`, or `spawn ffprobe ENOENT` | ffmpeg or ffprobe is missing | Install ffmpeg, so that both `ffmpeg` and `ffprobe` run in a new terminal |
| `Failed to load resource … 404` in capture output | Usually `/favicon.ico` | Harmless; add a favicon to silence it |

## Runtime copies

| Symptom | Cause | Fix |
|---|---|---|
| A second copy of a file appeared, at `src/<folder>/` | `umm-dev copy` without `--to`, for a file the game keeps elsewhere | Delete the new copy. Re-run with `--to <the game's path> --force`. Use `--dry-run` first |
| `refused <file>: exists and is not a copy; …` | The destination is the game's own file, not a stamped copy | Run the command the hint gives (`umm-dev copy <path> --to <file> --force`) to take it over, or leave it if it is the game's |
| `imports ./<name>, which is not beside it: copy that too` | A runtime file needs a sibling you have not copied | Copy the sibling to the same folder |
| drift says `changed here and upstream` | Both the game and a newer kit changed the file | [upgrading.md](upgrading.md#steps), "When both changed" |
| `drift --diff` says it is offline and compares with the installed file | It could not fetch the original from the public repo | Set `UMM_DEV_REPO` to a local clone of the kit, and it reads the tag there |

## Builds

| Symptom | Cause | Fix |
|---|---|---|
| `/assets/* is cached immutable but these have no content hash: <file>` | `headers({ immutableAssets: true })` found a file under `assets/` without a hash | Give it a hashed name, move it out of `assets/`, or list `headers()` after the plugin that writes it |
| `headers: target was removed in 0.2.0; _headers is for the site build only` | A portal build's config from before 0.2.0 | Drop `headers()` from that build and write its `_headers` yourself ([build.md](build.md#troubleshooting)) |
| `does not provide an export named 'portalSdk'` (or `fakePortal`, `PORTAL_MODE`) | 0.2.0 removed the portal tools | Keep the game on 0.1.x, or move the portal code into the game ([CHANGELOG.md](../CHANGELOG.md), 0.2.0) |

## Agents, GPU and git

| Symptom | Cause | Fix |
|---|---|---|
| A `gpu run` waits until its wait limit, though nothing else runs | It is nested inside another `gpu run`, and is waiting on itself | Run one lease per command; never nest |
| A `gpu run` exits 124 with `still running 30m past its 25m booking` | The command hung, or the booking was too short. The run stopped its own command so the GPU is free for the next | If it hung, find where (the last shot, the last test). If it is genuinely long, book what it takes, with `--long` over 45m |
| After a merge, a conflicted markdown file holds only our side, and git printed `Cannot find module …/node_modules/@ummgames/dev/bin/umm-dev.mjs` | The merge driver could not start: the kit is not installed in that checkout | Install, then `git checkout -m -- <file>` to restore the conflict, and merge again |
| `guard install-hooks` refuses a hook, exit 1 | The hook exists and was not written by umm-dev, or `core.hooksPath` points at the game's own hooks | Call `umm-dev guard hook <name>` from the existing hook, or unset `core.hooksPath` and re-run |
| `worktree remove` refuses | It would lose uncommitted work, an unreachable commit, or a nested worktree | Read its reason. Commit, branch or remove the nested worktree first. `--force` discards that work |
