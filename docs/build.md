# Build plugins

`@ummgames/dev/vite` holds the build plugins every game's site build shares: the `_headers` file
Cloudflare Pages reads, a real `404.html`, the third-party licence notices, and the home-screen
icon and share card drawn from the game's SVG, and the loading splash's markup and portrait.
Reach for them when a game's site is served by Cloudflare Pages, when it ships dependencies
whose licences it must show, or when it shows the Uncle Matt Makes splash. Each plugin is
configured by its options and reads nothing else from the game.

**Linked.** These plugins run from `node_modules` at build time; only their output ships.

## Quick start

```js
// vite.config.mjs
import { defineConfig } from 'vite'
import { appIcon, headers, licences, notFoundPage } from '@ummgames/dev/vite'

export default defineConfig({
  plugins: [
    headers({ immutableAssets: true }),
    notFoundPage(),
    licences({ page: 'licences.html' }),
    appIcon({ svg: 'icon.svg', shareCard: true }),
  ],
})
```

`icon.svg` sits at the game's root, in the form `appIcon` reads:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="#1d2330"/>
  <path fill="#f2b33d" d="M16 48 L32 12 L48 48 Z"/>
  <path fill="#e8e6e1" d="M26 40 h12 v4 h-12 z"/>
</svg>
```

```sh
pnpm exec vite build
```

**When it works,** the build lists the new files beside the game's own:

```
dist/_headers                      0.27 kB
dist/index.html                    0.45 kB │ gzip: 0.29 kB
dist/404.html                      0.94 kB │ gzip: 0.56 kB
dist/apple-touch-icon.png          1.35 kB
dist/licences.html                 1.64 kB │ gzip: 1.01 kB
dist/share-card.png                5.53 kB
dist/assets/index-yBffvZFW.js      4.62 kB │ gzip: 2.07 kB
```

`dist/_headers`:

```
/*
  Strict-Transport-Security: max-age=31536000
  X-Frame-Options: SAMEORIGIN
  Content-Security-Policy: frame-ancestors 'self'
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

`dist/index.html` gains `<link rel="apple-touch-icon" href="/apple-touch-icon.png">` at the end
of `<head>`.

**No config section.** None of these plugins reads `umm-dev.config.mjs`.

| Plugin | What it emits | Runs in |
|---|---|---|
| `headers()` | `_headers` | `vite build` |
| `notFoundPage()` | `404.html` | `vite build` |
| `licences()` | the `virtual:licences` module, and a licences page if asked | dev and build |
| `appIcon()` | `apple-touch-icon.png` and its `<link>`, and `share-card.png` if asked | dev and build |
| `devSplash()` | the splash's markup and stylesheet link in `index.html`, and `brand/uncle-matt-circle.webp` | dev and build |

## `headers(options)`: `_headers`

```ts
headers(options?: {
  immutableAssets?: boolean
  rules?: Record<string, Record<string, string>>
}): Plugin
```

Cloudflare reads a top-level `_headers` file and adds its headers to every static response that
matches, on Workers static assets as on Pages. Pages would send `nosniff` and a referrer policy on
its own; Workers static assets, where the game sites are, sends neither, so the set has both.

| Option | Type | Default | What it does |
|---|---|---|---|
| `immutableAssets` | `boolean` | `false` | Adds a year-long immutable cache rule for `/<build.assetsDir>/*`, and fails the build on an unhashed file there. |
| `rules` | `Record<string, Record<string, string>>` | `{}` | More path rules, written after the built-in ones. |
| `framedBy` | `string[]` | `[]` | Exact `https://` origins that may frame the site beside its own. |

The assets folder is Vite's `build.assetsDir` (default `assets`), read from the config.

**The security headers,** on `/*`:
- `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`.
- `Strict-Transport-Security: max-age=31536000`, with no `includeSubDomains` and no `preload`.
- Framing by the site's own origin only: `X-Frame-Options: SAMEORIGIN` and
  `Content-Security-Policy: frame-ancestors 'self'`.
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`. Gamepads,
  fullscreen and the clipboard stay at the browser's default.

**Framed by another site of ours.** `framedBy: ['https://tv.ummgames.com']` lets that origin show
the site in an iframe, as a station airs a game. The `/*` rule then sends
`Content-Security-Policy: frame-ancestors 'self' https://tv.ummgames.com` and no `X-Frame-Options`,
which cannot name another origin; every browser that reads `frame-ancestors` prefers it anyway. Only
exact `https://` origins are taken: no path, no wildcard, no `http://`. Do not use it to keep one
`/*` rule of your own beside the kit's, since Cloudflare drops an earlier rule with the same pattern.

**What the Worker answers itself.** `_headers` reaches only the static files. A page or API route
the site Worker's script answers goes out without these headers unless the script adds them: copy
`worker/security-headers.ts` ([runtime.md](runtime.md#security-headersts)), give its
`securityHeaders()` the same `framedBy` and `rules`, and wrap each response in
`withSecurityHeaders`. The kit's tests hold that file to this plugin's `/*` rules.

**For the site build only.** Leave `headers()` out of a portal build: the portal hosts the files
and sends its own headers, and `portalCheck` fails a build that carries a `_headers`
([portal.md](portal.md)). `target: 'portal'` and `frameAncestors`, removed in 0.2.0, still throw
when the config loads, so an old config fails rather than ships headers that refuse the frame.

**The cache rule.** `immutableAssets: true` adds
`/assets/* Cache-Control: public, max-age=31536000, immutable`. The build fails if any file under
`assets/` lacks an 8-character content hash before its extension (`index-CGx80H_5.js`). It checks:
- the bundle's own files, including those emitted by plugins that run before `headers()`;
- the files `public/assets/` would copy in, when `publicDir` is on.

**Put `headers()` last in `plugins`.** A plugin listed after it that writes into `assets/` adds
its files after the check has run, so an unhashed file there is cached for a year unchecked.

**Left out on purpose:**
- **COOP and COEP.** They break cross-origin assets unless every host opts in.
- **A full Content-Security-Policy.** A wrong policy breaks the game. Run one in Report-Only
  first.

```js
plugins: [headers({ immutableAssets: true, rules: { '/levels/*': { 'Cache-Control': 'no-cache' } } })]
```

```
/*
  Strict-Transport-Security: max-age=31536000
  X-Frame-Options: SAMEORIGIN
  Content-Security-Policy: frame-ancestors 'self'
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
/assets/*
  Cache-Control: public, max-age=31536000, immutable
/levels/*
  Cache-Control: no-cache
```

## `notFoundPage(options)`: `404.html`

```ts
notFoundPage(options?: NotFoundOptions): Plugin
```

Without a top-level `404.html`, Pages answers any unknown path with status 200 and the game, so a
typo'd link looks like a working one and a crawler indexes every path as the game. This page is
plain HTML with no script, works in light and dark, and carries
`<meta name="robots" content="noindex" />`. It is emitted by the build, so a build with
`publicDir: false` has it too.

| Option | Type | Default | What it does |
|---|---|---|---|
| `title` | `string` | `'Not found'` | The tab's title. |
| `heading` | `string` | `'There is nothing at this address'` | The `<h1>`. |
| `message` | `string` | `'The link may have a typo in it, or the page has moved.'` | The line under it. |
| `homeHref` | `string` | `'/'` | Where the link goes. |
| `homeLabel` | `string` | `'Back to the game'` | The link's text. |
| `html` | `string` | none | A whole page of your own, used as given. The other options are then ignored. |

Every value but `html` is HTML-escaped.

```js
plugins: [notFoundPage({ homeLabel: 'Play the game' })]
```

```js
import fs from 'node:fs'
plugins: [notFoundPage({ html: fs.readFileSync('src/404.html', 'utf8') })]
```

## `licences(options)`: third-party notices

```ts
licences(options?: LicencesOptions): Plugin
```

The plugin reads the game's `package.json` `dependencies`, the packages that ship in the bundle
(devDependencies never do). For each one it collects, from `node_modules/<name>/`:
- the version;
- the `license` field;
- every `LICENSE`, `LICENCE`, `COPYING` and `NOTICE` file (bare, `.md` or `.txt`), licences first.

The game imports the list:

```js
import { LICENCES } from 'virtual:licences'
// [{ name: 'ms', version: '2.1.3', licence: 'MIT', text: 'The MIT License (MIT)...' }], sorted by name
```

| Option | Type | Default | What it does |
|---|---|---|---|
| `fallbackDir` | `string` | `'licences'` | The folder, relative to Vite's root, for licence files a package leaves out. |
| `include` | `string[]` | `[]` | Packages to list beyond `dependencies`. Each must be at `node_modules/<name>`. |
| `exclude` | `string[]` | `[]` | Dependencies to leave out, such as a types-only package. |
| `module` | `string` | `'virtual:licences'` | The virtual module's id. |
| `page` | `string` or `false` | `false` | Also emit the list as a static page with this file name, such as `licences.html`. |
| `pageTitle` | `string` | `'Licences'` | The page's `<title>` and `<h1>`. |
| `pageIntro` | `string` | none | A line of text above the list. |

**A package with no licence file.** Add the text yourself as
`<fallbackDir>/<scope>-<name>.LICENSE`: `@scope/pkg` is `licences/scope-pkg.LICENSE`. A
dependency with neither a licence file nor a fallback fails the build, so a new dependency cannot
ship without its notice. So does a dependency with no `license` field, even with a fallback file.

**Types.** Declare the module once in the game:

```ts
declare module 'virtual:licences' {
  export const LICENCES: import('@ummgames/dev/vite').Licence[]
}
```

```js
plugins: [licences({ page: 'licences.html', pageIntro: 'This game uses these packages.' })]
```

```js
// Fallback notices kept in legal/, and a types-only dependency left out.
// legal/scope-pkg.LICENSE holds the text for @scope/pkg, whose tarball has none.
plugins: [licences({ fallbackDir: 'legal', exclude: ['@types/three'] })]
```

## `appIcon(options)`: the home-screen icon and the share card

```ts
appIcon(options: AppIconOptions): Plugin
```

The plugin draws `apple-touch-icon.png` (180 px) from the game's SVG at build time, so no PNG is
committed and the icons cannot drift. It:
- serves the icon from memory in dev, and redraws it when the SVG changes;
- emits it at the build's root;
- adds `<link rel="apple-touch-icon">` at the end of `<head>`. With `base: './'` the `href` is
  relative.

**The share card.** With `shareCard` set, the plugin also draws `share-card.png` at 1200 x 630:
the icon's ground over the whole card, the icon centred on it at 420 px. The plugin writes no
`og:image` tag. The game's own tag names the card, at an absolute URL:

```html
<meta property="og:image" content="https://<your site>/share-card.png" />
```

**What the SVG reader takes:**
- a square `viewBox` from `0 0`;
- exactly one `<rect>`, which is the ground;
- `<path>`s of straight lines (`M L H V Z`, absolute or relative), each with `fill="#rrggbb"`.

Anything else, such as a curve, an arc, a `<circle>`, a `<polygon>`, a `<g>` or a `transform`,
fails the build rather than drawing a wrong picture. Later paths paint over earlier ones.

| Option | Type | Default | What it does |
|---|---|---|---|
| `svg` | `string` | required | The icon's SVG, relative to Vite's root or absolute. |
| `fileName` | `string` | `'apple-touch-icon.png'` | The icon's file name. |
| `size` | `number` | `180` | The icon's size in px. |
| `link` | `boolean` | `true` | Add the `<link rel="apple-touch-icon">`. |
| `shareCard` | `boolean`, or `{ fileName?, width?, height?, mark? }` | `false` | Also draw the share card. `true` takes `share-card.png`, 1200, 630, 420. |

```js
plugins: [appIcon({ svg: 'icon.svg' })]
```

```js
// A square card for a client that crops square, under another name.
plugins: [appIcon({ svg: 'src/art/icon.svg', shareCard: { fileName: 'card.png', width: 800, height: 800, mark: 480 } })]
```

## `devSplash(options)`: the loading splash's page

```ts
devSplash(options?: DevSplashOptions): Plugin
```

The Uncle Matt Makes splash is two halves. `runtime/boot/dev-splash.ts` and `dev-splash.css`
are copied into the game (`umm-dev copy boot`) and drive markup already in the page. This plugin
writes that markup, so the game keeps no copy of it. It:
- puts the `#dev-splash` block first in `<body>`, with one sizer per word, built from the game's
  name. It is in the served HTML, so it is up from the first paint;
- links the game's copy of `dev-splash.css` at the end of `<head>`. It runs before Vite reads the
  page, so the stylesheet is bundled like the game's own;
- serves the brand portrait in dev, emits it in the build, and names it on the `<img>` as
  `data-src`, which the runtime loads. The kit carries the portrait, so the game does not.

The runtime reads its words from the sizers and its portrait from `data-src` when the game
passes neither, so the game names itself once, here. See
[runtime.md, adopting the splash](runtime.md#adopting-the-splash).

| Option | Type | Default | What it does |
|---|---|---|---|
| `game` | `string` | none | The game's name, typed just before the last word: `splashWords(game)`. |
| `words` | `string[]` | `SPLASH_WORDS` | The whole word list instead. Passing it with `game` throws. |
| `portrait` | `boolean` or `string` | `true` | `true`: the kit's portrait. A path, relative to Vite's root or absolute: the game's own image. `false`: no portrait and no `<img>`. |
| `portraitPath` | `string` | `'brand/<its file name>'` | Where the portrait is served and emitted, under the base. `brand/uncle-matt-circle.webp` for the kit's. |
| `css` | `string` or `false` | `'/src/boot/dev-splash.css'` | The href of the game's copy of the stylesheet, where `umm-dev copy boot` puts it. `false` links none. |
| `url` | `string` | none | A line under the bar, such as the label's site, each `.` in amber. |
| `page` | `string` | `'index.html'` | The page that gets the splash, relative to Vite's root. Other pages are left alone. |

**A page that has its own splash keeps it.** If the page already has an element with
`id="dev-splash"`, the plugin adds no markup; if it already names the stylesheet, it adds no link.
So a game with hand-written markup can add the plugin before deleting its own.

**A portrait in `public/` wins.** If the game keeps a file at `public/<portraitPath>`, the plugin
neither serves nor emits its own, and Vite serves and copies the game's.

```js
// vite.config.mjs
import { devSplash } from '@ummgames/dev/vite'

export default defineConfig({ plugins: [devSplash({ game: 'My Game', url: 'example.com' })] })
```

`dist/index.html` gains, first in `<body>`:

```html
<div id="dev-splash" role="status" aria-label="Uncle Matt Makes: Games. Loading.">
  <div class="dev-splash__lockup">
    <img class="dev-splash__portrait" alt="" width="384" height="384" decoding="async" data-src="/brand/uncle-matt-circle.webp" />
    <h1 class="dev-splash__mark">
      Uncle Matt Makes:
      <span class="dev-splash__blank" aria-hidden="true">
        <span class="dev-splash__sizer">stuff</span>
        …
        <span class="dev-splash__sizer">mistakes</span>
        <span class="dev-splash__sizer">My Game</span>
        <span class="dev-splash__sizer">Games</span>
        <span class="dev-splash__line"><span class="dev-splash__typed"></span><span class="dev-splash__caret"></span></span>
      </span>
      <span class="visually-hidden">Games</span>
    </h1>
  </div>
  <div class="dev-splash__bar" aria-hidden="true"><div class="dev-splash__fill"></div></div>
  <p class="dev-splash__url">example<span>.</span>com</p>
</div>
```

```js
// The kit's words only, no portrait, the stylesheet linked by the page itself.
plugins: [devSplash({ portrait: false, css: false })]
```

## Helpers and constants

Each plugin's logic is exported for tests and scripts.

| Export | What it is |
|---|---|
| `securityHeaders()` | The `/*` headers, as name to value. |
| `headersFile(options?)` | The text of `_headers`. Takes `assetsDir` too. |
| `hashedAsset(assetsDir?)` | The `RegExp` a hashed file name under `assetsDir` matches. |
| `unhashedUnderAssets(fileNames, assetsDir?)` | The names the immutable check fails on. |
| `HEADERS_FILE`, `HSTS`, `IMMUTABLE_CACHE`, `PERMISSIONS_POLICY`, `REFERRER_POLICY` | `'_headers'` and the header values above. |
| `notFoundHtml(options?)`, `NOT_FOUND_FILE` | The 404 page's text, and `'404.html'`. |
| `collectLicences(root, options?)` | The licence list for the game at `root`. Throws on a dependency with no notice. |
| `fallbackName(pkg)` | `@scope/name` to `scope-name.LICENSE`. |
| `licencesHtml(list, { title?, intro? })`, `LICENCES_MODULE` | The licences page's text, and `'virtual:licences'`. |
| `parseIconSvg(svg)`, `pathPoints(d)` | The SVG reader, and one path's points. |
| `rasterize(icon, size)`, `rasterizeCard(icon, width, height, mark)` | RGB pixels, row by row. |
| `appleTouchIconPng(svg, size?)`, `shareCardPng(svg, size?)` | The PNGs as `Buffer`s. |
| `encodePng(img, { level? })` | A minimal PNG encoder: 8-bit, no interlace. |
| `APPLE_TOUCH_ICON`, `APPLE_TOUCH_SIZE`, `SHARE_CARD`, `SHARE_CARD_SIZE` | `'apple-touch-icon.png'`, `180`, `'share-card.png'`, `{ width: 1200, height: 630, mark: 420 }`. |
| `splashWords(game, words?)` | The kit's words with `game` just before the last. The same rule as the runtime's. |
| `splashMarkup({ words?, portraitSrc?, url? })` | The `#dev-splash` block. No `<img>` without `portraitSrc`. |
| `injectSplash(html, { words?, portraitSrc?, url?, css? })` | The page with the link and the markup added, unless it has them. |
| `SPLASH_WORDS`, `SPLASH_PORTRAIT`, `SPLASH_PORTRAIT_FILE`, `SPLASH_CSS` | The kit's words (the runtime's), `'brand/uncle-matt-circle.webp'`, the portrait's path on disk, `'/src/boot/dev-splash.css'`. |

**Testing a D1 board.** `createD1(options?)` from `@ummgames/dev/testing` is a D1 binding over
`node:sqlite`, with the game's migrations applied. See [board.md](board.md#created1options-in-ummgamesdevtesting).

**Testing the built headers.** `headersFor(dist, pathname)` from `@ummgames/dev/testing` gives the
headers Cloudflare Pages would send for `pathname` from `dist/_headers`: every matching rule, in
order, with names lower-cased. It reads splats only, not placeholders, and gives `{}` when the
build has no `_headers`.

```js
import { headersFor } from '@ummgames/dev/testing'

expect(headersFor('dist', '/')['x-frame-options']).toBe('SAMEORIGIN')
expect(headersFor('dist', '/assets/index-CGx80H_5.js')['cache-control']).toContain('immutable')
```

## How it works

- **`headers` and `notFoundPage`** emit one asset each in `generateBundle`, and do nothing in dev.
  `headers` builds its text once when the config loads, so a bad option throws before the build.
- **The immutable check** runs in `headers`' `generateBundle`. It sees the bundle as it is at that
  moment, and lists `public/<assetsDir>/` from disk, because Vite copies `public/` after the
  bundle.
- **`licences`** reads `node_modules` once per config, the first time the module or the page is
  asked for. A dependency added while the dev server runs needs a restart.
- **`appIcon`** draws each PNG once and keeps it in memory. In dev it answers `<base><fileName>`
  and `/<fileName>` itself.
- **`devSplash`** changes the page in a `pre` `transformIndexHtml`, before Vite reads its links,
  in dev and build alike. In dev it answers `<base><portraitPath>` and `/<portraitPath>` from
  the file; in a build it emits the file in `generateBundle`. It checks the portrait exists when
  the config loads. Its word list is a copy of the runtime's, and a test keeps the two equal.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `/assets/* is cached immutable but these have no content hash: assets/hero.glb` | `immutableAssets` is on and a file under `assets/` has a stable name, often from `public/assets/`. | Move the file out of `public/assets/` (`public/models/`), or import it so the bundler hashes it. |
| An unhashed file under `assets/` ships with the immutable rule | A plugin after `headers()` emitted it. | Put `headers()` last in `plugins`. |
| `headers: target was removed in 0.2.0; _headers is for the site build only` (or `frameAncestors`) | A config from before 0.2.0, for a build another origin frames. | Drop `headers()` from that build and write its `_headers` yourself. Keep `headers()` in the site build. |
| `bad _headers text: "<text>"` | A rule's path, name or value is empty or holds a newline. | Fix the `rules` entry. |
| `<name> ships no licence file or no "license": add licences/<name>.LICENSE` | A dependency has no notice file, or no `license` field. | Add the fallback file. If the `license` field is what is missing, `exclude` it and list its notice yourself. |
| `ENOENT: no such file or directory, open '...node_modules/<name>/package.json'` | An `include` entry is not installed at `node_modules/<name>`, as with a transitive dependency under pnpm. | Make it a direct dependency, or leave it out. |
| `Cannot find module 'virtual:licences'` in `tsc` | The module has no declaration. | Add the `declare module` block above. |
| `app-icon: path command "C" is not a straight line ("<d>")` | A path has a curve or an arc. | Flatten it to straight lines. |
| `app-icon: a square viewBox from 0 0 is expected, got "0 0 64 32"` | The `viewBox` is not square, or does not start at `0 0`. | Make it square from `0 0`. |
| `app-icon: one <rect> (the ground) expected, found <n>` | No ground, or more than one `<rect>`. | Keep one `<rect>`; draw the rest as paths. |
| `app-icon: a fill must be #rrggbb, got #000` | A short, named or missing fill. | Write six hex digits. |
| `app-icon: "<g>" is not read here` | A group, circle, ellipse, polygon, polyline or transform. | Flatten it to paths. |
| `ENOENT ... icon.svg` | `svg` is not relative to Vite's root. | Fix the path, or pass an absolute one. |
| `dev-splash: no portrait at <path>` | `portrait` names a file that is not there. | Fix the path, or drop the option for the kit's. |
| `dev-splash: pass game or words, not both` | Both options are set. | Keep one. |
| Two splashes, or the game's name missing from the blank | The page still has its own `#dev-splash` (the plugin then adds none), or the game still passes its own `words`. | Delete the hand-written block and the `words` option. |
| The splash shows unstyled | `css` does not match where the game's copy of `dev-splash.css` is. | Pass `css` with the page's href for it, such as `'/src/ui/dev-splash.css'`. |
| The portrait never shows | The game passes `portraitUrl` to `startDevSplash`, or the runtime copy is from before 0.7.0 and does not read `data-src`. | Drop `portraitUrl`, or take the new copy (`umm-dev drift`). |

## For agents

- **Test the right build.** `headers`, `notFoundPage` and the icon files exist only in
  `vite build` output. Check `dist/`, never the dev server.
- **Never commit `apple-touch-icon.png`, `share-card.png`, `_headers` or `404.html`** to
  `public/`. The plugins make them, and the built file silently replaces a committed one, so an
  edit to it never ships. Change the plugin's options instead.
- **Keep `public/assets/` empty** when `immutableAssets` is on. Put stable-named files elsewhere.
- **Put `headers()` last** in `plugins`.
- **Add a dependency, add its notice.** If the build fails on a licence, add the fallback file the
  error names. Never `exclude` a package that ships in the bundle.
- **Keep the icon SVG in the reader's subset.** If an edit adds a curve or a group, flatten it;
  do not replace the plugin with a committed PNG.
- **Keep the splash in one place.** With `devSplash`, the game's name lives in its options only:
  no hand-written `#dev-splash` block, no word list in the game's code, no portrait in `public/`.
- **Check your own work:** run `vite build`, then read `dist/_headers`, check `dist/404.html`
  exists, and check `dist/index.html` has one `apple-touch-icon` link.
