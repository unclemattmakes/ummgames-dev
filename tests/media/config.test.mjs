import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import * as captureCmd from '../../src/commands/capture.mjs'
import * as cutCmd from '../../src/commands/cut.mjs'
import * as loopCmd from '../../src/commands/loop.mjs'
import * as storeCmd from '../../src/commands/store.mjs'
import { loadConfig } from '../../src/config.mjs'
import {
  CAPTURE_DEFAULTS,
  captureShots,
  mergeQuery,
  shotEvents,
  shotUrl,
  validateShots,
} from '../../src/media/capture.mjs'
import { clockScript } from '../../src/media/clock.mjs'
import { LOOP_DEFAULTS, loopScale, posterScore } from '../../src/media/loop.mjs'
import { stillHtml } from '../../src/media/stills.mjs'
import { STORE_DEFAULTS } from '../../src/media/store.mjs'
import { isSafeName, MediaError, pageFn, removeInside } from '../../src/media/util.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'umm-dev-media-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

describe('defaults are generic', () => {
  it('name no game: no debug global, URL flags or hooks', () => {
    expect(CAPTURE_DEFAULTS.debugGlobal).toBeNull()
    expect(CAPTURE_DEFAULTS.query).toBe('')
    expect(CAPTURE_DEFAULTS.ready).toBeNull()
    expect(CAPTURE_DEFAULTS.prep).toBeNull()
    expect(CAPTURE_DEFAULTS.shotUrl).toBeNull()
    expect(CAPTURE_DEFAULTS.port).toBeGreaterThanOrEqual(5440)
    expect(STORE_DEFAULTS.shots).toBeNull()
    expect(STORE_DEFAULTS.stills).toEqual([])
    expect(LOOP_DEFAULTS.edge).toBe(720)
  })

  it('the clock script carries no debug global of its own', () => {
    const src = clockScript({
      fps: 60,
      seed: 1,
      skip: 1,
      bootFrames: 60,
      debugGlobal: null,
      hold: 'ready',
      ready: null,
      state: null,
      keyTarget: 'window',
      canvas: 'canvas',
      grab: 'canvas',
      format: 'jpeg',
      quality: 0.9,
      binding: '__frame',
    })
    expect(() => new Function(src)).not.toThrow()
    expect(src).not.toMatch(/window\.__(?!ummClock)[a-z]/i)
  })

  it('a game’s section merges over them, one level deep', async () => {
    fs.writeFileSync(path.join(tmp, 'package.json'), '{}')
    fs.writeFileSync(
      path.join(tmp, 'umm-dev.config.mjs'),
      `export default { capture: { debugGlobal: '__game', browser: { channel: 'chrome' } },
        loop: { edge: 480 } }`,
    )
    const cfg = await loadConfig('capture', CAPTURE_DEFAULTS, tmp)
    expect(cfg.debugGlobal).toBe('__game')
    expect(cfg.browser).toEqual({ headless: true, channel: 'chrome', args: [] })
    expect(cfg.fps).toBe(60)
    const loop = await loadConfig('loop', LOOP_DEFAULTS, tmp)
    expect(loop.edge).toBe(480)
    expect(loop.crf).toBe(30)
  })
})

