# Adopting the kit in a game that has its own copies

**Use this page when a game already carries its own versions of these tools:** a trailer
script, a perf HUD, a GPU lease script, configs copied from another game. The aim is to
end with one copy of each tool, the kit's, and no lost local changes.

For a game that has none of them, [getting-started.md](getting-started.md) is shorter.

## The rule that changes

Many games carry a rule like "copy code between repos, never link it". Adopting the kit replaces
it with two rules:

- **Dev tools are linked.** Commands, Vite plugins, test helpers and config presets come from
  `@ummgames/dev`, pinned to a tag. Nobody edits them in the game.
- **Runtime code is copied, from one place only.** Code that ships in the game's bundle comes from
  this repo's `runtime/` through `umm-dev copy`. `umm-dev drift` reports how far each copy has
  moved.

Put the new rule in the game's `CLAUDE.md`, or its contributor notes, before anything else. The
paste-ready block is in [agents.md](agents.md).

## Order of work

Each step is a separate commit that leaves the game working. **Do them on a branch, and run the
game's full check after each one.**

### 1. Install and add the config file

```sh
pnpm add -D github:unclemattmakes/ummgames-dev#v0.2.2
```

Then create `umm-dev.config.mjs`: [getting-started.md, step 2](getting-started.md#2-add-the-config-file).

### 2. Presets

Swap each config for its preset, keeping only the game's own paths, aliases and port
([presets.md](presets.md)). Run the linter and the typechecker, and fix what the stricter
settings find.

**Before:** if the game's `biome.json` carries rule overrides, keep them. Biome merges the game's
overrides over the preset one key at a time.

### 3. Linked tools: delete the game's copies

For each tool, there are three steps:
1. Configure the kit's version in `umm-dev.config.mjs`.
2. Point the game's `package.json` scripts at it.
3. Delete the game's copy.

| The game has its own | Replace with | Config section |
|---|---|---|
| Capture, trailer or store scripts | `umm-dev capture`, `cut`, `store`, `loop` | `capture`, `store`, `loop` ([media.md](media.md)) |
| `_headers`, 404, licences or icon plugins | `headers`, `notFoundPage`, `licences`, `appIcon` | plugin options ([build.md](build.md)) |
| A GPU lease script | `umm-dev gpu run` | `gpu` ([agent.md](agent.md)) |
| Worktree setup and removal scripts | `umm-dev worktree hydrate` / `remove` | `worktree` ([agent.md](agent.md)) |
| Markdown merge resolvers | `umm-dev merge driver` | `.gitattributes` ([agent.md](agent.md)) |
| Hooks: em-dash checks, size budgets, denylists | `umm-dev guard` | `guard` ([guard.md](guard.md)) |
| A loudness meter | `umm-dev loudness`, or `@ummgames/dev/audio` | `loudness` ([audio.md](audio.md)) |

**Keep the game's data.** Shot lists, edit lists, store recipes, cover templates and denylist
rules are the game's. The kit reads them; it never ships its own.

**Watch for renamed outputs.** For example, store icons are named `icon-<w>x<h>.png`. Update
anything that read the old names, including any skill or checklist that names files.

### 4. Runtime code: re-take each file over the game's own

The game's existing files are not stamped copies yet. That is why `umm-dev copy` refuses to
overwrite them unless each one is named. **Take them one file at a time, with `--to` naming
where the game keeps it:**

```sh
pnpm exec umm-dev copy runtime/boot/dev-splash.ts --to src/boot/splash.ts --force
pnpm exec umm-dev copy runtime/dev/perf-hud.ts --force    # already at the default, src/dev/
```

- **`--to` is not optional when the game keeps a file somewhere other than the default.** The
  default is `<runtime.into>/<path under runtime/>`, with `runtime.into` defaulting to `src`.
  Without `--to`, the file lands at a new path and the game's old one stays: two copies, and only
  one of them used. Run with `--dry-run` first to see the destination.
- **A folder copy (`copy runtime/dev`) never overwrites the game's own files.** It lists them as
  refused, so a game-specific file in the same folder, such as a palette with the game's tool
  list, is never replaced by accident.
- **Re-apply the game's own changes after each copy.** The kit's version may have a slightly
  different API (an options object where there was an import). Each runtime page lists the API.
- **Then run `umm-dev drift`.** Every file you took reads `current`. Once you re-apply a local
  change, it reads `changed here`. That is expected and fine: drift is information.

### 5. Check

- The game's full check passes.
- The site build builds, and its e2e specs pass.
- `umm-dev drift --strict` exits 0, or reports only the copies you deliberately changed.

## Things that commonly go wrong

| Symptom | Cause | Fix |
|---|---|---|
| A second `splash.ts` appeared as `src/boot/dev-splash.ts` | `copy` without `--to` | Delete the new one, then re-run with `--to <the game's path> --force` |
| `copy runtime/dev` printed `refused` for several files | Those are the game's own files, not stamped copies | Copy each one by name with `--force`, or leave it if it is game-specific |
| `guard install-hooks` refuses to write | `core.hooksPath` points at the game's own hooks folder | `git config --unset core.hooksPath`, remove the old installer script, then re-run |
| Biome reports "nested root configuration" | A second `biome.json` somewhere under the root | Give the nested file `"root": false` (and `"extends": "//"` to inherit the game's), or delete it |
| Old lease scripts and `umm-dev gpu` do not see each other | The old scripts lock inside the repo | Set `GPU_LEASE_DIR` machine-wide first ([agent.md](agent.md), moving from older scripts) |

More in [troubleshooting.md](troubleshooting.md).
