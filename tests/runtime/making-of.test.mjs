/**
 * The making-of runtime's pure parts, run in node, and the promises its stylesheet makes. The path
 * is built at run time so this repo's typecheck leaves the TypeScript to runtime/tsconfig.json.
 */
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

/** @param {string} rel @returns {Promise<any>} */
const load = (rel) =>
  import(/* @vite-ignore */ new URL(`../../runtime/making-of/${rel}`, import.meta.url).href)

const { createLiveSet, createToyClock, MAX_LIVE_3D, MAX_TOY_STEPS } = await load('toy-host.ts')
const { loadToys } = await load('pages.ts')

describe('createLiveSet', () => {
  it('evicts the least recently seen once over the cap', () => {
    const live = createLiveSet(2)
    expect(live.admit('a')).toEqual([])
    live.unseen('a')
    expect(live.admit('b')).toEqual([])
    live.unseen('b')
    expect(live.admit('c')).toEqual(['a'])
    expect(live.ids()).toEqual(['b', 'c'])
  })

  it('never evicts the newest, or anything on screen', () => {
    const live = createLiveSet(1)
    live.admit('a')
    expect(live.admit('b')).toEqual([])
    expect(live.ids()).toEqual(['a', 'b'])
  })

  it('counts a seen toy as recent, and a released one as gone', () => {
    const live = createLiveSet(2)
    live.admit('a')
    live.admit('b')
    live.unseen('a')
    live.unseen('b')
    live.seen('a')
    live.unseen('a')
    expect(live.admit('c')).toEqual(['b'])
    live.release('a')
    expect(live.ids()).toEqual(['c'])
  })

  it('gives no place to what it never admitted', () => {
    const live = createLiveSet(2)
    live.seen('flat')
    live.unseen('flat')
    expect(live.ids()).toEqual([])
    expect(live.admit('a')).toEqual([])
    live.unseen('a')
    expect(live.admit('b')).toEqual([])
    expect(live.ids()).toEqual(['a', 'b'])
  })

  it('holds few enough contexts for a browser', () => {
    expect(MAX_LIVE_3D).toBeLessThan(16)
  })
})

describe('createToyClock', () => {
  it('runs whole steps at the given rate and hands back an alpha', () => {
    const clock = createToyClock(0.01)
    /** @type {number[][]} */
    const ticks = []
    const alpha = clock.step(0.025, (/** @type {number} */ dt, /** @type {number} */ tick) =>
      ticks.push([dt, tick]),
    )
    expect(ticks).toEqual([
      [0.01, 0],
      [0.01, 1],
    ])
    expect(alpha).toBeCloseTo(0.5)
  })

  it('carries the remainder, and keeps counting across frames', () => {
    const clock = createToyClock(0.01)
    /** @type {number[]} */
    const ticks = []
    const count = (/** @type {number} */ _dt, /** @type {number} */ tick) => ticks.push(tick)
    clock.step(0.006, count)
    clock.step(0.006, count)
    expect(ticks).toEqual([0])
  })

  it('drops the backlog after a stall, at the default cap or its own', () => {
    let n = 0
    const clock = createToyClock(0.01)
    expect(clock.step(10, () => n++)).toBe(0)
    expect(n).toBe(MAX_TOY_STEPS)
    n = 0
    createToyClock(0.01, 3).step(10, () => n++)
    expect(n).toBe(3)
  })
})

describe('loadToys', () => {
  it('loads by id, in order, and names a missing one', async () => {
    const loaders = {
      a: async () => ({ toy: { id: 'a' } }),
      b: async () => ({ toy: { id: 'b' } }),
    }
    expect(
      (await loadToys(loaders, ['b', 'a'])).map((/** @type {{ id: string }} */ t) => t.id),
    ).toEqual(['b', 'a'])
    await expect(loadToys(loaders, ['gone'])).rejects.toThrow(/no toy "gone"/)
  })
})

describe('site.css', () => {
  const css = fs.readFileSync(new URL('../../runtime/making-of/site.css', import.meta.url), 'utf8')

  it('styles every class the source pass writes', () => {
    for (const cls of [
      '.mo-const',
      '.mo-snippet',
      '.mo-tok-kw',
      '.mo-tok-str',
      '.mo-tok-num',
      '.mo-tok-com',
    ]) {
      expect(css, cls).toContain(cls)
    }
  })

  it('styles what the plugin, the host and the controls write', () => {
    for (const cls of [
      '.site-nav',
      '.page-header',
      '.page-toc',
      '.page-nav',
      '.chapter-card',
      '.site-footer',
      '.demo-container',
      '.demo-stage',
      '.demo-label',
      '.demo-controls',
      '.demo-readouts',
      '.playground-section',
    ]) {
      expect(css, cls).toContain(cls)
    }
  })

  it('keeps colours in the tokens, so a game palette reaches everything', () => {
    const body = css.slice(css.indexOf('*,'))
    expect(
      body.match(/#[0-9a-f]{3,8}\b/gi)?.filter((c) => c.toLowerCase() !== '#fff') ?? [],
    ).toEqual([])
    expect(body.match(/rgba?\([^)]*\)/g) ?? []).toEqual([])
  })
})
