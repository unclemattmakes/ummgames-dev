import type { Plugin } from 'vite'

// ── The portal build (docs/portal.md) ────────────────────────────────────────

/** The Vite mode the runtime's `build-target.ts` reads as the portal build: `'portal'`. */
export declare const PORTAL_MODE: 'portal'
/** CrazyGames' HTML5 SDK v3 script. */
export declare const CRAZYGAMES_SDK_URL: string
/** The origins CrazyGames frames a game from, as CSP `frame-ancestors` sources. */
export declare const CRAZYGAMES_ORIGINS: readonly string[]
/** CrazyGames' upload limits: files, and bytes downloaded before play. */
export declare const CRAZYGAMES_LIMITS: Readonly<{ files: number; bytes: number }>

/** Inject the portal SDK's script at the top of `<head>`. Build only. */
export declare function portalSdk(options?: { url?: string }): Plugin

export interface EmittedFile {
  fileName: string
  /** A chunk's code or a text asset's source; null for binaries. */
  text: string | null
  /** An entry chunk, always kept. */
  entry: boolean
  isChunk: boolean
}
/** File names of the non-entry chunks no other emitted file mentions, chains included. */
export declare function orphanChunks(files: readonly EmittedFile[]): string[]
/** Drop the chunks nothing in the build loads. Build only. */
export declare function portalPrune(options?: { log?: boolean }): Plugin

/** `html` without the elements carrying `attribute` (default `data-site-only`). */
export declare function stripSiteOnly(html: string, attribute?: string): string
/** Strip the elements marked `data-site-only` (or `attribute`) from index.html. Build only. */
export declare function portalSiteOnly(options?: { attribute?: string }): Plugin

/** What breaks a limit, in words; empty when the build fits. */
export declare function overLimits(
  sizes: readonly number[],
  limits?: { files: number; bytes: number },
): string[]

export interface PortalAssetsOptions {
  /** Files under `publicDir` the portal build needs, relative to it; or a function of the root. */
  paths?: readonly string[] | ((root: string) => readonly string[] | Promise<readonly string[]>)
  /** Relative to the root. Default `public`. */
  publicDir?: string
  /** Added to the error naming a missing file. */
  missingHint?: string
  /** Default CrazyGames' limits; `false` checks none. */
  limits?: { files: number; bytes: number } | false
}
/** Copy the listed `public/` files into the build and hold it to the portal's limits. Build only. */
export declare function portalAssets(options?: PortalAssetsOptions): Plugin

// ── Cloudflare Pages files (docs/build.md) ───────────────────────────────────

export type BuildTarget = 'site' | 'portal'

export declare const HEADERS_FILE: '_headers'
export declare const HSTS: string
export declare const IMMUTABLE_CACHE: string
export declare const PERMISSIONS_POLICY: string

/**
 * Header name to value for every path of one build. The site build is framed by itself only;
 * the portal build by itself and `frameAncestors` (default CrazyGames' origins), with no
 * `X-Frame-Options`.
 */
export declare function securityHeaders(options?: {
  target?: BuildTarget
  frameAncestors?: readonly string[]
}): Record<string, string>

export interface HeadersOptions {
  /** Default `site`. */
  target?: BuildTarget
  /** The portal's origins, portal target only. */
  frameAncestors?: readonly string[]
  /** Cache hashed output under `assetsDir` for a year; fails the build on an unhashed file there. */
  immutableAssets?: boolean
  /** Default `assets`. The plugin takes Vite's `build.assetsDir`. */
  assetsDir?: string
  /** More rules after the built-in ones: path pattern to headers. */
  rules?: Readonly<Record<string, Readonly<Record<string, string>>>>
}
/** The text of `_headers`. */
export declare function headersFile(options?: HeadersOptions): string
/** A file name under `assetsDir` ending in an 8-character content hash. */
export declare function hashedAsset(assetsDir?: string): RegExp
/** Names under `assetsDir` without a content hash. */
export declare function unhashedUnderAssets(
  fileNames: readonly string[],
  assetsDir?: string,
): string[]
/** Emit `_headers` at the top of the build output. Build only. */
export declare function headers(options?: Omit<HeadersOptions, 'assetsDir'>): Plugin

