// @ts-check
/**
 * The portal adapter's guards: no SDK, a hung or failed init, ads and the mute, the settings,
 * saves, and the room calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A runtime file is TypeScript for a game's bundler; Vitest compiles it, tsc here does not see it.
const SDK_FILE = '../../runtime/portal/portal-sdk.ts'
const TARGET_FILE = '../../runtime/portal/build-target.ts'
/** @type {any} */
const mod = await import(/* @vite-ignore */ SDK_FILE)
/** @type {any} */
const target = await import(/* @vite-ignore */ TARGET_FILE)

/** A CrazyGames SDK v3 double; every call recorded in `log`. */
function fakeSdk(over = {}) {
  /** @type {string[]} */
  const log = []
  /** @type {any} */
  let ad = null
  const sdk = {
    environment: 'crazygames',
    init: vi.fn(async () => {
      log.push('init')
    }),
    game: {
      gameplayStart: () => log.push('gameplayStart'),
      gameplayStop: () => log.push('gameplayStop'),
      loadingStart: () => log.push('loadingStart'),
      loadingStop: () => log.push('loadingStop'),
      happytime: () => log.push('happytime'),
    },
    ad: {
      requestAd: (/** @type {string} */ kind, /** @type {any} */ cb) => {
        log.push(`requestAd:${kind}`)
        ad = cb
      },
    },
    ...over,
  }
  return { sdk, log, ad: () => ad }
}

/** @returns {{ setMuted: (m: boolean) => void, muted: boolean[] }} */
function audio() {
  /** @type {boolean[]} */
  const muted = []
  return { muted, setMuted: (m) => muted.push(m) }
}

const quiet = { warn: vi.fn() }

