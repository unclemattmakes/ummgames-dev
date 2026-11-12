/**
 * A web portal's SDK behind one interface the game calls: CrazyGames' HTML5 SDK v3 in the portal
 * build, a stub that does nothing everywhere else (dev, the game's own site, the e2e specs, a
 * portal page with the SDK blocked). Game logic never sees the SDK itself.
 *
 * The portal build's index.html loads the SDK's script (`portalSdk()` in `@ummgames/dev/vite`).
 * Off CrazyGames' own domains the SDK runs `disabled` and every call throws, so that is a stub
 * too. Every call is guarded: a portal hiccup must never stop the game. A Basic Launch needs no
 * SDK at all, so a game built on this runs the same with the script missing or blocked.
 *
 * The room calls (CrazyGames multiplayer: instant multiplayer, invites, `updateRoom`,
 * `leftRoom`, invite links, usernames) are optional. A solo game never calls them; off the portal
 * they do nothing. A room is the game's own code for a session, carried in the invite's
 * parameters as `{ room: CODE }` (the parameter's name is an option).
 *
 * The call order: `createPortalSdk` first in boot (it sends `loadingStart`), `loadingStop()` once
 * the first frame is about to show, `setGameplay(true/false)` around play, and at a break
 * `setGameplay(false)`, `await midgameAd()`, `setGameplay(true)`. See docs/portal.md in
 * `@ummgames/dev`.
 */
import { PORTAL } from './build-target'

/** What an ad error carries (`unfilled`, `adCooldown`, `adblock`, `adsDisabled`, `other`). */
export interface CrazyAdError {
  code?: string
  message?: string
}

/** The portal's own settings for this player. */
export interface PortalSettings {
  /** Silence the game. It takes priority over the game's own sound setting. */
  readonly muteAudio: boolean
  /** Turn off any chat the game has. */
  readonly disableChat: boolean
}

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
    /** 0 to 100: how far through the game the player is. */
    reportGameCompletedPercentage?(percent: number): void
    /** State attached to a player's feedback report, such as the level. */
    setGameContext?(context: Record<string, unknown>): void
    clearGameContext?(): void
    /** The portal's settings for this player, read live. */
    readonly settings?: Partial<PortalSettings>
    addSettingsChangeListener?(fn: (settings: Partial<PortalSettings>) => void): void
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
    readonly systemInfo?: {
      readonly device?: { readonly type?: string }
      readonly locale?: string
    }
  }
  /** Shaped like `localStorage`; follows the player's account across devices. */
  data?: {
    getItem(key: string): string | null
    setItem(key: string, value: string): void
    removeItem(key: string): void
  }
  ad: {
    requestAd(
      kind: 'midgame' | 'rewarded',
      callbacks: {
        adStarted?: () => void
        adFinished?: () => void
        adError?: (e: CrazyAdError | unknown) => void
      },
    ): void
    hasAdblock?(): Promise<boolean>
  }
}

declare global {
  interface Window {
    CrazyGames?: { SDK: CrazySdk }
  }
}

/** Where saves go: the portal's data module on the portal, `localStorage` everywhere else. */
export interface PortalStorage {
  /** The value, or null when unset or unreadable. Never throws. */
  getItem(key: string): string | null
  /** Store it; a failure is reported through `warn` and dropped. Never throws. */
  setItem(key: string, value: string): void
  /** Never throws. */
  removeItem(key: string): void
}

