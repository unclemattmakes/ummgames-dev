# Repo guards

`umm-dev guard` checks a game repository before a commit and in CI: no em dashes in new text, a
size budget for CLAUDE.md, and a denylist that keeps assets and secrets out of git history. Reach
for it when a rule must hold for every session and every contributor, not just the careful ones.
It is **linked**: it runs from `node_modules/@ummgames/dev`, and the git hooks it writes call it
there. Settings are the game's `guard` section of `umm-dev.config.mjs`.

## Quick start

Install the hooks once per clone (worktrees share them):

```sh
pnpm exec umm-dev guard install-hooks
```

When it works, it prints one line per hook:

```
install-hooks: wrote /path/to/game/.git/hooks/pre-commit
install-hooks: wrote /path/to/game/.git/hooks/commit-msg
```

From then on a commit that adds a line with an em dash is refused with
`em-dash: 1 added line(s) carry an em-dash. Use a colon, a comma, parentheses or a new sentence instead.`
and the file and line. The denylist joins the pre-commit hook once the game has rules:

```js
// umm-dev.config.mjs
import { defineConfig } from '@ummgames/dev'

export default defineConfig({
  guard: { denylist: 'tools/denylist.json' },
})
```

```json
{
  "maxBytes": 262144,
  "extensions": [{ "group": "mesh", "why": "meshes live in the asset store", "ext": [".glb", ".fbx"] }],
  "names": [{ "pattern": "^\\.env(\\..+)?$", "except": "^\\.env\\.example$", "why": "local secrets" }]
}
```

`pnpm exec umm-dev guard denylist --tree` should then print
`guard denylist: OK, N file(s) checked (tree), nothing denied.` Run the same checks in CI, because
a hook is skipped by `git commit --no-verify`:

```sh
pnpm exec umm-dev guard em-dash
pnpm exec umm-dev guard claude-md
pnpm exec umm-dev guard denylist --tree
```

## `umm-dev guard`

```
umm-dev guard em-dash [<path>...] [--staged] [--message <file>]
umm-dev guard claude-md
umm-dev guard denylist [--staged | --tree | --history | --stdin | --files <path>...]
                       [--rules <file.json>] [--max-bytes <n>] [--quiet] [--list-rules]
umm-dev guard install-hooks [--dir <hooks dir>] [--force]
umm-dev guard hook <hook name> [args]
```

Options belong to one subcommand each, as listed below. `--help` anywhere, including after a
subcommand (`umm-dev guard em-dash --help`), prints the whole usage and exits 0.

**Exit codes**, for every subcommand:

| Code | Meaning |
|---|---|
| 0 | Clean. Also `--list-rules`, and `install-hooks` when it wrote every hook |
| 1 | Found something. Also `install-hooks` leaving a hook alone or running outside git, and a config that fails to load |
| 2 | The check itself failed or has nothing to check against: an unknown option, a bad rule table, a git error, a denylist with no rules or no mode, no subcommand |

### `guard em-dash`

No em dash (U+2014) in anything newly written. Other dashes are not checked.

- **With paths**, it checks every line of those files, or of the files in those folders, that
  git lists. With none, every file git lists: tracked, plus untracked that are not ignored. A path
  git ignores is not checked even when named. Outside git it walks the paths, skipping
  `node_modules` and `.git`.
- **`--staged`** checks only the lines the commit ADDS. It lets through, on purpose:
  - a line MOVED unchanged (the same text removed anywhere in the same commit), because a module
    split relocates old lines and the rule is about what is written, not what is carried;
  - every line while a merge, cherry-pick, revert or rebase is in progress, which replay commits
    written under their own rules.

  A tree that held many dashes when the rule arrived loses them line by line, because an edited
  line is an added line.
- **`--message <file>`** checks a commit message, minus its `#` lines.

Binary files (a NUL byte in the first 8 KB) are skipped, and so are paths in
`guard.emDash.exclude`, in every mode but `--message`.

