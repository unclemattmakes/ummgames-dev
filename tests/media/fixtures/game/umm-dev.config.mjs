// The fixture game's settings, the way a game writes its own.
/** @type {import('../../../../src/media/index.js').GameMediaConfig} */
export default {
  capture: {
    port: 5447,
    debugGlobal: '__fixture',
    ready: (game) => game?.frames > 10,
    prep: (_shot, game) => game.frames,
    state: (game) => ({ color: game.color }),
    size: [320, 180],
    bootFrames: 20,
    skip: 1,
  },
  store: {
    preset: 'tiny-portal.json',
    shots: 'shots.json',
    sheetEvery: 0.1,
    stills: [
      { name: 'cover-wide', template: 'cover.html', w: 320, h: 180, plates: { main: 'move' } },
      { name: 'icon', spec: false, template: 'icon.svg', w: 64, h: 64, sizes: [[32, 32]] },
    ],
    videos: [{ edl: 'preview.json', spec: 'preview' }],
  },
  loop: { edge: 720 },
}
