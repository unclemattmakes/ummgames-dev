# Portals

A web game portal such as CrazyGames serves a game's build from a path of its own, inside an
iframe, and blocks every other host. This page covers the three parts that turn a Vite game into
a build a portal accepts: the portal build plugins, the SDK adapter the game calls at runtime, and
a fake portal that runs the build in Playwright. Reach for it when a game ships to CrazyGames as
well as to its own site.

**Linked and copied.** The plugins (`@ummgames/dev/vite`) and the fake portal
(`@ummgames/dev/testing`) are linked: they run from `node_modules`. The adapter
(`runtime/portal/`) is copied: it ships inside the game.

The files the site build carries (`_headers`, `404.html`, licences, the app icon) are in
[build.md](build.md). None of them belongs in the portal build.

**The rules change.** The limits and calls here follow CrazyGames' docs as read on 2026-11-12:
the [requirements](https://docs.crazygames.com/requirements/intro/) and the
[HTML5 SDK](https://docs.crazygames.com/sdk/intro/). Read them again before a submission.

## Quick start

**1. Add the portal plugins** to the Vite config. A plain `vite build` stays the site build;
`vite build --mode portal` is the portal build.

```js
// vite.config.mjs
import { defineConfig } from 'vite'
import {
  PORTAL_MODE,
  portalCheck,
  portalPrune,
  portalSdk,
  portalSiteOnly,
} from '@ummgames/dev/vite'

export default defineConfig(({ mode }) => {
  const portal = mode === PORTAL_MODE
  return {
    base: portal ? './' : '/',
    plugins: portal ? [portalSdk(), portalPrune(), portalSiteOnly(), portalCheck()] : [],
    build: { outDir: portal ? 'dist-portal' : 'dist', sourcemap: !portal },
  }
})
```

**2. Copy the adapter in:**

```sh
pnpm exec umm-dev copy portal
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

// The game's own mixer. The adapter mutes it while an ad plays or the portal asks for silence.
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

**When it works,** the build drops the dev-tools chunk and prints its size:

```
vite v8.3.5 building client environment for portal...
[plugin umm:portal-prune] dropped assets/dev-tools-vbHtoDvf.js: nothing in the build loads it
[plugin umm:portal-check] 2 of 1500 files, 0.0 MB of 50.0 MB; fits the 20.0 MB mobile homepage size
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

**7. Upload it.** `dist-portal/` is the upload: `index.html` sits at its top. Drag the folder's
contents into CrazyGames' developer portal, or zip them so `index.html` is at the zip's top. A zip
made from the folder itself (Windows' "Send to, Compressed folder" on `dist-portal`) puts
everything one level down, and the game will not load.

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

**A Basic Launch needs no SDK,** but the script does no harm there: the adapter plays on with or
without it. Leave it in, so a Full Launch needs no rebuild.

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
`build.sourcemap` set to `true` or `'hidden'` nothing is ever dropped. `portalCheck` fails a build
that ships a `.map`.

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
| `attribute` | `string` | `'data-site-only'` | The marker attribute. It must start with a letter, then letters, digits and `-` only; anything else throws `bad attribute name: <name>` when the config loads. |

**What it changes.** It removes every element carrying the attribute from `index.html`, with its
contents and its line. CrazyGames bans cross-promotion and links to a playable web version, so
mark whatever names your site. It applies to `vite build` only.

**What it can match:**
- An element with a closing tag: `<p data-site-only>...</p>`. The opening tag may span lines.
- Not a void element. A marked `<link>`, `<meta>` or `<img>` is left in. `portalCheck` then fails
  the build, because the marker is still there. Wrap it in a marked `<span>` or `<div>`.
- Not an element holding another element of its own tag name. A marked `<div>` that holds a
  `<div>` is cut at the inner `</div>`, which leaves broken HTML.
- The marker matches as a prefix: `data-site-only-x` is stripped too.

**It reads `index.html` only.** A link the game's script draws, such as a credits line, is the
game's to gate on `PORTAL`.

```html
<!-- index.html, with portalSiteOnly() -->
<p data-site-only>More games at <a href="/games/">our site</a></p>
```

```js
// Another marker name.
plugins: [portalSiteOnly({ attribute: 'data-own-site' }), portalCheck({ attribute: 'data-own-site' })]
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

**What it emits.** Each listed file, at the same path in the build. A path that does not exist,
or holds `..`, fails the build:

```
[plugin umm:portal-assets]
RolldownError: models/gone.glb is missing from public/: run pnpm assets first
```

**The `limits` option moved** to `portalCheck` in 0.11.0. Passing it throws
`portalAssets: limits moved to portalCheck() in 0.11.0` when the config loads.

```js
plugins: [portalAssets({ paths: ['models/hero.glb', 'audio/theme.ogg'] })]
```

```js
// All of public/ but a dev-only folder: the list read from the game at build time.
import path from 'node:path'
import { portalAssets, publicFiles } from '@ummgames/dev/vite'

portalAssets({
  paths: (root) => publicFiles(path.join(root, 'public'), { exclude: ['dev/'] }),
  missingHint: 'run pnpm assets first',
})
```

**index.html is not rebased.** With `publicDir` off, Vite leaves a root-absolute link to a
public file as written, so `href="/icon.svg"` stays, and `portalCheck` fails it as
root-absolute. Write such links relative (`href="icon.svg"`), or rewrite them in the game's
portal config with a small `transformIndexHtml` hook.

**When to use it.** A game that needs all of `public/` keeps `publicDir` on and skips this
plugin. A game whose `public/` holds files the portal build must not carry (a dev-only model, raw
art, the site's `_headers`) turns `publicDir` off and lists what it needs.

## `portalCheck(options)`

```ts
portalCheck(options?: { limits?: { files: number, bytes: number } | false, attribute?: string, log?: boolean }): Plugin
```

| Option | Type | Default | What it does |
|---|---|---|---|
| `limits` | `{ files: number, bytes: number }` or `false` | `CRAZYGAMES_LIMITS`: `{ files: 1500, bytes: 50000000 }` | The upload limits to hold the folder to. `false` checks none. |
| `attribute` | `string` | `'data-site-only'` | The marker `portalSiteOnly` strips. One still in `index.html` fails. |
| `log` | `boolean` | `true` | Print the size line. |

**What it checks.** After Vite writes the folder, it reads every file on disk, so files copied
from an enabled `publicDir` count too. The build fails on any of:
- more files or bytes than `limits`;
- no `index.html` at the top of the folder;
- a `src` or `href` in `index.html` that starts with a single `/`, which breaks under the portal's
  own path: build with `base: './'`;
- a source map (`.map`), a dotfile, or a site file (`_headers`, `_redirects`, `_routes.json`);
- an element still marked with `attribute` in `index.html`.

```
RolldownError: the portal build breaks the portal's rules:
  1502 files (limit 1500)
  index.html: /assets/index-CGx80H_5.js is root-absolute (set base: './')
```

**The size line.** It prints on every build, so a build shows how close it is:

```
[plugin umm:portal-check] 412 of 1500 files, 31.6 MB of 50.0 MB; over the 20.0 MB mobile homepage size
```

- **The files stay on disk.** The check runs after writing, so `dist-portal/` is complete even
  though `vite build` exits 1. Never upload a build from a failed run.
- **MB is 1,000,000 bytes,** the stricter reading of CrazyGames' "50MB".
- **It holds the whole build to the first-download limit.** CrazyGames allows 250 MB in all when
  the game loads the rest after play starts, through the SDK. Without the SDK, the whole build is
  the first download. Pass `limits: { files: 1500, bytes: 250_000_000 }` only for a game that
  streams what it does not need at once.
- **The mobile line is advice.** Under 20 MB, the game can be shown on CrazyGames' mobile
  homepage. Over it, the build still passes.

```js
plugins: [portalCheck()]
```

```js
// By hand, on a folder already built: the same check and numbers.
import { checkPortalBuild } from '@ummgames/dev/vite'
const report = checkPortalBuild('dist-portal')
console.log(report.files, report.bytes, report.mobile, report.problems)
```

## `portalNoSelect(options)`

```ts
portalNoSelect(options?: { selector?: string }): Plugin
```

| Option | Type | Default | What it does |
|---|---|---|---|
| `selector` | `string` | `'body'` | The element text selection is turned off on. A selector holding `{`, `}` or `<` throws. |

It adds one `<style>` to `<head>` of the portal build:

```html
<style>body{-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none}</style>
```

**Why.** CrazyGames' technical rules ask a game to turn text selection off, with every prefix.
On a phone, a long press or a drag over the page otherwise selects text and pops up the copy menu
over play. Many games set the plain and `-webkit-` rules in `index.html` already. This adds all
four, in the portal build only, so the site build stays byte for byte.

**A text field still selects.** The rule is a type selector, so any rule of the game's with a
class or an id (`.name-entry { user-select: text }`) wins over it.

```js
plugins: [portalSdk(), portalNoSelect(), portalPrune(), portalSiteOnly(), portalCheck()]
```

## Constants and pure functions

| Export | What it is |
|---|---|
| `PORTAL_MODE` | `'portal'`: the Vite mode the adapter reads as the portal build. |
| `CRAZYGAMES_SDK_URL` | `'https://sdk.crazygames.com/crazygames-sdk-v3.js'` |
| `CRAZYGAMES_LIMITS` | `{ files: 1500, bytes: 50000000 }` |
| `CRAZYGAMES_MOBILE_BYTES` | `20000000` |
| `SITE_FILES` | `['_headers', '_redirects', '_routes.json']` |
| `orphanChunks(files)` | The file names `portalPrune` would drop. |
| `stripSiteOnly(html, attribute?)` | `html` as `portalSiteOnly` leaves it. |
| `overLimits(sizes, limits?)` | What breaks a limit, in the words of the error; `[]` when the sizes fit. |
| `publicFiles(dir, { exclude? })` | Every file under `dir`, relative with `/`, sorted; no dotfiles or dot folders, no `SITE_FILES` at the top, nothing starting with an `exclude` prefix. `[]` when `dir` is missing. |
| `checkPortalBuild(dir, options?)` | `{ files, bytes, mobile, problems }` for a written folder; takes `portalCheck`'s `limits` and `attribute`. |
| `NO_SELECT_CSS` | The rule `portalNoSelect` adds, for `body`. |
| `noSelectCss(selector?)` | The same rule for another selector. |

## Runtime: `runtime/portal/`

| File | Exports |
|---|---|
| `build-target.ts` | `PORTAL`, `PORTAL_MODE` |
| `portal-sdk.ts` | `createPortalSdk`, `NO_PORTAL`, `localStore`, `roomFromParams`, `INIT_WAIT_MS`, `AD_START_WAIT_MS`, `ROOM_CODE`, and the types `PortalSdk`, `PortalSdkOptions`, `PortalSettings`, `PortalStorage`, `CrazySdk`, `CrazyAdError` |

`portal-sdk.ts` imports `./build-target`, so the two files live in the same folder.

### Where the adapter goes

**By default it lands in `src/portal/`.** `umm-dev copy` writes to
`<runtime.into>/<path under runtime/>`, and `runtime.into` is `src`. To put it elsewhere:

| You want | Run |
|---|---|
| Both files in another folder | `pnpm exec umm-dev copy portal --to src/boot/` |
| The adapter over a file the game already has | `pnpm exec umm-dev copy portal/portal-sdk.ts --to src/boot/portal-sdk.ts --force`, then the same for `build-target.ts` |
| Every runtime copy under another folder | `runtime: { into: 'src/shared' }` in `umm-dev.config.mjs` |

**Without `--to`, a game that already has an adapter gets a second one** in `src/portal/`.
Delete it, and copy again with `--to`.

**Keep the game's glue as plain functions.** The site build drops the adapter only when nothing
outside `if (PORTAL)` keeps it alive. An exported object whose method writes to it (for example
`portal.silent = m`) counts as a side effect, so the adapter stays in the site bundle even with
the `/* @__PURE__ */` marks. Exported functions that call the adapter under `if (PORTAL)` drop
cleanly.

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
- a link to the game's own site, or to an app store;
- a fullscreen button: CrazyGames gives every game one, and bans the game's own;
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
| `adStartWaitMs` | `number` | `6000` (`AD_START_WAIT_MS`) | How long an ad call waits for an ad to start before resolving. |
| `roomParam` | `string` | `'room'` | The invite parameter that names a room. |
| `roomCode` | `RegExp` | `ROOM_CODE`: `/^[A-Z0-9]{4,12}$/` | What a room code looks like, tested after upper-casing. |
| `warn` | `(message: string, error?: unknown) => void` | `console.warn`, prefixed `[portal] ` | Where a failed call is reported. |

**Every call is guarded.** A call that throws is reported through `warn` as
`[portal] <call> failed`, and the game plays on.

### The `PortalSdk` calls

| Call | What it does | On the stub |
|---|---|---|
| `name` | `'crazygames'`, or `'none'` for the stub. | `'none'` |
| `loadingStop()` | Boot is done and the first frame is about to show. `createPortalSdk` already sent `loadingStart`. | nothing |
| `setGameplay(on)` | The player is playing now, or not. Sends `gameplayStart` or `gameplayStop`, only on a change. | nothing |
| `midgameAd()` | Asks for a midgame ad. Resolves when it is over, shown or not. Never rejects. | resolves at once |
| `rewardedAd()` | Asks for a rewarded ad. Resolves `true` when it played to the end, else `false`. Never rejects. | `false` |
| `hasAdblock()` | Whether the portal thinks an ad blocker is on. `false` on a failure. | `false` |
| `happytime()` | A big moment, such as a boss beaten. Use it sparingly. | nothing |
| `progress(percent)` | How far through the game the player is: clamped to 0 to 100, rounded. A non-number is dropped. | nothing |
| `setContext(context)` | State attached to a player's feedback report, such as `{ level: 3 }`. `null` clears it. | nothing |
| `settings()` | `{ muteAudio, disableChat }` as the portal has them now. | both `false` |
| `onSettings(fn)` | `fn(settings)` on every change. | never called |
| `device` | `'desktop'`, `'tablet'`, `'mobile'`, or null. Read once, at init. | `null` |
| `locale` | The player's locale, such as `'en-US'`, or null. Read once, at init. | `null` |
| `storage` | Saves: `getItem`, `setItem`, `removeItem`. The portal's data module, else `localStorage`. Never throws. | `localStorage` |
| `instantMultiplayer` | True when the player launched from the portal's multiplayer UI. Read once, at init. | `false` |
| `inviteRoom` | The room code from the invite the player launched from, or null. Read once, at init. | `null` |
| `onJoinRoom(fn)` | `fn(code)` runs when a friend's invite is clicked while the game runs. | never called |
| `updateRoom(code, joinable)` | Reports the room this player is in, hosting or joined, joinable or full. | nothing |
| `leftRoom()` | The player is back to playing alone. | nothing |
| `inviteLink(code)` | The portal's link to the room, or null. On null, make your own link. | `null` |
| `username()` | The portal username; `''` for a guest; null with no user API at all. | `null` |

### The call order

1. **Boot.** Call `createPortalSdk(audio)` first, before loading assets. It sends `loadingStart`
   and takes at most `initWaitMs`.
2. **Loaded.** Call `loadingStop()` once, when the first frame is about to show.
3. **Play.** Call `setGameplay(true)` when the player actually plays, and `setGameplay(false)` for a
   menu, a pause, a load, a level end or an ad. Do not stop it when the page loses focus.
   - A Basic Launch needs `gameplayStart` and nothing else, so this step is the minimum.
   - In a game that starts on a click, that is when play starts, not when loading ends.
   - In a pointer-lock game, call `setGameplay(true)` on `pointerlockchange` when the lock is
     taken, and `setGameplay(false)` when it is released.
4. **Breaks.** At a natural break (a level end, a death): `setGameplay(false)`, then
   `await midgameAd()`, then `setGameplay(true)`. Never on a menu button.
5. **Rewards.** Off the play screen, on the player's own click: `if (await rewardedAd()) give()`.
   On `false`, give nothing and say so.
6. **Big moments.** `happytime()`, rarely.
7. **Multiplayer (optional).** A solo game skips this.
   - At boot, read `instantMultiplayer` (host a joinable room at once, no menu) and
     `inviteRoom` (join that room at once).
   - Register `onJoinRoom` once.
   - Call `updateRoom(code, joinable)` on hosting, on joining, and whenever the room fills or
     opens again. Call `leftRoom()` on leaving.
   - A share button uses `inviteLink(code)`, and the game's own link when that is null.
   - Turn chat off while `settings().disableChat` is true.

**Room codes.** A room is the game's own session code, carried in the invite as
`{ [roomParam]: code }`. Codes from the portal are upper-cased, then tested against `roomCode`;
one that fails is dropped, so `onJoinRoom` never sees it. `roomFromParams(params, roomParam?,
roomCode?)` does that check on its own.

### The mute contract

- `audio.setMuted(true)` runs when the portal wants the game silent: an ad is playing, or its
  `muteAudio` setting is on. `audio.setMuted(false)` runs when neither holds. Only changes are
  sent.
- **`muteAudio` at boot mutes at once,** inside `createPortalSdk`. It takes priority over the
  game's own sound setting.
- **Only an ad that plays mutes.** With no fill, a blocked ad or the stub, an ad never calls
  `setMuted`.
- An ad call resolves on the first of: the ad finishing, the ad erroring, `requestAd` throwing,
  or `adStartWaitMs` with no start.
- **A late start still mutes.** An ad that starts after `adStartWaitMs` plays over a game that
  has already resumed. The adapter mutes the game then, and unmutes it when that ad ends. The
  promise has already resolved, `false` for a rewarded ad, and does not resolve again.
- **Keep `setMuted` apart from the player's own mute.** The adapter calls `setMuted(false)` when
  the portal is done with silence, whatever the player chose. Treat it as a second flag: the
  game is silent when the player muted it or the portal does.

### Saves

`storage` writes to the portal's data module, which follows a signed-in player across devices
and keeps a guest's data in `localStorage`. Without the module (the stub, an old SDK, or a game
submitted without "Progress Save"), or when a call to it throws, it uses `localStorage` itself.
CrazyGames caps a game's data at 1 MB as JSON. A Full Launch with accounts needs saves to go
through here; a Basic Launch does not.

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

This is the Quick start game's spec.

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
pnpm exec playwright test -c playwright.portal.config.mjs
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

### `sdk`: the fake SDK's behaviour

| Field | Type | Default | What it sets |
|---|---|---|---|
| `environment` | `'crazygames' \| 'local' \| 'disabled'` | `'crazygames'` | What `SDK.environment` reports. `'disabled'` makes the adapter take the stub. |
| `init` | `'ok' \| 'hang' \| 'reject'` | `'ok'` | How `init()` behaves. `'hang'` and `'reject'` make the adapter take the stub. |
| `ad` | `{ fill?, startMs?, lengthMs? }` | `true`, `100`, `300` | An ad starts after `startMs` and plays for `lengthMs`. `fill: false` errors with `{ code: 'unfilled' }` instead. Midgame and rewarded alike. |
| `adblock` | `boolean` | `false` | What `hasAdblock()` answers. |
| `settings` | `{ muteAudio?, disableChat? }` | both `false` | The portal's settings at boot. |
| `device` | `'desktop' \| 'tablet' \| 'mobile'` | `'desktop'` | `user.systemInfo.device.type`. |
| `locale` | `string` | `'en-US'` | `user.systemInfo.locale`. |
| `data` | `boolean` | `true` | Whether the SDK has `SDK.data`, kept in memory. |
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
| `data()` | What the game saved through `SDK.data`, key to value. |
| `joinRoom(invite)` | Fires the game's join listener, as the portal does when a friend's invite is clicked. A string is sent as `{ [roomParam]: code }`. |
| `setSettings(settings)` | Changes the portal's settings and fires the game's settings listeners, as a player does in the portal's menu. |
| `elsewhere` | `string[]`: requests to other hosts, blocked. |
| `missing` | `string[]`: paths on the portal with no file behind them, answered 404. |
| `served` | `string[]`: the build's files that were served, relative to `dist`. |
| `queries` | `Map<string, string>`: each served file's query string. |
| `sockets` | `string[]`: WebSocket dials that were closed. |

**`calls()`** resolves to strings from this set: `init`, `loadingStart`, `loadingStop`,
`gameplayStart`, `gameplayStop`, `requestAd:midgame`, `requestAd:rewarded`, `adStarted`,
`adFinished`, `adError`, `happytime`, `progress:<n>`, `context:<json>`, `context:clear`.
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

### The other testing exports

| Export | What it is |
|---|---|
| `fakeSdkScript(options?)` | The fake SDK's script on its own, for a page the spec builds itself. Calls land in `window.__fakePortal.calls`, `.rooms` and `.data`. `inviteLinkBase` defaults to `https://portal.test/invite` here. |
| `PORTAL_HOST` | `'https://portal.test'` |
| `CRAZYGAMES_SDK_URL` | The same URL as the Vite export. |

`fakePortal` takes any Playwright `Page`. Its types are structural, so a game needs only
`@playwright/test`.

## `umm-dev portal check`: the build in Chrome, with a verdict

```sh
pnpm exec umm-dev gpu run --name portal-check -- umm-dev portal check
```

One command that runs the portal build the way CrazyGames does and says whether it passes. Run
it before each upload. A fake-portal spec checks what one game does; this checks what every
portal build must do, and runs the game's own steps in the middle.

**What it does, in order:**
1. Runs `portal.build` (`pnpm build:portal`), unless `--no-build` is given or none is set.
2. Reads the folder with `checkPortalBuild`: the limits, `index.html` at the top, relative URLs,
   no source maps, no site files. Then it scans every `.js`, `.mjs`, `.html` and `.css` file for
   the words in `portal.forbidden` (a relay's host, `WebSocket`, the game's own site). Case
   matters.
3. Opens the build in the fake portal in Chrome, once per run. Each run waits for
   `portal.ready`, waits `settleMs`, and shoots the title. Then it calls `portal.play` with the
   page and the game frame.
4. Fails a run on:
   - a console error or an uncaught exception;
   - a request to any other host;
   - a missing file;
   - a WebSocket dial;
   - a load over `loadLimitMs` (20 s, CrazyGames' limit for desktop Chrome);
   - SDK calls out of order: `init` not first, no `loadingStart` then `loadingStop`, a
     `gameplayStart` before `loadingStop`, `gameplayStart` or `gameplayStop` twice in a row,
     or no `gameplayStart` once the play steps ran;
   - with `noAds`, any `requestAd` call. A Basic Launch build is checked with ads off.
5. Writes the stills and `report.json` to `out`, and exits 1 on any failure.

**The runs.** There are two by default, both in CrazyGames' smallest desktop frame, 907 x 510 at
devicePixelRatio 1. `desktop` has the fake SDK. `nosdk` has the SDK script blocked, as an ad
blocker does: the blocked script is not a failure there, and no SDK call is due. Console lines
about blocked requests (`ERR_BLOCKED_BY_CLIENT`) are never counted as errors, because each
blocked request is already reported once, under other hosts.

| Option | What it does |
|---|---|
| `--no-build` | Skip `portal.build`: check the folder as it is. |
| `--dir <dir>` | The built portal folder. Default `portal.dir`, `dist-portal`. |
| `--out <dir>` | Where the stills and `report.json` go. Default `portal.out`, `test-results/portal-check`. |
| `--only <run,...>` | Only these runs, by name. An unknown name exits 2. |
| `--cpu` | Draw in software (SwiftShader). Needs no GPU lease, and runs far slower. |
| `--headed` | Show the browser. |

**The GPU.** Chrome draws on the GPU, through Direct3D 11 on Windows. Take the lease with
`umm-dev gpu run` ([agent.md](agent.md)). `--cpu` needs no lease and proves the same things,
more slowly.

**When it works:**

```
== files
  ok   31 files, 12.4 MB, within the limits and the mobile homepage size
  ok   none of WebSocket wss:// in the code
== desktop
  ok   Enter starts a run
  ok   desktop: loaded in 3120 ms, clean
== nosdk
  ok   Enter starts a run
  ok   nosdk: loaded in 2980 ms, clean
portal check: ok. Stills in /home/me/my-game/test-results/portal-check
```

The stills are the game's frame alone, at its own size, named `<run>-<nn>-<step>.png`
(`desktop-01-title.png`): what a player in that frame sees.

### The game's own steps: `portal.play`

`play` is an async function in `umm-dev.config.mjs`. It runs once per run, after the title
still, and gets one argument:

| Field | What it is |
|---|---|
| `run` | The run: `{ name, frame, sdk, touch, ... }`. Branch on `run.name` or `run.sdk`. |
| `page` | The Playwright page holding the portal. Keys go to `page.keyboard`. |
| `game()` | The game's frame, looked up again each call, so a reload is followed. |
| `portal` | What `fakePortal` returned: `calls()`, `elsewhere`, `setSettings()` and the rest. |
| `context` | The browser context, for a CDP session (raw touches). |
| `still(name)` | Shoot the game's frame as the next still. |
| `ok(what)`, `fail(why)` | Print a passed check; record a failed one and go on. |
| `log(line)` | Print a line. |

Throw to stop the run: the error becomes a `stopped:` failure, with a `stopped` still.

```js
// umm-dev.config.mjs
// @ts-check
import { defineConfig } from '@ummgames/dev'

export default defineConfig({
  portal: {
    build: 'pnpm build:portal',
    forbidden: ['WebSocket', 'wss://'],
    noAds: true,
    // The loading plate is gone: the first frame is drawn.
    ready: () => !document.getElementById('loading'),
    async play({ page, game, still, ok, fail }) {
      await game().locator('body').click({ position: { x: 5, y: 5 } })
      await page.keyboard.press('Enter')
      await game().waitForFunction(() => window.__game?.mode === 'run', null, { timeout: 10_000 })
      ok('Enter starts a run')
      await page.keyboard.press('KeyP')
      if (!(await game().evaluate(() => window.__game.mode === 'paused'))) fail('P does not pause')
      await still('paused')
    },
  },
})
```

**A phone.** Add a run with `touch: true`: an emulated touch phone, its viewport the frame's
size, at 2x. Give the SDK's device too, so the game's touch mode follows it:

```js
runs: [
  { name: 'desktop' },
  { name: 'nosdk', sdk: false },
  { name: 'phone', frame: { width: 667, height: 375 }, sdk: { device: 'mobile' }, touch: true },
],
```

**From a script of the game's own,** call the same check with options in place of config:

```js
import { runPortalCheck } from '@ummgames/dev/testing'

const result = await runPortalCheck({ dir: 'dist-portal', play: myPlay })
process.exit(result.ok ? 0 : 1)
```

| Export (`@ummgames/dev/testing`) | What it is |
|---|---|
| `runPortalCheck(options?)` | The whole check. Takes the Config keys below, plus `root`, `only`, `cpu`, `headed` and `log`. Resolves `{ ok, problems, files, runs, out }`. |
| `runProblems(seen, rules)` | What one run broke, from what it saw. The rules above, as a pure function. |
| `forbiddenHits(dir, words)` | Each word found in the build's code, with the files holding it. |
| `portalChromeArgs({ cpu? })` | Chrome's flags for the GPU, or for SwiftShader. |
| `DEFAULT_PORTAL_RUNS`, `CRAZYGAMES_SMALLEST_FRAME`, `PORTAL_LOAD_LIMIT_MS` | The defaults: the two runs, `{ width: 907, height: 510 }`, `20000`. |

## Config: `portal`

| Key | Default | What it does |
|---|---|---|
| `dir` | `'dist-portal'` | The built portal folder, relative to the game root. |
| `build` | `null` | A shell command run in the game root first (`'pnpm build:portal'`). None: the folder is checked as it is. |
| `out` | `'test-results/portal-check'` | Where the stills and `report.json` go. |
| `forbidden` | `[]` | Words the build's `.js`, `.mjs`, `.html` and `.css` files must not hold. Case matters. |
| `limits` | CrazyGames': `{ files: 1500, bytes: 50000000 }` | `checkPortalBuild`'s limits; `false` checks none. |
| `ready` | `null`, which waits for `document.readyState === 'complete'` | A function run in the game frame until it returns true: the game has loaded. The load time runs from opening the portal page to this. |
| `readyTimeoutMs` | `60000` | How long `ready` may take before the run stops. |
| `loadLimitMs` | `20000` | A load slower than this fails. |
| `settleMs` | `1000` | The wait between `ready` and the title still. |
| `play` | `null` | The game's own steps; see above. |
| `runs` | `[{ name: 'desktop' }, { name: 'nosdk', sdk: false }]` | The runs. Each has a `name`, and optionally `frame` (907 x 510), `sdk` (`{}`; `false` blocks it), `touch`, `viewport` (the frame plus 40 px each way), `deviceScaleFactor` (1, or 2 with `touch`), `query`, `play` (`false` skips the steps) and `calls` (the exact SDK calls, in place of the order rules). |
| `noAds` | `false` | Any `requestAd` call fails the run. |
| `hideGamepads` | `true` | `navigator.getGamepads()` returns none, so a pad plugged into the machine moves nothing. |
| `gamePath` | `'/games/game/'` | The game's folder on the fake portal. |
| `channel` | none: Chrome, then Edge, then Playwright's Chromium | The Chromium to run. |

`umm-dev portal check` needs `playwright` in the game: `pnpm add -D playwright`.

## How it works

- **Build only.** All six plugins set `apply: 'build'`. The dev server has no SDK script, keeps
  every marked element, copies nothing and checks nothing.
- **The mode is the switch.** The Vite config adds the plugins when `mode === PORTAL_MODE`, and
  `build-target.ts` reads the same mode. Any other mode gives a site build with the stub adapter.
- **`portalSdk`, `portalNoSelect` and `portalSiteOnly`** are `transformIndexHtml` hooks. `portalSiteOnly` is one
  regular expression over the HTML text.
- **`portalPrune`** runs in `generateBundle`. A chunk counts as loaded when any other emitted
  text file contains its base file name.
- **`portalAssets`** emits its files in `generateBundle`.
- **`portalCheck`** runs in `writeBundle`, after the files and any `publicDir` copies are on
  disk, and reads the folder itself.
- **The adapter** reads `window.CrazyGames.SDK` once, races `init()` against `initWaitMs`, and
  checks `environment`. It reads the settings, the device, the locale and the invite once, and
  listens for settings changes. After that each call goes straight to the SDK inside a `try`.
  One flag, an ad playing or `muteAudio` on, drives `setMuted`.
- **The fake portal** is one `page.route('**/*')` and one `page.routeWebSocket(/.*/)`. The fake
  SDK keeps its record in the game frame's `window.__fakePortal`; `calls()`, `rooms()` and
  `data()` read it from there.
- **`umm-dev portal check`** is `runPortalCheck` with the game's `portal` config. Each run gets a
  fresh browser context, so no save or setting carries from one run to the next. The verdict on
  a run is `runProblems` over what the fake portal recorded once the play steps end.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `dist-portal has no index.html: build the portal target first` | The spec ran before a portal build, or the build writes elsewhere. | Run `vite build --mode portal` with `build.outDir: 'dist-portal'`, or pass `dist`. |
| `no game frame at https://portal.test/games/game/: call open() first` | `calls()`, `frame()`, `joinRoom()` or `setSettings()` ran before `open()`. | Call `await portal.open()` first. |
| `the game has not called addJoinRoomListener` | `joinRoom` ran before the game called `onJoinRoom`, or the game has the stub. | Wait for the game's boot. Check that `calls()` holds `init`. |
| `the game has not loaded the fake SDK` | `setSettings` ran on a build without the SDK script, or with `sdk: false`. | Test `dist-portal` from `vite build --mode portal`. |
| `calls()` stays `[]` | The build never loaded the SDK script: it is the site build, `sdk` is `false`, or `portalSdk()` is missing. | Test `dist-portal` from `vite build --mode portal`. |
| `calls()` stops at `['init', 'loadingStart']` | The game never called `loadingStop()`. | Follow [the call order](#the-call-order). |
| `browserType.launch: Executable doesn't exist at ...chromium_headless_shell-<revision>...` | Playwright's browser download is for another Playwright version. | Run on the installed Chrome: `E2E_CHANNEL=chrome pnpm exec playwright test`. Or run `pnpm exec playwright install chromium`. |
| `[portal] CrazyGames SDK unavailable, playing on without it Error: init timed out` | `init()` took longer than `initWaitMs`. A rejected `init()` logs the SDK's own error instead. | Expected on a slow or blocked network. The game plays on with the stub. |
| `[portal] <call> failed` | An SDK call threw. | The game plays on. Read the error logged with it. |
| `[portal] data.setItem failed` and the save is in `localStorage` | The game was submitted without "Progress Save", or its data passed 1 MB. | Turn "Progress Save" on in the submission, or save less. |
| `RolldownError: <path> is missing from public/: <hint>` | A `portalAssets` path has no file, or holds `..`. | Make the file, or fix the list. |
| `portalAssets: limits moved to portalCheck() in 0.11.0` | A config from 0.1.x. | Drop `limits` there and add `portalCheck({ limits })`. |
| `<n> files (limit 1500)` or `<x> MB (limit 50.0 MB)` | The folder breaks CrazyGames' limits. `dist-portal/` is still written. | Cut files or bytes. Do not upload that build. |
| `index.html: /assets/... is root-absolute (set base: './')` | The portal build has `base: '/'`. | `base: portal ? './' : '/'`. |
| `index.html: /<file> is root-absolute` with `base: './'` set | `publicDir` is off, so Vite leaves a link to a public file as written. | Write the link relative, or rewrite it with `transformIndexHtml` in the portal config. See [`portalAssets`](#portalassetsoptions). |
| The site bundle still holds the adapter | The game's glue is an object the code writes to, so the bundler keeps it. | Make the glue plain exported functions. See [Where the adapter goes](#where-the-adapter-goes). |
| `<file>.map: a source map (set build.sourcemap: false)` | Source maps are on in the portal build. | `sourcemap: !portal`. |
| `_headers: a site file the portal ignores`, or `<file>: a dotfile` | `publicDir` is on and `public/` holds site files, or `headers()` is in the portal build. | Drop `headers()` from the portal build; turn `publicDir` off and list files with `portalAssets` and `publicFiles`. |
| `index.html: an element marked data-site-only is still there` | `portalSiteOnly` is missing, or the marked element is void or nested. | Add the plugin; wrap the element in a marked `<span>` or `<div>`. |
| `no index.html at the top of the folder` | `build.outDir` or the HTML entry put it in a subfolder. | Build with `index.html` at the project root. |
| No `dropped` line, and a dev chunk ships | `build.sourcemap` is on, so each chunk's map names it. Or no `PORTAL` guard wraps the `import()`. | Turn source maps off in the portal build. Guard the `import()`. |
| `bad attribute name: <name>` | `portalSiteOnly({ attribute })` has a character other than letters, digits or `-`. | Use a plain attribute name. |
| The game has two adapters, one in `src/portal/` | `umm-dev copy portal` ran without `--to` in a game that keeps its adapter elsewhere. | Delete `src/portal/`, then copy again with `--to`. See [Where the adapter goes](#where-the-adapter-goes). |
| `refused  <file>: exists and is not a copy; --force overwrites` | The target is the game's own adapter, not a copy. | Add `--force`, naming that one file. |
| `the portal check needs Playwright: pnpm add -D playwright` | The game has `@playwright/test` only, or no Playwright. | `pnpm add -D playwright`. |
| `stopped: Timeout 60000ms exceeded` on every run | `portal.ready` never turns true, or the build never boots. | Look at the `stopped` still. Check `ready` against the game's own boot flag. |
| `the SDK heard init, loadingStart: no loadingStart then loadingStop` | The game never called `loadingStop()`, or the run stopped before boot ended. | Follow [the call order](#the-call-order). |
| `the SDK heard ...: no gameplayStart after the play steps` | The play steps never reached play, or the game does not send `gameplayStart`. | Look at the last still. A Basic Launch needs `gameplayStart`. |
| A run fails on a console error only on this machine | A gamepad plugged in, with `hideGamepads: false`, or a GPU driver message. | Leave `hideGamepads` on. Try `--cpu` to rule the GPU out. |

## For agents

- **CrazyGames rules the code encodes. Do not work around them:**
  - The SDK script is the first thing in `<head>` (`portalSdk`).
  - No cross-promotion, no link to a playable web version, no app store link
    (`portalSiteOnly`, and `PORTAL` guards in the game's own code).
  - No in-game fullscreen button: the portal has its own.
  - At most 1,500 files and 50 MB before play (`portalCheck`).
  - Assets load relative to the page: `base: './'` in the portal build (`portalCheck`).
  - `loadingStart` at init, then `loadingStop` once boot is done.
  - `gameplayStart` and `gameplayStop` mark play, sent only on a change. A menu, a load or an
    ad is not play. A Basic Launch needs `gameplayStart`.
  - The game is silent while an ad plays, and while the portal's `muteAudio` is on.
  - A midgame ad comes at a natural break, never on a menu button. A rewarded ad pays only on
    `true`.
  - `happytime` is for big moments only.
  - The game plays the same with an ad blocker on.
  - Text selection is off on the page, every prefix (`portalNoSelect`).
  - The game loads within 20 s in desktop Chrome, and plays the same with the SDK blocked
    (`umm-dev portal check`).
- **Rules no code here checks:** English text, readable at 800 x 450, physics the same at 144 Hz, the iOS audio unlock on a tap, PEGI 12 content, landing in
  play within one click for a Full Launch. Check them by playing the build.
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
  1. `vite build --mode portal` exits 0, prints a `dropped` line for each dev-only chunk, and
     prints the size line.
  2. `dist-portal/index.html` starts `<head>` with the SDK script and holds no `data-site-only`.
  3. `umm-dev portal check` ends `portal check: ok`, inside `umm-dev gpu run`, and its stills
     show the game, not a blank frame. The fake-portal spec passes, with `elsewhere` empty.
  4. `umm-dev drift` lists one copy of each adapter file.
  5. The upload is the folder's contents, `index.html` at the top.
