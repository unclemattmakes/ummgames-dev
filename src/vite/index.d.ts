import type { Plugin } from 'vite'

// ── The portal build (docs/portal.md) ────────────────────────────────────────

/** The Vite mode the runtime's `build-target.ts` reads as the portal build: `'portal'`. */
export declare const PORTAL_MODE: 'portal'
/** CrazyGames' HTML5 SDK v3 script: `https://sdk.crazygames.com/crazygames-sdk-v3.js`. */
export declare const CRAZYGAMES_SDK_URL: string
/** CrazyGames' upload limits: 1,500 files and 50 MB (`50000000` bytes). */
export declare const CRAZYGAMES_LIMITS: Readonly<{ files: number; bytes: number }>
/** The first download that fits CrazyGames' mobile homepage: 20 MB (`20000000` bytes). */
export declare const CRAZYGAMES_MOBILE_BYTES: number
/** `['_headers', '_redirects', '_routes.json']`: site files a portal build leaves out. */
export declare const SITE_FILES: readonly string[]

export interface PortalSdkPluginOptions {
  /** The SDK script's `src`. Default `CRAZYGAMES_SDK_URL`. */
  url?: string
}
/** Add the portal SDK's `<script>` as the first element of `<head>`. Build only. */
export declare function portalSdk(options?: PortalSdkPluginOptions): Plugin

/** One file of a build, as `orphanChunks` reads it. */
export interface EmittedFile {
  /** The file's path in the build output. */
  fileName: string
  /** A chunk's code or a text asset's source; null for binaries. */
  text: string | null
  /** An entry chunk, always kept. */
  entry: boolean
  /** A JS chunk, as opposed to an asset. Only chunks are dropped. */
  isChunk: boolean
}
/** File names of the non-entry chunks no other emitted file mentions, chains included. */
export declare function orphanChunks(files: readonly EmittedFile[]): string[]

export interface PortalPruneOptions {
  /** Print one line per dropped chunk. Default true. */
  log?: boolean
}
/** Drop the chunks nothing in the build loads. Nothing drops while source maps are on. Build only. */
export declare function portalPrune(options?: PortalPruneOptions): Plugin

/** `html` without the elements carrying `attribute` (default `data-site-only`). */
export declare function stripSiteOnly(html: string, attribute?: string): string

export interface PortalSiteOnlyOptions {
  /** The marker attribute: letters, digits and `-`. Default `data-site-only`. */
  attribute?: string
}
/** Strip the elements marked `data-site-only` (or `attribute`) from index.html. Build only. */
export declare function portalSiteOnly(options?: PortalSiteOnlyOptions): Plugin

/** `body{-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none}`. */
export declare const NO_SELECT_CSS: string
/** `NO_SELECT_CSS` for `selector` (default `body`). Throws on a selector holding `{`, `}` or `<`. */
export declare function noSelectCss(selector?: string): string
export interface PortalNoSelectOptions {
  /** The element text selection is turned off on. Default `body`. */
  selector?: string
}
/** Add a `<style>` turning text selection off on `body`, every prefix, as CrazyGames asks. Build only. */
export declare function portalNoSelect(options?: PortalNoSelectOptions): Plugin

/** What breaks a limit, in the words of the build error; empty when the sizes fit. */
export declare function overLimits(
  sizes: readonly number[],
  limits?: { files: number; bytes: number },
): string[]

/**
 * Every file under `dir`, relative with `/`, sorted: no dotfiles or dot folders, no
 * `SITE_FILES` at the top, nothing starting with an `exclude` prefix. `[]` when `dir` is missing.
 */
export declare function publicFiles(
  dir: string,
  options?: { exclude?: readonly string[] },
): string[]

export interface PortalAssetsOptions {
  /** Files under `publicDir` the portal build needs, relative to it; or a function of the root. */
  paths?: readonly string[] | ((root: string) => readonly string[] | Promise<readonly string[]>)
  /** Where `paths` are read from, relative to the root. Default `public`. */
  publicDir?: string
  /** Added to the error naming a missing file. Default none. */
  missingHint?: string
}
/** Copy the listed `public/` files into the build. Throws on the `limits` option (now `portalCheck`). Build only. */
export declare function portalAssets(options?: PortalAssetsOptions): Plugin

