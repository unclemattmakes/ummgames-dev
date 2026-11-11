/**
 * Fixed-step accumulator. The sim advances in exact `stepSeconds`
 * increments; rendering happens once per display frame and interpolates
 * between the last two sim states with `alpha`.
 *
 * Pure and clock-free: the caller hands in each frame's elapsed seconds.
 * Two guards keep a stall from turning into a "spiral of death":
 *  - a frame longer than `maxFrameSeconds` (tab switch, breakpoint, shader
 *    compile) is clamped, so we never try to simulate the lost time;
 *  - at most `maxStepsPerFrame` steps run per frame, and any backlog beyond
 *    that is dropped rather than carried into the next frame.
 *
 * The default step rate is `SIM_HZ`, 120 Hz. Sim code reads `SIM_DT` and never assumes the rate.
 */
export const SIM_HZ = 120
export const SIM_DT = 1 / SIM_HZ

export interface FixedStepperOptions {
  /** Seconds per sim step. Default `SIM_DT`. */
  stepSeconds?: number
  /** Most steps run in one frame; past it the backlog is dropped. Default 8. */
  maxStepsPerFrame?: number
  /** Longest frame counted, seconds; a longer one is clamped to it. Default 0.25. */
  maxFrameSeconds?: number
}

export interface FrameAdvance {
  /** Sim steps to run this frame. */
  steps: number
  /** Interpolation factor in [0, 1) between the previous and current sim state. */
  alpha: number
  /** True when time was dropped (clamped frame or step cap hit). */
  dropped: boolean
}

export interface FixedStepper {
  advance(frameSeconds: number): FrameAdvance
  /** Forget accumulated time, e.g. after the tab was hidden. */
  reset(): void
  readonly stepSeconds: number
}

export function createFixedStepper(opts: FixedStepperOptions = {}): FixedStepper {
  const stepSeconds = opts.stepSeconds ?? SIM_DT
  const maxSteps = opts.maxStepsPerFrame ?? 8
  const maxFrame = opts.maxFrameSeconds ?? 0.25
  let acc = 0
  const out: FrameAdvance = { steps: 0, alpha: 0, dropped: false }

  return {
    stepSeconds,
    advance(frameSeconds: number): FrameAdvance {
      let dt = Number.isFinite(frameSeconds) && frameSeconds > 0 ? frameSeconds : 0
      out.dropped = false
      if (dt > maxFrame) {
        dt = maxFrame
        out.dropped = true
      }
      acc += dt
      // A hair of tolerance so 1/60 s frames at 120 Hz reliably yield 2 steps
      // instead of alternating 1 and 3 from float error.
      let steps = Math.floor(acc / stepSeconds + 1e-9)
      if (steps > maxSteps) {
        steps = maxSteps
        acc = 0
        out.dropped = true
      } else {
        acc -= steps * stepSeconds
        if (acc < 0) acc = 0
      }
      out.steps = steps
      out.alpha = Math.min(acc / stepSeconds, 1 - 1e-6)
      return out
    },
    reset(): void {
      acc = 0
    },
  }
}
