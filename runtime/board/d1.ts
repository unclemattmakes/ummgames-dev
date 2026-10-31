// The slice of Cloudflare D1 the board core uses: prepare, bind, first, all, run and batch.
//
// A Worker's real binding has more than this and satisfies it as it is, so a game passes
// `env.MY_DB` straight in. The kit's test shim (`createD1` in `@ummgames/dev/testing`) runs the
// same SQL on node:sqlite behind the same methods, so every statement a board sends is executed
// in a unit test, not mocked.
//
// SERVER-SAFE: types and one regular expression. No imports.

export interface D1Result<T = Record<string, unknown>> {
  readonly results: T[]
  readonly success: boolean
  readonly meta?: { readonly changes?: number; readonly last_row_id?: number }
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>
  run(): Promise<D1Result>
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement
  /** Every statement in one transaction: all of them apply, or none. */
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>
}

/**
 * Whether `e` is SQLite saying a table is not there. D1 wraps the message in its own framing
 * (`D1_ERROR: no such table: blocks: SQLITE_ERROR`) and the shim in the same, so one test
 * covers both. A board deployed before its migration answers `unmigrated` on this.
 */
export const isMissingTable = (e: unknown): boolean =>
  e instanceof Error && /no such table/i.test(e.message)