export interface PortalCheckOptions {
  /** Default `CRAZYGAMES_LIMITS`; `false` checks none. */
  limits?: { files: number; bytes: number } | false
  /** The marker `portalSiteOnly` strips; one left in `index.html` fails. Default `data-site-only`. */
  attribute?: string
}
/** What `checkPortalBuild` found. */
export interface PortalReport {
  /** How many files the folder holds. */
  files: number
  /** Their total size in bytes. */
  bytes: number
  /** Whether `bytes` fits `CRAZYGAMES_MOBILE_BYTES`. */
  mobile: boolean
  /** One line per broken rule; empty when none. */
  problems: string[]
}
/**
 * Read a written portal build: the limits, `index.html` at the top, no root-absolute `src` or
 * `href` in it, no marked element left, no source map, dotfile or site file.
 */
export declare function checkPortalBuild(dir: string, options?: PortalCheckOptions): PortalReport
/**
 * Run `checkPortalBuild` on the folder Vite wrote, print its size, and fail the build on any
 * problem. Build only.
 */
export declare function portalCheck(options?: PortalCheckOptions & { log?: boolean }): Plugin

// ── Cloudflare Pages files (docs/build.md) ───────────────────────────────────

/** `'_headers'`, the file Cloudflare Pages reads. */
export declare const HEADERS_FILE: '_headers'
/** `max-age=31536000`, with no `includeSubDomains` or `preload`. */
export declare const HSTS: string
/** `public, max-age=31536000, immutable`. */
export declare const IMMUTABLE_CACHE: string
/** `camera=(), microphone=(), geolocation=(), payment=(), usb=()`. */
export declare const PERMISSIONS_POLICY: string
/** `strict-origin-when-cross-origin`. */
export declare const REFERRER_POLICY: string

/**
 * Header name to value for every path of the build: `nosniff`, the referrer policy, HSTS, framing
 * by its own origin only (`X-Frame-Options: SAMEORIGIN`, `frame-ancestors 'self'`) and the
 * Permissions-Policy.
 */
export declare function securityHeaders(): Record<string, string>

export interface HeadersOptions {
  /** Cache `assetsDir` for a year; fails the build on an unhashed file there. Default false. */
  immutableAssets?: boolean
  /** Default `assets`. The plugin takes Vite's `build.assetsDir`. */
  assetsDir?: string
  /** More rules after the built-in ones: path pattern to headers. Default none. */
  rules?: Readonly<Record<string, Readonly<Record<string, string>>>>
  /**
   * Exact `https://` origins that may frame the site beside its own, such as a station that airs it.
   * They join `frame-ancestors 'self'`, and `X-Frame-Options` is left out. Default none.
   */
  framedBy?: readonly string[]
}
/**
 * The text of `_headers`. Throws on a newline in a rule, and on `target` or `frameAncestors`
 * (removed in 0.2.0).
 */
export declare function headersFile(options?: HeadersOptions): string
/** A file name under `assetsDir` ending in an 8-character content hash. */
export declare function hashedAsset(assetsDir?: string): RegExp
/** Names under `assetsDir` without a content hash. */
export declare function unhashedUnderAssets(
  fileNames: readonly string[],
  assetsDir?: string,
): string[]
/** Emit `_headers` at the top of the build output. Checks its options when called. Build only. */
export declare function headers(options?: Omit<HeadersOptions, 'assetsDir'>): Plugin

/** `'404.html'`. */
export declare const NOT_FOUND_FILE: '404.html'
export interface NotFoundOptions {
  /** The tab's title. Default `Not found`. */
  title?: string
  /** The `<h1>`. Default `There is nothing at this address`. */
  heading?: string
  /** The line under it. Default `The link may have a typo in it, or the page has moved.` */
  message?: string
  /** Where the link goes. Default `/`. */
  homeHref?: string
  /** The link's text. Default `Back to the game`. */
  homeLabel?: string
  /** The whole page, used as given; the other options are ignored. */
  html?: string
}
/** The 404 page's HTML, every value escaped. */
export declare function notFoundHtml(options?: NotFoundOptions): string
/** Emit `404.html` at the top of the build output. Build only. */
export declare function notFoundPage(options?: NotFoundOptions): Plugin

// ── Licences ─────────────────────────────────────────────────────────────────

