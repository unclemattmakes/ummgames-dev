// @ts-nocheck
// A tiny game for the plugin and fake-portal tests: it boots the portal adapter, loads a level
// chunk, and in every build but the portal build loads a dev tool the portal build must not ship.
import { PORTAL } from '@runtime/portal/build-target.ts'
import { createPortalSdk } from '@runtime/portal/portal-sdk.ts'

const muted = []
const game = { sdk: 'pending', muted, ready: false, level: null }
window.__game = game

const sdk = await createPortalSdk({ setMuted: (m) => muted.push(m) })
game.sdk = sdk.name
game.inviteRoom = sdk.inviteRoom
game.username = await sdk.username()
sdk.onJoinRoom((room) => {
  game.joined = room
  sdk.updateRoom(room, false)
})
game.level = (await import('./level.js')).LEVEL
if (!PORTAL) (await import('./dev-tool.js')).start()
game.ad = async () => {
  sdk.setGameplay(false)
  await sdk.midgameAd()
  sdk.setGameplay(true)
}
game.invite = (code) => sdk.inviteLink(code)
game.reachOut = () => {
  fetch('https://elsewhere.example/beacon', { method: 'POST', body: '{}' }).catch(() => {})
  new WebSocket('wss://relay.example/room')
}
sdk.loadingStop()
sdk.setGameplay(true)
game.ready = true
