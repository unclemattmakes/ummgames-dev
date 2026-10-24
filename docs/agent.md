# Agent sessions

Tools for a game built by several Claude Code sessions at once, each in its own git worktree:

- `umm-dev gpu`: one GPU lease for the whole machine.
- `umm-dev worktree`: hydrate a fresh worktree, and remove one safely.
- `umm-dev merge`: resolve the markdown conflicts parallel sessions make.

Each reads its settings from the game's `umm-dev.config.mjs` (sections `gpu` and `worktree`).

## `umm-dev gpu`

Parallel sessions share one GPU. A headed browser run from one session lands inside another's
and contaminates it: perf readings go red, or green for the wrong reason; a frame capture lands
on a different tick; a game that measures itself drops a quality tier. Nothing in the stored
result says a peer had the box. So any run that needs the GPU takes the lease.

```sh
pnpm exec umm-dev gpu run my-session 20 -- pnpm e2e tests/e2e/look.spec.ts
pnpm exec umm-dev gpu run --name my-session --minutes 20 -- pnpm e2e   # the same, with flags
pnpm exec umm-dev gpu status            # who holds it, for how long, who waits
pnpm exec umm-dev gpu wait              # block until nobody holds it and nobody waits
pnpm exec umm-dev gpu release my-session  # hand back a lease left behind under that name
```

**`run`** queues, takes the lease, runs the command, hands the lease back (always: on failure, on
Ctrl-C, on a signal) and exits with the command's own code.

