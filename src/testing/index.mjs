// @ts-check
/**
 * `@ummgames/dev/testing`: the portal build as a web game portal runs it, for Playwright specs.
 *
 * `fakePortal(page)` routes every request the page makes:
 * - the portal's own page, on a fake origin (`https://portal.test`), holding the game in an
 *   iframe;
 * - the built game (`dist-portal/` by default) from a folder of its own on that origin;
 * - CrazyGames' SDK script, answered with a fake that records every call;
 * - every other host, blocked and noted, and every WebSocket dial too unless allowed.
 *
 * Nothing listens on a port: Playwright answers each request itself. See docs/portal.md.
 *
 *   const portal = await fakePortal(page)
 *   const game = await portal.open()
 *   await expect.poll(portal.calls).toContain('gameplayStart')
 */
import fs from 'node:fs'
import path from 'node:path'

export const PORTAL_HOST = 'https://portal.test'
export const CRAZYGAMES_SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js'

/** @type {Record<string, string>} */
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.ktx2': 'image/ktx2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.txt': 'text/plain',
}

/**
 * @typedef {object} FakeSdkOptions
 * @property {'crazygames' | 'local' | 'disabled'} [environment] Default `crazygames`.
 * @property {'ok' | 'hang' | 'reject'} [init] How `init()` behaves. Default `ok`.
 * @property {{ fill?: boolean, startMs?: number, lengthMs?: number }} [ad] An ad starts after
 *   `startMs` (100) and plays for `lengthMs` (300); with `fill: false` it errors instead.
 * @property {boolean} [instant] Launched from the portal's multiplayer UI.
 * @property {string | Record<string, string> | null} [invite] Launched from an invite: a room
 *   code (sent as `{ [roomParam]: code }`) or the whole parameters.
 * @property {string} [roomParam] Default `room`.
 * @property {string | null} [user] The signed-in player's username; null (default) is a guest.
 * @property {boolean} [userApi] Offer `SDK.user` at all. Default true.
 * @property {string} [inviteLinkBase] What `inviteLink` returns before its query.
 */

/**
 * The fake SDK's script. Every game call lands in `window.__fakePortal.calls` (`init`,
 * `loadingStart`, `gameplayStart`, `requestAd:midgame`, `adStarted`, `adFinished`, `adError`,
 * `happytime`, ...), every room call in `.rooms`; the join listener is kept as `.join`.
 * @param {FakeSdkOptions} [o]
 * @returns {string}
 */
export function fakeSdkScript(o = {}) {
  const roomParam = o.roomParam ?? 'room'
  const invite =
    typeof o.invite === 'string' ? { [roomParam]: o.invite } : o.invite ? { ...o.invite } : null
  const opts = {
    environment: o.environment ?? 'crazygames',
    init: o.init ?? 'ok',
    fill: o.ad?.fill ?? true,
    startMs: o.ad?.startMs ?? 100,
    lengthMs: o.ad?.lengthMs ?? 300,
    instant: !!o.instant,
    invite,
    user: o.user ?? null,
    userApi: o.userApi ?? true,
    linkBase: o.inviteLinkBase ?? `${PORTAL_HOST}/invite`,
  }
  return `(() => {
const opts = ${JSON.stringify(opts)}
const rec = (window.__fakePortal = { calls: [], rooms: [], join: null })
const log = (n) => rec.calls.push(n)
const sdk = {
  environment: opts.environment,
  init: () => {
    log('init')
    if (opts.init === 'hang') return new Promise(() => {})
    if (opts.init === 'reject') return Promise.reject(new Error('fake init failed'))
    return Promise.resolve()
  },
  game: {
    gameplayStart: () => log('gameplayStart'),
    gameplayStop: () => log('gameplayStop'),
    loadingStart: () => log('loadingStart'),
    loadingStop: () => log('loadingStop'),
    happytime: () => log('happytime'),
    isInstantMultiplayer: opts.instant,
    inviteParams: opts.invite,
    addJoinRoomListener: (fn) => { rec.join = fn },
    updateRoom: (r) => rec.rooms.push({ kind: 'update', ...r }),
    leftRoom: () => rec.rooms.push({ kind: 'left' }),
    inviteLink: (p) => {
      rec.rooms.push({ kind: 'link', ...p })
      return opts.linkBase + '?' + new URLSearchParams(p).toString()
    },
  },
  ad: {
    requestAd: (kind, cb) => {
      log('requestAd:' + kind)
      setTimeout(() => {
        if (!opts.fill) { log('adError'); cb.adError && cb.adError(new Error('no fill')); return }
        log('adStarted'); cb.adStarted && cb.adStarted()
        setTimeout(() => { log('adFinished'); cb.adFinished && cb.adFinished() }, opts.lengthMs)
      }, opts.startMs)
    },
  },
}
if (opts.userApi) sdk.user = { getUser: async () => (opts.user ? { username: opts.user } : null) }
window.CrazyGames = { SDK: sdk }
})()
`
}

