export interface ToyShot {
  readonly id: string
  /** The toy's screenshot. */
  readonly file: string
  /** Distinct colours in its stage, at 5 bits a channel. */
  readonly colours: number
  /** Its stage still shows the poster, or has none. */
  readonly unmounted: boolean
  /** The text of its readouts row. */
  readonly readouts: string
}

export interface PageShot {
  readonly url: string
  readonly toys: readonly ToyShot[]
  /** Console errors and uncaught exceptions. */
  readonly errors: readonly string[]
  /** Elements past the screen's right edge, up to five. */
  readonly overflow: readonly string[]
}

export interface ShotOptions {
  /** Where the screenshots go. Default `'test-results/making-of'`. */
  readonly out?: string
  /** A 375x812 phone at 2x, in place of 1280x800. */
  readonly phone?: boolean
  /** Milliseconds to wait at each toy before shooting. Default `2500`. */
  readonly wait?: number
  readonly log?: (line: string) => void
}

export declare const MIN_COLOURS: number
export declare const VIEWPORTS: {
  readonly desktop: { width: number; height: number; scale: number }
  readonly phone: { width: number; height: number; scale: number }
}
/** What is wrong with a page's shots, one line each. */
export declare function problemsIn(page: PageShot): string[]
/** Shoot every toy on each page. */
export declare function shootPages(
  urls: readonly string[],
  options?: ShotOptions,
): Promise<PageShot[]>