- **Name.** `--name` or the first word after `run`; else `GPU_LEASE_NAME`; else the checkout's
  folder name. Give each session its own name: a waiter that finds the lease already held under
  its own name by something that is not running (an old script's `acquire`, a dead run) takes it
  over, as the older scripts did.
- **Booking.** `--minutes` or the second word, whole minutes, default `gpu.defaultMinutes` (25).
  Book for one run, hand it back, book again for the next: reading results and debugging happen
  without the GPU.
- **Max hold.** A booking is capped at `gpu.maxHoldMinutes` (45). `--long` or `GPU_LONG=1` lifts
  the cap for one genuinely long run (a full e2e suite, a release gate, a baseline).
- **Past the booking.** A booking is a promise, not a timer. With `gpu.overrun: 'warn'` (the
  default) the holder is told and the log says so; waiters say "past its booking" and keep
  waiting. Nothing ever takes the lease from a live holder. With `gpu.overrun: 'kill'` the holder
  stops its own command at the end of the booking and exits 124.
- **Priority.** The command runs below normal priority, so a person at the desk keeps the CPU.
  It changes who wins a contended core, not what the command does. `GPU_PRIORITY=normal` or
  `gpu.priority: 'normal'` opts out, for a measurement that must not yield.
- **Wait limit.** A waiter gives up after `gpu.waitLimitMinutes` (240) or `--wait-limit`, exit 2.

Exit codes: the command's own; 2 gave up waiting; 124 stopped at the end of its booking; 127 the
command would not start; 130 interrupted; 64 usage.

### Where the lock lives

`GPU_LEASE_DIR` if set, else `~/.umm-dev/gpu` (the user's home directory from Node's
`os.homedir()`). **Never per repository**: a lock inside each repository excludes nobody outside
it, so two games' sessions would each hold "the" lock on the same GPU. A game's config cannot
move it, for the same reason.

```
<dir>/gpu.lock/          the lock: mkdir is the atomic step; it exists while held
<dir>/gpu.lock/holder    who holds it
<dir>/gpu.queue/<n>-<p>  one ticket per waiter; names sort by when they were filed
<dir>/gpu-lease.log      ACQUIRE, RELEASE, SWEEP, RECLAIM, REFILE, OVERRUN and RUN lines
```

### The queue, stale locks and stopped sessions

- **Order.** Every waiter files a ticket, and only the oldest live ticket may take the lock, so
  the order is the order of asking. A ticket whose process is gone, or older than six hours, is
  swept by the next reader.
- **A stopped session.** Stopping a session often kills `umm-dev gpu run` outright, which runs no
  cleanup, and a command tree outlives its parent. So `run` starts a small detached watchdog: if
  the `umm-dev` process dies while its lease is still held, the watchdog kills the command's
  whole tree and releases the lease. On Windows that takes finding the tree: Node puts a child in
  a job that dies with Node, but lets the child's own children (a browser, say) break away, so the
  watchdog asks Windows once for the live processes whose parent was the child and kills each
  tree. It never kills by the child's pid alone: Windows reuses pids, so a process holding it
  that started after the command did is left alone.
- **Stale.** A lock is stale only when every process its holder names is provably gone (the
  `umm-dev` process and the command it ran). The head of the queue then reclaims it, after
  `gpu.staleGraceSeconds` (10) with nothing changing, and logs `RECLAIM`. A holder that names no
  process this machine can check (an older script's `acquire`) is never reclaimed: a waiter says
  who holds it, and a person releases it with `umm-dev gpu release <name>`.

### Sharing a lock with older scripts

During a move to this kit some repositories still run their own bash `gpu.sh` lease (a lock dir,
a holder file and a ticket queue in the repository's `tools/agent/`). This lease uses the same
format, so the two exclude each other once they use the same directory.

**What is shared, exactly.**

- The lock is `gpu.lock/`, taken with `mkdir` by both. Neither can take it while the other holds
  it.
- The holder file starts with the same lines: name, epoch seconds taken, minutes booked, and a
  pid a shell can check. Line 5 is this kit's marker (`umm-dev/1 <node pid> <child pid> <token>`),
  which older scripts never read.
- A ticket is `gpu.queue/<16 digits of microseconds>-<pid>` holding name, pid and epoch seconds,
  written to a dot-name and renamed, then the same marker. Older scripts that name tickets in
  nanoseconds (19 digits) sort correctly against these: both are decimal fractions of the same
  epoch second.
- The log is the same file, with the same `ACQUIRE` and `RELEASE` lines.

**The pid problem on Windows, and the bridge.** Git Bash numbers its processes itself: `kill -0`
in bash sees only MSYS pids, and Node sees only Windows pids. Left alone, an older script would
sweep this kit's tickets as dead (and jump the queue), and this kit could not tell whether a bash
ticket lives. So on Windows each lease user starts one small bash from Git's own install (found
through `git --exec-path`, not PATH, where `bash` may be WSL's). Its `$$` goes in the pid fields,
so every Git Bash on the machine sees it alive; it answers `kill -0` questions about MSYS pids;
and it exits when the Node process ends in any way, so its pid dies with its owner.
`UMM_DEV_BASH` names a different bash, or `none` to turn the bridge off. Without a bridge, this
kit treats a bash ticket as live until it is six hours old, and refiles its own ticket under the
same name if a script sweeps it (it can lose its place in that case). On Linux and macOS there is
one pid namespace and no bridge is needed.

**What each fleet must set or change, in order.**

1. **Pick the one directory**, normally this kit's default, and set `GPU_LEASE_DIR` to it for
   every session on the machine, before anything else changes. On Windows, a user environment
   variable reaches Git Bash and PowerShell sessions alike (Git Bash converts the path for bash):
   `setx GPU_LEASE_DIR "%USERPROFILE%\.umm-dev\gpu"`, then restart the sessions. Elsewhere,
   export it from the shell profile. A script that already honours `GPU_LEASE_DIR` now shares the
   lock with this kit and with every other such script.
2. **A script that does not honour `GPU_LEASE_DIR`** resolves its lock inside its own repository
   and shares with nobody. Add the override to it (the lease dir is `$GPU_LEASE_DIR` when set,
   else the old per-repository path), in both the lease script and any waiter-listing script, and
   land it on the main branch. Write the new file and rename it over the old one: bash reads a
   running script by byte offset, so editing it in place under a live waiter runs garbage.
3. **Old worktrees.** Each worktree runs its own tracked copy of the script, so a worktree cut
   before step 2 still holds the per-repository lock. Merge the main branch into it, or finish
   and remove it, before it next takes the lease. Until then it excludes only other old copies in
   the same repository: this is the one gap, and it closes as those worktrees go.
4. **Adopt this kit** (any order across games): replace `bash tools/agent/gpu.sh run <name> <min>
   -- <cmd>` with `pnpm exec umm-dev gpu run <name> <min> -- <cmd>`, the same argument shape.
5. **Delete the old scripts** once no worktree carries a copy. `GPU_LEASE_DIR` can then stay or
   go: unset, this kit uses the same default directory.

Two cautions while both run: a session name used by both an old script and this kit means "the
same session" to both, so keep names distinct; and an old script's `acquire` (no run, no pid)
blocks everyone until it is released by name.

## `umm-dev worktree`

A fresh `git worktree add` lacks everything untracked: node_modules, `.env`, local asset trees.
Without them tests skip and the summary still reads green.

```sh
# from the main checkout (a fresh worktree has no node_modules of its own yet)
pnpm exec umm-dev worktree hydrate .claude/worktrees/my-branch
pnpm exec umm-dev worktree remove my-branch          # a folder under worktree.dir, or a path
pnpm exec umm-dev worktree remove my-branch --dry-run
```

**`hydrate [<path>]`** (default: the current directory) runs the install, makes the links and
copies, writes the env keys, then counts entries in each linked or copied path against the main
checkout, because a link to a wrong target reads as empty rather than failing. It ends with
`Hydration OK.` (exit 0) or `HYDRATION FAILED` (exit 1); do not trust a test count from a tree
that did not end OK. It refuses the main checkout itself. `--main <path>` names the checkout to
hydrate from (default: git's main checkout); `--skip-install` skips the install step. If the
worktree's own config cannot load yet (it imports a package not installed there), the main
checkout's is used.

**`remove <name|path>...`** exists because `git worktree remove --force` and `rm -rf` FOLLOW a
junction (and some tools follow a symlink) and delete the TARGET's contents: removing a hydrated
worktree that way empties the main checkout and breaks every worktree at once. It:

1. refuses the main checkout, a path git does not list as a worktree, the worktree the current
   directory is in, and a worktree that contains the main checkout or another registered
   worktree (deleting it would delete that one too);
2. without `--force`, refuses a tree with uncommitted changes, untracked files included (whatever
   `status.showUntrackedFiles` says), and a detached HEAD on a commit no branch or tag contains,
   which would otherwise be left dangling. **Ignored files are never checked**: they are deleted
   with the folder, so keep nothing in a worktree's ignored paths that exists nowhere else;
3. collects every link (symlink, junction, any reparse point) without descending into any, and
   counts the entries of every target outside the worktree;
4. unlinks them (the link only), checks none is left, and re-counts every outside target: one
   that changed aborts with nothing deleted;
5. unlocks the worktree, deletes the folder, prunes git's list, and prints the branch so it can
   be deleted if merged.

`--dry-run` lists the links and targets and changes nothing, git's worktree list included (no
prune).

### Config: `worktree`

```js
export default defineConfig({
  worktree: {
    dir: '.claude/worktrees',           // where `remove <name>` looks, from the main checkout
    install: 'pnpm install --frozen-lockfile',  // or false; run when node_modules is missing
    link: ['public', 'node_modules/some-lib'],  // directories linked from the main checkout
    copy: ['node_modules/@fontsource', '.env'], // files or directories copied, links followed
    allowEmpty: [],                     // link/copy paths that may be empty in the main checkout
    envFile: '.env',
    envExample: null,                   // e.g. '.env.example': copied when neither tree has envFile
    envKeys: [],                        // keys carried from the main checkout's envFile when missing
    envDefaults: {},                    // { KEY: 'value' } written when the key is missing
  },
})
```

- `link` makes a junction on Windows (no admin rights needed) and a directory symlink elsewhere.
  Link only directories that are read, never written, by the worktree.
- `copy` is for what must be real files: a dev server refuses to serve a file whose real path is
  outside its root, so a linked package it serves answers 403. Copies follow links and never
  overwrite something already present.
- Env values are never printed, and the file is written without a BOM (a BOM on the first key
  makes it unreadable).

## `umm-dev merge`

Two resolvers for the conflicts parallel sessions make in markdown, by hand during a merge or as
git merge drivers. Look before you run one:

- **keep-both**: both sides APPENDED blocks to the same file (a changelog, a findings log). Both
  belong. Keeps both, ours first, with a blank line where they meet on text: a `---` straight
  under a paragraph line is a setext heading underline, not a rule, and the previous entry would
  silently become a heading. Refuses anything but markdown: on code, keeping both sides drops the
  shared line between adjacent hunks (the `}` that closes ours and opens theirs is emitted once).
  Checks afterwards that no marker is left and nothing but markers went away.
- **resolve-table**: both sides rewrote rows of the same table, each changing a different subset.
  keep-both would duplicate every row, and that looks fine in a diff. Takes each row from the side
  that changed it against the merge base, keyed on the row's first cell. Refuses a row both sides
  changed, a non-row line inside the conflict, a repeated key, and sides holding different keys.

```sh
pnpm exec umm-dev merge keep-both docs/log.md          # during a merge, on the conflicted file
pnpm exec umm-dev merge resolve-table docs/status.md   # base from the index (stage 1)
```

By hand, a refusal leaves the file as it was and exits 1.

### As a merge driver

`.gitattributes` (tracked) names which files use which driver:

```gitattributes
docs/log.md     merge=umm-keep-both
docs/status.md  merge=umm-table
```

git config (once per clone; worktrees share it) defines the drivers:

```sh
git config merge.umm-keep-both.name "umm-dev keep-both (markdown appends)"
git config merge.umm-keep-both.driver "node node_modules/@ummgames/dev/bin/umm-dev.mjs merge driver keep-both %O %A %B %L %P"
git config merge.umm-table.name "umm-dev resolve-table (markdown table rows)"
git config merge.umm-table.driver "node node_modules/@ummgames/dev/bin/umm-dev.mjs merge driver resolve-table %O %A %B %L %P"
```

git runs a driver from the work tree's root, so the relative path finds the worktree's own
install. The driver runs git's ordinary three-way merge first (`git merge-file`); only a conflict
reaches the resolver. If the resolver refuses, the driver writes the ordinary conflict markers and
exits 1, so git reports a conflict for a person. A clone without the config lines merges those
files the ordinary way.
