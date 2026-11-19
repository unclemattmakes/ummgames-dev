/**
 * `@ummgames/dev/stats`: the shared half of a game's play stats report. Days and ranges, pulling
 * a stats bucket's days with rclone, reading them back, and grouping kept batches into sessions.
 * The game's own sums stay in the game. See docs/stats.md.
 */

/** What `parseReportArgs` reads from a report's command line. */
export interface ReportArgs {
  /** `YYYY-MM-DD` or `from..to`; null for today. */
  range: string | null
  /** `--days N`: the last N days, today included. */
  days: number | null
  /** Each `--site S`. */
  sites: string[]
  /** `--all`: every site. */
  all: boolean
  /** False with `--no-pull`: read what is already pulled. */
  pull: boolean
  /** `--json`. */
  json: boolean
  /** Any other `--flag`, for the game to read. */
  rest: string[]
}

/**
 * `[day | from..to] [--days N] [--site S]... [--all] [--no-pull] [--json]`. A bare word is the
 * range; an unknown `--flag` goes to `rest` without its value.
 */
export declare function parseReportArgs(argv: readonly string[]): ReportArgs

/**
 * The UTC days a report covers, oldest first. `days`: the last N, today included. `range`: one
 * day or `from..to`, both included. Neither: today. Throws on a malformed day or count.
 */
export declare function daysOf(options?: {
  range?: string | null
  days?: number | null
  /** Default: now. */
  today?: Date
}): string[]

/**
 * Copy each of `days` that the bucket has from the rclone `remote` (`<remote name>:<bucket>`)
 * into `<cache>/<day>/`, and return the days it had. Lists the bucket's top folders first, since
 * rclone fails on a missing prefix. `run` replaces the rclone call, for tests.
 */
export declare function pullDays(options: {
  remote: string
  cache: string
  days: readonly string[]
  run?: (cmd: string, args: string[]) => string
}): string[]

/** Every `<cache>/<day>/<sid>/*.json` of `days`, parsed, in name order. Days not pulled are skipped. */
export declare function readDays(cache: string, days: readonly string[]): unknown[]

/** The fields `sessionsOf` reads from a kept batch (runtime/stats/batch.ts `StoredBatch`). */
export interface KeptBatch {
  sid: string
  seq: number
  build: string
  site: string
  browser: string
  events: { t: number; dev: string }[]
}

/** One page load: its batches' events in time order. */
export interface Session<B extends KeptBatch> {
  sid: string
  site: string
  build: string
  browser: string
  /** The device on its last event. */
  device: string
  /** Its first batch, for the game's own batch fields. */
  first: B
  events: B['events']
}

/**
 * Kept objects to sessions. `parse` checks each (runtime/stats/batch.ts `parseStored` with the
 * game's spec) and a null counts as `rejected`. `sites` keeps only those sites; null keeps all.
 */
export declare function sessionsOf<B extends KeptBatch>(
  raw: readonly unknown[],
  options: {
    parse: (raw: unknown) => B | null
    sites: ReadonlySet<string> | readonly string[] | null
  },
): { sessions: Session<B>[]; rejected: number }

/** The median, or null for none. */
export declare function median(xs: readonly number[]): number | null

/** How many times each key comes up. */
export declare function tally(keys: Iterable<string>): Record<string, number>

/**
 * A plain-text table: the first column padded right, the rest left, two spaces between. A null
 * cell prints `-`.
 */
export declare function table(
  head: readonly string[],
  rows: readonly (readonly (string | number | null)[])[],
): string
