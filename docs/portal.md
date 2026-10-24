# Portals

A web game portal such as CrazyGames serves a game's build from a path of its own, inside an
iframe, and blocks every other host. This page covers the three parts that turn a Vite game into
a build a portal accepts: the portal build plugins, the SDK adapter the game calls at runtime, and
a fake portal that runs the build in Playwright. Reach for it when a game ships to CrazyGames as
well as to its own site.

**Linked and copied.** The plugins (`@ummgames/dev/vite`) and the fake portal
(`@ummgames/dev/testing`) are linked: they run from `node_modules`. The adapter
(`runtime/portal/`) is copied: it ships inside the game.

The files every build can carry (`_headers`, `404.html`, licences, the app icon) are in
[build.md](build.md).

## Quick start

**1. Add the portal plugins** to the Vite config. A plain `vite build` stays the site build;
`vite build --mode portal` is the portal build.

```js
// vite.config.mjs
import { defineConfig } from 'vite'
import { PORTAL_MODE, portalPrune, portalSdk, portalSiteOnly } from '@ummgames/dev/vite'

export default defineConfig(({ mode }) => {
  const portal = mode === PORTAL_MODE
  return {
    base: portal ? './' : '/',
    publicDir: portal ? false : 'public',
    plugins: portal ? [portalSdk(), portalPrune(), portalSiteOnly()] : [],
    build: { outDir: portal ? 'dist-portal' : 'dist' },
  }
})
```

**2. Copy the adapter in:**

```sh
pnpm exec umm-dev copy runtime/portal
```

```
written  src/portal/build-target.ts  (from portal/build-target.ts)
written  src/portal/portal-sdk.ts  (from portal/portal-sdk.ts)
```

