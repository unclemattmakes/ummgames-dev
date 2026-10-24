/**
 * A web portal's SDK behind one interface the game calls: CrazyGames' HTML5 SDK v3 in the portal
 * build, a stub that does nothing everywhere else (dev, the game's own site, the e2e specs, a
 * portal page with the SDK blocked). Game logic never sees the SDK itself.
 *
 * The portal build's index.html loads the SDK's script (`portalSdk()` in `@ummgames/dev/vite`).
 * Off CrazyGames' own domains the SDK runs `disabled` and every call throws, so that is a stub
 * too. Every call is guarded: a portal hiccup must never stop the game.
 *
 * The room calls (CrazyGames multiplayer: instant multiplayer, invites, `updateRoom`,
 * `leftRoom`, invite links, usernames) are optional. A solo game never calls them; off the portal
 * they do nothing. A room is the game's own code for a session, carried in the invite's
 * parameters as `{ room: CODE }` (the parameter's name is an option).
 */
import { PORTAL } from './build-target'

/** The slice of CrazyGames' HTML5 SDK v3 used here (https://docs.crazygames.com/sdk/intro/). */
export interface CrazySdk {
  init(): Promise<void>
  readonly environment: 'local' | 'crazygames' | 'disabled'
  game: {
    gameplayStart(): void
    gameplayStop(): void
    loadingStart(): void
    loadingStop(): void
    happytime(): void
    /** Launched from CrazyGames' multiplayer UI: put the player in a joinable room at once. */
    readonly isInstantMultiplayer?: boolean
    /** Launched from an invite: its parameters, else null. */
    readonly inviteParams?: Record<string, string> | null
    addJoinRoomListener?(fn: (params: Record<string, string> | null | undefined) => void): void
    updateRoom?(room: {
      roomId?: string
      isJoinable?: boolean
      inviteParams?: Record<string, string>
    }): void
    leftRoom?(): void
    /** Sync in the HTML5 docs' example, awaited in others: both are handled. */
    inviteLink?(params: Record<string, string>): string | Promise<string>
  }
  user?: {
    /** The signed-in player, or null for a guest. */
    getUser(): Promise<{ username?: string } | null>
  }
  ad: {
    requestAd(
      kind: 'midgame' | 'rewarded',
      callbacks: {
        adStarted?: () => void
        adFinished?: () => void
        adError?: (e: unknown) => void
      },
    ): void
  }
}

declare global {
  interface Window {
    CrazyGames?: { SDK: CrazySdk }
  }
}

export interface PortalSdk {
  readonly name: 'crazygames' | 'none'
  /** Boot is done and the first frame is about to show. */
  loadingStop(): void
  /** Whether the player is playing now (not a menu, a load, an ad); only changes are sent. */
  setGameplay(on: boolean): void
  /**
   * A midgame ad at a natural break. Resolves once it is over, shown or not (no fill, too soon
   * since the last, blocked); never rejects. The game's sound is muted only while an ad plays.
   */
  midgameAd(): Promise<void>
  /** A big moment: the portal celebrates with the player. Use sparingly. */
  happytime(): void
  /** Launched from the portal's multiplayer UI: host a joinable room at once, no menu. */
  readonly instantMultiplayer: boolean
  /** Launched from an invite: the room to join at once, or null. */
  readonly inviteRoom: string | null
  /** A friend's invite clicked while the game runs: join `room` without a reload. */
  onJoinRoom(fn: (room: string) => void): void
  /** This player is in room `code` (hosting or joined), joinable or full. */
  updateRoom(code: string, joinable: boolean): void
  /** This player is back to playing alone. */
  leftRoom(): void
  /** The portal's link to room `code`, or null (off the portal: the caller makes its own). */
  inviteLink(code: string): Promise<string | null>
  /**
   * The player's name: their portal username; `''` for a portal guest (not signed in); null
   * with no portal user API at all (off the portal).
   */
  username(): Promise<string | null>
}

export interface PortalSdkOptions {
  /** Use the SDK at all. Default `PORTAL`: the portal build only. */
  enabled?: boolean
  /** The SDK to use. Default `window.CrazyGames.SDK`, read when `createPortalSdk` is called. */
  sdk?: CrazySdk
  /** How long boot waits on the SDK's init before playing on without it. Default 5000 ms. */
  initWaitMs?: number
  /** An ad that has not started by then is not coming: play on. Default 6000 ms. */
  adStartWaitMs?: number
  /** The invite parameter that names a room. Default `room`. */
  roomParam?: string
  /** What a room code looks like, tested after upper-casing. Default 4 to 12 letters or digits. */
  roomCode?: RegExp
  /** Where a failed call is reported. Default `console.warn`. */
  warn?: (message: string, error?: unknown) => void
}

/** How long boot waits on the SDK's init before playing on without it. */
export const INIT_WAIT_MS = 5000
/** An ad that has not started by now is not coming: play on rather than hang on the break. */
export const AD_START_WAIT_MS = 6000
/** The default room code: 4 to 12 letters or digits. */
export const ROOM_CODE = /^[A-Z0-9]{4,12}$/

