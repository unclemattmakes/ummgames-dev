// @ts-nocheck
const canvas = document.querySelector('canvas')
canvas.width = Math.round(innerWidth * devicePixelRatio)
canvas.height = Math.round(innerHeight * devicePixelRatio)
const ctx = canvas.getContext('2d')
const game = { frames: 0, color: 'white', dot: [Math.random(), Math.random()] }
addEventListener('keydown', (e) => {
  if (e.code === 'Space') game.color = 'red'
})
const t0 = performance.now()
function frame(now) {
  game.frames++
  const t = (now - t0) / 1000
  ctx.fillStyle = '#123'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#ff0'
  ctx.fillRect(game.dot[0] * canvas.width, game.dot[1] * canvas.height, 6, 6)
  ctx.fillStyle = game.color
  ctx.fillRect((t * 120) % canvas.width, canvas.height / 2 - 20, 40, 40)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
window.__fixture = game