The adapter lands in `src/portal/` unless you say otherwise. See
[Where the adapter goes](#where-the-adapter-goes).

**3. Call it from boot:**

```ts
// src/main.ts
import { PORTAL } from './portal/build-target'
import { createPortalSdk } from './portal/portal-sdk'

// The game's own mixer. The adapter mutes it only while an ad plays.
const audio = { setMuted: (muted: boolean) => console.log(`muted ${muted}`) }

async function boot() {
  const portal = await createPortalSdk(audio) // sends loadingStart
  if (!PORTAL) await import('./dev-tools') // left out of the portal build
  // ...load the game's assets here...
  portal.loadingStop()
  portal.setGameplay(true)
  document.body.dataset.portal = portal.name

  document.querySelector('#break')?.addEventListener('click', async () => {
    portal.setGameplay(false)
    await portal.midgameAd()
    portal.setGameplay(true)
  })
}

boot()
```

**4. Mark what names your own site,** in `index.html`:

```html
<button id="break">Take a break</button>
<p data-site-only>More games at <a href="/games/">our site</a></p>
```

**5. Build it:**

```sh
pnpm exec vite build --mode portal
```

**When it works,** the build drops the dev-tools chunk and says so:

```
vite v8.2.1 building client environment for portal...
[plugin umm:portal-prune] dropped assets/dev-tools-vbHtoDvf.js: nothing in the build loads it
dist-portal/index.html                0.39 kB │ gzip: 0.26 kB
dist-portal/assets/index-CGx80H_5.js  3.39 kB │ gzip: 1.54 kB
```

`dist-portal/index.html` loads the SDK first, loads the game relative to the page, and has no
marked line:

```html
<!doctype html>
<html lang="en">
  <head>
    <script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>

    <meta charset="utf-8" />
    <title>My Game</title>
    <script type="module" crossorigin src="./assets/index-CGx80H_5.js"></script>
  </head>
  <body>
    <canvas id="game" width="960" height="540"></canvas>
    <button id="break">Take a break</button>
  </body>
</html>
```

**6. Test it** in the fake portal: see [Testing with the fake portal](#testing-with-the-fake-portal).

## `portalSdk(options)`

```ts
portalSdk(options?: { url?: string }): Plugin
```

| Option | Type | Default | What it does |
|---|---|---|---|
| `url` | `string` | `CRAZYGAMES_SDK_URL` (`https://sdk.crazygames.com/crazygames-sdk-v3.js`) | The SDK script's `src`. |

**What it changes.** It adds `<script src="<url>"></script>` as the first element of `<head>` in
every HTML entry, before the game's own script, as CrazyGames asks. It applies to `vite build`
only, so the dev server never loads the SDK. The adapter reads `window.CrazyGames.SDK`, which this
script defines.

```js
plugins: [portalSdk()]
```

```js
// Another script URL: give the fake portal the same one.
const SDK = 'https://portal.test/sdk.js'
plugins: [portalSdk({ url: SDK })]
// in the spec: await fakePortal(page, { sdkUrl: SDK })
```

## `portalPrune(options)`

```ts
portalPrune(options?: { log?: boolean }): Plugin
```

| Option | Type | Default | What it does |
|---|---|---|---|
| `log` | `boolean` | `true` | Print one line per dropped chunk. |

**What it changes.** A `PORTAL` guard lets the bundler drop an `import()`, but the chunk it
loaded is still written out. This drops every non-entry JS chunk whose file name no other emitted
file mentions, and repeats until nothing changes, so a chain of orphans goes too. It applies to
`vite build` only. Each dropped chunk prints one line:

```
[plugin umm:portal-prune] dropped assets/dev-tools-vbHtoDvf.js: nothing in the build loads it
```

**Turn source maps off in the portal build.** A chunk's own `.map` file names the chunk, so with
`build.sourcemap` set to `true` or `'hidden'` nothing is ever dropped.

```js
plugins: [portalPrune()]
```

```js
// Quiet, in a script or a test.
plugins: [portalPrune({ log: false })]
```

## `portalSiteOnly(options)`

```ts
portalSiteOnly(options?: { attribute?: string }): Plugin
```

| Option | Type | Default | What it does |
|---|---|---|---|
| `attribute` | `string` | `'data-site-only'` | The marker attribute. It must start with a letter, then letters, digits and `-` only; anything else throws `bad attribute name: <name>`. |

**What it changes.** It removes every element carrying the attribute from `index.html`, with its
contents and its line. CrazyGames bans cross-promotion and links to a playable web version, so
mark whatever names your site. It applies to `vite build` only.

**What it can match:**
- An element with a closing tag: `<p data-site-only>...</p>`. The opening tag may span lines.
- Not a void element. A marked `<link>`, `<meta>` or `<img>` is left in, silently. Wrap it in a
  marked `<span>` or `<div>`.
- Not an element holding another element of its own tag name. A marked `<div>` that holds a
  `<div>` is cut at the inner `</div>`, which leaves broken HTML.
- The marker matches as a prefix: `data-site-only-x` is stripped too.

```html
<!-- index.html, with portalSiteOnly() -->
<p data-site-only>More games at <a href="/games/">our site</a></p>
```

```js
// Another marker name.
plugins: [portalSiteOnly({ attribute: 'data-own-site' })]
// <footer data-own-site>...</footer>
```

## `portalAssets(options)`

```ts
portalAssets(options?: PortalAssetsOptions): Plugin
```

Use it when the portal build turns `publicDir` off and needs some of `public/` back.

| Option | Type | Default | What it does |
|---|---|---|---|
| `paths` | `string[]`, or `(root: string) => string[] \| Promise<string[]>` | `[]` | Files under `publicDir` to copy, relative to it. A function is called at build time with Vite's root. |
| `publicDir` | `string` | `'public'` | Where `paths` are read from, relative to Vite's root. |
| `missingHint` | `string` | `''` | Added to the error that names a missing file. |
| `limits` | `{ files: number, bytes: number }` or `false` | `CRAZYGAMES_LIMITS`: `{ files: 1500, bytes: 52428800 }` | The upload limits to hold the build to. `false` checks none. |

**What it emits.** Each listed file, at the same path in the build. A path that does not exist,
or holds `..`, fails the build:

```
[plugin umm:portal-assets]
RolldownError: models/gone.glb is missing from public/: run pnpm assets first
```

**The size check.** After the build is written, it counts every file in the bundle and adds up
their bytes. Over either limit, the build fails:

```
RolldownError: the portal build is over its limits: 4 files (limit 2), 0.3 MB (limit 0.1 MB)
```

- **The files stay on disk.** The check runs after writing, so `dist-portal/` is complete even
  though `vite build` exits 1. Never upload a build from a failed run.
- **MB is MiB.** The limit is 50 x 1024 x 1024 bytes, printed as `50.0 MB`.
- **It counts the bundle only.** Files Vite copies from an enabled `publicDir` are not counted.
  Keep `publicDir: false` in the portal build, or check by hand.
- **It counts the whole build.** CrazyGames' 50 MB is for what downloads before play; the plugin
  holds the whole build to it.

### Headroom: check the size by hand

**Within the limits it prints nothing,** so a build gives no sign of how close it is. Run this
from the game root after `vite build --mode portal`. It counts what is on disk, `publicDir` copies
included:

```sh
node --input-type=module -e "
import fs from 'node:fs'
import path from 'node:path'
import { CRAZYGAMES_LIMITS, overLimits } from '@ummgames/dev/vite'
const files = fs.readdirSync('dist-portal', { recursive: true, withFileTypes: true }).filter((d) => d.isFile())
const sizes = files.map((d) => fs.statSync(path.join(d.parentPath, d.name)).size)
const mb = (n) => (n / 2 ** 20).toFixed(1)
console.log(sizes.length, 'of', CRAZYGAMES_LIMITS.files, 'files;', mb(sizes.reduce((a, b) => a + b, 0)), 'of', mb(CRAZYGAMES_LIMITS.bytes), 'MB')
console.log(overLimits(sizes).join(', ') || 'within the limits')
"
```

```
4 of 1500 files; 0.3 of 50.0 MB
within the limits
```

```js
plugins: [portalAssets({ paths: ['models/hero.glb', 'audio/theme.ogg'] })]
```

```js
// The list read from the game, and a hint for the missing-file error.
import fs from 'node:fs'
import path from 'node:path'

portalAssets({
  paths: (root) => JSON.parse(fs.readFileSync(path.join(root, 'portal-assets.json'), 'utf8')),
  missingHint: 'run pnpm assets first',
})
```

**Keep listed files out of `public/assets/`** when the same build runs
`headers({ immutableAssets: true })`: they have no content hash. See
[build.md](build.md#headersoptions-_headers).

## Constants and pure functions

| Export | What it is |
|---|---|
| `PORTAL_MODE` | `'portal'`: the Vite mode the adapter reads as the portal build. |
| `CRAZYGAMES_SDK_URL` | `'https://sdk.crazygames.com/crazygames-sdk-v3.js'` |
| `CRAZYGAMES_ORIGINS` | `['https://crazygames.com', 'https://*.crazygames.com']`, the default `frameAncestors` of `headers({ target: 'portal' })`. |
| `CRAZYGAMES_LIMITS` | `{ files: 1500, bytes: 52428800 }` |
| `orphanChunks(files)` | The file names `portalPrune` would drop. |
| `stripSiteOnly(html, attribute?)` | `html` as `portalSiteOnly` leaves it. |
| `overLimits(sizes, limits?)` | What breaks a limit, in the words of the error; `[]` when the sizes fit. |

## Runtime: `runtime/portal/`

| File | Exports |
|---|---|
| `build-target.ts` | `PORTAL`, `PORTAL_MODE` |
| `portal-sdk.ts` | `createPortalSdk`, `NO_PORTAL`, `roomFromParams`, `INIT_WAIT_MS`, `AD_START_WAIT_MS`, `ROOM_CODE`, and the types `PortalSdk`, `PortalSdkOptions`, `CrazySdk` |

`portal-sdk.ts` imports `./build-target`, so the two files live in the same folder.

### Where the adapter goes

**By default it lands in `src/portal/`.** `umm-dev copy` writes to
`<runtime.into>/<path under runtime/>`, and `runtime.into` is `src`. To put it elsewhere:

| You want | Run |
|---|---|
| Both files in another folder | `pnpm exec umm-dev copy runtime/portal --to src/boot/` |
| The adapter over a file the game already has | `pnpm exec umm-dev copy runtime/portal/portal-sdk.ts --to src/boot/portal-sdk.ts --force`, then the same for `build-target.ts` |
| Every runtime copy under another folder | `runtime: { into: 'src/shared' }` in `umm-dev.config.mjs` |

**Without `--to`, a game that already has an adapter gets a second one** in `src/portal/`.
Delete it, and copy again with `--to`.

Copying one file prints a reminder when its neighbour is not beside it:

```
updated  src/boot/portal-sdk.ts  (from portal/portal-sdk.ts)
         imports ./build-target, which is not beside it: copy that too
```

`copy`, `--to`, `--force` and `drift` are in [runtime.md](runtime.md).

### `build-target.ts`

```ts
export const PORTAL_MODE = 'portal'
export const PORTAL: boolean = import.meta.env.MODE === 'portal'
```

**`PORTAL` is a compile-time constant.** Vite replaces `import.meta.env.MODE`, so the bundler
drops whatever `PORTAL` guards. It is true under `vite build --mode portal` and
`vite --mode portal`; false under `vite`, in the site build and in Vitest.

Guard with it whatever the portal build must not ship:
- an editor or a dev palette;
- a link to the game's own site;
- a service on another host.

### `createPortalSdk(audio, options)`

```ts
createPortalSdk(audio: { setMuted(muted: boolean): void }, options?: PortalSdkOptions): Promise<PortalSdk>
```

**It never rejects.** It resolves to one of two things:
- **CrazyGames' SDK, wrapped,** when `enabled` is true, `window.CrazyGames.SDK` exists, `init()`
  resolves within `initWaitMs`, and `environment` is not `'disabled'`.
- **`NO_PORTAL`,** a frozen stub that does nothing, otherwise. That covers dev, the site build,
  Vitest, a page with the SDK blocked, and any domain that is not CrazyGames'.

| Option | Type | Default | What it does |
|---|---|---|---|
| `enabled` | `boolean` | `PORTAL` | Use the SDK at all. |
| `sdk` | `CrazySdk` | `window.CrazyGames.SDK`, read when `createPortalSdk` is called | The SDK object. Pass a fake in a unit test. |
| `initWaitMs` | `number` | `5000` (`INIT_WAIT_MS`) | How long boot waits on `init()` before taking the stub. |
| `adStartWaitMs` | `number` | `6000` (`AD_START_WAIT_MS`) | How long `midgameAd()` waits for an ad to start before resolving. |
| `roomParam` | `string` | `'room'` | The invite parameter that names a room. |
| `roomCode` | `RegExp` | `ROOM_CODE`: `/^[A-Z0-9]{4,12}$/` | What a room code looks like, tested after upper-casing. |
| `warn` | `(message: string, error?: unknown) => void` | `console.warn`, prefixed `[portal] ` | Where a failed call is reported. |

**Every call is guarded.** A call that throws is reported through `warn` as
`[portal] <call> failed`, and the game plays on.

### The `PortalSdk` calls

| Call | What it does |
|---|---|
| `name` | `'crazygames'`, or `'none'` for the stub. |
| `loadingStop()` | Boot is done and the first frame is about to show. `createPortalSdk` already sent `loadingStart`. |
| `setGameplay(on)` | The player is playing now, or not. Sends `gameplayStart` or `gameplayStop`, only on a change. |
| `midgameAd()` | Asks for a midgame ad. Resolves when it is over, shown or not. Never rejects. |
| `happytime()` | A big moment. Use it sparingly. |
| `instantMultiplayer` | True when the player launched from the portal's multiplayer UI. Read once, at init. |
| `inviteRoom` | The room code from the invite the player launched from, or null. Read once, at init. |
| `onJoinRoom(fn)` | `fn(code)` runs when a friend's invite is clicked while the game runs. |
| `updateRoom(code, joinable)` | Reports the room this player is in, hosting or joined, joinable or full. |
| `leftRoom()` | The player is back to playing alone. |
| `inviteLink(code)` | The portal's link to the room, or null. On null, make your own link. |
| `username()` | The portal username; `''` for a guest; null with no user API at all (the stub). |

### The call order

1. **Boot.** Call `createPortalSdk(audio)` first, before loading assets. It sends `loadingStart`
   and takes at most `initWaitMs`.
2. **Loaded.** Call `loadingStop()` once, when the first frame is about to show.
3. **Play.** Call `setGameplay(true)` when the player actually plays, and `setGameplay(false)` for a
   menu, a pause, a load, a level end or an ad.
   - In a game that starts on a click, that is when play starts, not when loading ends.
   - In a pointer-lock game, call `setGameplay(true)` on `pointerlockchange` when the lock is
     taken, and `setGameplay(false)` when it is released.
4. **Breaks.** At a natural break: `setGameplay(false)`, then `await midgameAd()`, then
   `setGameplay(true)`.
5. **Big moments.** `happytime()`, rarely.
6. **Multiplayer (optional).** A solo game skips this.
   - At boot, read `instantMultiplayer` (host a joinable room at once, no menu) and
     `inviteRoom` (join that room at once).
   - Register `onJoinRoom` once.
   - Call `updateRoom(code, joinable)` on hosting, on joining, and whenever the room fills or
     opens again. Call `leftRoom()` on leaving.
   - A share button uses `inviteLink(code)`, and the game's own link when that is null.

**Room codes.** A room is the game's own session code, carried in the invite as
`{ [roomParam]: code }`. Codes from the portal are upper-cased, then tested against `roomCode`;
one that fails is dropped, so `onJoinRoom` never sees it. `roomFromParams(params, roomParam?,
roomCode?)` does that check on its own.

### The ad and mute contract

- `audio.setMuted(true)` runs when an ad starts, and `audio.setMuted(false)` when it finishes or
  errors.
- **Only an ad that plays mutes.** With no fill, a blocked ad or the stub, `setMuted` is never
  called.
- `midgameAd()` resolves on the first of: the ad finishing, the ad erroring, `requestAd`
  throwing, or `adStartWaitMs` with no start.
- **A late start still mutes.** An ad that starts after `adStartWaitMs` plays over a game that
  has already resumed. The adapter mutes the game then, and unmutes it when that ad ends. The
  promise has already resolved and does not resolve again.
- **Keep `setMuted` apart from the player's own mute.** The adapter calls `setMuted(false)` after
  every ad, whatever the player chose. Treat it as a second flag: the game is silent when the
  player muted it or an ad is playing.

## Testing with the fake portal

`fakePortal(page, options?)` routes every request a Playwright page makes, so a spec runs the
portal build as CrazyGames runs it. Nothing listens on a port: Playwright answers each request
itself. It serves:
- the portal page at `https://portal.test/`, holding the game in a 960 x 540 iframe;
- the build from `/games/game/`;
- a fake CrazyGames SDK at the SDK's URL, which records every call.

It blocks every other host and notes it in `elsewhere`. It closes every WebSocket dial unless
`allowWebSocket` lets it through.

**Setup.** The game needs `@playwright/test` and a portal build on disk:

```sh
pnpm add -D @playwright/test
pnpm exec vite build --mode portal
```

```js
// playwright.portal.config.mjs
import { defineConfig, devices } from '@playwright/test'
import { playwrightConfig } from '@ummgames/dev/playwright'

export default defineConfig(
  playwrightConfig({ device: devices['Desktop Chrome'], testDir: 'tests/portal', webServer: false }),
)
```

`webServer: false`, because the fake portal serves the build itself and needs no dev server.

**Make this a separate config file**, with its specs in their own folder. The game's main
`playwright.config` keeps its dev server for every other spec. Run the portal specs with
`playwright test -c playwright.portal.config.mjs`, after `vite build --mode portal`. One config
cannot hold both, because the preset replaces any `projects` the game passes. The preset is in
[presets.md](presets.md).

### A complete spec

This is the Quick start game's spec. It passes as written.

```js
// tests/portal/portal.spec.mjs
import { expect, test } from '@playwright/test'
import { fakePortal } from '@ummgames/dev/testing'

test('the portal build boots and reports to the portal', async ({ page }) => {
  const portal = await fakePortal(page)
  const game = await portal.open()
  await expect
    .poll(portal.calls)
    .toEqual(['init', 'loadingStart', 'loadingStop', 'gameplayStart'])
  await expect(game.locator('[data-site-only]')).toHaveCount(0)
  expect(portal.elsewhere).toEqual([])
})

test('a midgame ad stops play and mutes the game while it plays', async ({ page }) => {
  const sound = []
  page.on('console', (m) => m.text().startsWith('muted') && sound.push(m.text()))
  const portal = await fakePortal(page, { sdk: { ad: { startMs: 50, lengthMs: 200 } } })
  const game = await portal.open()
  await expect.poll(portal.calls).toContain('gameplayStart')
  await game.locator('#break').click()
  await expect
    .poll(portal.calls)
    .toEqual([
      'init',
      'loadingStart',
      'loadingStop',
      'gameplayStart',
      'gameplayStop',
      'requestAd:midgame',
      'adStarted',
      'adFinished',
      'gameplayStart',
    ])
  expect(sound).toEqual(['muted true', 'muted false'])
})

test('the game plays on when an ad blocker stops the SDK', async ({ page }) => {
  const portal = await fakePortal(page, { sdk: false })
  const game = await portal.open()
  await expect(game.locator('body')).toHaveAttribute('data-portal', 'none')
  expect(portal.elsewhere).toEqual(['https://sdk.crazygames.com/crazygames-sdk-v3.js'])
})
```

```sh
pnpm exec playwright test
```

```
Running 3 tests using 1 worker

  ok 1 [chromium] › tests\portal\portal.spec.mjs:4:1 › the portal build boots and reports to the portal (326ms)
  ok 2 [chromium] › tests\portal\portal.spec.mjs:14:1 › a midgame ad stops play and mutes the game while it plays (805ms)
  ok 3 [chromium] › tests\portal\portal.spec.mjs:37:1 › the game plays on when an ad blocker stops the SDK (230ms)

  3 passed (2.2s)
```

### `fakePortal` options

| Option | Type | Default | What it does |
|---|---|---|---|
| `dist` | `string` | `'dist-portal'` | The build to serve, relative to the working directory. |
| `host` | `string` | `'https://portal.test'` | The portal page's origin. |
| `gamePath` | `string` | `'/games/game/'` | The game's folder on the portal. |
| `query` | `string` | none | Appended as written to `index.html` in the iframe: `'?debug=1'`. |
| `frame` | `{ width?, height?, allow? }` | `960`, `540`, `'autoplay; fullscreen; clipboard-write'` | The iframe. |
| `sdk` | `FakeSdkOptions` or `false` | `{}` | How the fake SDK behaves (below). `false` blocks the script, as an ad blocker would, and notes it in `elsewhere`. |
| `sdkUrl` | `string` | `CRAZYGAMES_SDK_URL` | The URL answered with the fake SDK. Match `portalSdk({ url })`. |
| `routes` | `{ match, handle }[]` | `[]` | Requests the spec answers itself, such as a stats endpoint. `match` is a full URL, a `RegExp` or `(url: URL) => boolean`; `handle(route)` fulfils or aborts. Checked after the SDK URL and before the host block. |
| `allowWebSocket` | `(url: string) => boolean` | none | WebSocket dials that may reach their server, such as a dev relay. Every other dial is closed and noted in `sockets`. |
| `gameOrigin` | `string` | `host` | Serves the game from another origin than the portal page, as CrazyGames does. |
| `applyHeaders` | `boolean` | `false` | Sends the build's own `_headers` rules with its files, so a spec sees whether the portal may frame it. |

### `sdk`: the fake SDK's behaviour

| Field | Type | Default | What it sets |
|---|---|---|---|
| `environment` | `'crazygames' \| 'local' \| 'disabled'` | `'crazygames'` | What `SDK.environment` reports. `'disabled'` makes the adapter take the stub. |
| `init` | `'ok' \| 'hang' \| 'reject'` | `'ok'` | How `init()` behaves. `'hang'` and `'reject'` make the adapter take the stub. |
| `ad` | `{ fill?, startMs?, lengthMs? }` | `true`, `100`, `300` | An ad starts after `startMs` and plays for `lengthMs`. `fill: false` errors instead. |
| `instant` | `boolean` | `false` | Launched from the portal's multiplayer UI. |
| `invite` | `string`, `Record<string, string>` or `null` | `null` | Launched from an invite: a room code (sent as `{ [roomParam]: code }`) or the whole parameters. |
| `roomParam` | `string` | `'room'` | The invite parameter that names the room. |
| `user` | `string` or `null` | `null` | The signed-in player's username; null is a guest. |
| `userApi` | `boolean` | `true` | Whether the SDK has `SDK.user` at all. |
| `inviteLinkBase` | `string` | the game's `index.html` on the portal | What `inviteLink` returns before its query. |

### What `fakePortal` returns

| Member | What it is |
|---|---|
| `url` | The portal page's URL: `https://portal.test/`. |
| `gameUrl` | The game's folder on the portal, ending in `/`. |
| `open()` | Loads the portal page and resolves to the game's `Frame`. Throws if `dist` has no `index.html`. |
| `frame()` | Looks the game's frame up again, so a reload is followed. Throws before `open()`. |
| `calls()` | The SDK calls so far, in order (below). |
| `rooms()` | The room calls so far, in order (below). |
| `joinRoom(invite)` | Fires the game's join listener, as the portal does when a friend's invite is clicked. A string is sent as `{ [roomParam]: code }`. |
| `elsewhere` | `string[]`: requests to other hosts, blocked. |
| `missing` | `string[]`: paths on the portal with no file behind them, answered 404. |
| `served` | `string[]`: the build's files that were served, relative to `dist`. |
| `queries` | `Map<string, string>`: each served file's query string. |
| `sockets` | `string[]`: WebSocket dials that were closed. |

**`calls()`** resolves to strings from this set: `init`, `loadingStart`, `loadingStop`,
`gameplayStart`, `gameplayStop`, `requestAd:midgame`, `adStarted`, `adFinished`, `adError`,
`happytime`.
- A game that booted but never called `loadingStop()` shows `['init', 'loadingStart']`.
- A game whose `init()` hung or rejected, and so took the stub, shows `['init']`.
- A build that never loaded the fake SDK shows `[]`.

**`rooms()`** resolves to objects with a `kind`. From a game that calls `inviteLink('WXYZ')`,
`updateRoom('WXYZ', true)` and `leftRoom()`, then joins a friend's room `efgh` from `onJoinRoom`:

```json
[
  { "kind": "link", "room": "WXYZ" },
  { "kind": "update", "roomId": "WXYZ", "isJoinable": true, "inviteParams": { "room": "WXYZ" } },
  { "kind": "left" },
  { "kind": "update", "roomId": "EFGH", "isJoinable": false, "inviteParams": { "room": "EFGH" } }
]
```

**Testing the framing.** With `applyHeaders` and a `gameOrigin`, the iframe is held to the build's
own `_headers`. A build whose `frame-ancestors` leaves the portal out never loads, and `open()`
throws.

```js
// The build was made with headers({ target: 'portal', frameAncestors: ['https://portal.test'] }).
const portal = await fakePortal(page, { applyHeaders: true, gameOrigin: 'https://games.portal.test' })
await portal.open()
```

### The other testing exports

| Export | What it is |
|---|---|
| `fakeSdkScript(options?)` | The fake SDK's script on its own, for a page the spec builds itself. Calls land in `window.__fakePortal.calls` and `.rooms`. `inviteLinkBase` defaults to `https://portal.test/invite` here. |
| `headersFor(dist, pathname)` | The headers Cloudflare Pages would send for `pathname` from `dist/_headers`. Names come back lower-cased; splats only. |
| `PORTAL_HOST` | `'https://portal.test'` |
| `CRAZYGAMES_SDK_URL` | The same URL as the Vite export. |

`fakePortal` takes any Playwright `Page`. Its types are structural, so a game needs only
`@playwright/test`.

## How it works

- **Build only.** All four plugins set `apply: 'build'`. The dev server has no SDK script, keeps
  every marked element and copies nothing.
- **The mode is the switch.** The Vite config adds the plugins when `mode === PORTAL_MODE`, and
  `build-target.ts` reads the same mode. Any other mode gives a site build with the stub adapter.
- **`portalSdk` and `portalSiteOnly`** are `transformIndexHtml` hooks. `portalSiteOnly` is one
  regular expression over the HTML text.
- **`portalPrune`** runs in `generateBundle`. A chunk counts as loaded when any other emitted
  text file contains its base file name.
- **`portalAssets`** emits its files in `generateBundle` and checks the limits in `writeBundle`,
  after the files are on disk.
- **The adapter** reads `window.CrazyGames.SDK` once, races `init()` against `initWaitMs`, and
  checks `environment`. After that each call goes straight to the SDK inside a `try`.
- **The fake portal** is one `page.route('**/*')` and one `page.routeWebSocket(/.*/)`. The fake
  SDK keeps its record in the game frame's `window.__fakePortal`; `calls()` and `rooms()` read it
  from there.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `dist-portal has no index.html: build the portal target first` | The spec ran before a portal build, or the build writes elsewhere. | Run `vite build --mode portal` with `build.outDir: 'dist-portal'`, or pass `dist`. |
| `no game frame at https://portal.test/games/game/: call open() first`, thrown by `open()` | The iframe was refused. With `applyHeaders`, the build's `frame-ancestors` leaves the portal out (a site build allows `'self'` only). | Build with `headers({ target: 'portal', frameAncestors: [...] })` naming the portal's host. |
| The same message from `calls()`, `frame()` or `joinRoom()` | They ran before `open()`. | Call `await portal.open()` first. |
| `the game has not called addJoinRoomListener` | `joinRoom` ran before the game called `onJoinRoom`, or the game has the stub. | Wait for the game's boot. Check that `calls()` holds `init`. |
| `calls()` stays `[]` | The build never loaded the SDK script: it is the site build, `sdk` is `false`, or `portalSdk()` is missing. | Test `dist-portal` from `vite build --mode portal`. |
| `calls()` stops at `['init', 'loadingStart']` | The game never called `loadingStop()`. | Follow [the call order](#the-call-order). |
| `browserType.launch: Executable doesn't exist at ...chromium_headless_shell-<revision>...` | Playwright's browser download is for another Playwright version. | Run on the installed Chrome: `E2E_CHANNEL=chrome pnpm exec playwright test`. Or run `pnpm exec playwright install chromium`. |
| `[portal] CrazyGames SDK unavailable, playing on without it Error: init timed out` | `init()` took longer than `initWaitMs`. A rejected `init()` logs the SDK's own error instead. | Expected on a slow or blocked network. The game plays on with the stub. |
| `[portal] <call> failed` | An SDK call threw. | The game plays on. Read the error logged with it. |
| `RolldownError: <path> is missing from public/: <hint>` | A `portalAssets` path has no file, or holds `..`. | Make the file, or fix the list. |
| `RolldownError: the portal build is over its limits: <n> files (limit 1500), <x> MB (limit 50.0 MB)` | The bundle breaks CrazyGames' limits. `dist-portal/` is still written. | Cut files or bytes. Do not upload that build. |
| No `dropped` line, and a dev chunk ships | `build.sourcemap` is on, so each chunk's map names it. Or no `PORTAL` guard wraps the `import()`. | Turn source maps off in the portal build. Guard the `import()`. |
| A marked element still ships | It is a void element (`<link>`, `<meta>`, `<img>`), or it holds an element of its own tag. | Wrap it in a marked `<span>` or `<div>` with no nested tag of the same name. |
| `bad attribute name: <name>` | `portalSiteOnly({ attribute })` has a character other than letters, digits or `-`. | Use a plain attribute name. |
| The game has two adapters, one in `src/portal/` | `umm-dev copy runtime/portal` ran without `--to` in a game that keeps its adapter elsewhere. | Delete `src/portal/`, then copy again with `--to`. See [Where the adapter goes](#where-the-adapter-goes). |
| `imports ./build-target, which is not beside it: copy that too` | One file was copied with `--to`. | Copy `build-target.ts` to the same folder. |
| `refused  <file>: exists and is not a copy; --force overwrites` | The target is the game's own adapter, not a copy. | Add `--force`, naming that one file. |

## For agents

- **CrazyGames rules the code encodes. Do not work around them:**
  - The SDK script is the first thing in `<head>` (`portalSdk`).
  - No cross-promotion and no link to a playable web version (`portalSiteOnly`).
  - At most 1,500 files and 50 MB (`portalAssets`).
  - Assets load relative to the page: `base: './'` in the portal build.
  - `loadingStart` at init, then `loadingStop` once boot is done.
  - `gameplayStart` and `gameplayStop` mark play, sent only on a change. A menu, a load or an
    ad is not play.
  - The game is silent while an ad plays.
  - `happytime` is for big moments only.
- **Never edit line 1 of a runtime copy** (`portal-sdk.ts`, `build-target.ts`). It is the header
  `umm-dev drift` reads. Below line 1 the file is the game's. To take a newer version, run
  `umm-dev copy` again: it refuses a changed copy until `--force`, which drops the changes.
- **Find the adapter before copying.** Search the game for `createPortalSdk`. If it lives
  outside `src/portal/`, copy with `--to` that folder.
- **Never call `window.CrazyGames` from game code.** Go through the `PortalSdk` the adapter
  returns. In a unit test, pass a fake as the `sdk` option.
- **Test the portal build:** `dist-portal/` from `vite build --mode portal`. The dev server and
  the site build both run the stub and prove nothing about the portal.
- **Check your own work:**
  1. `vite build --mode portal` exits 0 and prints a `dropped` line for each dev-only chunk.
  2. `dist-portal/index.html` starts `<head>` with the SDK script and holds no `data-site-only`.
  3. The fake-portal spec passes, with `elsewhere` empty.
  4. The size check above prints `within the limits`, with room to spare.
  5. `umm-dev drift` lists one copy of each adapter file.
