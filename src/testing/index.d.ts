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

// ── The fake portal (docs/portal.md) ─────────────────────────────────────────

/**
 * Structural slices of Playwright's types, so a game's `@playwright/test` `Page` fits without
 * this package resolving `playwright` itself.
 */
export interface RouteLike {
  /** The intercepted request. */
  request(): { url(): string; method(): string; postData(): string | null }
  /** Answer the request. */
  fulfill(response: {
    status?: number
    contentType?: string
    body?: string | Buffer
    headers?: Record<string, string>
  }): Promise<void>
  /** Fail the request, as a blocked host does. */
  abort(errorCode?: string): Promise<void>
  /** Send the request on to its server. */
  continue(): Promise<void>
}
/** The slice of Playwright's `WebSocketRoute` the fake portal uses. */
export interface WebSocketRouteLike {
  /** The URL the page dialled. */
  url(): string
  /** Close the dial unanswered. */
  close(): Promise<void>
  /** Let the dial reach its server. */
  connectToServer(): unknown
}
/** The slice of Playwright's `Frame` the fake portal uses. */
export interface FrameLike {
  /** Run `fn` inside the frame. */
  evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>
}
/** The slice of Playwright's `Page` the fake portal uses. */
export interface PageLike {
  /** Route every request matching `url`. */
  route(url: string, handler: (route: RouteLike) => unknown): Promise<unknown>
  /** Route every WebSocket dial matching `url`. */
  routeWebSocket(url: RegExp, handler: (ws: WebSocketRouteLike) => unknown): Promise<unknown>
  /** Load `url` in the page. */
  goto(url: string): Promise<unknown>
  /** The frame whose URL passes the test, or null. */
  frame(selector: { url: (url: URL) => boolean }): FrameLike | null
}
type FrameOf<P> = P extends { frame(selector: never): infer F } ? NonNullable<F> : FrameLike

/** The fake portal's origin: `'https://portal.test'`. */
export declare const PORTAL_HOST: 'https://portal.test'
/** CrazyGames' SDK v3 URL, the same as `@ummgames/dev/vite`'s. */
export declare const CRAZYGAMES_SDK_URL: string

export interface FakeSdkOptions {
  /** What `SDK.environment` reports. Default `crazygames`; `disabled` gets the game the stub. */
  environment?: 'crazygames' | 'local' | 'disabled'
  /** How `init()` behaves. Default `ok`; `hang` and `reject` get the game the stub. */
  init?: 'ok' | 'hang' | 'reject'
  /** An ad starts after `startMs` (100) and plays `lengthMs` (300); `fill: false` errors instead. */
  ad?: { fill?: boolean; startMs?: number; lengthMs?: number }
  /** What `hasAdblock()` answers. Default false. */
  adblock?: boolean
  /** The portal's settings at boot. Default both false. */
  settings?: { muteAudio?: boolean; disableChat?: boolean }
  /** `user.systemInfo.device.type`. Default `desktop`. */
  device?: 'desktop' | 'tablet' | 'mobile'
  /** `user.systemInfo.locale`. Default `en-US`. */
  locale?: string
  /** Offer `SDK.data`, kept in memory. Default true. */
  data?: boolean
  /** Launched from the portal's multiplayer UI. Default false. */
  instant?: boolean
  /** Launched from an invite: a room code, or the whole parameters. Default null. */
  invite?: string | Record<string, string> | null
  /** The invite parameter that names the room. Default `room`. */
  roomParam?: string
  /** The signed-in player's username; null (default) is a guest. */
  user?: string | null
  /** Offer `SDK.user` at all. Default true. */
  userApi?: boolean
  /**
   * What `inviteLink` returns before its query. Default the game's `index.html` under
   * `fakePortal`; `https://portal.test/invite` under `fakeSdkScript` alone.
   */
  inviteLinkBase?: string
}

/** The fake SDK's script; calls land in `window.__fakePortal.calls`, `.rooms` and `.data`. */
export declare function fakeSdkScript(options?: FakeSdkOptions): string

/** A request the spec answers itself. */
export interface PortalRoute {
  /** A full URL, a pattern or a test. */
  match: string | RegExp | ((url: URL) => boolean)
  /** Fulfil or abort it. */
  handle(route: RouteLike): unknown
}

export interface FakePortalOptions {
  /** The built game, relative to the working directory. Default `dist-portal`. */
  dist?: string
  /** The portal page's origin. Default `https://portal.test`. */
  host?: string
  /** The game's folder on it. Default `/games/game/`. */
  gamePath?: string
  /** Appended as written to the game's `index.html` in the iframe (`?debug=1`). Default none. */
  query?: string
  /** The fake SDK's behaviour; `false` blocks the script and notes it in `elsewhere`. */
  sdk?: FakeSdkOptions | false
  /** The URL answered with the fake SDK. Default CrazyGames' SDK v3 URL. */
  sdkUrl?: string
  /** The iframe: 960 x 540, `allow="autoplay; fullscreen; clipboard-write"` by default. */
  frame?: { width?: number; height?: number; allow?: string }
  /** Requests the spec answers itself, checked after the SDK URL and before the host block. */
  routes?: readonly PortalRoute[]
  /** WebSocket dials that may reach their server; every other is closed and noted. */
  allowWebSocket?: (url: string) => boolean
  /** Serve the game from another origin than the portal page, as CrazyGames does. Default `host`. */
  gameOrigin?: string
}

/** One room call the game made, as `rooms()` returns it. */
export interface RoomCall {
  /** `update` from `updateRoom`, `left` from `leftRoom`, `link` from `inviteLink`. */
  kind: 'update' | 'left' | 'link'
  /** The room code, on `update`. */
  roomId?: string
  /** Whether the room takes more players, on `update`. */
  isJoinable?: boolean
  /** The invite's parameters, on `update`. */
  inviteParams?: Record<string, string>
  /** On `link`, the parameters passed to `inviteLink`, such as `room`. */
  [param: string]: unknown
}

/** What `fakePortal` resolves to. */
export interface FakePortal<F> {
  /** The portal page's URL. */
  readonly url: string
  /** The game's folder on the portal, ending in `/`. */
  readonly gameUrl: string
  /** Requests to any other host, blocked. */
  readonly elsewhere: string[]
  /** Paths on the portal's origin with no file behind them. */
  readonly missing: string[]
  /** The game's files served, relative to `dist`. */
  readonly served: string[]
  /** Each served file's query string, by file. */
  readonly queries: Map<string, string>
  /** WebSocket dials closed unanswered. */
  readonly sockets: string[]
  /** Open the portal page; the game's frame once its page has loaded. Throws with no build. */
  open(): Promise<F>
  /** The game's frame, looked up again each time. Throws before `open()`. */
  frame(): F
  /** The SDK calls the game has made so far, in order. */
  calls(): Promise<string[]>
  /** The room calls the game has made so far, in order. */
  rooms(): Promise<RoomCall[]>
  /** What the game has saved through `SDK.data`, key to value. */
  data(): Promise<Record<string, string>>
  /** Fire the game's join listener with a room code or the whole parameters. */
  joinRoom(invite: string | Record<string, string>): Promise<void>
  /** Change the portal's settings and fire the game's settings listeners. */
  setSettings(settings: { muteAudio?: boolean; disableChat?: boolean }): Promise<void>
}

/** Route `page` as a portal serving the built game. Call before `open()`. */
export declare function fakePortal<P extends PageLike>(
  page: P,
  options?: FakePortalOptions,
): Promise<FakePortal<FrameOf<P>>>