export interface PortalSdk {
  /** `crazygames` with the SDK, `none` for the stub. */
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
  /**
   * A rewarded ad the player asked for. Resolves true when it played to the end, false
   * otherwise (error, no fill, no start within the wait, the stub); never rejects. Give the
   * reward on true only.
   */
  rewardedAd(): Promise<boolean>
  /** Whether the portal thinks an ad blocker is on. False on the stub or a failure. */
  hasAdblock(): Promise<boolean>
  /** A big moment: the portal celebrates with the player. Use sparingly. */
  happytime(): void
  /** How far through the game the player is, 0 to 100, clamped and rounded. */
  progress(percent: number): void
  /** State attached to a player's feedback report, such as `{ level: 3 }`; null clears it. */
  setContext(context: Record<string, unknown> | null): void
  /** The portal's settings now. Both false on the stub. */
  settings(): PortalSettings
  /** Called on every change of the portal's settings. */
  onSettings(fn: (settings: PortalSettings) => void): void
  /** The device the portal reports, or null (the stub, or an SDK without it). */
  readonly device: 'desktop' | 'tablet' | 'mobile' | null
  /** The player's locale as the portal reports it (`en-US`), or null. */
  readonly locale: string | null
  /** Saves: the portal's data module when it works, else `localStorage`. */
  readonly storage: PortalStorage
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

const NO_SETTINGS: PortalSettings = /* @__PURE__ */ Object.freeze({
  muteAudio: false,
  disableChat: false,
})

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

/**
 * `localStorage`, guarded: it throws in some sandboxed frames and private modes. A store that
 * cannot be read reads as empty.
 */
export function localStore(warn: (message: string, error?: unknown) => void): PortalStorage {
  const ls = (): Storage | null => {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage
    } catch {
      return null
    }
  }
  return {
    getItem(key) {
      try {
        return ls()?.getItem(key) ?? null
      } catch (e) {
        warn('localStorage.getItem failed', e)
        return null
      }
    },
    setItem(key, value) {
      try {
        ls()?.setItem(key, value)
      } catch (e) {
        warn('localStorage.setItem failed', e)
      }
    },
    removeItem(key) {
      try {
        ls()?.removeItem(key)
      } catch (e) {
        warn('localStorage.removeItem failed', e)
      }
    },
  }
}

const quietWarn = (m: string, e?: unknown) => console.warn(`[portal] ${m}`, e)

/** The stub: what the game gets off the portal, or when the SDK fails. */
export const NO_PORTAL: PortalSdk = /* @__PURE__ */ Object.freeze({
  name: 'none',
  loadingStop() {},
  setGameplay() {},
  midgameAd: () => Promise.resolve(),
  rewardedAd: () => Promise.resolve(false),
  hasAdblock: () => Promise.resolve(false),
  happytime() {},
  progress() {},
  setContext() {},
  settings: () => NO_SETTINGS,
  onSettings() {},
  device: null,
  locale: null,
  storage: localStore(quietWarn),
  instantMultiplayer: false,
  inviteRoom: null,
  onJoinRoom() {},
  updateRoom() {},
  leftRoom() {},
  inviteLink: () => Promise.resolve(null),
  username: () => Promise.resolve(null),
})

/** The SDK's settings as two booleans; anything missing reads false. */
function readSettings(raw: Partial<PortalSettings> | null | undefined): PortalSettings {
  return { muteAudio: raw?.muteAudio === true, disableChat: raw?.disableChat === true }
}

/**
 * The portal SDK, initialised, or the stub. Never rejects. `audio.setMuted(true)` runs when the
 * portal wants the game silent (an ad is playing, or its `muteAudio` setting is on) and
 * `setMuted(false)` when neither holds, whatever the player chose, so keep it apart from the
 * player's own mute. Only changes are sent.
 */
