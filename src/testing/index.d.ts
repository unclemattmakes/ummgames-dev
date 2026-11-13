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

// ── The portal check (docs/portal.md) ────────────────────────────────────────

/** `20000`: CrazyGames asks that a game loads within 20 s in desktop Chrome. */
export declare const PORTAL_LOAD_LIMIT_MS: number
/** `{ width: 907, height: 510 }`: CrazyGames' smallest desktop frame. */
export declare const CRAZYGAMES_SMALLEST_FRAME: Readonly<{ width: number; height: number }>
/** `[{ name: 'desktop' }, { name: 'nosdk', sdk: false }]`. */
export declare const DEFAULT_PORTAL_RUNS: readonly PortalCheckRun[]

/** One opening of the build in the fake portal. */
export interface PortalCheckRun {
  /** Names its stills (`desktop-01-title.png`) and its lines; `--only` picks runs by it. */
  name: string
  /** The iframe's size. Default `CRAZYGAMES_SMALLEST_FRAME`, 907 x 510. */
  frame?: { width: number; height: number }
  /** The fake SDK's behaviour; `false` blocks the script as an ad blocker would. Default `{}`. */
  sdk?: FakeSdkOptions | false
  /** An emulated touch phone: `isMobile`, `hasTouch`, the viewport the frame's size, 2x. */
  touch?: boolean
  /** The page's size. Default the frame plus 40 px each way; the frame itself with `touch`. */
  viewport?: { width: number; height: number }
  /** Default 1, or 2 with `touch`. */
  deviceScaleFactor?: number
  /** Appended to the game's `index.html` (`?debug=1`). */
  query?: string
  /** `false` skips the game's `play` steps in this run. Default true. */
  play?: boolean
  /** The exact SDK calls the run must make, in place of the order rules. */
  calls?: readonly string[]
}

/** What the game's `play` steps get, once per run, after the title still. */
export interface PortalCheckStep {
  run: PortalCheckRun
  page: import('playwright').Page
  context: import('playwright').BrowserContext
  portal: FakePortal<import('playwright').Frame>
  /** The game's frame, looked up again each call, so a reload is followed. */
  game(): import('playwright').Frame
  /** Shoot the game's frame alone as `<run>-<nn>-<name>.png`. */
  still(name: string): Promise<void>
  /** Print a passed check. */
  ok(what: string): void
  /** Record a failed check and go on. Throw instead to stop the run. */
  fail(why: string): void
  log(line: string): void
}

export interface PortalCheckOptions {
  /** The game root; relative paths here are read from it. Default the working directory. */
  root?: string
  /** The built portal folder. Default `dist-portal`. */
  dir?: string
  /** A shell command run in the root first (`pnpm build:portal`). Default none. */
  build?: string | null
  /** Where the stills and `report.json` go. Default `test-results/portal-check`. */
  out?: string
  /** Words the build's `.js`, `.mjs`, `.html` and `.css` must not hold. Case matters. */
  forbidden?: readonly string[]
  /** The upload limits for `checkPortalBuild`; `false` skips them. Default CrazyGames'. */
  limits?: { files: number; bytes: number } | false
  /** Run in the game's frame until it returns true: the game has loaded. Default `document.readyState === 'complete'`. */
  ready?: (() => unknown) | null
  /** How long `ready` may take before the run stops. Default 60000. */
  readyTimeoutMs?: number
  /** A load slower than this fails. Default `PORTAL_LOAD_LIMIT_MS`, 20000. */
  loadLimitMs?: number
  /** The wait between `ready` and the title still. Default 1000. */
  settleMs?: number
  /** The game's own steps, run in each run after the title still. */
  play?: ((step: PortalCheckStep) => Promise<void> | void) | null
  /** Default `DEFAULT_PORTAL_RUNS`. */
  runs?: readonly PortalCheckRun[]
  /** Only the runs with these names. */
  only?: readonly string[] | null
  /** Any `requestAd` call fails a run (a Basic Launch build asks for none). Default false. */
  noAds?: boolean
  /** Stub `navigator.getGamepads` to none, so a pad on the machine moves nothing. Default true. */
  hideGamepads?: boolean
  /** The game's folder on the fake portal. Default `fakePortal`'s, `/games/game/`. */
  gamePath?: string
  /** Draw in software (SwiftShader): no GPU lease, far slower. Default false. */
  cpu?: boolean
  /** Show the browser. Default false. */
  headed?: boolean
  /** A Chromium channel. Default the installed Chrome, then Edge, then Playwright's. */
  channel?: string
  /** Where the lines go. Default `console.log`. */
  log?: (line: string) => void
}

/** One run's record. */
export interface PortalRunReport {
  name: string
  loadMs: number
  calls: string[]
  errors: string[]
  elsewhere: string[]
  missing: string[]
  sockets: string[]
  /** How many files the fake portal served. */
  served: number
  /** The stills, relative to `out`. */
  stills: string[]
  problems: string[]
}

/** What `runPortalCheck` found; also written to `<out>/report.json`. */
export interface PortalCheckResult {
  ok: boolean
  /** Every failure, one line each. */
  problems: string[]
  /** `checkPortalBuild`'s report; null when the build failed. */
  files: import('../vite/index.js').PortalReport | null
  runs: PortalRunReport[]
  out: string
}

/** The game's `portal` section in `umm-dev.config.mjs`: `runPortalCheck`'s options, less the per-call ones. */
export type PortalCheckConfig = Omit<PortalCheckOptions, 'root' | 'only' | 'cpu' | 'headed' | 'log'>

/**
 * Open the portal build in the fake portal once per run, in Chrome, and fail on a console
 * error, another host, a missing file, a socket, a slow load or SDK calls out of order. See
 * docs/portal.md.
 */
export declare function runPortalCheck(options?: PortalCheckOptions): Promise<PortalCheckResult>
/** What a run broke, one line each. Blocked-request console lines are left out. */
export declare function runProblems(
  seen: Pick<PortalRunReport, 'loadMs' | 'calls' | 'errors' | 'elsewhere' | 'missing' | 'sockets'>,
  rules: {
    sdk: boolean
    sdkUrl?: string
    loadLimitMs?: number
    played?: boolean
    noAds?: boolean
    calls?: readonly string[] | null
  },
): string[]
/** Each forbidden word in the build's code, with the files holding it. */
export declare function forbiddenHits(
  dir: string,
  words: readonly string[],
): { word: string; files: string[] }[]
/** Chrome's flags for the real GPU, or SwiftShader with `cpu`. */
export declare function portalChromeArgs(options?: { cpu?: boolean; platform?: string }): string[]
