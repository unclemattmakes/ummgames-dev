# Agent sessions

Tools for a game built by several coding sessions at once, each in its own git worktree. Reach
for them when two sessions might use the GPU at the same time, when a session needs a fresh
worktree that can run the tests, and when parallel branches keep conflicting in the same markdown
files. All three are **linked**: they run from `node_modules/@ummgames/dev` and ship nothing in
the game's build.

- `umm-dev gpu`: one GPU lease for the whole machine, shared by every repository on it.
- `umm-dev worktree`: hydrate a fresh worktree, and remove one without deleting what its links
  point at.
- `umm-dev merge`: resolve the markdown conflicts that parallel sessions make.

Settings are the game's `gpu` and `worktree` sections of `umm-dev.config.mjs`. The merge
resolvers take no config. The repo guards and git hooks are on [guard.md](guard.md).

## Quick start

**The GPU lease.** Nothing to set up. Wrap each command that needs the GPU:

```sh
pnpm exec umm-dev gpu run --name my-task --minutes 20 -- pnpm exec playwright test tests/e2e/look.spec.ts
```

When it works, the command's output sits between two lease lines, and the exit code is the
command's own:

```
GPU LEASE ACQUIRED by my-task at 2026-01-01 10:00:00 for ~20m.
...the command's output...
GPU LEASE RELEASED by my-task.
```

A second session that asks meanwhile prints, about once a minute,
`2026-01-01 10:02:00 waiting, place 1 in the queue: held by 'my-task' for 2m (asked 20m)`, and
starts as soon as the first hands the lease back. `pnpm exec umm-dev gpu status` shows the same
from anywhere.

**A worktree.** Say what a fresh worktree lacks, in `umm-dev.config.mjs`:

```js
import { defineConfig } from '@ummgames/dev'

export default defineConfig({
  worktree: {
    link: ['public/assets'],   // big, read-only: linked from the main checkout
    copy: ['.env'],            // must be a real file in the worktree
  },
})
```

Then, from the main checkout:

```sh
git worktree add .claude/worktrees/my-task -b my-task
pnpm exec umm-dev worktree hydrate .claude/worktrees/my-task   # ends "Hydration OK."
# ... work, commit, merge ...
pnpm exec umm-dev worktree remove my-task                      # ends "branch 'my-task' kept; ..."
```