/** One shipped package's notice. */
export interface Licence {
  /** The package's name. */
  name: string
  /** The installed version. */
  version: string
  /** The package's `license`, an SPDX id. */
  licence: string
  /** Every licence and notice file in full, one after another. */
  text: string
}
/** `'virtual:licences'`, the module's default id. */
export declare const LICENCES_MODULE: 'virtual:licences'
/** The fallback folder's file name for a package: `@scope/name` is `scope-name.LICENSE`. */
export declare function fallbackName(pkg: string): string
export interface CollectOptions {
  /** The folder for fallback licence files, relative to the root. Default `licences`. */
  fallbackDir?: string
  /** More packages to list, beyond `dependencies`; each at `node_modules/<name>`. */
  include?: readonly string[]
  /** Dependencies to leave out. */
  exclude?: readonly string[]
}
/** Every dependency's version, licence and notice text. Throws on one with no notice. */
export declare function collectLicences(root: string, options?: CollectOptions): Licence[]
/** The list as a plain, script-free page. `title` defaults to `Licences`. */
export declare function licencesHtml(
  list: readonly Licence[],
  options?: { title?: string; intro?: string },
): string
export interface LicencesOptions extends CollectOptions {
  /** The virtual module's id. Default `virtual:licences`. */
  module?: string
  /** A file name to also emit the list as a page (`licences.html`). Default false. */
  page?: string | false
  /** The page's title and heading. Default `Licences`. */
  pageTitle?: string
  /** A line of text above the list. Default none. */
  pageIntro?: string
  /** A file name to also emit the list as plain text (`notices.txt`). Default false. Build only. */
  text?: string | false
  /** The text file's first lines: the game's own copyright. Default none. */
  textHeader?: string
  /** The line after the header. Default `This game uses these packages.`; `''` for none. */
  textIntro?: string
}
/** The list as plain text: `header`, `intro`, then each package and its notices in full. */
export declare function licencesText(
  list: readonly Licence[],
  options?: { header?: string; intro?: string },
): string
/** `import { LICENCES } from 'virtual:licences'`, and optionally a licences page and a notices file. Dev and build. */
export declare function licences(options?: LicencesOptions): Plugin

// ── The app icon and the share card ──────────────────────────────────────────

/** `'apple-touch-icon.png'`. */
export declare const APPLE_TOUCH_ICON: 'apple-touch-icon.png'
/** `180`, the icon's size in px. */
export declare const APPLE_TOUCH_SIZE: 180
/** `'share-card.png'`. */
export declare const SHARE_CARD: 'share-card.png'
/** `{ width: 1200, height: 630, mark: 420 }`: the card, and the icon on it, in px. */
export declare const SHARE_CARD_SIZE: Readonly<{ width: number; height: number; mark: number }>

/** A colour: red, green, blue, 0 to 255. */
export type Rgb = [number, number, number]
/** An icon as the SVG reader leaves it. */
export interface Icon {
  /** The `viewBox` side. */
  size: number
  /** The `<rect>`'s fill. */
  ground: Rgb
  /** Each `<path>`, in paint order. */
  shapes: { fill: Rgb; points: [number, number][] }[]
}
/** Straight-line path data (`M L H V Z`) to one polygon's points. Throws on a curve. */
export declare function pathPoints(d: string): [number, number][]
/** Read an icon SVG. Throws on anything outside the subset docs/build.md lists. */
export declare function parseIconSvg(svg: string): Icon
/** The icon at `size` x `size` px: RGB, row by row. */
export declare function rasterize(icon: Icon, size: number): Uint8Array
/** The share card's pixels: the ground everywhere, the icon centred at `mark` px. */
export declare function rasterizeCard(
  icon: Icon,
  width: number,
  height: number,
  mark: number,
): Uint8Array
/** The home-screen icon as a PNG. `size` defaults to 180. */
export declare function appleTouchIconPng(svg: string, size?: number): Buffer
/** The share card as a PNG. `size` defaults to `SHARE_CARD_SIZE`. */
export declare function shareCardPng(
  svg: string,
  size?: { width: number; height: number; mark: number },
): Buffer
/** A minimal PNG encoder: 8-bit, non-interlaced. `level` is zlib's, default zlib's own. */
export declare function encodePng(
  img: { width: number; height: number; channels: 1 | 2 | 3 | 4; data: Uint8Array },
  options?: { level?: number },
): Buffer

