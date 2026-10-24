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

/** The fake SDK's script; calls land in `window.__fakePortal.calls` and `.rooms`. */
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
  /** Send the build's own `_headers` rules with its files. Default false. */
  applyHeaders?: boolean
}

/** The headers Cloudflare Pages would send for `pathname` from `dist/_headers` (splats only). */
export declare function headersFor(dist: string, pathname: string): Record<string, string>

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
  /** Fire the game's join listener with a room code or the whole parameters. */
  joinRoom(invite: string | Record<string, string>): Promise<void>
}

/** Route `page` as a portal serving the built game. Call before `open()`. */
export declare function fakePortal<P extends PageLike>(
  page: P,
  options?: FakePortalOptions,
): Promise<FakePortal<FrameOf<P>>>
