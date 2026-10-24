# ummgames-dev

`@ummgames/dev` holds the tools every Uncle Matt Makes game shares, so a tool built for one game
is there for the next. It covers:

- **Capture:** record a game in virtual time.
- **Video:** cut trailers and store previews from an edit list.
- **Store art:** make covers and icons.
- **Portals:** build for web game portals.
- **Agent sessions:** share one GPU between parallel sessions.
- **Configs:** start every game from one set of lint, type and test configs.

## Install

```sh
pnpm add -D github:unclemattmakes/ummgames-dev#v0.1.0
```

**Pin a tag.** A game moves to a newer version only when it chooses to, by adding the newer tag the
same way. The lockfile records the exact commit.

**Requirements:**
- pnpm 10 or 11, and Node 22 or later.
- The media commands need `ffmpeg` on `PATH`.
- Capture and store art need Playwright's Chromium (`pnpm exec playwright install chromium`).

## Tools are linked, runtime code is copied

- **Linked tools.** Commands, Vite plugins, test helpers and config presets run from
  `node_modules`. None of them ships in a game's build.
- **Copied runtime code.** Code that ships inside a game lives in `runtime/`: the portal SDK
  adapter, the splash, the perf HUD, the gamepad profiles.
  - `umm-dev copy <path>` writes one of those files into the game, with a header naming this repo,
    the path and the commit. From then on the game owns its copy.
  - `umm-dev drift` shows how far each copy has moved from the version it came from, and how far
    behind the latest version it is.

## Commands

Run `pnpm exec umm-dev help` for the list, and `umm-dev <command> --help` for a command's options.

| Command | What it does | Docs |
|---|---|---|
| `umm-dev capture` | Record shots of the game in virtual time: every frame exact, an mp4 per shot, contact sheets, `expect` checks | [media](docs/media.md) |
| `umm-dev cut` | Cut a video from an edit list: dissolves, wipes, speed, reverse, reframing, overlays, cards, music. `--print` works without ffmpeg | [media](docs/media.md) |
| `umm-dev store` | Make a portal store kit: capture, covers and icons from the game's own templates, preview cuts, a review sheet, preset checks | [media](docs/media.md) |
| `umm-dev loop` | Make a site loop: a silent 720p faststart mp4 and a poster, from a cut or a store preview | [media](docs/media.md) |
| `umm-dev loudness` | Meter audio: integrated LUFS, true peak, momentary max, checked against a target | [audio](docs/audio.md) |
| `umm-dev copy` | Copy a `runtime/` file or folder into the game, stamped with its version and hash | [runtime](docs/runtime.md) |
| `umm-dev drift` | Report how far each copy has moved, here and upstream (`--diff`, `--strict`) | [runtime](docs/runtime.md) |
| `umm-dev gpu` | Share one GPU between parallel sessions on the machine: run, status, wait, release | [agent](docs/agent.md) |
| `umm-dev worktree` | Hydrate a new git worktree, or remove one without following its links | [agent](docs/agent.md) |
| `umm-dev merge` | Resolve markdown append and table-row conflicts, by hand or as a merge driver | [agent](docs/agent.md) |
| `umm-dev guard` | Repo guards: em dashes, CLAUDE.md size, a path denylist, git hooks | [guard](docs/guard.md) |

## Configuration

**Each game keeps its own settings** in `umm-dev.config.mjs` at its root. Every command reads only
its own section, so a game configures only the tools it uses.

```js
import { defineConfig } from '@ummgames/dev'

export default defineConfig({
  capture: {},
  store: {},
})
```

## Vite plugins and testing

```js
// vite.config.mjs
import { defineConfig } from 'vite'
import { PORTAL_MODE, headers, notFoundPage, portalPrune, portalSdk, portalSiteOnly } from '@ummgames/dev/vite'

export default defineConfig(({ mode }) => {
  const portal = mode === PORTAL_MODE
  return {
    base: portal ? './' : '/',
    plugins: portal
      ? [portalSdk(), portalPrune(), portalSiteOnly()]
      : [headers({ immutableAssets: true }), notFoundPage()],
  }
})
```

**Framing.** The site build's headers refuse framing. A portal build that the game hosts itself
takes `headers({ target: 'portal' })`, which allows the portal's origins and nobody else.

**More plugins.** Licences, the app icon and a share card are plugins too. See
[docs/build.md](docs/build.md).

`@ummgames/dev/testing` runs a game's portal build inside a fake portal, which records every
call the game makes:

```js
const portal = await fakePortal(page)
await portal.open()
await expect.poll(portal.calls).toContain('gameplayStart')
```

The portal SDK adapter itself is runtime code: `umm-dev copy runtime/portal`. See
[docs/portal.md](docs/portal.md).

## Presets

```jsonc
// biome.json
{ "extends": ["@ummgames/dev/biome"], "files": { "includes": ["**", "!public"] } }
```

```jsonc
// tsconfig.json
{
  "extends": "@ummgames/dev/tsconfig",
  "compilerOptions": { "types": ["vite/client"], "paths": { "@/*": ["./src/*"] } },
  "include": ["src/**/*", "tests/**/*"]
}
```

```ts
// vitest.config.ts
export default defineConfig(vitestConfig({ root: import.meta.url }))
// playwright.config.ts
export default defineConfig(playwrightConfig({ device: devices['Desktop Chrome'], port: 5180 }))
```

`vitestConfig` comes from `@ummgames/dev/vitest`, and `playwrightConfig` from
`@ummgames/dev/playwright`. See [docs/presets.md](docs/presets.md).

## Libraries

`@ummgames/dev/media` is the code behind the media commands: the capture clock, the edit-list
validator and planner, the store checks. `@ummgames/dev/audio` is the loudness meter, for meters
that run inside a game's own tools.

## Licence

MIT. See [LICENSE](LICENSE).