| Option | Value | Default | What it does |
|---|---|---|---|
| `<path>...` | files or folders | every file git lists | What to check |
| `--staged` | flag | off | Only the lines the staged commit adds |
| `--message` | file | | Check this commit message instead; wins over the others |

```sh
pnpm exec umm-dev guard em-dash                 # every file git lists
pnpm exec umm-dev guard em-dash docs src/ui     # these files or folders
pnpm exec umm-dev guard em-dash --staged        # what the pre-commit hook runs
```

A hit prints `em-dash: N line(s) carry an em-dash. ...` and up to 40 `file:line: text` lines.

### `guard claude-md`

The root CLAUDE.md is read in full by every session, so its size is a cost every session pays,
and it grows because lessons are appended and none ever leave. A cap turns growth into a
decision: raising it is an edit to the config with a reason in the commit, and the practice at
the cap is one in, one out (move a lesson down to a nested CLAUDE.md, a file header or a test).

It checks every CLAUDE.md git lists (tracked or untracked, not ignored) under the game root:

- the root one exists and is within `guard.claudeMd.rootMaxLines`;
- each nested one is within `nestedMaxLines`;
- the root contains `mustMention`, when set;
- every relative markdown link resolves from the file's folder, when `links` is on. URLs and
  bare `#anchors` are skipped.

It takes no options. It prints one line per file with its line count and cap, then any problems.

```sh
pnpm exec umm-dev guard claude-md
```

### `guard denylist`

Keeps files a game must never commit out of git history. `.gitignore` is the first line of
defence; this is the second, because one `git add -f`, or an extension nobody anticipated,
defeats the first. History is forever, and a rewrite after the fact invalidates every clone, so
the check runs before the object exists (the hook) and again in CI. **This package ships no
rules**: each game writes its own table ("File formats" below).

| Option | Value | Default | What it does |
|---|---|---|---|
| `--staged` | flag | | Staged files, at their staged size (the hook) |
| `--tree` | flag | | Every tracked file, at its size on disk (CI) |
| `--history` | flag | | Every blob on every ref, at its stored size (CI, before a repository goes public) |
| `--stdin` | flag | | Paths on stdin, newline or NUL separated, sized from disk |
| `--files` | paths after it | | Named paths, sized from disk; no git needed. Bare paths with no mode mean the same |
| `--rules` | JSON file | `guard.denylist` | A rule table to use instead of the config, from the current directory |
| `--max-bytes` | bytes, more than 0 | the table's `maxBytes` | Override the size ceiling |
| `--quiet` | flag | off | Print nothing when clean |
| `--list-rules` | flag | off | Print the rule table and exit 0 |

Give one mode. Given several, the first in the order above wins. With no mode it prints
`guard denylist: say what to check` and exits 2.

```sh
pnpm exec umm-dev guard denylist --staged          # what the hook runs
pnpm exec umm-dev guard denylist --tree            # every tracked file
pnpm exec umm-dev guard denylist --history         # every blob on every ref
pnpm exec umm-dev guard denylist --files a.png b   # named paths
git ls-files -z | pnpm exec umm-dev guard denylist --stdin
pnpm exec umm-dev guard denylist --list-rules
pnpm exec umm-dev guard denylist --rules other.json --max-bytes 1000000 --quiet --tree
```

A hit prints `BLOCKED: this would put content the denylist forbids into git history.`, each file
with its size and every rule it broke, and "What to do instead". In `--staged` mode only, when
the table names an `allowEnv` variable and it is set, the check prints the same and passes.

### `guard install-hooks`

Writes one hook into git's hooks folder (`git rev-parse --git-path hooks`, which follows
`core.hooksPath`), or into `--dir`, for each `guard.hooks` entry with at least one check: by
default `pre-commit` and `commit-msg`. **Only when someone runs it**: never from an install
script, because a game installs this package from git and pnpm would run it in every worktree.

- It rewrites a hook only when the file is exactly a script this package wrote. It leaves alone
  a hook someone else wrote, one of its own that a person has edited since, and a symlink
  (writing through it would overwrite the target), and exits 1.
- A hook whose `guard.hooks` list is empty is not written, and an existing one is not removed.

