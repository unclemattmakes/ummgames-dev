# Portals

A game ships to web game portals such as CrazyGames as well as to its own site. A portal serves
the build from a path of its own, inside an iframe, and blocks every other host. This page covers
the three parts that make that work:

- **The portal build**: Vite plugins from `@ummgames/dev/vite`.
- **The adapter**: TypeScript copied into the game from `runtime/portal/`.
- **The fake portal**: a Playwright helper from `@ummgames/dev/testing`.

The Pages files every build can carry (`_headers`, `404.html`, licences, the icon) are in
[build.md](build.md).

## The portal build

Build it in Vite's `portal` mode: `vite build --mode portal`. In that mode:

- `runtime/portal/build-target.ts` reads `PORTAL` as true.
- The config adds the portal plugins.

```js
// vite.config.mjs
import { defineConfig } from 'vite'
import {
  PORTAL_MODE,
  portalAssets,
  portalPrune,
  portalSdk,
  portalSiteOnly,
} from '@ummgames/dev/vite'

export default defineConfig(({ mode }) => {
  const portal = mode === PORTAL_MODE
  return {
    base: portal ? './' : '/',
    publicDir: portal ? false : 'public',
    plugins: portal
      ? [
          portalSdk(),
          portalPrune(),
          portalSiteOnly(),
          portalAssets({ paths: ['assets/hero.glb'] }),
        ]
      : [],
    build: { outDir: portal ? 'dist-portal' : 'dist', sourcemap: !portal && 'hidden' },
  }
})
```

Each plugin applies to `vite build` only.

| Plugin | What it does | Options |
|---|---|---|
| `portalSdk()` | Injects CrazyGames' SDK v3 `<script>` at the top of `<head>`, before the game's own script, as CrazyGames asks. | `url` |
| `portalPrune()` | A `PORTAL` guard lets the bundler drop an `import()`, but the chunk it loaded may still be written out. This drops every non-entry JS chunk that no other emitted file names, and repeats so a chain of orphans goes too. | `log` (default true) |
| `portalSiteOnly()` | Strips every element marked `data-site-only` from `index.html`. CrazyGames bans cross-promotion and links to a playable web version, so mark the line that names your site. | `attribute` |
| `portalAssets()` | Copies the listed files from `public/` into a build with `publicDir: false`, and fails the build if one is missing. It also fails a build over the portal's limits: 1,500 files, or 50 MB before play. | `paths`, `publicDir`, `missingHint`, `limits` |

### `portalAssets`

- **`paths`.** Which assets a portal build needs is the game's own business. `paths` is either a
  list, or a function of the project root that returns one.
- **`limits`.** Set `limits: false` to skip the size check, or pass another portal's
  `{ files, bytes }`.

**Element marking.** `portalSiteOnly` matches one level deep, so keep a marked element simple. A
marked `<p>` that holds another `<p>` is not matched correctly.

The pure functions behind the plugins are exported for tests: `orphanChunks`, `stripSiteOnly` and
`overLimits`.

## The adapter: `runtime/portal/`

Copy both files into the game:

```sh
umm-dev copy runtime/portal/portal-sdk.ts
umm-dev copy runtime/portal/build-target.ts
```

### `build-target.ts`

This file exports `PORTAL`, which is `import.meta.env.MODE === 'portal'`. It is a compile-time
constant, so the bundler drops whatever it guards.

Guard with it whatever the portal build must not ship:

- an editor;
- a dev palette;
- a link to the game's site;
- a service on another host.

### `portal-sdk.ts`

`createPortalSdk(audio, options?)` returns a `PortalSdk`:

- **In the portal build,** it wraps CrazyGames' SDK.
- **Everywhere else,** it returns `NO_PORTAL`, a stub that does nothing. That covers dev, the site,
  e2e specs, and a portal page with the SDK blocked.

Every call is guarded. A portal hiccup logs a warning and the game plays on.

| Call | What it does |
|---|---|
| `loadingStop()` | Boot is done. (`loadingStart` is sent at init.) |
| `setGameplay(on)` | The player is playing now, or not. Only changes are sent. |
| `midgameAd()` | A midgame ad at a break. It resolves when the ad is over, whether it was shown or not, and never rejects. The `audio` passed in is muted only while an ad actually plays. An ad that has not started after 6 s is given up on, and a late start after that is ignored. |
| `happytime()` | A big moment. Use it sparingly. |

