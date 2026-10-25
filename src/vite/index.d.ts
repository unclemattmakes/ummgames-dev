import type { Plugin } from 'vite'

// ── Cloudflare Pages files (docs/build.md) ───────────────────────────────────

/** `'_headers'`, the file Cloudflare Pages reads. */
export declare const HEADERS_FILE: '_headers'
/** `max-age=31536000`, with no `includeSubDomains` or `preload`. */
export declare const HSTS: string
/** `public, max-age=31536000, immutable`. */
export declare const IMMUTABLE_CACHE: string
/** `camera=(), microphone=(), geolocation=(), payment=(), usb=()`. */
export declare const PERMISSIONS_POLICY: string

/**
 * Header name to value for every path of the build: HSTS, framing by its own origin only
 * (`X-Frame-Options: SAMEORIGIN`, `frame-ancestors 'self'`) and the Permissions-Policy.
 */
export declare function securityHeaders(): Record<string, string>

export interface HeadersOptions {
  /** Cache `assetsDir` for a year; fails the build on an unhashed file there. Default false. */
  immutableAssets?: boolean
  /** Default `assets`. The plugin takes Vite's `build.assetsDir`. */
  assetsDir?: string
  /** More rules after the built-in ones: path pattern to headers. Default none. */
  rules?: Readonly<Record<string, Readonly<Record<string, string>>>>
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
}
/** `import { LICENCES } from 'virtual:licences'`, and optionally a licences page. Dev and build. */
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