**Merge drivers.** Name the files in `.gitattributes` (tracked), and define the drivers once per
clone (worktrees share the clone's config):

```gitattributes
docs/log.md     merge=umm-keep-both
docs/status.md  merge=umm-table
```

```sh
git config merge.umm-keep-both.name "umm-dev keep-both (markdown appends)"
git config merge.umm-keep-both.driver "node node_modules/@ummgames/dev/bin/umm-dev.mjs merge driver keep-both %O %A %B %L %P"
git config merge.umm-table.name "umm-dev resolve-table (markdown table rows)"
git config merge.umm-table.driver "node node_modules/@ummgames/dev/bin/umm-dev.mjs merge driver resolve-table %O %A %B %L %P"
```

When a merge reaches a conflict in one of those files, git prints
`umm-dev merge driver: docs/log.md: resolved by keep-both (1 block(s))` and the merge carries on
as if there had been no conflict.

## `umm-dev gpu`

```
umm-dev gpu run [<name> [<minutes>]] [options] -- <command...>
umm-dev gpu status [--json]
umm-dev gpu wait [--timeout <minutes>]
umm-dev gpu release <name> [--force]
```

Parallel sessions share one GPU. A headed browser run from one session lands inside another's
and contaminates it: perf readings go red, or green for the wrong reason; a frame capture lands
on a different tick; a game that measures itself drops a quality tier. Nothing in the stored
result says a peer had the machine. So every run that needs the GPU takes the lease, and the
lease is machine-wide: it covers sessions in other repositories too.

**Subcommands:**

- **`run`** files a ticket in the queue, waits its turn, takes the lease, runs the command, hands
  the lease back (on success, failure, Ctrl-C or a signal) and exits with the command's own code.
  Options and the two positionals go before `--`; everything after `--` is the command. It
  runs without a shell, so `&&`, pipes and globs reach it as plain arguments: wrap a pipeline in
  a package script.
- **`status`** prints the lease folder, who holds the lease, since when, how much of its booking
  it has used, and who waits. It sweeps dead tickets as it reads. It never takes or changes the
  lease.
- **`wait`** blocks until nobody holds the lease and nobody waits, printing the status once a
  minute. It does not take the lease, so a command run after it is unprotected.
- **`release`** removes a lease left behind under `<name>`: a run that died and left no
  watchdog, or an older script's `acquire`. It refuses a lease held under another name. **It does
  not check that the holder has stopped**: releasing a live run lets the next session in on top
  of it.

**Options:**

| Option | Value | Default | What it does |
|---|---|---|---|
| `--name` | text | `GPU_LEASE_NAME`, else the folder name of the checkout's root | `run`: who is asking. Also the first positional after `run` |
| `--minutes` | whole number, 1 or more | `gpu.defaultMinutes` (25) | `run`: the booking. Also the second positional |
| `--long` | flag | off | `run`: lift the `gpu.maxHoldMinutes` cap for this run. `GPU_LONG=1` does the same |
| `--wait-limit` | minutes | `gpu.waitLimitMinutes` (240) | `run`: give up after this long in the queue, exit 2 |
| `--json` | flag | off | `status`: print the state as JSON |
| `--timeout` | minutes | `gpu.waitLimitMinutes` (240) | `wait`: give up after this long, exit 2 |
| `--force` | flag | off | `release`: release whoever holds it, whatever the name |
| `--help`, `-h` | flag | | `umm-dev gpu --help` prints the usage |

An unknown option is a usage error (exit 64). The name and the booking:

- **Name.** `--name` or the first positional; else `GPU_LEASE_NAME`; else the folder name of the
  checkout's root (the nearest folder with a `package.json`), which in a worktree is the
  worktree's folder. Give each session its own name. A run that finds the lease already held
  under its own name by something that is not running (a dead run, an older script's `acquire`)
  takes it over at once, without queueing, as the older scripts did.
- **Booking.** Book for one run, hand it back, book again for the next: reading results and
  debugging happen without the GPU. A booking over `gpu.maxHoldMinutes` (45) is cut to it, with
  `GPU LEASE: 60m is over the 45m cap. Booking 45m.`, unless `--long` or `GPU_LONG=1`.
- **Past the booking.** A booking is a promise, not a timer. With `gpu.overrun: 'warn'` (the
  default) the holder prints `GPU LEASE: '<name>' is past its 20m booking. Finish and hand the GPU
  back; book again for the next run. It is stopped at 50m.`, the log records it, and waiters see
  `!! the holder is past its booking`. No waiter ever takes the lease from a live holder. The
  holder stops its own command instead, once it is `gpu.overrunGraceMinutes` (30) past the
  booking, and exits 124: a hung command, such as a capture stuck on one shot, would otherwise
  hold the GPU for as long as its process lives. With `gpu.overrun: 'kill'` the holder stops its
  command at the end of the booking.
- **Priority.** The command runs below normal CPU priority, so a person at the desk keeps the
  machine responsive. It changes who wins a contended core, not what the command does.
  `GPU_PRIORITY=normal` or `gpu.priority: 'normal'` opts out, for a measurement that must not
  yield.

**Environment:**

| Variable | Default | What it does |
|---|---|---|
| `GPU_LEASE_DIR` | `~/.umm-dev/gpu` | The lease folder. Set it machine-wide, never per session. On Windows an MSYS path (`/c/...`) is accepted |
| `GPU_LEASE_NAME` | unset | The session name when `--name` and the positional are absent |
| `GPU_LONG` | unset | `1` acts as `--long` |
| `GPU_PRIORITY` | unset | `normal` opts out of the lower priority; overrides `gpu.priority` |
| `GPU_POLL_SECONDS` | `3` | How often a waiter, and `wait`, look at the lease |
| `UMM_DEV_BASH` | Git's own bash | Windows only: the bash for the bridge (see "How it works"); `none` or `0` turns the bridge off |
| `UMM_DEV_GPU_MINUTE_MS` | `60000` | The length of a minute, for the kit's own tests. Never set it in a session |

**Exit codes:**

| Code | Subcommand | Meaning |
|---|---|---|
| the command's | `run` | The command ran; this is its exit code (on POSIX, 128 + the signal number if a signal ended it) |
| 0 | `status`, `wait`, `release` | Done; for `wait`, the lease is free with nobody waiting; for `release`, released or nothing was held |
| 1 | `release` | Refused: held under another name |
| 2 | `run`, `wait` | Gave up waiting (`--wait-limit`, `--timeout`). `run` did not run the command |
| 124 | `run` | Stopped for running past its booking: `gpu.overrunGraceMinutes` after it, or at its end with `gpu.overrun: 'kill'` |
| 127 | `run` | The command could not start. On Windows a missing command runs through `cmd.exe` and exits 1 instead |
| 130 | `run` | Interrupted (Ctrl-C, SIGTERM, SIGHUP) while waiting or running. The ticket or lease goes with it |
| 64 | any | Usage: a bad option, no `--`, minutes not a whole number, no name for `release` |

**Examples:**

```sh
pnpm exec umm-dev gpu run --name my-task --minutes 20 -- pnpm exec playwright test
pnpm exec umm-dev gpu run my-task 20 -- pnpm exec playwright test      # the same, positionally
pnpm exec umm-dev gpu run --name release-gate --minutes 90 --long -- pnpm test:e2e
pnpm exec umm-dev gpu status                  # who holds it, who waits
pnpm exec umm-dev gpu status --json           # the same, for a script
pnpm exec umm-dev gpu wait --timeout 30       # block until it is free (does not take it)
pnpm exec umm-dev gpu release my-task         # only after checking its run is gone
```

A `status` line reads `HELD by 'my-task' since 10:00:00 (12m of 20m)`, followed by one
`queue N: '<name>' (pid N) waiting Nm` line per waiter, or just `FREE`.

## `umm-dev worktree`

```
umm-dev worktree hydrate [<path>] [--main <path>] [--skip-install]
umm-dev worktree remove <name|path>... [--dry-run] [--force]
```

A fresh `git worktree add` lacks everything untracked: `node_modules`, `.env`, local asset
trees. Without them tests skip and the summary still reads green. And a hydrated worktree holds
links into the main checkout, which `rm -rf` and `git worktree remove --force` can follow.

**Subcommands:**

- **`hydrate [<path>]`** (default: the current directory) makes a worktree ready to run tests:
  1. runs `worktree.install` in it when `node_modules/.modules.yaml` is missing;
  2. links each `worktree.link` path to the main checkout's (a junction on Windows, a directory
     symlink elsewhere), leaving one already present alone;
  3. copies each `worktree.copy` path, links followed, leaving one already present alone (a link
     there is replaced by a copy);
  4. writes the env file: `envExample` when the worktree has no `envFile`, then any `envKeys`
     line from the main checkout's `envFile`, then any `envDefaults`;
  5. counts entries in each linked or copied path against the main checkout, because a link to
     a wrong target reads as empty rather than failing. A linked path must match exactly; a
     copied one must have at least as many;
  6. lists any link outside `node_modules` that points out of the worktree.

  It ends with `Hydration OK.` (exit 0) or `HYDRATION FAILED (N checks)` (exit 1). It refuses
  the main checkout itself and a folder that is not a git checkout (exit 64). If the worktree's
  own config cannot load yet (it imports a package not installed there), it says so and uses the
  main checkout's. A fresh worktree has no `umm-dev` of its own, so run `hydrate` from the main
  checkout and name the worktree's path.
- **`remove <name|path>...`** deletes worktrees without deleting what their links point at. For
  each one it:
  1. refuses the main checkout, a path git does not list as a worktree, a worktree that contains
     the main checkout or another registered worktree, and the worktree the current directory is
     in;
  2. without `--force`, refuses a tree with uncommitted changes (untracked files included,
     whatever `status.showUntrackedFiles` says), and a detached HEAD on a commit no branch or tag
     contains. **Ignored files are never checked**: they go with the folder;
  3. collects every link (symlink, junction, any reparse point) without descending into any, and
     counts the entries of every target outside the worktree;
  4. unlinks every link (the link only), checks none is left, and re-counts every outside
     target: one that changed aborts with nothing deleted;
  5. unlocks the worktree, deletes the folder, and prints the branch so it can be deleted if
     merged.

  After the last one it prunes git's worktree list. A folder already gone is only pruned.
  `<name>` is a folder name under `worktree.dir`. **Any other worktree takes an absolute path**:
  a relative path is also read under `worktree.dir`, not from the current directory.

**Options:**

| Option | Value | Default | What it does |
|---|---|---|---|
| `--main` | path | git's main checkout | `hydrate`: the checkout to link and copy from, and to count against |
| `--skip-install` | flag | off | `hydrate`: never run `worktree.install`; a missing `node_modules` then fails the hydration |
| `--dry-run` | flag | off | `remove`: list the links and their targets, change nothing, prune nothing |
| `--force` | flag | off | `remove`: also remove a tree with uncommitted changes, or a detached HEAD no ref contains. Both are lost. Every other refusal still applies |
| `--help`, `-h` | flag | | Print the usage |

**Exit codes:**

| Code | Meaning |
|---|---|
| 0 | `hydrate`: `Hydration OK.`; `remove`: every named worktree removed (or already gone), or the dry run listed |
| 1 | `hydrate`: `HYDRATION FAILED`; `remove`: at least one refused or aborted; either: git failed |
| 64 | Usage (no subcommand, no name for `remove`, an unknown option), or `hydrate` refused its path |

**Examples:**

```sh
pnpm exec umm-dev worktree hydrate .claude/worktrees/my-task
pnpm exec umm-dev worktree hydrate .claude/worktrees/my-task --skip-install   # links and copies only
pnpm exec umm-dev worktree remove my-task --dry-run                           # look first
pnpm exec umm-dev worktree remove my-task other-task
pnpm exec umm-dev worktree remove /abs/path/to/other-tree                     # outside worktree.dir
```

## `umm-dev merge`

```
umm-dev merge keep-both <file.md>...
umm-dev merge resolve-table <file.md>...
umm-dev merge driver <keep-both|resolve-table> %O %A %B [%L] [%P]
```

Two resolvers for the conflicts parallel sessions make in markdown, by hand during a merge or as
git merge drivers. Look at the conflict before you pick one:

- **`keep-both`**: both sides APPENDED blocks to the same file (a changelog, a findings log).
  Both belong. It keeps both, ours first, with a blank line where they meet on text: a `---`
  straight under a paragraph line is a setext heading underline, not a rule, and the previous
  entry would silently become a heading. It refuses anything but `.md` and `.markdown`: on code,
  keeping both sides drops the shared line between adjacent hunks. It checks afterwards that no
  marker is left and that nothing but markers (and a diff3 base section) went away.
- **`resolve-table`**: both sides rewrote rows of the same table, each changing a different
  subset. keep-both would duplicate every row, and that looks fine in a diff. It takes each row
  from the side that changed it against the merge base, keyed on the row's first cell. It
  refuses a row both sides changed differently, a non-row line inside the conflict, a repeated
  key, and sides holding different keys.
- **`driver`**: the same two, called by git (see "File formats" for the lines). git's own
  three-way merge (`git merge-file`) runs first; only a conflict reaches the resolver. A refusal
  leaves the ordinary conflict markers, labelled `ours` and `theirs`, and exits 1, so git reports
  a conflict for a person.

By hand, `resolve-table` reads the merge base from the index (stage 1), so run it during the
merge. Both rewrite the file in place and do not stage it: read the result, then `git add` it. A
refusal leaves the file as it was.

**Options:** none beyond `--help` (or `-h`). The driver's arguments are git's placeholders:

| Argument | Required | What it is |
|---|---|---|
| `%O` | yes | The merge base's version |
| `%A` | yes | Ours; the driver writes the result here |
| `%B` | yes | Theirs |
| `%L` | no | The conflict marker size (default 7) |
| `%P` | no, but pass it | The file's path. Without it the driver cannot tell markdown from code and resolves any file |

**Exit codes:**

| Code | Meaning |
|---|---|
| 0 | By hand: every named file resolved. Driver: merged cleanly or resolved |
| 1 | By hand: a file refused (that file is unchanged). Driver: conflict left for a person |
| 2 | Driver: `git merge-file` itself failed |
| 64 | Usage |

**Examples:**

```sh
pnpm exec umm-dev merge keep-both docs/log.md          # during a merge, on the conflicted file
pnpm exec umm-dev merge resolve-table docs/status.md   # base from the index (stage 1)
git add docs/log.md docs/status.md                     # after reading the result
```

## Config: `gpu`

```js
export default defineConfig({
  gpu: { defaultMinutes: 20, overrun: 'kill' },
})
```

| Key | Type | Default | What it does |
|---|---|---|---|
| `defaultMinutes` | number | `25` | Minutes `run` books when neither `--minutes` nor a second positional gives one |
| `maxHoldMinutes` | number | `45` | The most a booking may be; a larger one is cut to this unless `--long` or `GPU_LONG=1` |
| `waitLimitMinutes` | number | `240` | Minutes `run` waits in the queue before giving up (exit 2); also `wait`'s timeout |
| `staleGraceSeconds` | number | `10` | Seconds a dead holder must stay unchanged before the head of the queue reclaims its lock |
| `overrun` | `'warn'` or `'kill'` | `'warn'` | At the end of a booking: print and log it, or stop the command (exit 124) |
| `overrunGraceMinutes` | number | `30` | With `'warn'`: minutes past the booking at which a run still going is stopped anyway (exit 124). `0` acts as `'kill'` |
| `priority` | `'below'` or `'normal'` | `'below'` | Run the command below normal CPU priority, or leave it. `GPU_PRIORITY` overrides |

The type is `GpuConfig` in `src/agent/config.d.ts`. The config is read from the checkout that
runs `umm-dev gpu`.

**What config cannot change, and why:**

- **The lease folder.** Only `GPU_LEASE_DIR` moves it. A game's config belongs to one
  repository, and a lock chosen per repository excludes nobody outside it: two games' sessions
  would each hold "the" lock on the same GPU.
- **The session name.** Only `--name`, the positional or `GPU_LEASE_NAME` sets it. A name in
  config would give every session of the game the same name.
- **The poll interval and the bridge**: `GPU_POLL_SECONDS` and `UMM_DEV_BASH`, because they
  belong to the machine, not the game.
- **The fixed limits**: a ticket older than six hours is dead, and a lock folder with no holder
  file for a minute is a crashed writer. These are part of the lock format every user of the
  folder shares.

## Config: `worktree`

```js
export default defineConfig({
  worktree: {
    dir: '.claude/worktrees',
    install: 'pnpm install --frozen-lockfile',
    link: ['public/assets', 'node_modules/some-lib'],
    copy: ['node_modules/@fontsource', '.env'],
    allowEmpty: [],
    envFile: '.env',
    envExample: '.env.example',
    envKeys: ['API_URL'],
    envDefaults: { LOG_LEVEL: 'info' },
  },
})
```

| Key | Type | Default | What it does |
|---|---|---|---|
| `dir` | string | `'.claude/worktrees'` | Where `remove <name>` looks for `<name>`, from the main checkout |
| `install` | string or `false` | `'pnpm install --frozen-lockfile'` | Run in the worktree when `node_modules/.modules.yaml` is missing. Split on spaces, no shell, no quoting |
| `link` | string[] | `[]` | Directories linked from the main checkout. Link only what the worktree reads and never writes |
| `copy` | string[] | `[]` | Files or directories copied from the main checkout, links followed. One already present is left alone. `envFile` missing in the main checkout is not an error |
| `allowEmpty` | string[] | `[]` | `link` or `copy` paths that may be empty in the main checkout |
| `envFile` | string | `'.env'` | The env file the next three keys write, in the worktree |
| `envExample` | string or `null` | `null` | A file in the worktree, copied to `envFile` when the worktree has no `envFile` after the copy step |
| `envKeys` | string[] | `[]` | Keys whose whole line is copied from the main checkout's `envFile` when the worktree's lacks them. A key in neither fails the hydration |
| `envDefaults` | `{ KEY: 'value' }` | `{}` | Lines appended when the key is missing |

The type is `WorktreeConfig` in `src/agent/config.d.ts`. Paths are relative to the checkout's
root. Arrays replace the default; they are not merged with it.

- **`link` or `copy`.** A dev server refuses to serve a file whose real path is outside its root,
  so a linked package it serves answers 403. Copy what must be a real file; link what is big and
  only read.
- **`install`** looks for pnpm's marker: any other package manager never writes
  `node_modules/.modules.yaml`, so its install runs on every hydrate.
- **Env values are never printed.** The file never gains a BOM (a BOM on the first key makes it
  unreadable).

**What config cannot change:** the main checkout (git's, or `--main` for one run), and the
refusals and checks in `remove`. They are what makes removal safe.

## File formats

### The lease folder

`GPU_LEASE_DIR` if set, else `~/.umm-dev/gpu` (`os.homedir()`). One per machine.

```
<dir>/gpu.lock/          the lock: a folder, so mkdir is the atomic step; it exists while held
<dir>/gpu.lock/holder    who holds it
<dir>/gpu.queue/<n>-<p>  one ticket per waiter; names sort by when they were filed
<dir>/gpu-lease.log      one line per event, appended
```

**The holder file**, one value per line:

| Line | Holds |
|---|---|
| 1 | The session name |
| 2 | Epoch seconds when taken |
| 3 | Minutes booked |
| 4 | A pid a shell can check with `kill -0`: the bridge's MSYS pid on Windows, else (or with no bridge) the `umm-dev` process |
| 5 | `umm-dev/1 <node pid> <command pid, or - before it starts> <token>` |

Older scripts read lines 1 to 4 and write no line 5. The token is how a run knows the lease is
still its own when it releases.

**A ticket** is `gpu.queue/<16 digits of epoch microseconds>-<node pid>`, written to a dot-name
and renamed, holding the name, a shell-checkable pid, epoch seconds filed, and
`umm-dev/1 <node pid>`. Only names starting with a digit are tickets.

**The log** is one line per event, `YYYY-MM-DD HH:MM:SS <EVENT> ...` in local time:

| Event | When |
|---|---|
| `ACQUIRE <name> (asked for Nm)` | A run took the lease |
| `RELEASE <name> after Nm` | A run handed it back |
| `RELEASE <name> by hand` | `gpu release`; ` (forced)` with `--force` |
| `RUN <name> exited N` | A run's command finished |
| `RUN <name>: umm-dev died; killed its command tree and released` | The watchdog cleaned up |
| `OVERRUN <name>: ...` | A run passed its booking (warned, or killed) |
| `SWEEP stale ticket '<name>' (...)` | A dead ticket was removed |
| `RECLAIM stale lease of '<name>' (...)` | The head of the queue took over a dead holder's lock |
| `REFILE ticket '<name>' (...)` | A live waiter's ticket was swept by a reader that could not see its pid, and was filed again |

A `gpu.lock.stale-<pid>-<ms>` folder exists for a moment during a reclaim. One left behind is
named in a `RECLAIM raced` log line.

### The merge driver lines

`.gitattributes` (tracked) maps paths to drivers, and the clone's git config defines them (see
"Quick start"). A driver whose `.name` is set but whose `.driver` is not makes git stop with
`fatal: custom merge driver ... lacks command line`. git runs a driver from the work tree's
root, so the relative path finds the worktree's own install. A clone without the config lines
merges those files the ordinary way.

## How it works

### The queue and stale locks

- **Order.** Every waiter files a ticket, and only the oldest live ticket may take the lock, so
  the order is the order of asking. A ticket whose process is gone, or older than six hours, is
  swept by the next reader.
- **Stale.** A lock is stale only when every process its holder names is provably gone (the
  `umm-dev` process and the command it ran). The head of the queue then reclaims it, after
  `gpu.staleGraceSeconds` with the holder file unchanged, and logs `RECLAIM`. Nothing reclaims
  while nobody waits: the next `run` does it.
- **Never reclaimed.** A holder that names no process this machine can check (an older script's
  `acquire`, or a bash pid on Windows without the bridge) is left alone. A waiter says who holds
  it, and a person releases it with `umm-dev gpu release <name>`.

### A stopped session

Stopping a session often kills `umm-dev gpu run` outright, which runs no cleanup, and a command
tree outlives its parent. So `run` starts a small detached watchdog. If the `umm-dev` process
dies while its lease is still held, the watchdog kills the command's whole tree and releases the
lease. On POSIX the command is its own process group, and the group is killed. On Windows Node
puts a child in a job that dies with Node, but the child's own children (a browser, say) can
break away, so the watchdog asks Windows once for the live processes whose parent was the child
and kills each tree. It never kills by the child's pid alone: Windows reuses pids.

### Windows: pids and the bridge

Git Bash numbers its processes itself: `kill -0` in bash sees only MSYS pids, and Node sees only
Windows pids. So on Windows each lease user starts one small bash from Git's own install (found
through `git --exec-path`, not `PATH`, where `bash` may be WSL's). Its pid goes in the
shell-checkable fields, so every Git Bash on the machine sees the entry alive; it answers
`kill -0` questions about MSYS pids; and it exits when the Node process ends in any way.
Without a bridge, a bash ticket counts as live until it is six hours old. On Linux and macOS
there is one pid namespace and no bridge.

### Removing a worktree

`git worktree remove --force` and `rm -rf` FOLLOW a junction (and some tools follow a symlink)
and delete the TARGET's contents. Removing a hydrated worktree that way empties the main
checkout and breaks every worktree at once. `remove` unlinks first and proves every outside
target kept its entries before it deletes anything.

## Moving from older per-repository lease scripts

Some repositories still run their own bash lease script, which keeps its lock inside the
repository. This lease uses the same format, so the two exclude each other once they use the
same folder.

**What is shared:**

- The lock is `gpu.lock/`, taken with `mkdir` by both. Neither can take it while the other holds
  it.
- The holder file's first four lines are the same. Line 5 is this kit's marker, which older
  scripts never read.
- Tickets sort together: older scripts that name tickets in nanoseconds (19 digits) and this
  kit's microseconds (16 digits) are both decimal fractions of the same epoch second.
- The log is the same file, with the same `ACQUIRE` and `RELEASE` lines.

**The move, in order:**

1. **Pick the one folder**, normally this kit's default, and set `GPU_LEASE_DIR` to it for every
   session on the machine before anything else changes. On Windows a user environment variable
   reaches Git Bash and PowerShell alike: `setx GPU_LEASE_DIR "%USERPROFILE%\.umm-dev\gpu"`, then
   restart the sessions. Elsewhere, export it from the shell profile. A script that already
   honours `GPU_LEASE_DIR` now shares the lock.
2. **A script that does not honour `GPU_LEASE_DIR`** shares with nobody. Add the override (the
   lease folder is `$GPU_LEASE_DIR` when set, else the old path) to the lease script and any
   waiter-listing script, and land it on the main branch. Write the new file and rename it over
   the old one: bash reads a running script by byte offset, so editing it in place under a live
   waiter runs garbage.
3. **Old worktrees** each run their own tracked copy of the script, so one cut before step 2
   still locks inside the repository. Merge the main branch into it, or finish and remove it,
   before it next takes the lease. This is the one gap, and it closes as those worktrees go.
4. **Adopt this kit**, in any order across repositories: replace the script's
   `run <name> <minutes> -- <cmd>` with `pnpm exec umm-dev gpu run <name> <minutes> -- <cmd>`,
   the same argument shape.
5. **Delete the old scripts** once no worktree carries a copy. `GPU_LEASE_DIR` can then stay or
   go: unset, this kit uses the same default folder.

While both run, keep session names distinct between them (a shared name means "the same
session" to both), and remember that an old script's `acquire` blocks everyone until it is
released by name.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `waiting, place N in the queue: held by '<name>' for Nm (asked Nm)` repeats | Another session holds the lease and is alive | Wait. `umm-dev gpu status` shows who. Never delete the lock |
| The same, plus `!! the holder is past its booking. Do NOT steal it; tell whoever runs the fleet.` | The holder overran its booking (`gpu.overrun: 'warn'`) | Tell the person running the sessions. Nothing takes a lease from a live holder |
| `GPU LEASE: '<name>' is held by another live process; waiting like anyone else.`, then waiting on yourself | `gpu run` inside `gpu run` (a script that already wraps itself, wrapped again): the inner run waits for the outer, which waits for it | Never nest. Run the inner command directly; it already has the lease |
| `HELD by '<name>' ... (STALE: every process it named is gone)` | A run died and nothing cleaned up after it (a reboot, or its watchdog was killed too) | Nothing: the next `gpu run` reclaims it after `gpu.staleGraceSeconds` and logs `RECLAIM`. Do not delete the folder |
| `HELD by '<name>'`, no process to check, never reclaimed; or `(the holder's pid N cannot be checked from here)` | An older script's `acquire`, or a bash holder on Windows without the bridge | Check that its run is really gone, then `umm-dev gpu release <name>` |
| `(umm-dev process gone; its command pid N still runs)` | The runner was killed but the command lives on, and holds the lease until it ends | Let it end, or stop that process if you started it |
| A queue line `(pid N, pid not checkable here)` that never moves | A bash ticket on Windows with no bridge: it counts as live for six hours | Check Git for Windows is installed and `UMM_DEV_BASH` is not `none` |
| `GPU LEASE: gave up after N minutes. Tell whoever runs the fleet; do not run on the GPU.` (exit 2) | The wait limit passed | Do not run the command without the lease. Report it |
| `GPU LEASE: '<name>' no longer held the lease at the end (released by hand?).` | Someone ran `gpu release` during the run | Treat the run's GPU results as suspect, and run again |
| Old scripts and `umm-dev gpu` run at the same time | They use different lease folders | Set `GPU_LEASE_DIR` machine-wide (see "Moving from older per-repository lease scripts") |
| `Cannot find package '@ummgames/dev' imported from .../umm-dev.config.mjs` | A command ran in a fresh worktree outside the main checkout, before its install | Run `worktree hydrate` on it from the main checkout first |
| `REFUSING <name>: N uncommitted change(s). Commit them, or pass --force to discard.` | Work in the tree, untracked files included | Commit or move it. `--force` deletes it |
| `REFUSING <name>: its detached HEAD is on a commit no branch or tag contains. ...` | Commits made on a detached HEAD | `git branch <name>` inside it, then remove |
| `REFUSING <name>: the current directory is inside it. Run this from the main checkout.` | Run from inside the worktree | `cd` to the main checkout |
| `REFUSING: <path> is not a worktree git knows about.` | A typo, or a relative path (read under `worktree.dir`) | `git worktree list`; pass the folder name, or an absolute path |
| `REFUSING <name>: it contains N other checkout(s) git knows about:` | Another worktree is nested inside it | Remove the nested ones first |
| `delete failed (a dev server or editor still holding a file?): ...` | A process has a file open (common on Windows) | Stop it, then run `remove` again: the links are already gone |
| `ABORT: target <path> went A -> B entries` | Something changed a link target during the removal | Nothing was deleted. Find what wrote there, then run `remove` again |
| `HYDRATION FAILED`, a row ends `NOT HYDRATED` | A link points at the wrong place, or a copy came out short | Delete that path in the worktree and hydrate again |
| `! <path>: missing in the main checkout` | The main checkout lacks a `link` or `copy` path | Create it there, or take it out of the config |
| `! <KEY> is in neither .env: tools that need it will stop and say so` | An `envKeys` key is missing from both env files | Add it to the main checkout's env file |
| A conflicted file with ordinary markers, and no `umm-dev merge driver:` line | The driver did not fire: no `.gitattributes` line for that path, or no git config for that driver in this clone | `git check-attr merge -- <file>` must name the driver; `git config --get merge.umm-keep-both.driver` must print it. Then `git checkout -m -- <file>` redoes that file's merge |
| `fatal: custom merge driver umm-table lacks command line.` | `merge.<driver>.name` is set but `.driver` is not | Set the `.driver` line |
| A file git reports as conflicted that holds only our side, after `Cannot find module '.../node_modules/@ummgames/dev/bin/umm-dev.mjs'` | The driver could not start (no install in this worktree), and git kept ours | Install (or hydrate) the worktree, then `git checkout -m -- <file>` |
| `REFUSING <file>: no conflict markers found.` | Already resolved, or the driver ran | Read the file; nothing to do if it is right |
| `REFUSING <file>: no merge base in the index (run it during the merge).` | `resolve-table` by hand outside a merge | Run it while the merge is in progress |
| `row "<key>": BOTH sides changed it; resolve by hand` | Both sides edited the same row | Edit that conflict by hand |

## For agents

- **Wrap every command that uses the GPU** in
  `pnpm exec umm-dev gpu run --name <task> --minutes <n> -- <cmd>`: browser captures, perf runs,
  headed or GPU-backed e2e, anything that renders. Do not wrap unit tests, typechecks, lints or
  builds: they hold the GPU from sessions that need it.
- **One run per lease.** Book for that one command, then let it hand back. Read results and debug
  after it exits. Book again for the next run.
- **Never nest `gpu run`.** If a package script already wraps itself, call it unwrapped. A nested
  run waits on its own parent until the wait limit.
- **Name the session after the task**, the same name for every run of that task, and unique on
  the machine: the branch or worktree name is a good choice. Never reuse another session's name.
- **Check what holds the GPU** with `pnpm exec umm-dev gpu status` (or `--json`). `gpu wait` does
  not take the lease, so never run GPU work after `wait` without `gpu run`.
- **Never delete or edit anything in the lease folder by hand.** Not the lock, the holder, a
  ticket or the log. A stale lock is reclaimed by the next run. `gpu release <name>` is for your
  own name, only when its run is gone. Never `--force` another session's lease: ask a person.
- **Exit 2 means you do not have the GPU.** Do not run the command anyway; report it. Exit 124
  means the command was stopped at its booking: its output is partial.
- **Hydrate a new worktree** with `pnpm exec umm-dev worktree hydrate <path>` from the main
  checkout, and trust no test count until it printed `Hydration OK.`
- **Remove a worktree only with `pnpm exec umm-dev worktree remove <name>`**, run from the main
  checkout. Never `rm -rf`, `Remove-Item -Recurse` or `git worktree remove --force` on a
  worktree: they can follow its links and empty the main checkout.
- **`--force` on `remove` discards** uncommitted changes, untracked files and commits on a
  detached HEAD that no branch holds. Ignored files are always deleted. Run `--dry-run` and
  `git status` first, and use `--force` only when you are sure nothing there is needed.
- **Look at a markdown conflict before resolving it.** Appended blocks: `keep-both`. The same
  table rows: `resolve-table`. Never `keep-both` on a table or on code. After a by-hand resolve,
  read the file and `git add` it. A refusal means a person, or you, resolves it by hand.