describe('shots', () => {
  it('a shot’s own query wins over the config’s', () => {
    expect(mergeQuery('a=1&b=2', { b: '3', c: '4' })).toBe('a=1&b=2&c=4')
    expect(
      shotUrl({ name: 's', dur: 1, query: 'dpr=2' }, { ...CAPTURE_DEFAULTS, query: 'dpr=1&x=0' }),
    ).toBe('/?dpr=2&x=0')
    expect(shotUrl({ name: 's', dur: 1 }, CAPTURE_DEFAULTS)).toBe('/')
  })

  it('a game’s shotUrl builds the URL from its own fields', () => {
    const cfg = {
      ...CAPTURE_DEFAULTS,
      query: 'q=1',
      shotUrl: (/** @type {any} */ s, /** @type {{ query: string }} */ c) =>
        `/play?level=${s.level}&${c.query}`,
    }
    expect(shotUrl(/** @type {any} */ ({ name: 's', dur: 1, level: 'two' }), cfg)).toBe(
      '/play?level=two&q=1',
    )
  })

  it('schedules events on game frames, a tap lasting at least one', () => {
    expect(
      shotEvents(
        {
          name: 's',
          dur: 1,
          keys: [
            [0.5, 'Space', 0.001],
            [0.25, 'KeyW', 0.5],
          ],
          run: [[0.1, 'debug.go()']],
          pointer: [[0.2, 'pointerdown', 10, 20]],
        },
        60,
      ),
    ).toEqual([
      [6, 'run', 'debug.go()'],
      [12, 'pointer', 'pointerdown', 10, 20],
      [15, 'keydown', 'KeyW'],
      [30, 'keydown', 'Space'],
      [31, 'keyup', 'Space'],
      [45, 'keyup', 'KeyW'],
    ])
  })

  it('validates a shots file', () => {
    expect(validateShots({})).toEqual(['the shots file must be a JSON array of shots'])
    expect(
      validateShots([
        { name: 'a b', dur: 0 },
        { name: 'c', dur: 1, from: -1, size: [1] },
        { name: 'c', dur: 1, keys: 'x' },
      ]),
    ).toEqual([
      'shot 0 (a b): "name" must be a folder-safe string (letters, digits, . _ @ -; not only dots)',
      'shot 0 (a b): "dur" must be seconds > 0',
      'shot 1 (c): "from" must be seconds >= 0',
      'shot 1 (c): "size" must be [w, h] in px',
      'shot 2 (c): the name is used twice',
      'shot 2 (c): "keys" must be an array',
    ])
  })
})

describe('page hooks and templates', () => {
  it('serialises functions, arrows and method shorthand', () => {
    const cfg = {
      ready(/** @type {any} */ d) {
        return d.ok
      },
      async prep() {},
    }
    expect(pageFn('(d) => d.ok', 'x')).toBe('(d) => d.ok')
    expect(pageFn(cfg.ready, 'x')).toMatch(/^function ready\(/)
    expect(pageFn(cfg.prep, 'x')).toMatch(/^async function prep\(\)/)
    expect(pageFn(null, 'x')).toBeNull()
    expect(() => pageFn(3, 'capture.ready')).toThrow('config capture.ready must be a function')
    for (const f of [cfg.ready, cfg.prep])
      expect(() => new Function(`return (${pageFn(f, 'x')})`)).not.toThrow()
  })

  it('sets STORE before the template’s scripts and inlines tokens', () => {
    const html = stillHtml(
      '<html><head><style>@font-face{src:url(__FONT__)}</style></head><body><script>draw()</script></body></html>',
      false,
      { w: 10, h: 10, note: '</script>' },
      { FONT: 'data:font/woff2;base64,AA' },
    )
    expect(html).toContain(
      '<head><script>window.STORE = {"w":10,"h":10,"note":"\\u003c/script>"}</script>',
    )
    expect(html).toContain('url(data:font/woff2;base64,AA)')
    const svg = stillHtml('<svg viewBox="0 0 8 8"></svg>', true, { w: 64, h: 64 }, {})
    expect(svg).toContain('<svg width="64" height="64" viewBox="0 0 8 8">')
  })
})

describe('loop', () => {
  it('caps the long edge without upscaling', () => {
    expect(loopScale(720)).toContain(
      "scale='if(gt(a,1),min(720,iw),-2)':'if(gt(a,1),-2,min(720,ih))'",
    )
  })
  it('prefers a detailed frame over a flat one, bright or dark', () => {
    const flatBlack = new Uint8Array(100)
    const flatWhite = new Uint8Array(100).fill(255)
    const detailed = Uint8Array.from({ length: 100 }, (_, i) => (i % 2 ? 200 : 40))
    expect(posterScore(detailed)).toBeGreaterThan(posterScore(flatWhite))
    expect(posterScore(flatWhite)).toBeGreaterThan(posterScore(flatBlack))
  })
})

describe('deletes stay inside their folder', () => {
  it('a safe name is one folder, never only dots', () => {
    for (const ok of ['move', 'move@b', 'k-land.v2', '.hidden', 'a..b'])
      expect(isSafeName(ok), ok).toBe(true)
    for (const bad of ['.', '..', '...', '', 'a/b', 'a\\b', 'x/../../..', '../x', 'a b', 3])
      expect(isSafeName(bad), String(bad)).toBe(false)
  })

  it('rejects . and .. as shot names', () => {
    const msg = '"name" must be a folder-safe string (letters, digits, . _ @ -; not only dots)'
    expect(
      validateShots([
        { name: '..', dur: 1 },
        { name: '.', dur: 1 },
      ]),
    ).toEqual([`shot 0 (..): ${msg}`, `shot 1 (.): ${msg}`])
  })

  it('removeInside refuses the parent itself, anything outside it, and a prefix sibling', () => {
    const parent = path.join(tmp, 'guard', 'out')
    const inside = path.join(parent, 'shot')
    const sibling = path.join(tmp, 'guard', 'out-other')
    for (const d of [inside, sibling]) fs.mkdirSync(d, { recursive: true })
    const bad = [parent, `${parent}${path.sep}.`, path.join(parent, '..'), tmp, sibling]
    for (const d of [...bad, `${inside}${path.sep}..`])
      expect(() => removeInside(d, parent), d).toThrow(MediaError)
    expect(fs.existsSync(parent) && fs.existsSync(sibling)).toBe(true)
    removeInside(inside, parent)
    expect(fs.existsSync(inside)).toBe(false)
    expect(fs.existsSync(parent)).toBe(true)
  })

  it('a hostile --tag deletes nothing', async () => {
    const game = path.join(tmp, 'hostile')
    fs.mkdirSync(game, { recursive: true })
    fs.writeFileSync(path.join(game, 'package.json'), '{}')
    fs.writeFileSync(path.join(game, 'shots.json'), JSON.stringify([{ name: 'intro', dur: 1 }]))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      for (const tag of ['x/../../..', '..', '.'])
        expect(await captureCmd.run(['intro', '--tag', tag, '--out', 'cap'], { cwd: game })).toBe(2)
    } finally {
      err.mockRestore()
    }
    await expect(
      captureShots({
        cfg: { ...CAPTURE_DEFAULTS, root: game },
        shots: [{ name: 'intro', dur: 1 }],
        out: path.join(game, 'cap'),
        tag: 'x/../../..',
      }),
    ).rejects.toThrow(/--tag must be a folder-safe name/)
    expect(fs.existsSync(path.join(game, 'shots.json'))).toBe(true)
  })
})

