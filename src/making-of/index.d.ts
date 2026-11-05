import type { ConfigEnv, Plugin } from 'vite'

/** One row of a game's chapter list. A game's own rows may carry more. */
export interface Chapter {
  /** The page's folder under `making-of/`. Permanent once linked. */
  readonly slug: string
  /** All digits prints as "Chapter 3"; anything else ("Prologue") prints as it is. */
  readonly number: string
  readonly title: string
  /** One line: the card, the header and the link preview. */
  readonly pitch: string
  /** `published` is built. `planned` is a card without a link. Anything else shows as a tag. */
  readonly status: string
  /** Toy ids this chapter mounts. */
  readonly toys: readonly string[]
}

/** What a `data-const` resolves to. */
export interface ConstantHit {
  readonly ref: string
  /** The file it came from; `''` from a `lookup` with no file. */
  readonly file: string
  readonly value: number | string | boolean
  /** The unit `data-unit="auto"` prints. */
  readonly unit?: string | null
  /** Added to the number's tooltip after the reference. */
  readonly note?: string | null
}

/** What a `data-snippet` cuts out. */
export interface SnippetHit {
  readonly file: string
  readonly name: string
  /** 1-based, in the file. */
  readonly startLine: number
  readonly endLine: number
  readonly text: string
}

export interface FormatOptions {
  /** Fixed decimals. Absent: six significant figures with the zeros trimmed. */
  readonly digits?: string | null
  /** Multiply by this, such as 1000 for seconds to milliseconds. */
  readonly scale?: string | null
  /** Print 1/x, such as a step as a rate. */
  readonly reciprocal?: boolean
  /** Appended after a no-break space. `auto` prints the hit's own unit. */
  readonly unit?: string | null
}

export interface SourceOptions {
  /** Import prefixes the game's bundler maps to folders. Default `{ '@/': 'src/' }`. */
  readonly alias?: Readonly<Record<string, string>>
  /** The repo's blob URL, such as `https://github.com/me/game/blob/main`. Absent: a snippet's path is not a link. */
  readonly repoBlob?: string
  /** Tried first for each `data-const`: a game with a constants sheet answers here. Return nothing to fall through. */
  readonly lookup?: (root: string, ref: string) => ConstantHit | null | undefined
}

/** Resolve `src/x.ts#NAME.path` statically, or a path into a JSON file. Throws naming the reference. */
export declare const lookupConstant: (
  root: string,
  ref: string,
  options?: SourceOptions,
) => ConstantHit
export declare const formatConstant: (hit: ConstantHit, options?: FormatOptions) => string
/** Cut `file#name` or `file#Class.member` by name, with the leading doc comment left out. */
export declare const cutSnippet: (root: string, ref: string) => SnippetHit
/** Token-kind highlighting: the text, escaped, in `mo-tok-kw`, `-str`, `-num` and `-com` spans. */
export declare const highlight: (text: string) => string
/** Replace every `data-const` and `data-snippet` in a page. Throws on one that does not resolve, naming `page`. */
export declare const resolveSources: (
  root: string,
  html: string,
  page: string,
  options?: SourceOptions,
) => string
export declare const constRefsIn: (html: string) => string[]
export declare const snippetRefsIn: (html: string) => string[]
/** Any marker at all, filled or not: what a "nothing left behind" check looks for. */
export declare const ANY_MARKER: RegExp
/** Forget parsed files. The plugin does this when a source changes under `vite dev`. */
export declare const clearSourceCache: () => void

/** A pass of the game's own over a page, before `data-const` and `data-snippet` resolve. */
export type PageTransform = (
  html: string,
  page: { readonly root: string; readonly slug: string; readonly chapter: Chapter | null },
) => string

export interface MakingOfOptions {
  /** The game's name: the nav's brand, the footer, `og:site_name`. */
  readonly site: string
  /** The site's chapters, in reading order. Absent: hand-written pages, which get `transforms` and the source pass only. */
  readonly chapters?: readonly Chapter[]
  /** Pages that are not chapters. Default `['index', 'playground']`. */
  readonly sitePages?: readonly string[]
  /** Which chapters have a page. Default: `status === 'published'`. */
  readonly isBuilt?: (chapter: Chapter) => boolean
  /** The nav's whole HTML, in place of the default. */
  readonly nav?: string
  /** The footer's whole HTML, in place of the default. */
  readonly footer?: string
  /** HTML at the end of a chapter's header, such as a draft flag. */
  readonly headerNote?: (chapter: Chapter) => string
  /** What a card counts, singular. Default `'toy'`. */
  readonly unit?: string
  /** The game's own passes, in order. */
  readonly transforms?: readonly PageTransform[]
  /** Passed to the source pass. */
  readonly source?: SourceOptions
  /** The build's other inputs, by name, from the game root. Default `{ main: 'index.html' }`. */
  readonly entries?: Readonly<Record<string, string>>
  /** Whether a build lists the pages as inputs. A function can answer per mode. Default `true`. */
  readonly buildPages?: boolean | ((env: ConfigEnv) => boolean)
}

export interface MakingOfSite {
  /** The Vite plugin. */
  plugin(): Plugin
  /** The whole pass over one page's HTML. For the game's tests. */
  transformPage(root: string, slug: string, html: string): string
  /** The chapters with a page, in reading order. */
  builtChapters(): readonly Chapter[]
  /** The slugs a build emits. */
  builtPages(root: string): string[]
}

/** One game's making-of site. See docs/making-of.md. */
export declare function createMakingOf(options: MakingOfOptions): MakingOfSite
/** A page's file, from the game root. */
export declare const pageFile: (slug: string) => string
/** Every `making-of/**` page on disk, as a slug. */
export declare const pagesOnDisk: (root: string) => string[]
/** A section heading's anchor: its words, lowercased and hyphenated. */
export declare const sectionId: (heading: string) => string
/** A chapter with this many sections or more gets an "On this page" list. */
export declare const TOC_MIN_SECTIONS: number
