/**
 * The headers Cloudflare Pages would send for `pathname` from `dist/_headers`: every rule whose
 * pattern matches, in order, names lower-cased (splats only; placeholders are not read). `{}`
 * when the build has no `_headers`.
 */
export declare function headersFor(dist: string, pathname: string): Record<string, string>

/** What D1 says a statement did. */
export interface D1Meta {
  /** Rows the statement itself inserted, updated or deleted; 0 for a SELECT. */
  changes: number
  last_row_id: number
  changed_db: boolean
  duration: number
}

export interface D1Result<T = Record<string, unknown>> {
  results: T[]
  success: true
  meta: D1Meta
}

/** A prepared statement, as D1's. SQL compiles when it runs. */
export interface TestD1Statement {
  /** A new statement with these values. `undefined` and plain objects throw `D1_TYPE_ERROR`; booleans bind as 1 and 0. */
  bind(...values: unknown[]): TestD1Statement
  /** The first row, or null; with `column`, that column of it (`Column not found` when absent). */
  first<T = Record<string, unknown>>(): Promise<T | null>
  first<T = unknown>(column: string): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>
  /** Rows as arrays; with `columnNames`, the names first. */
  raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]>
}

/** A D1 binding over `node:sqlite`. Pass it wherever the Worker passes `env.<DB>`. */
export interface TestD1 {
  /** The node:sqlite database underneath, for a test that reads tables directly. */
  readonly sqlite: import('node:sqlite').DatabaseSync
  prepare(sql: string): TestD1Statement
  /** Every statement in one transaction; on a failure, none of them. Statements from another database throw. */
  batch<T = Record<string, unknown>>(statements: TestD1Statement[]): Promise<D1Result<T>[]>
  /** Several statements as one script. */
  exec(sql: string): Promise<{ count: number; duration: number }>
  close(): void
}

export interface CreateD1Options {
  /** A folder of `.sql` migrations, applied in name order, as wrangler applies them. */
  migrations?: string
  /** SQL run after the migrations: seed rows, or a schema given as text. */
  sql?: string | string[]
  /** A database file instead of memory. Default `':memory:'`. */
  file?: string
}

/**
 * A fresh D1 binding over `node:sqlite` (node 22.13 or later), with `migrations` and then
 * `sql` applied. Throws naming the file when a migration fails. See docs/board.md.
 */
export declare function createD1(options?: CreateD1Options): TestD1

/** The `?` parameters a statement takes, as SQLite counts them (`?NNN` is NNN). */
export declare function parameterCount(sql: string): number

export interface ImportGraphOptions {
  /** The game root. */
  root: string
  /** Import prefixes the game's bundler maps to folders. Default `{ '@/': 'src/' }`. */
  alias?: Readonly<Record<string, string>>
}

export interface ImportWalkOptions {
  /** Leave out whole `import type` and `export type` statements, which a compiler erases. */
  valueOnly?: boolean
}

/** One node of a walk: the file, and the chain of imports that first reached it. */
export interface ImportNode {
  file: string
  chain: string[]
}

export interface ImportGraph {
  /** A forward-slashed path from the game root, for anything printed or compared. */
  rel(abs: string): string
  /** An import specifier as a file on disk; `null` for a package. */
  resolveSpecifier(fromFile: string, spec: string): string | null
  /** Every imported specifier in a file. */
  importsOf(file: string, options?: ImportWalkOptions): string[]
  /** Breadth-first from `entry`, each file once. The entry comes first, and `chain[0]` is it. */
  walkImports(entry: string, options?: ImportWalkOptions): Generator<ImportNode>
  /** The TypeScript modules under `under` (default `src`) a file reaches: a test's width. */
  reachable(entry: string, under?: string): Set<string>
}

/** A static import walker over one game's sources. See docs/making-of.md. */
export declare function createImportGraph(options: ImportGraphOptions): ImportGraph
