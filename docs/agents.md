# For AI agents working in a game that uses the kit

This page is for coding agents, and for the people who brief them. It says how to use the kit
without breaking it or the game. Each area page ends with its own "For agents" section with the
details. This page is the short version, plus a block to paste into the game's `CLAUDE.md`.

## Paste this into the game's CLAUDE.md

Before pasting, set the first line of the block's list to this game's package manager. Leave it
as it is for pnpm, or change the run line to `npx umm-dev` for npm.

**Keep every `@` in the block inside backticks.** Claude Code reads `@path` in a CLAUDE.md as an
instruction to import that file, and skips only what sits in a code span or a code block. The
block below is written that way; keep it so if you edit it.

```md
## The shared kit (`@ummgames/dev`)

Dev tools come from `@ummgames/dev`, pinned to a tag in package.json. Runtime code that ships in
the game is copied from the kit's `runtime/` with `umm-dev copy`, and `umm-dev drift` says how far
each copy has moved. Docs: `node_modules/@ummgames/dev/docs/README.md`.

- Run the kit with this game's package manager: `pnpm exec umm-dev <command>`. Never run pnpm in
  an npm game, or npm in a pnpm game: it rewrites node_modules. Below, `umm-dev` means that.
- Never edit anything under `node_modules/@ummgames/dev`. Kit bugs go upstream, to
  github.com/unclemattmakes/ummgames-dev, not into a local patch.
- Settings live in umm-dev.config.mjs at the root. Run `umm-dev <command> --help` before guessing
  an option.
- A file whose line 1 says "Copied from ummgames-dev" is a runtime copy. Edit its body freely.
  Never edit or delete line 1. Run `umm-dev drift` after editing one.
- Take a runtime file one at a time: `umm-dev copy <runtime path> --to <where this game keeps it>`.
  Run with --dry-run first. Never leave two copies of the same file in the tree.
- Taking over a file the game already has (dry run says "refused ... not a copy") is a
  deliberate replace, not a bypass. First diff the two files:
  `git diff --no-index <game file> node_modules/@ummgames/dev/runtime/<path>`. Then pass --force,
  and carry the game-only parts (extra exports, constants) back into the copy. Then run drift.
- Wrap GPU work (browser captures, perf runs, headed e2e) in
  `umm-dev gpu run --name <task> -- <cmd>`, one lease per run, never nested. `umm-dev gpu status`
  shows who holds the GPU. Never delete lease files by hand, and never set GPU_LEASE_DIR: the lease
  folder belongs to the machine.
- Never bypass a check to get green: no --no-verify, no new denylist allow entry, no weakened
  capture `expect`. Fix the cause, or stop and ask.
- Remove worktrees with `umm-dev worktree remove <name>`, never with rm -rf. It refuses when work
  would be lost; read why before passing --force.
- Moving to a newer kit tag is its own change: read the kit's CHANGELOG.md, bump the tag, then run
  `umm-dev drift` and follow docs/upgrading.md.
```

## Why each rule exists

| Rule | What goes wrong without it |
|---|---|
| Use the game's own package manager | Running pnpm in an npm game installs before it runs anything. It moves npm's packages into `node_modules/.ignored`, writes `pnpm-lock.yaml` and `pnpm-workspace.yaml`, and can then fail before the command runs. Recover by deleting those two files and `node_modules`, then `npm ci`. |
| Never edit `node_modules/@ummgames/dev` | The next install erases the change silently. Every other game keeps the bug. |
| Diff before taking over a file | `--force` replaces the whole file. Anything only the game had (an extra export, a tuned constant) is gone unless you carry it back. |
| Never set `GPU_LEASE_DIR` | The lease only works if every session on the machine uses the same folder. A session with its own folder sees the GPU as free while another holds it. |
| Check `--help` before guessing | Every command rejects an unknown option with a usage error, and `cut` also rejects unknown edit-list keys. A guessed flag costs a round trip. |
| Never touch line 1 of a copy | `drift` finds copies by that header, and hashes everything after it. Without the header, the file is no longer a copy: drift cannot see it, and `copy` will refuse to update it. |
| One file at a time, with `--to` | Without `--to`, a file lands at the default path. The game's own version stays where it was, so two adapters exist and only one is used. |
| Wrap GPU work in `gpu run` | Two sessions measuring the GPU at once both get wrong numbers, and a capture can drop frames. The lease is machine-wide, so it also covers sessions in other repos. A `gpu run` inside another one waits on itself until its wait limit. |
| Never bypass a check | The checks exist because something shipped broken once. A bypass hides the problem from the next session too, and CI runs the same check anyway. |
| `worktree remove`, never `rm -rf` | A worktree can hold junctions into the main checkout (`node_modules`, `public`). A recursive delete can follow them. `remove` unlinks them first, and refuses when uncommitted work, an unreachable commit or a nested worktree would be lost. |
| A tag bump is its own change | Runtime copies do not follow the tag by themselves, so a bump also needs a drift pass. Mixing it into feature work hides both. |

## Gotchas that catch agents

- **Page hooks run in the browser, not in the config file.** `capture.ready`, `prep`, `hide` and
  friends are serialised into the game's page. They cannot use a variable or an import from
  `umm-dev.config.mjs`; the error is `<name> is not defined`. Pass what they need through the
  shot's fields or the debug global.
- **CLI paths and config paths differ.** A path given on the command line is relative to the
  working directory. A path in `umm-dev.config.mjs` is relative to the game root.
- **Usage errors exit 2 in most commands, 64 in `gpu`, `worktree` and `merge`.** Read the
  command's own exit-code table before scripting around it. For `gpu run`, 2 means you never got
  the GPU.
- **A failed build can leave complete output on disk.** Never ship or measure a `dist*/` folder
  from a run that exited non-zero.
- **`umm-dev.config.mjs` is typed, but only an editor checks it unless the game's tsconfig says
  otherwise.** With `// @ts-check` at the top, an editor flags a misspelt section or key ("Did you
  mean to write 'capture'?"). `tsc` checks it too only when the tsconfig has `"allowJs": true`, and
  lists `umm-dev.config.mjs` in `include`. Without those, `tsc` passes a broken config.
- **Playwright empties `test-results/`.** That is also capture's default output. Footage made
  there is gone after the next e2e run, unless `capture.out` points somewhere else.

## Checking your own work

- After changing config: run the command it configures, with `--help` first, and then for real.
  Validators run without side effects: `cut --check`, `store --steps preflight`, `copy --dry-run`,
  `worktree remove --dry-run`.
- After touching a runtime copy: `umm-dev drift`. Expect `changed here` for the files you edited,
  and `current` for the rest.
- Before finishing a branch that touched the kit's area: the game's full check, plus
  `umm-dev drift --strict` if the game runs it in CI.
- Media output (`test-results/`, `dist-store/`) is generated. It is safe to delete and re-make,
  and should not be committed unless the game says so. Check it by exit code, by the `wrote` and
  `ok` lines it prints, and by looking at the images it made.

## Reporting a kit bug

Write down:
- the command;
- the kit version (from package.json);
- the exact message;
- the smallest config that shows it.

Open an issue, or tell the person you are working for. Do not work around it in the game by
copying the kit's code in: that brings back the drift the kit exists to end.