export async function createPortalSdk(
  audio: { setMuted(muted: boolean): void },
  options: PortalSdkOptions = {},
): Promise<PortalSdk> {
  const warn = options.warn ?? quietWarn
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

  // Silence is wanted while an ad plays or while the portal's muteAudio is on. One flag goes to
  // the game, sent only when it changes.
  let adsPlaying = 0
  let settings = NO_SETTINGS
  let silent = false
  const applyMute = () => {
    const want = adsPlaying > 0 || settings.muteAudio
    if (want === silent) return
    silent = want
    safe(want ? 'mute' : 'unmute', () => audio.setMuted(want))
  }
  const settingsListeners: ((s: PortalSettings) => void)[] = []
  safe('settings', () => {
    settings = readSettings(sdk.game.settings)
  })
  applyMute()
  safe('addSettingsChangeListener', () =>
    sdk.game.addSettingsChangeListener?.((raw) => {
      settings = readSettings(raw)
      applyMute()
      for (const fn of settingsListeners) safe('settings listener', () => fn(settings))
    }),
  )

  safe('loadingStart', () => sdk.game.loadingStart())
  let playing = false
  let instant = false
  let invited: string | null = null
  let device: PortalSdk['device'] = null
  let locale: string | null = null
  safe('isInstantMultiplayer', () => {
    instant = sdk.game.isInstantMultiplayer === true
  })
  safe('inviteParams', () => {
    invited = roomFromParams(sdk.game.inviteParams, roomParam, roomCode)
  })
  safe('systemInfo', () => {
    const info = sdk.user?.systemInfo
    const type = info?.device?.type
    if (type === 'desktop' || type === 'tablet' || type === 'mobile') device = type
    if (typeof info?.locale === 'string' && info.locale) locale = info.locale
  })

  /**
   * One ad. Resolves true when it played to the end. An ad can end after play resumed (it
   * started past the no-show wait), so unmuting is separate from resolving: the sound comes back
   * whenever the ad that took it ends.
   */
  const requestAd = (kind: 'midgame' | 'rewarded') =>
    new Promise<boolean>((resolve) => {
      let started = false
      let playingNow = false
      let over = false
      const end = (finished: boolean) => {
        if (playingNow) {
          playingNow = false
          adsPlaying -= 1
          applyMute()
        }
        if (over) return
        over = true
        clearTimeout(noShow)
        resolve(finished)
      }
      const noShow = setTimeout(() => end(false), adWait)
      try {
        sdk.ad.requestAd(kind, {
          adStarted: () => {
            // One ad per request. A start after the no-show wait still plays over the game,
            // so it still mutes the game.
            if (started) return
            started = true
            clearTimeout(noShow)
            playingNow = true
            adsPlaying += 1
            applyMute()
          },
          adFinished: () => end(true),
          adError: () => end(false),
        })
      } catch (e) {
        warn('requestAd failed', e)
        end(false)
      }
    })

  const fallback = localStore(warn)
  const storage: PortalStorage = {
    getItem(key) {
      if (!sdk.data) return fallback.getItem(key)
      try {
        return sdk.data.getItem(key)
      } catch (e) {
        warn('data.getItem failed', e)
        return fallback.getItem(key)
      }
    },
    setItem(key, value) {
      if (!sdk.data) return fallback.setItem(key, value)
      try {
        sdk.data.setItem(key, value)
      } catch (e) {
        warn('data.setItem failed', e)
        fallback.setItem(key, value)
      }
    },
    removeItem(key) {
      if (!sdk.data) return fallback.removeItem(key)
      try {
        sdk.data.removeItem(key)
      } catch (e) {
        warn('data.removeItem failed', e)
        fallback.removeItem(key)
      }
    },
  }

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
    midgameAd: () => requestAd('midgame').then(() => undefined),
    rewardedAd: () => requestAd('rewarded'),
    async hasAdblock() {
      try {
        return (await sdk.ad.hasAdblock?.()) === true
      } catch (e) {
        warn('hasAdblock failed', e)
        return false
      }
    },
    happytime: () => safe('happytime', () => sdk.game.happytime()),
    progress(percent) {
      if (!Number.isFinite(percent)) return
      const p = Math.round(Math.min(100, Math.max(0, percent)))
      safe('reportGameCompletedPercentage', () => sdk.game.reportGameCompletedPercentage?.(p))
    },
    setContext(context) {
      safe(context ? 'setGameContext' : 'clearGameContext', () =>
        context ? sdk.game.setGameContext?.(context) : sdk.game.clearGameContext?.(),
      )
    },
    settings: () => settings,
    onSettings(fn) {
      settingsListeners.push(fn)
    },
    device,
    locale,
    storage,
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
