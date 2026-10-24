/**
 * Perf recorder: a rolling window of per-frame times, for the perf HUD and for tests.
 *
 * Call `sample(now)` once per rAF with the frame's timestamp and it records `now - lastNow`
 * in a fixed ring; `push(value)` records a measured value instead (GPU ms from timestamp
 * queries, say). `stats()` reports fps, percentiles and hitches over what the ring holds, and
 * `toCsv()` dumps it.
 *
 * - `sample()` and `push()` allocate nothing: the ring and the sort scratch are made once.
 * - `stats()` and `toCsv()` may allocate; call them a few times a second, never per frame.
 * - A hitch is a frame over `hitchMs` (default 33.4 ms, a missed 30 fps frame), counted over
 *   the window, so it ages out as the ring wraps.
 *
 * The window is a sample count (default 600, ten seconds at 60 Hz), so it covers less time on a
 * faster display. No DOM, no renderer: it is a plain unit test.
 */

/** Ring capacity in samples: about 10 s at 60 fps. */
export const PERF_RING_CAPACITY = 600

/** Frame time above which a frame counts as a hitch, ms. 33.4 ms is just over a 30 fps frame. */
export const HITCH_THRESHOLD_MS = 33.4

export interface PerfStats {
  /** Mean fps across the window. 0 when the ring is empty. */
  fps: number
  /** Mean frame time, ms. */
  avgMs: number
  /** 50th percentile frame time. */
  p50Ms: number
  /** 95th percentile frame time. */
  p95Ms: number
  /** 99th percentile frame time. */
  p99Ms: number
  /** Smallest frame time in the window. */
  minMs: number
  /** Largest frame time in the window. */
  maxMs: number
  /** Samples in the ring now (at most the capacity). */
  count: number
  /** Frames in the window over the hitch threshold. */
  hitchCount: number
}

export interface PerfRecorder {
  /** Record the delta since the last call. `now` is monotonic (a rAF timestamp, or
   *  performance.now()); the first call only sets the baseline. */
  sample(now: number): void
  /** Record a measured value straight into the ring, not a delta between timestamps. */
  push(value: number, now?: number): void
  /** Stats over the ring as it is now. Reuses one sort buffer across calls. */
  stats(): PerfStats
  /** Every sample in the ring, oldest first, as CSV: `frame_index,t_ms,dt_ms`. */
  toCsv(): string
  /** Empty the ring and forget the baseline. */
  reset(): void
}

const EMPTY_STATS: PerfStats = {
  fps: 0,
  avgMs: 0,
  p50Ms: 0,
  p95Ms: 0,
  p99Ms: 0,
  minMs: 0,
  maxMs: 0,
  count: 0,
  hitchCount: 0,
}

export function createPerfRecorder(
  capacity: number = PERF_RING_CAPACITY,
  hitchMs: number = HITCH_THRESHOLD_MS,
): PerfRecorder {
  const cap = Math.max(1, Math.floor(capacity))
  // Frame times, ms, allocated once.
  const deltas = new Float32Array(cap)
  // The timestamp beside each sample, so toCsv() can give absolute time.
  const stamps = new Float64Array(cap)
  // Sort scratch for percentiles; only the first `count` entries are ever read.
  let scratch = new Float32Array(cap)

  let head = 0 // next write index
  let count = 0 // valid samples (at most cap)
  let lastNow = -1 // -1: no baseline yet

  function write(value: number, now: number): void {
    deltas[head] = value
    stamps[head] = now
    head = (head + 1) % cap
    if (count < cap) count += 1
  }

  function sample(now: number): void {
    if (lastNow < 0) {
      lastNow = now
      return
    }
    const dt = now - lastNow
    lastNow = now
    write(dt, now)
  }

  function push(value: number, now = 0): void {
    write(value, now)
  }

  /** The ring into `out[0..count)`, oldest first. */
  function snapshot(out: Float32Array): void {
    if (count < cap) {
      for (let i = 0; i < count; i++) out[i] = deltas[i] as number
      return
    }
    for (let i = 0; i < cap; i++) out[i] = deltas[(head + i) % cap] as number
  }

  function stats(): PerfStats {
    if (count === 0) return { ...EMPTY_STATS }
    if (scratch.length < count) scratch = new Float32Array(count)
    snapshot(scratch)
    let total = 0
    let minV = Number.POSITIVE_INFINITY
    let maxV = Number.NEGATIVE_INFINITY
    let hitchCount = 0
    for (let i = 0; i < count; i++) {
      const v = scratch[i] as number
      total += v
      if (v < minV) minV = v
      if (v > maxV) maxV = v
      if (v > hitchMs) hitchCount += 1
    }
    const view = scratch.subarray(0, count)
    view.sort()
    const avgMs = total / count
    return {
      fps: avgMs > 0 ? 1000 / avgMs : 0,
      avgMs,
      p50Ms: percentile(view, 0.5),
      p95Ms: percentile(view, 0.95),
      p99Ms: percentile(view, 0.99),
      minMs: minV,
      maxMs: maxV,
      count,
      hitchCount,
    }
  }

  function toCsv(): string {
    const rows: string[] = ['frame_index,t_ms,dt_ms']
    // frame_index counts within the window (0 is the oldest), not since boot.
    const start = count < cap ? 0 : head
    for (let i = 0; i < count; i++) {
      const src = (start + i) % cap
      rows.push(`${i},${stamps[src] as number},${deltas[src] as number}`)
    }
    return rows.join('\n')
  }

  function reset(): void {
    head = 0
    count = 0
    lastNow = -1
  }

  return { sample, push, stats, toCsv, reset }
}

/** Linear-interpolated percentile of a sorted view; `q` in [0, 1]. */
export function percentile(sorted: Float32Array, q: number): number {
  const n = sorted.length
  if (n === 0) return 0
  if (n === 1) return sorted[0] as number
  const pos = q * (n - 1)
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  const a = sorted[lo] as number
  if (lo === hi) return a
  const b = sorted[hi] as number
  return a + (b - a) * (pos - lo)
}