| Option | Value | Default | What it does |
|---|---|---|---|
| `--dir` | folder | git's hooks folder | Write the hooks here instead, from the current directory |
| `--force` | flag | off | Replace whatever is there. For a symlink it removes the link and writes a new file, leaving the target untouched |

```sh
pnpm exec umm-dev guard install-hooks
pnpm exec umm-dev guard install-hooks --dir .githooks
```

### `guard hook`

`guard hook <hook name> [args]` is what the hooks run: every check `guard.hooks` lists for that
hook, so one commit reports them all, exiting with the worst result. `em-dash` runs as
`--staged`, or as `--message <file>` in `commit-msg` (git passes the file). `denylist` runs as
`--staged --quiet`, and is skipped when the game has no rules. `claude-md` reads the work tree,
not the index. A hook name with no checks exits 0. You do not normally run it by hand.

## Config: `guard`

```js
export default defineConfig({
  guard: {
    emDash: { exclude: ['src/generated/**', 'content/levels/*.json'] },
    claudeMd: { rootMaxLines: 200, nestedMaxLines: 100, mustMention: 'docs/claude-md.md' },
    denylist: 'tools/denylist.json',
    hooks: { 'pre-commit': ['denylist', 'em-dash', 'claude-md'] },
  },
})
```

| Key | Type | Default | What it does |
|---|---|---|---|
| `emDash.exclude` | string[] | `[]` | Globs from the repo root never checked for em dashes (every mode but `--message`). For generated trees, whose fix belongs in the tool that writes them |
| `claudeMd.rootMaxLines` | number | `200` | Most lines the root CLAUDE.md may have |
| `claudeMd.nestedMaxLines` | number or `null` | `100` | Most lines any nested CLAUDE.md may have; `null` leaves them uncapped |
| `claudeMd.mustMention` | string or `null` | `null` | Text the root CLAUDE.md must contain, normally the path of the page on keeping it small |
| `claudeMd.links` | boolean | `true` | Check that every relative link in every CLAUDE.md resolves |
| `denylist` | rule table, path, `null` or `false` | `null` | The rule table, or the path of a JSON file holding it (from the game root). `null` or `false`: no denylist, and the hook skips it |
| `hooks['pre-commit']` | check[] | `['denylist', 'em-dash']` | Checks the pre-commit hook runs. A check is `'denylist'`, `'em-dash'` or `'claude-md'` |
| `hooks['commit-msg']` | check[] | `['em-dash']` | Checks the commit-msg hook runs. Only `em-dash` reads the message |
| `hooks.<other hook>` | check[] | none | Any other git hook name gets a hook too; `em-dash` there checks staged lines |

The type is `GuardConfig` in `src/guard/config.d.ts`, with `DenylistRules` for the table.
`emDash`, `claudeMd` and `hooks` merge one level deep with their defaults: setting
`hooks: { 'pre-commit': ['em-dash'] }` keeps `commit-msg` at its default. `denylist` replaces.
**Which checks run is read at commit time**, so changing a list never needs a reinstall:
`'commit-msg': []` makes that hook run nothing (its file stays until deleted). Only a new hook
name needs `install-hooks` again.

