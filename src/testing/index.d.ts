/**
 * Structural slices of Playwright's types, so a game's `@playwright/test` `Page` fits without
 * this package resolving `playwright` itself.
 */
export interface RouteLike {
  request(): { url(): string; method(): string; postData(): string | null }
  fulfill(response: {
    status?: number
    contentType?: string
    body?: string | Buffer
    headers?: Record<string, string>
  }): Promise<void>
  abort(errorCode?: string): Promise<void>
  continue(): Promise<void>
}
export interface WebSocketRouteLike {
  url(): string
  close(): Promise<void>
  connectToServer(): unknown
}
export interface FrameLike {
  evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>
}
export interface PageLike {
  route(url: string, handler: (route: RouteLike) => unknown): Promise<unknown>
  routeWebSocket(url: RegExp, handler: (ws: WebSocketRouteLike) => unknown): Promise<unknown>
  goto(url: string): Promise<unknown>
  frame(selector: { url: (url: URL) => boolean }): FrameLike | null
}
type FrameOf<P> = P extends { frame(selector: never): infer F } ? NonNullable<F> : FrameLike

export declare const PORTAL_HOST: 'https://portal.test'
export declare const CRAZYGAMES_SDK_URL: string

export interface FakeSdkOptions {
  /** Default `crazygames`. */
  environment?: 'crazygames' | 'local' | 'disabled'
  /** How `init()` behaves. Default `ok`. */
  init?: 'ok' | 'hang' | 'reject'
  /** An ad starts after `startMs` (100) and plays `lengthMs` (300); `fill: false` errors instead. */
  ad?: { fill?: boolean; startMs?: number; lengthMs?: number }
  /** Launched from the portal's multiplayer UI. */
  instant?: boolean
  /** Launched from an invite: a room code, or the whole parameters. */
  invite?: string | Record<string, string> | null
  /** Default `room`. */
  roomParam?: string
  /** The signed-in player's username; null (default) is a guest. */
  user?: string | null
  /** Offer `SDK.user` at all. Default true. */
  userApi?: boolean
  /** What `inviteLink` returns before its query. Default the game's index.html on the portal. */
  inviteLinkBase?: string
}

/** The fake SDK's script; calls land in `window.__fakePortal.calls` and `.rooms`. */
export declare function fakeSdkScript(options?: FakeSdkOptions): string

export interface PortalRoute {
  /** A full URL, a pattern or a test. */
  match: string | RegExp | ((url: URL) => boolean)
  /** Fulfil or abort it. */
  handle(route: RouteLike): unknown
}

export interface FakePortalOptions {
  /** The built game, relative to the working directory. Default `dist-portal`. */
  dist?: string
  /** The portal's origin. Default `https://portal.test`. */
  host?: string
  /** The game's folder on it. Default `/games/game/`. */
  gamePath?: string
  /** Appended to the game's `index.html` in the iframe. */
  query?: string
  /** The fake SDK's behaviour; `false` blocks the script. */
  sdk?: FakeSdkOptions | false
  /** Default CrazyGames' SDK v3 URL. */
  sdkUrl?: string
  /** The iframe: 960 x 540, `allow="autoplay; fullscreen; clipboard-write"` by default. */
  frame?: { width?: number; height?: number; allow?: string }
  /** Requests the spec answers itself, checked before the host block. */
  routes?: readonly PortalRoute[]
  /** WebSocket dials that may reach their server; every other is closed and noted. */
  allowWebSocket?: (url: string) => boolean
  /** Serve the game from another origin than the portal page, as CrazyGames does. */
  gameOrigin?: string
  /** Send the build's own `_headers` rules with its files. Default false. */
  applyHeaders?: boolean
}

/** The headers Cloudflare Pages would send for `pathname` from `dist/_headers` (splats only). */
export declare function headersFor(dist: string, pathname: string): Record<string, string>

export interface RoomCall {
  kind: 'update' | 'left' | 'link'
  roomId?: string
  isJoinable?: boolean
  inviteParams?: Record<string, string>
  [param: string]: unknown
}

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
  /** Open the portal page; the game's frame once its page has loaded. */
  open(): Promise<F>
  /** The game's frame, looked up again each time. */
  frame(): F
  /** The SDK calls the game has made so far, in order. */
  calls(): Promise<string[]>
  /** The room calls the game has made so far, in order. */
  rooms(): Promise<RoomCall[]>
  /** Fire the game's join listener with a room code or the whole parameters. */
  joinRoom(invite: string | Record<string, string>): Promise<void>
}

/** Route `page` as a portal serving the built game. */
export declare function fakePortal<P extends PageLike>(
  page: P,
  options?: FakePortalOptions,
): Promise<FakePortal<FrameOf<P>>>
