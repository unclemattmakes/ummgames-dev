# Known issues

Behaviour that is wrong or surprising in the current version, each with a workaround. **When a
fix lands, its line is deleted here, and the changelog says so.** An issue found in a game goes
here, or upstream as an issue, never into a local patch of `node_modules`.

## Media

| Issue | Workaround |
|---|---|
| `capture`'s default output is `test-results/capture`, which Playwright empties on every e2e run | Set `capture.out` (and each edit list's `clips`) to a folder of its own |
| `store --draft`: the check step checks the full-quality file, not `-draft.mp4`. A draft reads as `skipped`, or a stale final file gets checked | Check drafts by eye; run without `--draft` before trusting the report |
| `cut` does not check a shot against its clip's length, or `length` against the shots' total. It can print `15.00 s` for a file that runs 13.5 s | Trust the store check step, or `ffprobe`, for the real duration |
| `cut` prints `0.0 MB` against `maxMB` for small files | Cosmetic |
| `capture --compare` with two folders that do not exist prints `SAME footage` and exits 0 | Check the folder names first |
| `hold: 'assign'` without `debugGlobal` is not rejected: the clock never holds, and the message says `window.null` | Always set `debugGlobal` with `hold: 'assign'` |
| Under `store`, the hint for a missing shots file names `capture.shots`; the `no plate` hint leaves out `--file <store.shots>` | The store's shots come from `store.shots` |
| `store --steps preflight` prints `store done:` although it made nothing | Cosmetic |
| `loop` accepts `--edge 0` and any `--crf` | Use the defaults unless you need otherwise |

## Portal and build

| Issue | Workaround |
|---|---|
| `portalPrune` drops nothing when source maps are on, because each chunk's `.map` names it | Keep `build.sourcemap` off in the portal build |
| `portalSiteOnly` keeps a marked void element (`<link>`, `<img>`, `<meta>`), matches `data-site-only-x` as the attribute by prefix, and leaves broken HTML for a nested element of the same name | Mark only simple, non-nested, non-void elements, and check the built `index.html` |
| `portalAssets` checks the limits after writing, so a failed build leaves a complete `dist-portal/`. It does not count files copied from an enabled `publicDir` | Never upload from a run that exited non-zero; keep `publicDir: false` in the portal build |
| `portalAssets` prints nothing when the build is within limits | Measure by hand ([portal.md](portal.md#headroom-check-the-size-by-hand)) |
| `headers({ immutableAssets: true })` only sees files written by plugins before it | List `headers()` after any plugin that writes into `assets/` |
| `licences`: the error suggests a fallback file even when the missing piece is the package's `license` field; an `include` entry that is not at `node_modules/<name>` gives a raw `ENOENT` (pnpm transitive dependencies) | Add the package as a direct dependency, or give it a fallback licence file |
| `fakePortal`: when the game's iframe is refused, `open()` throws "call open() first" | Check the portal build's headers (`frame-ancestors`) |

## Agent kit and guards

| Issue | Workaround |
|---|---|
| Usage errors exit 64 in `gpu`, `worktree` and `merge`, and 2 everywhere else | Read each command's exit-code table; in `gpu run`, 2 means it gave up waiting |
| A non-numeric `gpu run --wait-limit` or `gpu wait --timeout` waits forever | Pass whole numbers |
| `guard em-dash --staged` passes everything when git's `diff.mnemonicPrefix` or `diff.noprefix` is set, and skips paths git quotes (non-ASCII) | Leave those settings off, or run `guard em-dash <paths>` |
| A config that fails to load makes `guard` exit 1, not 2 | Read the message: it names the config error |
| The merge driver without `%P` skips the markdown check, so it resolves any file | Always pass `%P`, as docs/agent.md shows |
| `worktree remove <relative path>` resolves the path under `worktree.dir`, not the working directory | Pass a name, or an absolute path |

## Runtime, presets and audio

| Issue | Workaround |
|---|---|
| A merged copy cannot be re-stamped | Take the new version with `copy --force`, then re-apply the game's change (upgrading.md) |
| `copy` does not warn when a file of the same name already exists elsewhere in the game | `--dry-run` first, and search for the file name |
| The Playwright preset replaces any `projects` a game passes | Use a separate config file per kind of spec (portal.md) |
| The Playwright preset's `devCommand` defaults to `pnpm dev` | Under npm, pass `devCommand: 'npm run dev --'` |
| `loudness` does not convert a string from the config, and then says `--target needs a number` even with no flag given | Write numbers, not strings, in the `loudness` section |
| `loudness` reads any file with 4 or more channels as 5.1, so a quad file's 4th channel weighs 0 | Meter quad files as stereo pairs |
| `runtime/dev/palette.ts`: `destroy()` removes the tuner panel without calling its `close()`, so its 500 ms poll keeps running | Close the tuner before destroying the palette |
