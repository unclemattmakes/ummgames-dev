/**
 * Perf handle: a small read-only object on `window` (`__pf` by default) that a perf spec reads
 * from outside the page. `measureFrames` and `coldLoad` in `@ummgames/dev/testing` wait on
 * `frames` and read `stats()`; a game adds its own readings as `extras` (draw calls, a sim and
 * render split, GPU time), which a spec asks for by name.
 *
 * Call `frame(now)` once per rAF with the frame's timestamp: it samples the recorder and counts
 * the frame. Install it in every build, not only dev: a perf spec measures the production build,
 * and a handle of a few closures costs nothing a frame. Imports `perf-recorder`.
 */
import { createPerfRecorder, type PerfRecorder, type PerfStats } from './perf-recorder'

export interface PerfHandle {
  /** Frames counted since it was installed. A spec waits on this. */
  readonly frames: number
  /** The recorder's stats over its window. */
  stats(): PerfStats
}

export interface PerfHandleOptions<X> {
  /** The name on `target`. Default `'__pf'`. */
  name?: string
  /** The recorder to sample. Default a new `createPerfRecorder()`. */
  recorder?: PerfRecorder
  /** More readings, each a function a spec calls by name. Return plain data. */
  extras?: X
  /** Where the handle goes. Default `globalThis` (the window). */
  target?: object
}

export interface InstalledPerfHandle<X> {
  /** What is on `window`. */
  handle: PerfHandle & X
  /** The recorder behind `stats()`, for a HUD that shares it. */
  recorder: PerfRecorder
  /** Once per rAF: sample the recorder and count the frame. */
  frame(now: number): void
  /** Take the handle off `target`. */
  remove(): void
}

export function installPerfHandle<X extends Record<string, () => unknown> = Record<never, never>>(
  options: PerfHandleOptions<X> = {},
): InstalledPerfHandle<X> {
  const name = options.name ?? '__pf'
  const target = (options.target ?? globalThis) as Record<string, unknown>
  const recorder = options.recorder ?? createPerfRecorder()
  let frames = 0
  const handle = {
    ...(options.extras ?? ({} as X)),
    get frames() {
      return frames
    },
    stats: () => recorder.stats(),
  } as PerfHandle & X
  target[name] = handle
  return {
    handle,
    recorder,
    frame(now: number) {
      recorder.sample(now)
      frames += 1
    },
    remove() {
      if (target[name] === handle) delete target[name]
    },
  }
}
