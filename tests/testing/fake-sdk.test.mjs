// @ts-check
/** The fake SDK's script, run in a bare VM context: what it records and how its ads behave. */
import vm from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeSdkScript } from '../../src/testing/index.mjs'

/** @param {import('../../src/testing/fake-portal.mjs').FakeSdkOptions} [o] */
function load(o) {
  /** @type {any} */
  const window = {}
  vm.runInNewContext(fakeSdkScript(o), {
    window,
    setTimeout,
    URLSearchParams,
    Promise,
    Error,
  })
  return { sdk: window.CrazyGames.SDK, rec: window.__fakePortal }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('fakeSdkScript', () => {
  it('records the game calls in order', async () => {
    const { sdk, rec } = load()
    expect(sdk.environment).toBe('crazygames')
    await sdk.init()
    sdk.game.loadingStart()
    sdk.game.loadingStop()
    sdk.game.gameplayStart()
    sdk.game.happytime()
    sdk.game.gameplayStop()
    expect(rec.calls).toEqual([
      'init',
      'loadingStart',
      'loadingStop',
      'gameplayStart',
      'happytime',
      'gameplayStop',
    ])
  })

  it('plays an ad after its start delay, for its length; or errors with no fill', () => {
    vi.useFakeTimers()
    const { sdk, rec } = load({ ad: { startMs: 50, lengthMs: 200 } })
    const seen = /** @type {string[]} */ ([])
    sdk.ad.requestAd('midgame', {
      adStarted: () => seen.push('started'),
      adFinished: () => seen.push('finished'),
    })
    vi.advanceTimersByTime(49)
    expect(seen).toEqual([])
    vi.advanceTimersByTime(1)
    expect(seen).toEqual(['started'])
    vi.advanceTimersByTime(200)
    expect(seen).toEqual(['started', 'finished'])
    expect(rec.calls).toEqual(['requestAd:midgame', 'adStarted', 'adFinished'])

    const dry = load({ ad: { fill: false } })
    const errors = /** @type {unknown[]} */ ([])
    dry.sdk.ad.requestAd('midgame', { adError: (/** @type {unknown} */ e) => errors.push(e) })
    vi.advanceTimersByTime(100)
    expect(errors).toHaveLength(1)
    expect(dry.rec.calls).toEqual(['requestAd:midgame', 'adError'])
  })

  it('can hang or fail its init, or say it is disabled', async () => {
    const hung = load({ init: 'hang' })
    const state = await Promise.race([
      hung.sdk.init().then(() => 'resolved'),
      new Promise((r) => setTimeout(() => r('pending'), 20)),
    ])
    expect(state).toBe('pending')
    await expect(load({ init: 'reject' }).sdk.init()).rejects.toThrow(/fake init failed/)
    expect(load({ environment: 'disabled' }).sdk.environment).toBe('disabled')
  })

  it('launches from an invite or for instant multiplayer, and records room calls', () => {
    const { sdk, rec } = load({ invite: 'ABCD', instant: true, inviteLinkBase: 'https://p.test/g' })
    expect(sdk.game.inviteParams).toEqual({ room: 'ABCD' })
    expect(sdk.game.isInstantMultiplayer).toBe(true)
    sdk.game.updateRoom({ roomId: 'ABCD', isJoinable: true })
    sdk.game.leftRoom()
    expect(sdk.game.inviteLink({ room: 'ABCD' })).toBe('https://p.test/g?room=ABCD')
    expect(rec.rooms).toEqual([
      { kind: 'update', roomId: 'ABCD', isJoinable: true },
      { kind: 'left' },
      { kind: 'link', room: 'ABCD' },
    ])
    const fn = () => {}
    sdk.game.addJoinRoomListener(fn)
    expect(rec.join).toBe(fn)
    expect(load({ invite: 'WXYZ', roomParam: 'code' }).sdk.game.inviteParams).toEqual({
      code: 'WXYZ',
    })
  })

  it('sends settings changes to every listener, and records progress and context', () => {
    const { sdk, rec } = load({ settings: { muteAudio: true } })
    expect(sdk.game.settings).toEqual({ muteAudio: true, disableChat: false })
    /** @type {unknown[]} */
    const seen = []
    sdk.game.addSettingsChangeListener((/** @type {unknown} */ s) => seen.push(s))
    rec.setSettings({ disableChat: true })
    expect(seen).toEqual([{ muteAudio: true, disableChat: true }])
    expect(sdk.game.settings.disableChat).toBe(true)
    sdk.game.reportGameCompletedPercentage(40)
    sdk.game.setGameContext({ level: 2 })
    sdk.game.clearGameContext()
    expect(rec.calls).toEqual(['progress:40', 'context:{"level":2}', 'context:clear'])
  })

  it('keeps data in memory, reports the device and the blocker, or offers no data', async () => {
    const { sdk, rec } = load({ device: 'mobile', locale: 'fr-FR', adblock: true })
    sdk.data.setItem('save', 3)
    expect(sdk.data.getItem('save')).toBe('3')
    expect(sdk.data.getItem('none')).toBeNull()
    expect(rec.data).toEqual({ save: '3' })
    sdk.data.removeItem('save')
    expect(rec.data).toEqual({})
    expect(sdk.user.systemInfo).toEqual({ device: { type: 'mobile' }, locale: 'fr-FR' })
    expect(await sdk.ad.hasAdblock()).toBe(true)
    expect(load({ data: false }).sdk.data).toBeUndefined()
  })

  it('plays a rewarded ad like a midgame one', () => {
    vi.useFakeTimers()
    const { sdk, rec } = load()
    sdk.ad.requestAd('rewarded', {})
    vi.advanceTimersByTime(400)
    expect(rec.calls).toEqual(['requestAd:rewarded', 'adStarted', 'adFinished'])
  })

  it('names a signed-in user, a guest, or offers no user API', async () => {
    expect(await load({ user: 'Ada' }).sdk.user.getUser()).toEqual({ username: 'Ada' })
    expect(await load().sdk.user.getUser()).toBeNull()
    expect(load({ userApi: false }).sdk.user).toBeUndefined()
  })
})