export declare const NOT_FOUND_FILE: '404.html'
export interface NotFoundOptions {
  title?: string
  heading?: string
  message?: string
  /** Default `/`. */
  homeHref?: string
  /** Default `Back to the game`. */
  homeLabel?: string
  /** The whole page, used as given. */
  html?: string
}
export declare function notFoundHtml(options?: NotFoundOptions): string
/** Emit `404.html` at the top of the build output. Build only. */
export declare function notFoundPage(options?: NotFoundOptions): Plugin

// ── Licences ─────────────────────────────────────────────────────────────────

export interface Licence {
  name: string
  version: string
  /** The package's `license`, an SPDX id. */
  licence: string
  /** Every licence and notice file in full, one after another. */
  text: string
}
export declare const LICENCES_MODULE: 'virtual:licences'
/** The fallback folder's file name for a package: `@scope/name` is `scope-name.LICENSE`. */
export declare function fallbackName(pkg: string): string
export interface CollectOptions {
  /** Relative to the root. Default `licences`. */
  fallbackDir?: string
  /** More packages to list, beyond `dependencies`. */
  include?: readonly string[]
  /** Dependencies to leave out. */
  exclude?: readonly string[]
}
/** Every dependency's version, licence and notice text. Throws on one with no notice. */
export declare function collectLicences(root: string, options?: CollectOptions): Licence[]
export declare function licencesHtml(
  list: readonly Licence[],
  options?: { title?: string; intro?: string },
): string
export interface LicencesOptions extends CollectOptions {
  /** The virtual module's id. Default `virtual:licences`. */
  module?: string
  /** A file name to also emit the list as a page (`licences.html`). Off by default. */
  page?: string | false
  pageTitle?: string
  pageIntro?: string
}
/** `import { LICENCES } from 'virtual:licences'`, and optionally a licences page. */
export declare function licences(options?: LicencesOptions): Plugin

// ── The app icon and the share card ──────────────────────────────────────────

export declare const APPLE_TOUCH_ICON: 'apple-touch-icon.png'
export declare const APPLE_TOUCH_SIZE: 180
export declare const SHARE_CARD: 'share-card.png'
export declare const SHARE_CARD_SIZE: Readonly<{ width: number; height: number; mark: number }>

export type Rgb = [number, number, number]
export interface Icon {
  size: number
  ground: Rgb
  shapes: { fill: Rgb; points: [number, number][] }[]
}
export declare function pathPoints(d: string): [number, number][]
export declare function parseIconSvg(svg: string): Icon
export declare function rasterize(icon: Icon, size: number): Uint8Array
export declare function rasterizeCard(
  icon: Icon,
  width: number,
  height: number,
  mark: number,
): Uint8Array
export declare function appleTouchIconPng(svg: string, size?: number): Buffer
export declare function shareCardPng(
  svg: string,
  size?: { width: number; height: number; mark: number },
): Buffer
export declare function encodePng(
  img: { width: number; height: number; channels: 1 | 2 | 3 | 4; data: Uint8Array },
  options?: { level?: number },
): Buffer

export interface AppIconOptions {
  /** The icon's SVG, relative to Vite's root or absolute. */
  svg: string
  /** Default `apple-touch-icon.png`. */
  fileName?: string
  /** Default 180. */
  size?: number
  /** Add `<link rel="apple-touch-icon">` to the head. Default true. */
  link?: boolean
  /** Also draw the share card (default 1200 x 630, `share-card.png`). Off by default. */
  shareCard?: boolean | { fileName?: string; width?: number; height?: number; mark?: number }
}
/** Draw the home-screen icon (and the share card) from an SVG: linked, served in dev, emitted. */
export declare function appIcon(options: AppIconOptions): Plugin