/** A room code from invite parameters (`{ room: 'ABCD' }`), upper-cased, or null. */
export function roomFromParams(
  params: unknown,
  roomParam = 'room',
  roomCode: RegExp = ROOM_CODE,
): string | null {
  if (typeof params !== 'object' || params === null) return null
  const room = (params as Record<string, unknown>)[roomParam]
  if (typeof room !== 'string') return null
  const code = room.toUpperCase()
  roomCode.lastIndex = 0
  return roomCode.test(code) ? code : null
}

/** The stub: what the game gets off the portal, or when the SDK fails. */
export const NO_PORTAL: PortalSdk = Object.freeze({
  name: 'none',
  loadingStop() {},
  setGameplay() {},
  midgameAd: () => Promise.resolve(),
  happytime() {},
  instantMultiplayer: false,
  inviteRoom: null,
  onJoinRoom() {},
  updateRoom() {},
  leftRoom() {},
  inviteLink: () => Promise.resolve(null),
  username: () => Promise.resolve(null),
})

/**
 * The portal SDK, initialised, or the stub. Never rejects. `audio` is muted while an ad plays.
 */
export async function createPortalSdk(
  audio: { setMuted(muted: boolean): void },
  options: PortalSdkOptions = {},
): Promise<PortalSdk> {
  const warn = options.warn ?? ((m: string, e?: unknown) => console.warn(`[portal] ${m}`, e))
  const enabled = options.enabled ?? PORTAL
  const sdk = enabled
    ? (options.sdk ?? (typeof window === 'undefined' ? undefined : window.CrazyGames?.SDK))
    : undefined
  if (!sdk) return NO_PORTAL
  const initWait = options.initWaitMs ?? INIT_WAIT_MS
  const adWait = options.adStartWaitMs ?? AD_START_WAIT_MS
  const roomParam = options.roomParam ?? 'room'
  const roomCode = options.roomCode ?? ROOM_CODE
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      sdk.init(),
      new Promise((_, no) => {
        timer = setTimeout(() => no(new Error('init timed out')), initWait)
      }),
    ])
  } catch (e) {
    warn('CrazyGames SDK unavailable, playing on without it', e)
    return NO_PORTAL
  } finally {
    clearTimeout(timer)
  }
  let disabled = true
  try {
    disabled = sdk.environment === 'disabled'
  } catch (e) {
    warn('environment failed', e)
  }
  if (disabled) return NO_PORTAL

  const safe = (what: string, f: () => void) => {
    try {
      f()
    } catch (e) {
      warn(`${what} failed`, e)
    }
  }
  safe('loadingStart', () => sdk.game.loadingStart())
  let playing = false
  let instant = false
  let invited: string | null = null
  safe('isInstantMultiplayer', () => {
    instant = sdk.game.isInstantMultiplayer === true
  })
  safe('inviteParams', () => {
    invited = roomFromParams(sdk.game.inviteParams, roomParam, roomCode)
  })
  return {
    name: 'crazygames',
    loadingStop: () => safe('loadingStop', () => sdk.game.loadingStop()),
    setGameplay(on) {
      if (on === playing) return
      playing = on
      safe(on ? 'gameplayStart' : 'gameplayStop', () =>
        on ? sdk.game.gameplayStart() : sdk.game.gameplayStop(),
      )
    },
    midgameAd() {
      return new Promise<void>((resolve) => {
        let started = false
        let muted = false
        let over = false
        // An ad can end after play resumed (it started past the no-show wait), so unmuting is
        // separate from resolving: the sound comes back whenever the ad that took it ends.
        const done = () => {
          if (muted) {
            muted = false
            safe('unmute', () => audio.setMuted(false))
          }
          if (over) return
          over = true
          clearTimeout(noShow)
          resolve()
        }
        const noShow = setTimeout(done, adWait)
        try {
          sdk.ad.requestAd('midgame', {
            adStarted: () => {
              // One ad per request. A start after the no-show wait still plays over the game,
              // so it still mutes the game.
              if (started) return
              started = true
              clearTimeout(noShow)
              muted = true
              safe('mute', () => audio.setMuted(true))
            },
            adFinished: done,
            adError: done,
          })
        } catch (e) {
          warn('requestAd failed', e)
          done()
        }
      })
    },
    happytime: () => safe('happytime', () => sdk.game.happytime()),
    instantMultiplayer: instant,
    inviteRoom: invited,
    onJoinRoom(fn) {
      safe('addJoinRoomListener', () =>
        sdk.game.addJoinRoomListener?.((params) => {
          const room = roomFromParams(params, roomParam, roomCode)
          if (room) fn(room)
        }),
      )
    },
    updateRoom(code, joinable) {
      safe('updateRoom', () =>
        sdk.game.updateRoom?.({
          roomId: code,
          isJoinable: joinable,
          inviteParams: { [roomParam]: code },
        }),
      )
    },
    leftRoom: () => safe('leftRoom', () => sdk.game.leftRoom?.()),
    async inviteLink(code) {
      try {
        const link = await sdk.game.inviteLink?.({ [roomParam]: code })
        return typeof link === 'string' && link ? link : null
      } catch (e) {
        warn('inviteLink failed', e)
        return null
      }
    },
    async username() {
      if (!sdk.user) return null
      try {
        const u = await sdk.user.getUser()
        return typeof u?.username === 'string' ? u.username : ''
      } catch (e) {
        warn('getUser failed', e)
        return null
      }
    },
  }
}
