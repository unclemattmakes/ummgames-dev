# Build plugins

`@ummgames/dev/vite` holds the build plugins every game shares. Each plugin is configured by its
options and reads nothing else from the game. The portal plugins are in [portal.md](portal.md);
this page covers the files a Cloudflare Pages site needs and the pages and pictures a game ships.

```js
// vite.config.mjs
import { defineConfig } from 'vite'
import { appIcon, headers, licences, notFoundPage } from '@ummgames/dev/vite'

const cloudflare = process.env.CF_PAGES === '1'

export default defineConfig({
  publicDir: cloudflare ? false : 'public',
  plugins: [
    headers({ immutableAssets: cloudflare }),
    notFoundPage({ title: 'Not found', homeLabel: 'Play the game' }),
    licences({ page: 'licences.html' }),
    appIcon({ svg: 'icon.svg', shareCard: true }),
  ],
})
```

| Plugin | What it emits |
|---|---|
| `headers()` | `_headers`: the security headers, and the cache rule for hashed output |
| `notFoundPage()` | `404.html` |
| `licences()` | The `virtual:licences` module, and a licences page if asked |
| `appIcon()` | `apple-touch-icon.png` and its `<link>`, and the share card if asked |

## `headers(options)`: `_headers`

Cloudflare Pages reads a top-level `_headers` file and adds its headers to every static response
that matches.

### The security headers

These go on every path:

- `Strict-Transport-Security: max-age=31536000`. It has no `includeSubDomains` and no `preload`.
- The framing policy (below).
- A `Permissions-Policy` that denies the camera, microphone, geolocation, payment and USB.

### Framing: the site build and the portal build

| `target` | `X-Frame-Options` | `Content-Security-Policy` |
|---|---|---|
| `'site'` (default) | `SAMEORIGIN` | `frame-ancestors 'self'` |
| `'portal'` | none | `frame-ancestors 'self' <frameAncestors>` |

**Why the portal build drops `X-Frame-Options`.** The header cannot name another origin. A browser
that read it would block the portal's iframe.

**`frameAncestors`.** The default is CrazyGames' origins (`CRAZYGAMES_ORIGINS`). Each entry must
be an origin (`https://host`, `https://*.host`, with an optional port) or `'self'`. Anything else
throws when the config is made, not after a build. That covers a path, `*`, `'none'`, a newline,
and passing `frameAncestors` for the site build.

**When the portal build needs `_headers`.** Only when you host it yourself for a portal that
frames your URL. A build uploaded to CrazyGames is served by CrazyGames, which ignores
`_headers`.

### The cache rule

`immutableAssets: true` adds `/assets/* Cache-Control: public, max-age=31536000, immutable`.

**Use it only when `publicDir` is off.** Then everything under `assets/` is the bundler's hashed
output.

**The build checks.** It fails if any file under `assets/` lacks an 8-character content hash.
That covers bundle files and anything `public/assets/` would copy in.

### Other options

- `rules`: more path rules, as `{ '/levels/*': { 'Cache-Control': 'no-cache' } }`. They are
  written after the built-in rules.

**Left out on purpose:**

- **COOP and COEP.** They break cross-origin assets unless every host opts in.
- **A full Content-Security-Policy.** A wrong policy breaks the game. Run one in Report-Only
  first.

`securityHeaders(options)` and `headersFile(options)` return the same data, for tests.

## `notFoundPage(options)`: `404.html`

Without a top-level `404.html`, Pages answers any unknown path with status 200 and the game, so
a typo'd link looks like a working one. This page is plain HTML with no script, and works in light
and dark.

| Option | Default |
|---|---|
| `title` | `Not found` |
| `heading` | `There is nothing at this address` |
| `message` | `The link may have a typo in it, or the page has moved.` |
| `homeHref` | `/` |
| `homeLabel` | `Back to the game` |

Every value is escaped. Pass `html` to use a whole page of your own instead.

## `licences(options)`: third-party notices

The plugin reads `package.json`'s `dependencies`, the packages that ship in the bundle. For each
one it collects:

- the version;
- the `license`;
- every LICENSE, LICENCE, COPYING and NOTICE file in its folder in `node_modules`.

```js
import { LICENCES } from 'virtual:licences'
// [{ name, version, licence, text }], sorted by name
```

**A package with no licence file.** Add the text yourself as `licences/<scope>-<name>.LICENSE`.
If a dependency has neither a licence file nor a fallback, the build fails, so a new dependency
cannot ship without its notice.

| Option | What it does |
|---|---|
| `fallbackDir` | The folder for fallback licence files. Default `licences`. |
| `include` | Packages to list beyond `dependencies`. |
| `exclude` | Packages to leave out. |
| `module` | The virtual module's id. Default `virtual:licences`. |
| `page` | Also emit the list as a static page, such as `licences.html`. |
| `pageTitle` | The page's title. |
| `pageIntro` | A line of text above the list. |

**Types.** Declare the module once in the game:

```ts
declare module 'virtual:licences' {
  export const LICENCES: import('@ummgames/dev/vite').Licence[]
}
```

## `appIcon(options)`: the home-screen icon and the share card

The plugin draws `apple-touch-icon.png` (180 px) from the game's `icon.svg` at build time, so no
PNG is committed. It also:

- serves the icon from memory in dev;
- emits it at the site root;
- adds `<link rel="apple-touch-icon">` to the head.

**The share card.** With `shareCard: true` the plugin also draws `share-card.png` at 1200 x 630:
the icon's ground with the icon centred on it. The game's own `og:image` tag names it, at an
absolute URL.

**What the SVG reader takes:**

- a square `viewBox` from `0 0`;
- one `<rect>`, which is the ground;
- `<path>`s of straight lines (`M L H V Z`, absolute or relative), filled `#rrggbb`.

Anything else, such as a curve, an arc, a transform or a group, fails the build rather than
drawing a wrong picture.

| Option | Default |
|---|---|
| `svg` | Required: the icon's SVG, relative to Vite's root. |
| `fileName` | `apple-touch-icon.png` |
| `size` | 180 |
| `link` | true |
| `shareCard` | false; `true`, or `{ fileName, width, height, mark }` |