beforeEach(() => {
  quiet.warn.mockClear()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('the build target', () => {
  it('is the portal build only in portal mode', () => {
    expect(target.PORTAL_MODE).toBe('portal')
    expect(target.PORTAL).toBe(false) // Vitest runs in mode `test`
  })
})

describe('no SDK', () => {
  it('is the stub off the portal build, even with an SDK on the page', async () => {
    const { sdk, log } = fakeSdk()
    const p = await mod.createPortalSdk(audio(), { sdk, enabled: false })
    expect(p).toBe(mod.NO_PORTAL)
    expect(log).toEqual([])
  })

  it('is the stub by default here: not the portal build, and no window', async () => {
    expect(await mod.createPortalSdk(audio())).toBe(mod.NO_PORTAL)
    expect(await mod.createPortalSdk(audio(), { enabled: true })).toBe(mod.NO_PORTAL)
  })

  it('the stub does nothing and never rejects', async () => {
    const s = mod.NO_PORTAL
    expect(s.name).toBe('none')
    s.loadingStop()
    s.setGameplay(true)
    s.happytime()
    s.updateRoom('ABCD', true)
    s.leftRoom()
    s.onJoinRoom(() => {})
    await expect(s.midgameAd()).resolves.toBeUndefined()
    await expect(s.inviteLink('ABCD')).resolves.toBeNull()
    await expect(s.username()).resolves.toBeNull()
    expect(s.instantMultiplayer).toBe(false)
    expect(s.inviteRoom).toBeNull()
  })
})

describe('init', () => {
  it('plays on without the SDK when init hangs past the wait', async () => {
    vi.useFakeTimers()
    const { sdk } = fakeSdk({ init: () => new Promise(() => {}) })
    const made = mod.createPortalSdk(audio(), { sdk, enabled: true, ...quiet })
    await vi.advanceTimersByTimeAsync(mod.INIT_WAIT_MS - 1)
    let done = false
    made.then(() => {
      done = true
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const p = await made
    expect(p.name).toBe('none')
    p.loadingStop()
    p.setGameplay(true)
    await expect(p.midgameAd()).resolves.toBeUndefined()
    expect(quiet.warn).toHaveBeenCalledWith(expect.stringMatching(/taking over/))
  })

  it('takes its own wait', async () => {
    vi.useFakeTimers()
    const { sdk } = fakeSdk({ init: () => new Promise(() => {}) })
    const made = mod.createPortalSdk(audio(), { sdk, enabled: true, initWaitMs: 50, ...quiet })
    await vi.advanceTimersByTimeAsync(50)
    expect((await made).name).toBe('none')
  })

  it('joins a slow SDK when its init ends, and replays loading and gameplay', async () => {
    // CrazyGames' QA preview, 2026-11-13: init took 7 to 9 s and the portal heard nothing.
    vi.useFakeTimers()
    /** @type {() => void} */
    let finish = () => {}
    const { sdk, log } = fakeSdk({
      init: () =>
        new Promise((ok) => {
          finish = () => ok(undefined)
        }),
    })
    const made = mod.createPortalSdk(audio(), { sdk, enabled: true, initWaitMs: 50, ...quiet })
    await vi.advanceTimersByTimeAsync(50)
    const p = await made
    p.loadingStop()
    p.setGameplay(true)
    expect(log).toEqual([])
    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(p.name).toBe('crazygames')
    expect(log).toEqual(['loadingStart', 'loadingStop', 'gameplayStart'])
    p.setGameplay(false)
    expect(log.at(-1)).toBe('gameplayStop')
  })

  it('stays the stub when a slow init then fails', async () => {
    vi.useFakeTimers()
    /** @type {(e: Error) => void} */
    let fail = () => {}
    const { sdk, log } = fakeSdk({
      init: () =>
        new Promise((_, no) => {
          fail = no
        }),
    })
    const made = mod.createPortalSdk(audio(), { sdk, enabled: true, initWaitMs: 50, ...quiet })
    await vi.advanceTimersByTimeAsync(50)
    const p = await made
    p.setGameplay(true)
    fail(new Error('blocked'))
    await vi.advanceTimersByTimeAsync(0)
    expect(p.name).toBe('none')
    expect(log).toEqual([])
    expect(quiet.warn).toHaveBeenCalledWith(expect.stringMatching(/unavailable/), expect.any(Error))
  })

  it('plays on when init rejects, or the SDK says it is disabled', async () => {
    const failing = fakeSdk({ init: () => Promise.reject(new Error('blocked')) })
    expect(await mod.createPortalSdk(audio(), { sdk: failing.sdk, enabled: true, ...quiet })).toBe(
      mod.NO_PORTAL,
    )
    const off = fakeSdk({ environment: 'disabled' })
    expect(await mod.createPortalSdk(audio(), { sdk: off.sdk, enabled: true, ...quiet })).toBe(
      mod.NO_PORTAL,
    )
    expect(off.log).toEqual(['init'])
  })

  it('reads the SDK from the window when none is given', async () => {
    const { sdk } = fakeSdk()
    vi.stubGlobal('window', { CrazyGames: { SDK: sdk } })
    try {
      const p = await mod.createPortalSdk(audio(), { enabled: true })
      expect(p.name).toBe('crazygames')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('the SDK in use', () => {
  it('starts loading at init, stops on loadingStop, and sends only gameplay changes', async () => {
    const { sdk, log } = fakeSdk()
    const p = await mod.createPortalSdk(audio(), { sdk, enabled: true })
    expect(p.name).toBe('crazygames')
    p.loadingStop()
    p.setGameplay(true)
    p.setGameplay(true)
    p.setGameplay(false)
    p.setGameplay(false)
    p.happytime()
    expect(log).toEqual([
      'init',
      'loadingStart',
      'loadingStop',
      'gameplayStart',
      'gameplayStop',
      'happytime',
    ])
  })

  it('never lets a throwing SDK call stop the game', async () => {
    const boom = () => {
      throw new Error('portal hiccup')
    }
    const { sdk } = fakeSdk()
    Object.assign(sdk.game, { loadingStart: boom, gameplayStart: boom, happytime: boom })
    const p = await mod.createPortalSdk(audio(), { sdk, enabled: true, ...quiet })
    expect(() => p.setGameplay(true)).not.toThrow()
    expect(() => p.happytime()).not.toThrow()
    expect(quiet.warn).toHaveBeenCalledTimes(3)
  })
})

describe('a midgame ad', () => {
  it('mutes while the ad plays and unmutes when it finishes', async () => {
    const a = audio()
    const f = fakeSdk()
    const p = await mod.createPortalSdk(a, { sdk: f.sdk, enabled: true })
    let over = false
    const ad = p.midgameAd().then(() => {
      over = true
    })
    expect(f.log.at(-1)).toBe('requestAd:midgame')
    expect(a.muted).toEqual([])
    f.ad().adStarted()
    expect(a.muted).toEqual([true])
    await Promise.resolve()
    expect(over).toBe(false)
    f.ad().adFinished()
    await ad
    expect(a.muted).toEqual([true, false])
  })

  it('never mutes for an ad that errors (no fill, too soon)', async () => {
    const a = audio()
    const f = fakeSdk()
    const p = await mod.createPortalSdk(a, { sdk: f.sdk, enabled: true })
    const ad = p.midgameAd()
    f.ad().adError(new Error('no fill'))
    await expect(ad).resolves.toBeUndefined()
    expect(a.muted).toEqual([])
  })

  it('plays on when the ad never starts', async () => {
    vi.useFakeTimers()
    const a = audio()
    const f = fakeSdk()
    const p = await mod.createPortalSdk(a, { sdk: f.sdk, enabled: true })
    const ad = p.midgameAd()
    await vi.advanceTimersByTimeAsync(mod.AD_START_WAIT_MS)
    await expect(ad).resolves.toBeUndefined()
    expect(a.muted).toEqual([])
  })

  it('mutes an ad that starts after play resumed, and unmutes when it ends', async () => {
    vi.useFakeTimers()
    const a = audio()
    const f = fakeSdk()
    const p = await mod.createPortalSdk(a, { sdk: f.sdk, enabled: true })
    const ad = p.midgameAd()
    await vi.advanceTimersByTimeAsync(mod.AD_START_WAIT_MS)
    await expect(ad).resolves.toBeUndefined()
    f.ad().adStarted()
    expect(a.muted).toEqual([true])
    f.ad().adFinished()
    expect(a.muted).toEqual([true, false])
  })

  it('ignores a second start for the same request', async () => {
    const a = audio()
    const f = fakeSdk()
    const p = await mod.createPortalSdk(a, { sdk: f.sdk, enabled: true })
    const ad = p.midgameAd()
    f.ad().adStarted()
    f.ad().adFinished()
    await ad
    f.ad().adStarted()
    expect(a.muted).toEqual([true, false])
  })

  it('stays unmuted after a finished ad, whatever else the SDK sends', async () => {
    const a = audio()
    const f = fakeSdk()
    const p = await mod.createPortalSdk(a, { sdk: f.sdk, enabled: true })
    const ad = p.midgameAd()
    f.ad().adStarted()
    f.ad().adFinished()
    f.ad().adError(new Error('late'))
    f.ad().adFinished()
    await ad
    expect(a.muted).toEqual([true, false])
  })

  it('resolves when requestAd throws', async () => {
    const f = fakeSdk()
    f.sdk.ad.requestAd = () => {
      throw new Error('no ads here')
    }
    const p = await mod.createPortalSdk(audio(), { sdk: f.sdk, enabled: true, ...quiet })
    await expect(p.midgameAd()).resolves.toBeUndefined()
  })
})

describe('the room calls', () => {
  it('reads instant multiplayer and the invite room at init', async () => {
    const f = fakeSdk()
    Object.assign(f.sdk.game, { isInstantMultiplayer: true, inviteParams: { room: 'abcd' } })
    const p = await mod.createPortalSdk(audio(), { sdk: f.sdk, enabled: true })
    expect(p.instantMultiplayer).toBe(true)
    expect(p.inviteRoom).toBe('ABCD')
  })

  it('checks a room code against the pattern, and takes another parameter name', () => {
    expect(mod.roomFromParams({ room: 'ab' })).toBeNull()
    expect(mod.roomFromParams({ room: 'ab-cd' })).toBeNull()
    expect(mod.roomFromParams({ room: 7 })).toBeNull()
    expect(mod.roomFromParams(null)).toBeNull()
    expect(mod.roomFromParams({ code: 'wxyz' }, 'code', /^[A-Z]{4}$/)).toBe('WXYZ')
    expect(mod.roomFromParams({ code: 'WXY1' }, 'code', /^[A-Z]{4}$/)).toBeNull()
  })

  it('reports the room, the join listener and the invite link', async () => {
    const f = fakeSdk()
    /** @type {unknown[]} */
    const calls = []
    /** @type {any} */
    let listener = null
    Object.assign(f.sdk.game, {
      addJoinRoomListener: (/** @type {any} */ fn) => {
        listener = fn
      },
      updateRoom: (/** @type {unknown} */ r) => calls.push(['update', r]),
      leftRoom: () => calls.push(['left']),
      inviteLink: async (/** @type {Record<string, string>} */ q) =>
        `https://portal.test/?room=${q.room}`,
    })
    const p = await mod.createPortalSdk(audio(), { sdk: f.sdk, enabled: true })
    /** @type {string[]} */
    const joins = []
    p.onJoinRoom((/** @type {string} */ r) => joins.push(r))
    listener({ room: 'efgh' })
    listener({ room: '!' })
    listener(null)
    expect(joins).toEqual(['EFGH'])
    p.updateRoom('EFGH', false)
    p.leftRoom()
    expect(calls).toEqual([
      ['update', { roomId: 'EFGH', isJoinable: false, inviteParams: { room: 'EFGH' } }],
      ['left'],
    ])
    expect(await p.inviteLink('EFGH')).toBe('https://portal.test/?room=EFGH')
  })

  it('handles a sync invite link, a failing one, and an SDK without room calls', async () => {
    const f = fakeSdk()
    Object.assign(f.sdk.game, { inviteLink: () => 'https://portal.test/sync' })
    const p = await mod.createPortalSdk(audio(), { sdk: f.sdk, enabled: true, ...quiet })
    expect(await p.inviteLink('ABCD')).toBe('https://portal.test/sync')
    Object.assign(f.sdk.game, {
      inviteLink: () => {
        throw new Error('no')
      },
    })
    expect(await p.inviteLink('ABCD')).toBeNull()

    const bare = await mod.createPortalSdk(audio(), { sdk: fakeSdk().sdk, enabled: true })
    expect(bare.instantMultiplayer).toBe(false)
    expect(bare.inviteRoom).toBeNull()
    expect(() => bare.updateRoom('ABCD', true)).not.toThrow()
    expect(() => bare.onJoinRoom(() => {})).not.toThrow()
    expect(await bare.inviteLink('ABCD')).toBeNull()
  })

  it("names the player: their username, '' for a guest, null with no user API", async () => {
    const named = fakeSdk({ user: { getUser: async () => ({ username: 'Ada' }) } })
    const guest = fakeSdk({ user: { getUser: async () => null } })
    const broken = fakeSdk({ user: { getUser: () => Promise.reject(new Error('x')) } })
    const none = fakeSdk()
    const make = (/** @type {any} */ f) =>
      mod.createPortalSdk(audio(), { sdk: f.sdk, enabled: true, ...quiet })
    expect(await (await make(named)).username()).toBe('Ada')
    expect(await (await make(guest)).username()).toBe('')
    expect(await (await make(broken)).username()).toBeNull()
    expect(await (await make(none)).username()).toBeNull()
  })
})

describe('the stub, for the calls added in 0.11.0', () => {
  it('answers with no ad, no blocker, default settings and no device', async () => {
    const s = mod.NO_PORTAL
    await expect(s.rewardedAd()).resolves.toBe(false)
    await expect(s.hasAdblock()).resolves.toBe(false)
    expect(s.settings()).toEqual({ muteAudio: false, disableChat: false })
    expect(s.device).toBeNull()
    expect(s.locale).toBeNull()
    expect(() => s.progress(50)).not.toThrow()
    expect(() => s.setContext({ level: 1 })).not.toThrow()
    expect(() => s.onSettings(() => {})).not.toThrow()
  })

  it('saves to localStorage, and reads empty where there is none', () => {
    // Node has no localStorage here: every call is a quiet no-op.
    expect(mod.NO_PORTAL.storage.getItem('k')).toBeNull()
    expect(() => mod.NO_PORTAL.storage.setItem('k', 'v')).not.toThrow()
    /** @type {Map<string, string>} */
    const m = new Map()
    vi.stubGlobal('localStorage', {
      getItem: (/** @type {string} */ k) => m.get(k) ?? null,
      setItem: (/** @type {string} */ k, /** @type {string} */ v) => m.set(k, v),
      removeItem: (/** @type {string} */ k) => m.delete(k),
    })
    try {
      const store = mod.localStore(quiet.warn)
      store.setItem('k', 'v')
      expect(store.getItem('k')).toBe('v')
      store.removeItem('k')
      expect(store.getItem('k')).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('a rewarded ad', () => {
  it('resolves true only when the ad played to the end, muting while it plays', async () => {
    const a = audio()
    const f = fakeSdk()
    const p = await mod.createPortalSdk(a, { sdk: f.sdk, enabled: true })
    const won = p.rewardedAd()
    expect(f.log.at(-1)).toBe('requestAd:rewarded')
    f.ad().adStarted()
    expect(a.muted).toEqual([true])
    f.ad().adFinished()
    await expect(won).resolves.toBe(true)
    expect(a.muted).toEqual([true, false])

    const lost = p.rewardedAd()
    f.ad().adStarted()
    f.ad().adError({ code: 'other' })
    await expect(lost).resolves.toBe(false)
    expect(a.muted).toEqual([true, false, true, false])
  })

  it('resolves false with no fill, a throw, or no start in time', async () => {
    vi.useFakeTimers()
    const f = fakeSdk()
    const p = await mod.createPortalSdk(audio(), { sdk: f.sdk, enabled: true, ...quiet })
    const dry = p.rewardedAd()
    f.ad().adError({ code: 'unfilled' })
    await expect(dry).resolves.toBe(false)
    const late = p.rewardedAd()
    await vi.advanceTimersByTimeAsync(mod.AD_START_WAIT_MS)
    await expect(late).resolves.toBe(false)
    f.sdk.ad.requestAd = () => {
      throw new Error('no ads here')
    }
    await expect(p.rewardedAd()).resolves.toBe(false)
  })
})

describe('the settings the portal sends', () => {
  /** @param {any} settings */
  function withSettings(settings) {
    const f = fakeSdk()
    /** @type {any} */
    let listener = null
    Object.assign(f.sdk.game, {
      settings,
      addSettingsChangeListener: (/** @type {any} */ fn) => {
        listener = fn
      },
    })
    return { f, fire: (/** @type {any} */ s) => listener(s) }
  }

  it('mutes from boot when muteAudio is on, and follows its changes', async () => {
    const a = audio()
    const { f, fire } = withSettings({ muteAudio: true, disableChat: true })
    const p = await mod.createPortalSdk(a, { sdk: f.sdk, enabled: true })
    expect(a.muted).toEqual([true])
    expect(p.settings()).toEqual({ muteAudio: true, disableChat: true })
    /** @type {unknown[]} */
    const seen = []
    p.onSettings((/** @type {unknown} */ s) => seen.push(s))
    fire({ muteAudio: false, disableChat: false })
    expect(a.muted).toEqual([true, false])
    expect(seen).toEqual([{ muteAudio: false, disableChat: false }])
  })

  it('keeps the game silent through an ad that ends while muteAudio is on', async () => {
    const a = audio()
    const { f, fire } = withSettings({ muteAudio: false })
    const p = await mod.createPortalSdk(a, { sdk: f.sdk, enabled: true })
    const ad = p.midgameAd()
    f.ad().adStarted()
    fire({ muteAudio: true })
    f.ad().adFinished()
    await ad
    expect(a.muted).toEqual([true])
    fire({ muteAudio: false })
    expect(a.muted).toEqual([true, false])
  })

  it('reads both false from an SDK without settings', async () => {
    const a = audio()
    const p = await mod.createPortalSdk(a, { sdk: fakeSdk().sdk, enabled: true })
    expect(p.settings()).toEqual({ muteAudio: false, disableChat: false })
    expect(a.muted).toEqual([])
  })
})

describe('the other calls', () => {
  it('reports progress clamped and rounded, and sets and clears the context', async () => {
    const f = fakeSdk()
    /** @type {unknown[]} */
    const sent = []
    Object.assign(f.sdk.game, {
      reportGameCompletedPercentage: (/** @type {number} */ n) => sent.push(n),
      setGameContext: (/** @type {unknown} */ c) => sent.push(c),
      clearGameContext: () => sent.push('clear'),
    })
    const p = await mod.createPortalSdk(audio(), { sdk: f.sdk, enabled: true })
    p.progress(33.4)
    p.progress(140)
    p.progress(-3)
    p.progress(Number.NaN)
    p.setContext({ level: 3 })
    p.setContext(null)
    expect(sent).toEqual([33, 100, 0, { level: 3 }, 'clear'])
  })

  it('reads the device and the locale, and drops a device it does not know', async () => {
    const make = (/** @type {any} */ info) =>
      mod.createPortalSdk(audio(), {
        sdk: fakeSdk({ user: { getUser: async () => null, systemInfo: info } }).sdk,
        enabled: true,
      })
    const phone = await make({ device: { type: 'mobile' }, locale: 'de-DE' })
    expect([phone.device, phone.locale]).toEqual(['mobile', 'de-DE'])
    const odd = await make({ device: { type: 'fridge' } })
    expect([odd.device, odd.locale]).toEqual([null, null])
  })

  it('asks about an ad blocker, false on a failure', async () => {
    const on = fakeSdk()
    Object.assign(on.sdk.ad, { hasAdblock: async () => true })
    const broken = fakeSdk()
    Object.assign(broken.sdk.ad, { hasAdblock: () => Promise.reject(new Error('x')) })
    const make = (/** @type {any} */ f) =>
      mod.createPortalSdk(audio(), { sdk: f.sdk, enabled: true, ...quiet })
    expect(await (await make(on)).hasAdblock()).toBe(true)
    expect(await (await make(broken)).hasAdblock()).toBe(false)
    expect(await (await make(fakeSdk())).hasAdblock()).toBe(false)
  })

  it('saves through the data module, and falls back when it throws', async () => {
    /** @type {Map<string, string>} */
    const cloud = new Map()
    const f = fakeSdk({
      data: {
        getItem: (/** @type {string} */ k) => cloud.get(k) ?? null,
        setItem: (/** @type {string} */ k, /** @type {string} */ v) => cloud.set(k, v),
        removeItem: (/** @type {string} */ k) => cloud.delete(k),
      },
    })
    const p = await mod.createPortalSdk(audio(), { sdk: f.sdk, enabled: true, ...quiet })
    p.storage.setItem('save', '{"day":2}')
    expect(cloud.get('save')).toBe('{"day":2}')
    expect(p.storage.getItem('save')).toBe('{"day":2}')
    p.storage.removeItem('save')
    expect(cloud.has('save')).toBe(false)

    const off = fakeSdk({
      data: {
        getItem: () => {
          throw new Error('dataModuleDisabled')
        },
        setItem: () => {
          throw new Error('dataModuleDisabled')
        },
        removeItem: () => {},
      },
    })
    const q = await mod.createPortalSdk(audio(), { sdk: off.sdk, enabled: true, ...quiet })
    expect(() => q.storage.setItem('save', 'x')).not.toThrow()
    expect(q.storage.getItem('save')).toBeNull()
    expect(quiet.warn).toHaveBeenCalledWith('data.setItem failed', expect.any(Error))
  })
})