export interface AppIconOptions {
  /** The icon's SVG, relative to Vite's root or absolute. Required. */
  svg: string
  /** The icon's file name. Default `apple-touch-icon.png`. */
  fileName?: string
  /** The icon's size in px. Default 180. */
  size?: number
  /** Add `<link rel="apple-touch-icon">` to the head. Default true. */
  link?: boolean
  /** Also draw the share card (`true`: `share-card.png`, 1200 x 630, icon at 420). Default false. */
  shareCard?: boolean | { fileName?: string; width?: number; height?: number; mark?: number }
}
/** Draw the home-screen icon (and the share card) from an SVG: linked, served in dev, emitted. */
export declare function appIcon(options: AppIconOptions): Plugin

// The loading splash's markup, stylesheet link and portrait.

/** The kit's splash words, the last one the label's. The same as `runtime/boot/dev-splash.ts`'s. */
export declare const SPLASH_WORDS: readonly string[]
/** Where the portrait is served, under the base: `brand/uncle-matt-circle.webp`. */
export declare const SPLASH_PORTRAIT: 'brand/uncle-matt-circle.webp'
/** The kit's portrait on disk. */
export declare const SPLASH_PORTRAIT_FILE: string
/** Where `umm-dev copy boot` puts the stylesheet, as the page links it: `/src/boot/dev-splash.css`. */
export declare const SPLASH_CSS: '/src/boot/dev-splash.css'
/** The kit's words with `game` typed just before the last one. */
export declare function splashWords(game: string, words?: readonly string[]): string[]
export interface SplashMarkupOptions {
  /** The blank's words, one sizer each. Default `SPLASH_WORDS`. */
  words?: readonly string[]
  /** The `<img>`'s `data-src`, which the runtime loads. Null or absent leaves the `<img>` out. */
  portraitSrc?: string | null
  /** A line under the bar, each `.` in amber. None by default. */
  url?: string
  /**
   * The game's own HTML under the lockup, such as what it is about and its controls. Written as
   * given, unescaped: it must come from the game's config, never from a player. None by default.
   */
  note?: string
  /** A word over the bar, such as `Loading`, so the bar does not read as an underline. None by default. */
  loading?: string
}
/** The `#dev-splash` block, as `runtime/boot/dev-splash.ts` reads it. Throws on an empty word list. */
export declare function splashMarkup(options?: SplashMarkupOptions): string
export interface InjectSplashOptions extends SplashMarkupOptions {
  /** The stylesheet's href; false links none. Default `SPLASH_CSS`. */
  css?: string | false
}
/**
 * `html` with the stylesheet link at the end of `<head>` and the markup first in `<body>`. A page
 * that already has a `#dev-splash`, or already names the stylesheet, keeps its own.
 */
export declare function injectSplash(html: string, options?: InjectSplashOptions): string
export interface DevSplashOptions {
  /** The game's name, typed just before the last word. */
  game?: string
  /** The whole word list instead of `game`. Passing both throws. */
  words?: readonly string[]
  /**
   * `true`: the kit's portrait (the default). A path, relative to Vite's root or absolute: the
   * game's own image. `false`: no portrait, and no `<img>`.
   */
  portrait?: boolean | string
  /** Where the portrait is served, under the base. Default `brand/<its file name>`. */
  portraitPath?: string
  /** The href of the game's copy of `dev-splash.css`. Default `/src/boot/dev-splash.css`; false links none. */
  css?: string | false
  /** A line under the bar, such as the label's site. None by default. */
  url?: string
  /** The game's own HTML under the lockup, written as given (see `SplashMarkupOptions.note`). */
  note?: string
  /** A word over the bar, such as `Loading`. None by default. */
  loading?: string
  /** The page that gets the splash, relative to Vite's root. Default `index.html`. */
  page?: string
}
/**
 * Write the splash's markup and stylesheet link into the page, in dev and build; serve the
 * portrait in dev and emit it in a build. A page with its own `#dev-splash` keeps it, and a
 * portrait at the same path in `public/` wins.
 */
export declare function devSplash(options?: DevSplashOptions): Plugin
