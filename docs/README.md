# Docs

## Start here

| You want to | Read |
|---|---|
| Add the kit to a new game | [getting-started.md](getting-started.md) |
| Replace a game's own copies of these tools | [adopting.md](adopting.md) |
| Move a game to a newer version | [upgrading.md](upgrading.md) |
| Brief an AI agent working in a game | [agents.md](agents.md), with a block to paste into the game's `CLAUDE.md` |
| Fix an error | [troubleshooting.md](troubleshooting.md) |
| Know what is broken right now, and how to work around it | [known-issues.md](known-issues.md) |
| Change the kit itself | [maintaining.md](maintaining.md), and the repo's [CLAUDE.md](https://github.com/unclemattmakes/ummgames-dev/blob/main/CLAUDE.md) |

## By area

| Area | Page | Linked or copied |
|---|---|---|
| Capture, trailers, store art, site loops | [media.md](media.md) | linked: `umm-dev capture`, `cut`, `store`, `loop`; `@ummgames/dev/media` |
| Headers, 404, licences, app icon | [build.md](build.md) | linked: `@ummgames/dev/vite`, `@ummgames/dev/testing` |
| GPU lease, worktrees, merge drivers | [agent.md](agent.md) | linked: `umm-dev gpu`, `worktree`, `merge` |
| Repo guards and git hooks | [guard.md](guard.md) | linked: `umm-dev guard` |
| Runtime copies and drift; the dev palette, splash, pad profiles, music sequencer core | [runtime.md](runtime.md) | copied: `umm-dev copy`, `drift`; `runtime/` |
| Biome, TypeScript, Vitest, Playwright | [presets.md](presets.md) | linked: `@ummgames/dev/biome`, `/tsconfig`, `/vitest`, `/playwright` |
| Loudness | [audio.md](audio.md) | linked: `umm-dev loudness`; `@ummgames/dev/audio` |
| GLB optimizing, meshopt decoding | [gltf.md](gltf.md) | linked: `umm-dev gltf`; `@ummgames/dev/gltf` |

**Linked** code runs from `node_modules` and never ships in a game's build; nobody edits it in the
game. **Copied** code ships inside the game, so it is copied in with a header and owned by the
game from then on.

## How every area page is laid out

The same order everywhere, so a reader can jump straight to the part they need:
1. what it is for;
2. Quick start;
3. one section per command or export, with an options table;
4. a Config table per section of `umm-dev.config.mjs`;
5. file formats;
6. how it works;
7. Troubleshooting;
8. For agents.

## Reading order for an agent new to a game

1. The game's `CLAUDE.md`, for the block from [agents.md](agents.md).
2. The game's `umm-dev.config.mjs`, for what is configured.
3. `pnpm exec umm-dev <command> --help`, for the command it is about to run.
4. The area page's "Config", "Troubleshooting" and "For agents" sections.

These docs ship inside the package, at `node_modules/@ummgames/dev/docs/`. A game always has the
docs for the exact version it pins.