**What config cannot change:** where the hooks go (git's hooks folder, or `--dir` for one run),
the hook script itself (it must stay byte for byte what this package writes, or `install-hooks`
treats it as someone else's), and the character the em-dash check looks for.

## File formats

### The denylist rule table

An object in `umm-dev.config.mjs`, or a JSON file named there. In JSON, patterns are strings with
backslashes doubled; in a `.mjs` config they can be RegExp objects.

```js
{
  maxBytes: 262144,        // size ceiling for any file not size-allowed; unset: only sizeAllow is size-checked
  hardCeiling: 2097152,    // cap on size-allowed files with no max (default 2 MiB)
  extensions: [{ group: 'mesh', why: 'meshes live in the asset store', ext: ['.glb', '.fbx'] }],
  prefixes: [{ prefix: 'public/assets/', why: 'built assets live in the asset store' }],
  segments: [{ segment: 'Some Vendor Pack', why: 'a bought pack copied in' }],  // or a bare string
  names: [{ pattern: '^\\.env(\\..+)?$', except: '^\\.env\\.example$', why: 'local secrets' }],
  allow: [{ glob: 'public/favicon.png', why: 'tiny, first-party, ships with the source' }],
  sizeAllow: [{ glob: 'docs/**/*.md', why: 'prose', max: 4194304 }],
  allowEnv: 'GAME_ALLOW_ASSETS',   // set it to let a --staged check print and pass; CI still runs
  advice: ['Built art goes to the asset store.'],
}
```

| Key | Type | Default | What it does |
|---|---|---|---|
| `maxBytes` | number | unset | Size ceiling in bytes for any file not in `sizeAllow`. Unset, only `sizeAllow` files are size-checked |
| `hardCeiling` | number | `2097152` | Size cap for `sizeAllow` files that set no `max` |
| `extensions` | `{ group?, why, ext[] }[]` | `[]` | Denied extensions, with the dot. Matched against the name from its last dot, ignoring case. A name like `.env` has no extension |
| `prefixes` | `{ prefix, why }[]` | `[]` | Denied repo-relative path prefixes, ignoring case |
| `segments` | `(string \| { segment, why? })[]` | `[]` | Denied folder names at any depth, ignoring case. The file's own name is not a segment |
| `names` | `{ pattern, flags?, except?, why }[]` | `[]` | Regular expressions over the file name only. String patterns use `flags`, default `'i'`. A name matching `except` passes |
| `allow` | `{ glob, why }[]` | `[]` | Paths exempt from every rule |
| `sizeAllow` | `{ glob, why, max? }[]` | `[]` | Paths exempt from `maxBytes`, still capped by `max` or `hardCeiling` |
| `allowEnv` | string | unset | An env variable that, when set, lets a `--staged` check print its findings and pass |
| `advice` | string[] | `[]` | Lines printed under "What to do instead" |

- **Globs** (`allow`, `sizeAllow`, `emDash.exclude`) take `*` (within one folder), `?` (one
  character) and `**` (any depth), match the whole repo-relative path, and are case-sensitive.
- **Every `allow` and `sizeAllow` entry is a reviewed exception.** Give it a reason.
- **One file can break several rules**; each is printed with its `why`.
- **Sizes** come from the staged blob (`--staged`, falling back to the file on disk), the disk
  (`--tree`, `--files`, `--stdin`) or the stored blob (`--history`). A file whose size cannot be
  read is checked by name only.

### The hooks

`guard.hooks` maps a git hook name to its checks (see "Config"). Each hook file is a few lines of
POSIX sh (Git Bash on Windows) carrying the line `# umm-dev hook: written by ...`. It:

1. finds `node_modules/@ummgames/dev/bin/umm-dev.mjs` in the work tree, else in the main
   checkout (a fresh worktree has none);
2. refuses the commit when neither has it, or when `node` is not on `PATH`, because "cannot
   check" must never read as "nothing wrong";
3. runs `node <that file> guard hook <hook name> "$@"`.

Delete a hook file to stop that hook. Re-run `install-hooks` to rewrite it.

## How it works

- **Ownership.** `install-hooks` compares an existing hook with the script it would write, line
  endings aside. Only an exact match is rewritten, so a person's edit, or another tool's hook, is
  never overwritten without `--force`.
- **Moved lines.** `em-dash --staged` reads `git diff --cached -U0`. An added line whose trimmed
  text also appears as a removed line anywhere in the same diff counts as moved.
- **Replays.** A `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD` or `REBASE_HEAD` in the git
  folder turns `em-dash --staged` off for that commit.
- **The config is read at commit time** from the checkout the commit is made in. In a worktree,
  that is the worktree's own `umm-dev.config.mjs`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `install-hooks: <path> exists and is not a hook this tool wrote (or was edited since); left alone (--force replaces it).` | A hook is already there: another tool's, a hand-written one, or an edited copy of ours. With `core.hooksPath` set, `<path>` is in that folder | Keep the other hook and add a line to it that runs `node node_modules/@ummgames/dev/bin/umm-dev.mjs guard hook pre-commit` (and `guard hook commit-msg "$1"`). Use `--force` only to throw the old hook away |
| Hooks were installed but never run | `core.hooksPath` was set (or changed) after the install, so git looks in another folder | `git config --get core.hooksPath`; run `install-hooks` again, which writes where git now looks |
| `install-hooks: <path> is a link; left alone (--force replaces the link, not its target).` | The hook is a symlink | `--force` replaces the link with a file; the target is untouched |
| `install-hooks: not inside a git work tree; nothing to install.` | Run outside a repository | Run it from the checkout, or pass `--dir` |
| `pre-commit: @ummgames/dev is not installed here or in the main checkout; refusing blind.` | No install in the work tree or the main checkout | `pnpm install` (or `umm-dev worktree hydrate` for a worktree) |
| `pre-commit: node is not on PATH, so the guards cannot run. ...` | git runs hooks in a shell without Node | Put Node on the `PATH` that git's shell sees |
| `Cannot find package '@ummgames/dev' imported from .../umm-dev.config.mjs` on commit | A worktree outside the main checkout, not installed yet: the hook found the main checkout's package, but the worktree's config cannot import it | Hydrate the worktree (`umm-dev worktree hydrate`) |
| `umm-dev guard hook: the check failed: ...` on every commit | The rule table does not parse (often a JSON backslash: write `\\.` for a regex `\.`) | Fix the file; `umm-dev guard denylist --list-rules` shows when it parses |
| `guard denylist: no rules (set guard.denylist in umm-dev.config.mjs, or pass --rules).` on `guard denylist` | No rule table configured, and none passed | Set `guard.denylist`, or pass `--rules <file>`. A hook skips the check when `guard.denylist` is `null` or `false`. |
| `guard hook: unknown check "<name>" in guard.hooks.<hook>` | A check name the hook does not know | Use `'denylist'`, `'em-dash'` or `'claude-md'` |
| `em-dash --staged` passes a line with an em dash | The line was moved, a replay is in progress, the path is in `emDash.exclude`, or `diff.noprefix` or `diff.mnemonicPrefix` is set in git config (the check then reads no file names) | Run `guard em-dash <file>` to check the whole file. Unset those two git settings for the repository |
| `guard em-dash <file>` reports nothing for a file with a dash | git ignores that file, so it is not listed | Expected: ignored files are not checked |
| `CLAUDE.md: N lines, over its cap of M. Move a lesson down a level.` | The root grew past `rootMaxLines` | One in, one out: move a lesson to a nested CLAUDE.md, a file header or a test. Raise the cap only with a reason in the commit |
| `CLAUDE.md: dead link -> <target>` | A linked file moved or never existed | Fix the link. Links resolve from the CLAUDE.md's own folder |
| `BLOCKED: this would put content the denylist forbids into git history.` | A staged file breaks a rule | Unstage it (`git restore --staged <file>`), or, for a real exception, add an `allow` or `sizeAllow` entry with a reason |

## For agents

- **Never bypass a guard on your own.** No `git commit --no-verify`, no setting the table's
  `allowEnv` variable, unless the person you work for says so for that commit. Fix the cause.
- **An em-dash hit:** rewrite the line with a colon, a comma, parentheses or a new sentence. The
  same goes for a commit message.
- **A denylist hit:** unstage the file. Never add an `allow` or `sizeAllow` entry to get a commit
  through: each is a reviewed exception, with a reason a person agreed to.
- **A CLAUDE.md over its cap:** move a lesson down a level. Do not raise the cap to fit.
- **Exit 2 is not a pass.** The check did not run. Read the message.
- **Change which checks run in `guard.hooks`**, not by editing a hook file: an edited hook is no
  longer this package's, and `install-hooks` will refuse to update it.
- **Never `install-hooks --force` over a hook you did not write** without asking: it throws the
  other hook away.
- **Before a repository goes public**, run `umm-dev guard denylist --history`.
