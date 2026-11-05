// How a page mounts its toys. A toy is a module that exports a `ToyDef`. The host owns everything
// that is not the toy: the frame around it, lazy mounting when it nears the screen, disposing it
// when it is far away (browsers cap WebGL contexts near 16 and silently kill the oldest), one
// shared frame loop that runs only while something is visible, and the reduced-motion flag.
//
// Sim toys step a fixed clock (`createToyClock` below), so a toy's physics runs at the game's step
// with the game's accumulator, never a `dt`-per-frame imitation.

import { type Controls, createControls } from './controls'

export interface Toy {
  /** Called once per display frame while visible, with wall seconds. */
  frame?(dt: number): void
  resize?(width: number, height: number): void
  dispose(): void
}

export interface ToyContext {
  readonly stage: HTMLElement
  readonly controls: Controls
  readonly reducedMotion: boolean
}

export type MountToy = (ctx: ToyContext) => Toy | Promise<Toy>

export interface ToyDef {
  readonly id: string
  readonly title: string
  /**
   * Under the stage on a CHAPTER page: one line saying what the demo is. The
   * chapter's own "Try it" paragraph says what to do, so this must not repeat it.
   */
  readonly about: string
  /** Under the stage on the PLAYGROUND, which has no prose: what to try. */
  readonly caption: string
  /** 3D toys hold a WebGL context and are capped; 2D ones are only disposed when far. */
  readonly kind: '2d' | '3d'
  readonly mount: MountToy
}

/** Browsers cap contexts near 16, and a game's world is heavy: three live at most. */
export const MAX_LIVE_3D = 3

/**
 * Which toys are live, and which to evict. Pure, so the cap is unit-tested
 * without a browser. `admit` returns the ids that must be disposed now.
 */
export const createLiveSet = (max: number) => {
  /** Least recently visible first. */
  const order: string[] = []
  const visible = new Set<string>()
  const touch = (id: string) => {
    const i = order.indexOf(id)
    if (i >= 0) order.splice(i, 1)
    order.push(id)
  }
  return {
    admit(id: string): string[] {
      touch(id)
      visible.add(id)
      const evict: string[] = []
      // The newest is never evicted, and neither is anything on screen.
      for (const old of [...order]) {
        if (order.length - evict.length <= max) break
        if (old !== id && !visible.has(old)) evict.push(old)
      }
      for (const e of evict) order.splice(order.indexOf(e), 1)
      return evict
    },
    seen(id: string) {
      visible.add(id)
      // Only what was admitted holds a place: a 2D toy, or one on its poster, takes none.
      if (order.includes(id)) touch(id)
    },
    unseen(id: string) {
      visible.delete(id)
    },
    release(id: string) {
      const i = order.indexOf(id)
      if (i >= 0) order.splice(i, 1)
      visible.delete(id)
    },
    ids: () => [...order],
  }
}

/** The most sim steps one frame runs by default, so a long stall cannot spiral. */
export const MAX_TOY_STEPS = 12

/**
 * The game's fixed clock, for a toy: wall seconds in, whole sim steps out, an alpha back. Pass the
 * game's step, and the most steps its own loop runs in a frame.
 */
export const createToyClock = (stepSeconds: number, maxSteps = MAX_TOY_STEPS) => {
  let acc = 0
  let tick = 0
  return {
    /** Returns the interpolation alpha in [0, 1]. `onTick` gets the fixed dt and the step's count. */
    step(frameSeconds: number, onTick: (dt: number, tick: number) => void): number {
      acc += frameSeconds
      let steps = 0
      while (acc >= stepSeconds && steps < maxSteps) {
        onTick(stepSeconds, tick++)
        acc -= stepSeconds
        steps++
      }
      if (steps === maxSteps) acc = 0
      return Math.min(1, acc / stepSeconds)
    },
  }
}

interface Live {
  readonly def: ToyDef
  readonly root: HTMLElement
  readonly stage: HTMLElement
  readonly controlsEl: HTMLElement
  toy: Toy | null
  loading: boolean
  /** Pushed out while its `mount` was still running: dropped as soon as that returns. */
  evicted: boolean
  onScreen: boolean
}

const prefersReducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Mount every `<div data-toy="<id>">` on the page whose id is in `defs`. The
 * element becomes the frame; the toy mounts into its stage when it is within a
 * viewport of the screen, or on reaching the screen if the cap pushed it out on
 * the way, and is disposed when it has been far away. `line` picks the line
 * under the stage: a chapter's `about`, or the playground's fuller `caption`.
 */
export const mountToysOnPage = (
  defs: readonly ToyDef[],
  line: 'about' | 'caption' = 'about',
): void => {
  const byId = new Map(defs.map((d) => [d.id, d]))
  const lives: Live[] = []
  const liveSet = createLiveSet(MAX_LIVE_3D)
  const reduced = prefersReducedMotion()

  const build = (root: HTMLElement, def: ToyDef): Live => {
    root.classList.add('demo-container')
    root.innerHTML = ''
    const stage = document.createElement('div')
    stage.className = 'demo-stage'
    const poster = document.createElement('div')
    poster.className = 'poster'
    poster.textContent = def.title
    stage.append(poster)
    const label = document.createElement('div')
    label.className = 'demo-label'
    label.textContent = def[line]
    const controlsEl = document.createElement('div')
    root.append(stage, controlsEl, label)
    return {
      def,
      root,
      stage,
      controlsEl,
      toy: null,
      loading: false,
      evicted: false,
      onScreen: false,
    }
  }

  const dispose = (live: Live) => {
    live.toy?.dispose()
    live.toy = null
    live.controlsEl.replaceChildren()
    const poster = document.createElement('div')
    poster.className = 'poster'
    poster.textContent = live.def.title
    live.stage.replaceChildren(poster)
    liveSet.release(live.def.id)
  }

  const mount = async (live: Live) => {
    if (live.toy || live.loading) return
    live.loading = true
    live.evicted = false
    if (live.def.kind === '3d') {
      for (const id of liveSet.admit(live.def.id)) {
        const victim = lives.find((l) => l.def.id === id)
        if (victim?.loading) victim.evicted = true
        else if (victim) dispose(victim)
      }
      // `admit` takes a toy for on screen, and one near the screen is not there yet.
      if (!live.onScreen) liveSet.unseen(live.def.id)
    }
    live.stage.replaceChildren()
    live.controlsEl.replaceChildren()
    const controls = createControls(live.controlsEl)
    let toy: Toy
    try {
      toy = await live.def.mount({ stage: live.stage, controls, reducedMotion: reduced })
    } finally {
      live.loading = false
    }
    live.toy = toy
    if (live.evicted || (!live.onScreen && !isNear(live.root))) {
      dispose(live)
      if (live.onScreen) void mount(live)
      return
    }
    const r = live.stage.getBoundingClientRect()
    toy.resize?.(r.width, r.height)
  }

  const isNear = (el: HTMLElement): boolean => {
    const r = el.getBoundingClientRect()
    return r.bottom > -innerHeight && r.top < innerHeight * 2
  }

  const near = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const live = lives.find((l) => l.root === e.target)
        if (!live) continue
        if (e.isIntersecting) void mount(live)
        else if (live.toy) dispose(live)
      }
    },
    { rootMargin: '100% 0px' },
  )
  const seen = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const live = lives.find((l) => l.root === e.target)
      if (!live) continue
      live.onScreen = e.isIntersecting
      if (e.isIntersecting) {
        liveSet.seen(live.def.id)
        // `near` fires only on crossing its margin, so a toy the cap pushed out inside the
        // margin has nothing else to bring it back.
        void mount(live)
      } else liveSet.unseen(live.def.id)
    }
  })

  const resizer = new ResizeObserver((entries) => {
    for (const e of entries) {
      const live = lives.find((l) => l.stage === e.target)
      if (live?.toy) live.toy.resize?.(e.contentRect.width, e.contentRect.height)
    }
  })

  for (const el of document.querySelectorAll<HTMLElement>('[data-toy]')) {
    const def = byId.get(el.dataset.toy ?? '')
    if (!def) {
      console.error(`making-of: no toy "${el.dataset.toy}" is registered`)
      continue
    }
    const live = build(el, def)
    lives.push(live)
    near.observe(el)
    seen.observe(el)
    resizer.observe(live.stage)
  }

  // One loop for the page; a toy's `frame` runs only while it is live and on screen.
  let last = performance.now()
  const tick = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    for (const l of lives) if (l.toy && l.onScreen && !document.hidden) l.toy.frame?.(dt)
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}