/**
 * @typedef {object} PortalRoute
 * @property {string | RegExp | ((url: URL) => boolean)} match A full URL, a pattern or a test.
 * @property {(route: import('playwright').Route) => unknown} handle Fulfil or abort it.
 */

/**
 * @typedef {object} FakePortalOptions
 * @property {string} [dist] The built game, relative to the working directory. Default
 *   `dist-portal`.
 * @property {string} [host] The portal's origin. Default `https://portal.test`.
 * @property {string} [gamePath] The game's folder on it. Default `/games/game/`.
 * @property {string} [query] Appended to the game's `index.html` in the iframe (`?debug=1`).
 * @property {FakeSdkOptions | false} [sdk] The fake SDK's behaviour; `false` blocks the script
 *   as an ad blocker would.
 * @property {string} [sdkUrl] Default CrazyGames' SDK v3 URL.
 * @property {{ width?: number, height?: number, allow?: string }} [frame] The iframe: 960 x 540,
 *   `allow="autoplay; fullscreen; clipboard-write"` by default.
 * @property {readonly PortalRoute[]} [routes] Requests the spec answers itself (a stats endpoint),
 *   checked before the host block.
 * @property {(url: string) => boolean} [allowWebSocket] Dials that may reach their server (a dev
 *   relay). Every other dial is closed and noted in `sockets`.
 * @property {string} [gameOrigin] Serve the game from another origin than the portal page, as
 *   CrazyGames does. Default the portal's own.
 * @property {boolean} [applyHeaders] Send the build's own `_headers` rules with its files, so
 *   a spec sees whether the portal may frame it. Default false.
 */

/**
 * @typedef {object} RoomCall
 * @property {'update' | 'left' | 'link'} kind
 * @property {string} [roomId]
 * @property {boolean} [isJoinable]
 * @property {Record<string, string>} [inviteParams]
 */

/**
 * Route `page` as a portal serving the game. Call before `open()`.
 * @param {import('playwright').Page} page
 * @param {FakePortalOptions} [options]
 */
