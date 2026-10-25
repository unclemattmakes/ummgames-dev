# Maintaining the kit

This page is for people and agents changing this repo. Using the kit in a game is covered by
the other pages. The hard rules are in the repo's
[CLAUDE.md](https://github.com/unclemattmakes/ummgames-dev/blob/main/CLAUDE.md), which is not
shipped in the package, and this page explains them and the routine work around them.

## Setup

```sh
pnpm install
pnpm check        # typecheck (both tsconfigs), Biome, unit tests
pnpm test:slow    # needs ffmpeg and ffprobe on PATH and a Chromium (Playwright's, or Chrome or Edge)
```

**Create `.private-names` at the root** (see "Keeping it public" below). Without it, the
public-names test skips instead of guarding.

## Where things go

| You are adding | It goes in | Also update |
|---|---|---|
| A command | `src/commands/<name>.mjs`, exporting `describe` and `run(argv, ctx)`; the code behind it in `src/<area>/` | README's command table; the area's page in `docs/`; `--help` |
| A config section | `loadConfig('<section>', DEFAULTS)` in the command; a `<Name>Config` type in the area's `.d.ts` | `UmmDevConfig` in `src/index.d.ts`; a "Config" table in the area's page |
| A Vite plugin or test helper | `src/vite/` or `src/testing/`, exported from its `index.mjs` and `index.d.ts` | docs/build.md, docs/portal.md |
| A library entry point | `src/<area>/index.mjs` and `index.d.ts`, plus an entry in `exports` in package.json | README "Libraries" |
| A preset | `config/`. Never call a file `biome.json` there: Biome treats any such file as a second root config | docs/presets.md |
| Runtime code a game copies | `runtime/<folder>/`, TypeScript that imports nothing outside its folder | docs/runtime.md, or the area page |
| A platform spec | `presets/<name>.json` | docs/media.md |

The dispatcher finds commands by listing `src/commands/`, so adding a command never touches
package.json. Files starting with `_` are skipped.

## The rules, and why

| Rule (CLAUDE.md) | Why |
|---|---|
| One package, no internal packages | pnpm cannot resolve `workspace:*` between packages when a game installs from git (`ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`). |
| Linked code is `.mjs` with JSDoc, not `.ts` | Node refuses to strip types inside `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so a `.ts` bin or import fails in every game. |
| No install-time scripts | A game installs this from git, so pnpm would run them in every worktree of every game. |
| Runtime files import nothing outside their folder | A game copies a folder as a unit, and has no copy of anything else. |
| Defaults are generic | No game's URL flags, debug global, ports or paths. A game sets its own in `umm-dev.config.mjs`. |
| Tags never move | Lockfiles pin the commit, and drift fetches originals by tag. A moved tag breaks both silently. |

`tests/cli.test.mjs` enforces several of these:
- every command has `describe` and `run`;
- the README names every command;
- every `exports` path exists;
- package.json has no lifecycle scripts;
- no `.ts` file sits under `bin/`, `src/` or `config/`.

## Keeping it public

The repo is public, and must never name a private repo, an unannounced game, a host, an account,
a key, a home path or a plan.

- **The names list.** `.private-names` is gitignored and lists the names to keep out, one per
  line, with `#` comments. `tests/public-names.test.mjs` fails if any file that would be published
  contains one. Keep the list current when you learn a new name to keep out. **Never commit the
  list itself.**
- **Commit identity.** Commits use the GitHub noreply identity, set in this repo's local git
  config. Check with `git config user.email` before the first commit in a new clone.
- **Where provenance goes.** Where a piece of code came from is not recorded here. A source repo's
  name would itself be a leak.
- **Examples.** They use generic names: `__game` for a debug global, `my-game`, ports 5173 and
  up.

## Writing docs

Every area page follows the same shape:
1. what it is for;
2. Quick start;
3. one section per command or export, with an options table;
4. a Config table per section;
5. file formats;
6. how it works;
7. Troubleshooting;
8. For agents.

When you change behaviour, change these four together, or the docs drift from the code:
- the `--help` text;
- the options table;
- the `.d.ts` JSDoc;
- the defaults in the Config table.

**Style:**
- Short declarative sentences, a bold lead-in for the key fact, tables for reference.
- No em dashes; `umm-dev guard em-dash docs README.md` checks.
- No marketing words.
- Defaults are written exactly as the code has them.

**Known issues.** A bug you find but do not fix goes in [known-issues.md](known-issues.md), with
a workaround. When you fix one, delete its line and say so in the changelog.

`tests/docs.test.mjs` checks that:
- every relative link in the docs resolves;
- every command's `--help` runs;
- every config section in `UmmDevConfig` has a Config table somewhere in `docs/`.

## Releasing

1. Move the `CHANGELOG.md` entry from "unreleased" to the version and date. List what a game must
   change, if anything.
2. Bump `version` in package.json. `umm-dev copy` stamps copies with this version, so it must
   match the tag.
3. Run `pnpm check`, `pnpm test:slow` and the public-names test, all green.
4. Commit, then tag `v<version>`:
   ```sh
   git tag -a v<version> -m v<version> && git push origin main v<version>
   ```
5. Check that it installs from GitHub in a scratch project, with pnpm and with npm:
   ```sh
   pnpm add -D github:unclemattmakes/ummgames-dev#v<version>
   ```
   Also check that the raw URL drift uses answers 200:
   `https://raw.githubusercontent.com/unclemattmakes/ummgames-dev/v<version>/runtime/portal/portal-sdk.ts`.
6. Bump the install lines in README.md and the docs to the new tag, in the release commit, so
   copy-pasted instructions install the latest.

**Patch or minor:** a patch is fixes and docs only; a minor adds tools or options. While the major
version is 0, a minor may also rename or remove, and the changelog must say what to change.
