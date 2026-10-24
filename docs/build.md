# Build plugins

`@ummgames/dev/vite` holds the build plugins every game's site build shares: the `_headers` file
Cloudflare Pages reads, a real `404.html`, the third-party licence notices, and the home-screen
icon and share card drawn from the game's SVG. Reach for them when a game's site is served by
Cloudflare Pages, or when it ships dependencies whose licences it must show. Each plugin is
configured by its options and reads nothing else from the game. The portal build's plugins are in
[portal.md](portal.md).

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

## `headers(options)`: `_headers`

```ts
headers(options?: {
  target?: 'site' | 'portal'
  frameAncestors?: readonly string[]
  immutableAssets?: boolean
  rules?: Record<string, Record<string, string>>
}): Plugin
```

Cloudflare Pages reads a top-level `_headers` file and adds its headers to every static response
that matches. Pages alone sends only `nosniff` and a referrer policy.

| Option | Type | Default | What it does |
|---|---|---|---|
| `target` | `'site' \| 'portal'` | `'site'` | Which framing policy to write (below). |
| `frameAncestors` | `string[]` | `CRAZYGAMES_ORIGINS` | The origins that may frame the portal build. Portal target only. |
| `immutableAssets` | `boolean` | `false` | Adds a year-long immutable cache rule for `/<build.assetsDir>/*`, and fails the build on an unhashed file there. |
| `rules` | `Record<string, Record<string, string>>` | `{}` | More path rules, written after the built-in ones. |

The assets folder is Vite's `build.assetsDir` (default `assets`), read from the config.

**The security headers,** on `/*`:
- `Strict-Transport-Security: max-age=31536000`, with no `includeSubDomains` and no `preload`.
- The framing policy.
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`. Gamepads,
  fullscreen and the clipboard stay at the browser's default.

**The framing policy:**

| `target` | `X-Frame-Options` | `Content-Security-Policy` |
|---|---|---|
| `'site'` | `SAMEORIGIN` | `frame-ancestors 'self'` |
| `'portal'` | none | `frame-ancestors 'self' <frameAncestors>` |

- **Why the portal build drops `X-Frame-Options`.** The header cannot name another origin. A
  browser that read it would block the portal's iframe.
- **`frameAncestors` is checked when the config loads,** not after a build. Each entry is an
  origin (`https://host`, `https://*.host`, `http://` too, with an optional port) or `'self'`.
  A path, `*`, `'none'`, a newline, an empty list, or `frameAncestors` with the site target
  throws.
- **When the portal build needs `_headers`.** Only when you host it yourself, for a portal that
  frames your URL. A build uploaded to CrazyGames is served by CrazyGames, which ignores
  `_headers`.

**The cache rule.** `immutableAssets: true` adds
`/assets/* Cache-Control: public, max-age=31536000, immutable`. The build fails if any file under
`assets/` lacks an 8-character content hash before its extension (`index-CGx80H_5.js`). It checks:
- the bundle's own files, including those emitted by plugins that run before `headers()`;
- the files `public/assets/` would copy in, when `publicDir` is on.

**Put `headers()` last in `plugins`.** A plugin listed after it, such as `portalAssets`, adds its
files after the check has run, so an unhashed file there is cached for a year unchecked.

**Left out on purpose:**
- **COOP and COEP.** They break cross-origin assets unless every host opts in.
- **A full Content-Security-Policy.** A wrong policy breaks the game. Run one in Report-Only
  first.