export async function fakePortal(page, options = {}) {
  const host = (options.host ?? PORTAL_HOST).replace(/\/+$/, '')
  const gamePath = `/${(options.gamePath ?? '/games/game/').replace(/^\/+|\/+$/g, '')}/`
  const dist = path.resolve(options.dist ?? 'dist-portal')
  const sdkUrl = options.sdkUrl ?? CRAZYGAMES_SDK_URL
  const gameOrigin = (options.gameOrigin ?? host).replace(/\/+$/, '')
  const gameUrl = `${gameOrigin}${gamePath}`
  const frameOpts = options.frame ?? {}
  const sdkOpts =
    options.sdk === false
      ? false
      : { inviteLinkBase: `${gameUrl}index.html`, ...(options.sdk ?? {}) }
  const routes = options.routes ?? []

  /** Requests to any other host, blocked. */
  const elsewhere = /** @type {string[]} */ ([])
  /** Paths on the portal's origin with no file behind them. */
  const missing = /** @type {string[]} */ ([])
  /** The game's files served, relative to `dist`. */
  const served = /** @type {string[]} */ ([])
  /** Each served file's query string, by file. */
  const queries = /** @type {Map<string, string>} */ (new Map())
  /** WebSocket dials closed unanswered. */
  const sockets = /** @type {string[]} */ ([])

  await page.routeWebSocket(/.*/, (ws) => {
    if (options.allowWebSocket?.(ws.url())) {
      ws.connectToServer()
      return
    }
    sockets.push(ws.url())
    ws.close()
  })
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.href === sdkUrl) {
      if (!sdkOpts) {
        elsewhere.push(url.href)
        return route.abort('blockedbyclient')
      }
      return route.fulfill({ contentType: 'text/javascript', body: fakeSdkScript(sdkOpts) })
    }
    for (const r of routes) {
      const m = r.match
      const hit =
        typeof m === 'string' ? url.href === m : m instanceof RegExp ? m.test(url.href) : m(url)
      if (hit) return r.handle(route)
    }
    if (url.origin !== host && url.origin !== gameOrigin) {
      elsewhere.push(url.href)
      return route.abort('blockedbyclient')
    }
    if (url.origin === host && url.pathname === '/') {
      const w = frameOpts.width ?? 960
      const h = frameOpts.height ?? 540
      const allow = frameOpts.allow ?? 'autoplay; fullscreen; clipboard-write'
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><title>Fake portal</title><body style="margin:0;background:#222">
<iframe id="game" src="${gameUrl}index.html${options.query ?? ''}" width="${w}" height="${h}" allow="${allow}"></iframe></body>`,
      })
    }
    const rel = decodeURIComponent(url.pathname.slice(gamePath.length))
    const file = path.normalize(path.join(dist, rel))
    if (
      url.origin !== gameOrigin ||
      !url.pathname.startsWith(gamePath) ||
      !file.startsWith(dist + path.sep) ||
      !fs.existsSync(file) ||
      !fs.statSync(file).isFile()
    ) {
      missing.push(url.pathname)
      return route.fulfill({ status: 404, body: '' })
    }
    served.push(rel)
    queries.set(rel, url.search)
    return route.fulfill({
      contentType: TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      body: fs.readFileSync(file),
      headers: options.applyHeaders ? headersFor(dist, `/${rel}`) : {},
    })
  })

  const frame = () => {
    const f = page.frame({ url: (u) => u.href.startsWith(gameUrl) })
    if (!f) throw new Error(`no game frame at ${gameUrl}: call open() first`)
    return f
  }
  /** @returns {Promise<{ calls: string[], rooms: RoomCall[] }>} */
  const record = () =>
    frame().evaluate(() => {
      const r = /** @type {any} */ (window).__fakePortal
      return { calls: r ? [...r.calls] : [], rooms: r ? [...r.rooms] : [] }
    })

  return {
    /** The portal page's URL. */
    url: `${host}/`,
    /** The game's folder on the portal, ending in `/`. */
    gameUrl,
    elsewhere,
    missing,
    served,
    queries,
    sockets,
    /** Open the portal page and return the game's frame once its page has loaded. */
    async open() {
      if (!fs.existsSync(path.join(dist, 'index.html'))) {
        throw new Error(
          `${path.relative(process.cwd(), dist) || dist} has no index.html: build the portal target first`,
        )
      }
      await page.goto(`${host}/`)
      return frame()
    },
    /** The game's frame (looked up again each time, so a reload is followed). */
    frame,
    /** The SDK calls the game has made so far, in order. */
    calls: async () => (await record()).calls,
    /** The room calls the game has made so far, in order. */
    rooms: async () => (await record()).rooms,
    /**
     * Fire the game's join listener as the portal does when a friend's invite is clicked in a
     * running game: a room code, or the whole parameters.
     * @param {string | Record<string, string>} invite
     */
    async joinRoom(invite) {
      const params =
        typeof invite === 'string'
          ? { [sdkOpts ? (sdkOpts.roomParam ?? 'room') : 'room']: invite }
          : invite
      const fired = await frame().evaluate((p) => {
        const r = /** @type {any} */ (window).__fakePortal
        if (!r?.join) return false
        r.join(p)
        return true
      }, params)
      if (!fired) throw new Error('the game has not called addJoinRoomListener')
    },
  }
}

/**
 * The headers Cloudflare Pages would send for `pathname` from a build's `_headers`: every rule
 * whose pattern matches, in order (splats only; placeholders are not read).
 * @param {string} dist
 * @param {string} pathname
 * @returns {Record<string, string>}
 */
export function headersFor(dist, pathname) {
  const file = path.join(dist, '_headers')
  if (!fs.existsSync(file)) return {}
  /** @type {Record<string, string>} */
  const out = {}
  let on = false
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    if (!/^\s/.test(line)) {
      const re = line
        .trim()
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
      on = new RegExp(`^${re}$`).test(pathname)
      continue
    }
    const at = line.indexOf(':')
    if (on && at > 0) out[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim()
  }
  return out
}
