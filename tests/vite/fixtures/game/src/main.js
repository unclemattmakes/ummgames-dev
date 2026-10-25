// @ts-nocheck
// A tiny game for the plugin tests: an entry and one lazy chunk.
window.__game = { level: (await import('./level.js')).LEVEL }
