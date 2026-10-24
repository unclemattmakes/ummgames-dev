# Repo guards

`umm-dev guard` checks a game repository before a commit and in CI. Settings are the game's
`guard` section of `umm-dev.config.mjs`.

```sh
pnpm exec umm-dev guard em-dash                 # every file git lists
pnpm exec umm-dev guard em-dash docs src/ui     # these files or folders
pnpm exec umm-dev guard claude-md               # CLAUDE.md size budget and links
pnpm exec umm-dev guard denylist --tree         # the game's denylist over every tracked file
pnpm exec umm-dev guard install-hooks           # write the pre-commit and commit-msg hooks
```

Exit codes: 0 clean; 1 something found; 2 the check itself failed, or has nothing to check
against (a denylist with no rules).

## `guard em-dash`

No em-dash in anything newly written.

- `guard em-dash [<path>...]` checks every line of the named files or folders, or of every file
  git lists (tracked, plus untracked that are not ignored) when none is named. Binary files are
  skipped.
- `guard em-dash --staged` checks only the lines a commit ADDS. It lets through, on purpose:
  - a line MOVED unchanged (the same text removed elsewhere in the same commit), because a module
    split relocates old lines and the rule is about what is written, not what is carried;
  - a merge, cherry-pick, revert or rebase in progress, which replays commits written under their
    own rules;
  - paths in `guard.emDash.exclude`: generated trees, whose fix belongs in the tool that writes
    them.

  A tree that held many dashes when the rule arrived loses them line by line, because an edited
  line is an added line.
- `guard em-dash --message <file>` checks a commit message, minus its `#` lines.

```js
guard: { emDash: { exclude: ['src/generated/**', 'content/levels/*.json'] } }
```

## `guard claude-md`

The root CLAUDE.md is read in full by every session, so its size is a cost every session pays,
and it grows because lessons are appended and none ever leave. A cap turns growth into a
decision: raising it is an edit to the config with a reason in the commit, and the practice at the
cap is one in, one out (move a lesson down to a nested CLAUDE.md, a file header or a test).

It checks every CLAUDE.md git lists: the root against `rootMaxLines`, each nested one against
`nestedMaxLines`, that the root mentions `mustMention` (the page on how to keep it small) when
set, and that every relative link resolves, so a moved document cannot leave a dead pointer in
the file every session reads.

```js
guard: {
  claudeMd: { rootMaxLines: 200, nestedMaxLines: 100, mustMention: 'docs/claude-md.md', links: true },
}
```

`nestedMaxLines: null` leaves nested files uncapped.

## `guard denylist`

Keeps files a game must never commit out of git history. `.gitignore` is the first line of
defence; this is the second, because one `git add -f`, or an extension nobody anticipated,
defeats the first. History is forever, and a rewrite after the fact invalidates every clone, so
the check runs before the object exists (the hook) and again in CI.

```sh
umm-dev guard denylist --staged          # what is staged, with STAGED sizes (the hook)
umm-dev guard denylist --tree            # every tracked file (CI)
umm-dev guard denylist --history         # every blob on every ref (CI, before going public)
umm-dev guard denylist --files a.png b   # named paths, sized from disk; no git needed
umm-dev guard denylist --stdin           # paths on stdin, newline or NUL separated
umm-dev guard denylist --list-rules      # print the table
umm-dev guard denylist --rules other.json --max-bytes 1000000 --quiet
```

**This package ships no rules.** Each game writes its own table, inline or as JSON:

```js
guard: { denylist: 'tools/denylist.json' }   // a path from the game root, or the object itself
```

```js
{
  maxBytes: 262144,        // size ceiling for any file not size-allowed; unset: no size rule
  hardCeiling: 2097152,    // cap on size-allowed files (default 2 MiB)
  extensions: [{ group: 'mesh', why: 'meshes live in the bucket', ext: ['.glb', '.fbx'] }],
  prefixes: [{ prefix: 'public/assets/', why: 'built assets live in the bucket' }],
  segments: [{ segment: 'Some Vendor Pack', why: 'a bought pack copied in' }],  // whole folder names
  names: [{ pattern: '^\\.env(\\..+)?$', except: '^\\.env\\.example$', why: 'local secrets' }],
  allow: [{ glob: 'public/favicon.png', why: 'tiny, first-party, ships with the source' }],
  sizeAllow: [{ glob: 'docs/**/*.md', why: 'prose', max: 4194304 }],
  allowEnv: 'GAME_ALLOW_ASSETS',   // set it to let a --staged check print and pass; CI still runs
  advice: ['Built art goes to the bucket: pnpm assets:push'],
}
```

- Extensions, prefixes and segments match case-insensitively. Name patterns are regular
  expressions over the file name (strings in JSON, case-insensitive unless `flags` says
  otherwise; RegExp objects in a `.mjs` config).
- `allow` exempts a path from every rule; `sizeAllow` from the size rule only, and still capped.
  Globs take `*`, `?` and `**`. Every entry is a reviewed exception: give it a reason.
- In `--staged` mode sizes are the staged blob's, falling back to the file on disk, so "size
  unknown" never reads as "fine".

## `guard install-hooks`

Writes `pre-commit` and `commit-msg` into git's hooks directory
(`git rev-parse --git-path hooks`, which follows `core.hooksPath`), or into `--dir`. **Only when
someone runs it**: never from an install script, because a game installs this package from git
and pnpm would run it in every worktree.

- Each hook is a few lines of POSIX sh (Git Bash on Windows) that finds `@ummgames/dev` in the
  work tree's node_modules, or the main checkout's (a fresh worktree has none), and runs
  `umm-dev guard hook <name>`.
- It fails closed: no node, or no package, refuses the commit, because "cannot check" must never
  read as "nothing wrong".
- It will not overwrite a hook it did not write; `--force` does. Re-run it to rewrite its own.
- A hook is advisory (`git commit --no-verify` skips it), so CI should run the same checks.

Which checks each hook runs is config, so changing them never needs a reinstall. Every listed
check runs, so one commit reports them all:

```js
guard: {
  hooks: {
    'pre-commit': ['denylist', 'em-dash'],   // the default; 'claude-md' is also allowed
    'commit-msg': ['em-dash'],
  },
}
```

`denylist` is skipped when the game has no rules.