describe('commands', () => {
  const quiet = () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => {})
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    return {
      text: () => [...out.mock.calls, ...err.mock.calls].map((c) => c.join(' ')).join('\n'),
      done: () => {
        out.mockRestore()
        err.mockRestore()
      },
    }
  }

  it('each prints --help and exits 0, and exits 2 on a bad option', async () => {
    for (const cmd of [captureCmd, cutCmd, storeCmd, loopCmd]) {
      const q = quiet()
      try {
        expect(await cmd.run(['--help'], { cwd: tmp })).toBe(0)
        expect(q.text()).toMatch(/^usage: umm-dev /)
        expect(await cmd.run(['--no-such-flag'], { cwd: tmp })).toBe(2)
      } finally {
        q.done()
      }
    }
  })

  it('cut --print shows the commands without clips or ffmpeg runs', async () => {
    const edl = path.join(tmp, 'edl.json')
    fs.writeFileSync(edl, JSON.stringify({ shots: [{ clip: 'missing', in: 0, dur: 1 }] }))
    const q = quiet()
    try {
      expect(await cutCmd.run([edl, '--print'], { cwd: tmp })).toBe(0)
      expect(q.text()).toContain('# would write')
      expect(q.text()).toMatch(/ffmpeg .*-filter_complex/)
    } finally {
      q.done()
    }
  })

  it('cut exits 1 and names the field to fix', async () => {
    const edl = path.join(tmp, 'bad.json')
    fs.writeFileSync(edl, JSON.stringify({ shots: [{ clip: 'a', in: 0 }] }))
    const q = quiet()
    try {
      expect(await cutCmd.run([edl, '--check'], { cwd: tmp })).toBe(1)
      expect(q.text()).toContain('"dur" must be seconds > 0')
    } finally {
      q.done()
    }
  })

  it('store refuses an unknown step', async () => {
    const q = quiet()
    try {
      expect(await storeCmd.run(['--steps', 'cut,paint'], { cwd: tmp })).toBe(2)
      expect(q.text()).toContain('no step paint')
    } finally {
      q.done()
    }
  })
})