```js
// The site build.
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

```js
// A portal build the game hosts itself, framed by CrazyGames.
plugins: [portalSdk(), portalPrune(), portalSiteOnly(), headers({ target: 'portal' })]
```

```
/*
  Strict-Transport-Security: max-age=31536000
  Content-Security-Policy: frame-ancestors 'self' https://crazygames.com https://*.crazygames.com
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
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

## Helpers and constants

Each plugin's logic is exported for tests and scripts.

| Export | What it is |
|---|---|
| `securityHeaders({ target?, frameAncestors? })` | The `/*` headers, as name to value. |
| `headersFile(options?)` | The text of `_headers`. Takes `assetsDir` too. |
| `hashedAsset(assetsDir?)` | The `RegExp` a hashed file name under `assetsDir` matches. |
| `unhashedUnderAssets(fileNames, assetsDir?)` | The names the immutable check fails on. |
| `HEADERS_FILE`, `HSTS`, `IMMUTABLE_CACHE`, `PERMISSIONS_POLICY` | `'_headers'` and the header values above. |
| `notFoundHtml(options?)`, `NOT_FOUND_FILE` | The 404 page's text, and `'404.html'`. |
| `collectLicences(root, options?)` | The licence list for the game at `root`. Throws on a dependency with no notice. |
| `fallbackName(pkg)` | `@scope/name` to `scope-name.LICENSE`. |
| `licencesHtml(list, { title?, intro? })`, `LICENCES_MODULE` | The licences page's text, and `'virtual:licences'`. |
| `parseIconSvg(svg)`, `pathPoints(d)` | The SVG reader, and one path's points. |
| `rasterize(icon, size)`, `rasterizeCard(icon, width, height, mark)` | RGB pixels, row by row. |
| `appleTouchIconPng(svg, size?)`, `shareCardPng(svg, size?)` | The PNGs as `Buffer`s. |
| `encodePng(img, { level? })` | A minimal PNG encoder: 8-bit, no interlace. |
| `APPLE_TOUCH_ICON`, `APPLE_TOUCH_SIZE`, `SHARE_CARD`, `SHARE_CARD_SIZE` | `'apple-touch-icon.png'`, `180`, `'share-card.png'`, `{ width: 1200, height: 630, mark: 420 }`. |

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

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `/assets/* is cached immutable but these have no content hash: assets/hero.glb` | `immutableAssets` is on and a file under `assets/` has a stable name, often from `public/assets/`. | Move the file out of `public/assets/` (`public/models/`), or import it so the bundler hashes it. |
| An unhashed file under `assets/` ships with the immutable rule | A plugin after `headers()` emitted it. | Put `headers()` last in `plugins`. |
| `frameAncestors is for the portal build; the site build is framed by itself` | `frameAncestors` with the site target. | Add `target: 'portal'`, or drop `frameAncestors`. |
| `not a frame-ancestors source: "*"` | An entry is not an origin or `'self'`: a path, `*`, `'none'`. | Give origins only: `https://host` or `https://*.host`. |
| `the portal build needs at least one frame ancestor` | `frameAncestors: []`. | Name the portal's origins, or leave the default. |
| `unknown build target <name>` | `target` is not `'site'` or `'portal'`. | Use one of the two. |
| `bad _headers text: "<text>"` | A rule's path, name or value is empty or holds a newline. | Fix the `rules` entry. |
| The portal shows a blank frame when the game hosts its portal build | The build has the site's framing headers. | Build it with `headers({ target: 'portal' })`. |
| `<name> ships no licence file or no "license": add licences/<name>.LICENSE` | A dependency has no notice file, or no `license` field. | Add the fallback file. If the `license` field is what is missing, `exclude` it and list its notice yourself. |
| `ENOENT: no such file or directory, open '...node_modules/<name>/package.json'` | An `include` entry is not installed at `node_modules/<name>`, as with a transitive dependency under pnpm. | Make it a direct dependency, or leave it out. |
| `Cannot find module 'virtual:licences'` in `tsc` | The module has no declaration. | Add the `declare module` block above. |
| `app-icon: path command "C" is not a straight line ("<d>")` | A path has a curve or an arc. | Flatten it to straight lines. |
| `app-icon: a square viewBox from 0 0 is expected, got "0 0 64 32"` | The `viewBox` is not square, or does not start at `0 0`. | Make it square from `0 0`. |
| `app-icon: one <rect> (the ground) expected, found <n>` | No ground, or more than one `<rect>`. | Keep one `<rect>`; draw the rest as paths. |
| `app-icon: a fill must be #rrggbb, got #000` | A short, named or missing fill. | Write six hex digits. |
| `app-icon: "<g>" is not read here` | A group, circle, ellipse, polygon, polyline or transform. | Flatten it to paths. |
| `ENOENT ... icon.svg` | `svg` is not relative to Vite's root. | Fix the path, or pass an absolute one. |

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
- **Check your own work:** run `vite build`, then read `dist/_headers`, check `dist/404.html`
  exists, and check `dist/index.html` has one `apple-touch-icon` link.