**Init.** If init takes more than 5 s, or rejects, or reports the `disabled` environment (any
domain that is not CrazyGames'), the game gets the stub.

#### Multiplayer (optional)

A solo game ignores these calls. Off the portal they do nothing.

| Call | What it does |
|---|---|
| `instantMultiplayer` | True when the player launched from the portal's multiplayer UI. Host a joinable room at once. |
| `inviteRoom` | The room code from the invite the player launched from, or null. |
| `onJoinRoom(fn)` | A friend's invite was clicked while the game runs. |
| `updateRoom(code, joinable)` | Report the room: hosting or joined, joinable or full. |
| `leftRoom()` | The player is back to playing alone. |
| `inviteLink(code)` | The portal's link to the room. Null off the portal, so the caller makes its own. |
| `username()` | The portal username. `''` for a guest, and null with no user API at all. |

**Room codes.** A room is the game's own session code, carried in the invite as `{ room: CODE }`.
Codes are upper-cased, then checked against `roomCode`.

#### Options

| Option | Default |
|---|---|
| `enabled` | `PORTAL` |
| `sdk` | `window.CrazyGames.SDK` |
| `initWaitMs` | 5000 |
| `adStartWaitMs` | 6000 |
| `roomParam` | `room` |
| `roomCode` | 4 to 12 letters or digits |
| `warn` | `console.warn` |

Pass the game's own pattern as `roomCode` when it has one.

## The fake portal: `@ummgames/dev/testing`

`fakePortal(page, options?)` routes every request a Playwright page makes, so a spec sees the
portal build as a portal runs it. It serves:

- the portal page on `https://portal.test`, holding the game in a 960 x 540 iframe;
- the build from a folder of its own, `/games/game/`;
- a fake CrazyGames SDK that records every call.

It blocks every other host and every WebSocket dial, and notes each one. Nothing listens on a
port.

```js
import { expect, test } from '@playwright/test'
import { fakePortal } from '@ummgames/dev/testing'

test('the portal build boots and talks to the SDK', async ({ page }) => {
  const portal = await fakePortal(page)
  const game = await portal.open()
  await expect.poll(portal.calls).toContain('gameplayStart')
  expect(portal.elsewhere).toEqual([])
})
```

### What it returns

| Member | What it is |
|---|---|
| `open()` | Loads the portal page and returns the game's `Frame`. |
| `frame()` | Looks the game's frame up again, so a reload is followed. |
| `calls()` | The SDK calls, in order: `init`, `loadingStart`, `loadingStop`, `gameplayStart`, `gameplayStop`, `requestAd:midgame`, `adStarted`, `adFinished`, `adError` and `happytime`. |
| `rooms()` | The room calls: `{ kind: 'update' \| 'left' \| 'link', ... }`. |
| `joinRoom(code)` | Fires the game's join listener, as the portal does when a friend's invite is clicked. |
| `elsewhere` | Requests to other hosts, blocked. |
| `missing` | Paths with no file behind them. |
| `served` | The build's files that were served. |
| `queries` | Each served file's query string. |
| `sockets` | WebSocket dials that were closed. |

### Options

| Option | What it does |
|---|---|
| `dist` | The build to serve. Default `dist-portal`. |
| `host` | The portal page's origin. |
| `gamePath` | The game's folder on the portal. |
| `query` | Appended to `index.html` in the iframe. |
| `frame` | `{ width, height, allow }` for the iframe. |
| `sdk` | See below. `false` blocks the SDK script, as an ad blocker would. |
| `sdkUrl` | The SDK script's URL. |
| `routes` | `[{ match, handle }]`: requests the spec answers itself, such as a stats endpoint. |
| `allowWebSocket` | `(url) => boolean`: dials that may reach their server, such as a dev relay. |
| `gameOrigin` | Serves the game from another origin than the portal page, as CrazyGames does. |
| `applyHeaders` | Sends the build's own `_headers`, so a spec sees whether the portal may frame it. |

The `sdk` option is an object that sets how the fake SDK behaves:

| Field | What it sets |
|---|---|
| `environment` | The environment the SDK reports. |
| `init` | `'ok'`, `'hang'` or `'reject'`. |
| `ad` | `{ fill, startMs, lengthMs }`. |
| `instant` | Launch from the portal's multiplayer UI. |
| `invite` | The invite the game launches from. |
| `roomParam` | The invite parameter that names the room. |
| `user` | The signed-in player's name. |
| `userApi` | Whether the SDK has a user API at all. |
| `inviteLinkBase` | The base of the link `inviteLink` returns. |

`fakeSdkScript(options)` is the fake on its own, and `headersFor(dist, path)` reads a build's
`_headers` as Cloudflare Pages would. `fakePortal` accepts any Playwright `Page`; its types are
structural, so a game needs only `@playwright/test`.
