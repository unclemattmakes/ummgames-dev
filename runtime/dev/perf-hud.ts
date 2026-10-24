/**
 * Perf overlay: frame time, GPU time, sim and render cost, draw calls and heap, in a small fixed
 * panel. A row turns amber when it is over its budget.
 *
 * It takes plain numbers (`RenderInfoLite` is what a loop pulls from its renderer's stats), so
 * it imports no renderer and stays testable. `tick()` returns at once while hidden, before any
 * DOM write; call it a few times a second with `PerfRecorder.stats()`.
 */
import type { PerfStats } from './perf-recorder'

export interface RenderInfoLite {
  /** Draw calls this frame (the renderer's counters reset per frame). */
  drawCalls: number
  triangles: number
  geometries: number
  textures: number
}

export interface FrameCost {
  /** CPU ms in the simulation this frame, and how many fixed steps it took. */
  simMs: number
  simSteps: number
  /** CPU ms submitting the frame to the renderer. */
  renderMs: number
  /** The pixel ratio rendered at (adaptive resolution moves it). */
  pixelRatio: number
}

export interface PerfDiagnostics {
  backend: string
  tier: string
  gpu: string
}

export interface PerfBudget {
  /** Frame time, 95th percentile, ms. */
  frameP95Ms: number
  /** GPU time, 95th percentile, ms. */
  gpuP95Ms: number
  simMs: number
  renderMs: number
  drawCalls: number
  triangles: number
}

/** A 60 Hz game's budgets: change them per game through `createPerfHud({ budget })`. */
export const DEFAULT_BUDGET: PerfBudget = {
  frameP95Ms: 16.7,
  gpuP95Ms: 12,
  simMs: 2,
  renderMs: 4,
  drawCalls: 250,
  triangles: 750_000,
}

export interface PerfHudOptions {
  /** Merged over {@link DEFAULT_BUDGET}. */
  budget?: Partial<PerfBudget>
  /** Where the panel goes. Default `document.body`. */
  parent?: HTMLElement
  /** The panel's element id. Default `perf-hud`. */
  id?: string
}

export interface PerfHud {
  /** `gpu`: GPU ms per frame, or null when the backend cannot measure it. `info` and `cost`
   *  are optional: a game without a renderer's counters or a fixed-step sim leaves them out. */
  tick(
    stats: PerfStats,
    info?: RenderInfoLite | null,
    cost?: FrameCost | null,
    gpu?: PerfStats | null,
  ): void
  setDiagnostics(d: PerfDiagnostics): void
  setVisible(on: boolean): void
  isVisible(): boolean
  dispose(): void
}

export function createPerfHud(options: PerfHudOptions = {}): PerfHud {
  const budget: PerfBudget = { ...DEFAULT_BUDGET, ...options.budget }
  const root = document.createElement('div')
  root.id = options.id ?? 'perf-hud'
  root.style.cssText = [
    'position:fixed',
    'top:12px',
    'right:12px',
    'z-index:1500',
    'padding:6px 10px',
    'background:rgba(16,24,40,0.78)',
    'color:rgba(240,248,255,0.95)',
    'font:11px ui-monospace,"SF Mono",Menlo,Consolas,monospace',
    'line-height:1.5',
    'border-radius:6px',
    'pointer-events:none',
    'white-space:pre',
    'min-width:270px',
    'display:none',
  ].join(';')

  const rows = {
    fps: row(),
    gpuTime: row(),
    cost: row(),
    draw: row(),
    heap: row(),
    env: row('opacity:0.8'),
    gpu: row('opacity:0.8;white-space:normal'),
  }
  for (const r of Object.values(rows)) root.appendChild(r)
  ;(options.parent ?? document.body).appendChild(root)
  let visible = false

  return {
    tick(stats, info, cost, gpu) {
      if (!visible) return
      set(
        rows.fps,
        `FPS  ${stats.fps.toFixed(0).padStart(3)} · P95 ${stats.p95Ms.toFixed(1)}ms · P99 ${stats.p99Ms.toFixed(1)}ms · HITCH ${stats.hitchCount}`,
        stats.p95Ms > budget.frameP95Ms,
      )
      set(
        rows.gpuTime,
        gpu
          ? `GPU  P50 ${gpu.p50Ms.toFixed(2)}ms · P95 ${gpu.p95Ms.toFixed(2)}ms · MAX ${gpu.maxMs.toFixed(1)}ms`
          : 'GPU  n/a (no timestamp queries)',
        (gpu?.p95Ms ?? 0) > budget.gpuP95Ms,
      )
      if (cost)
        set(
          rows.cost,
          `SIM  ${cost.simMs.toFixed(2)}ms ×${cost.simSteps} · RENDER ${cost.renderMs.toFixed(2)}ms · DPR ${cost.pixelRatio.toFixed(2)}`,
          cost.simMs > budget.simMs || cost.renderMs > budget.renderMs,
        )
      if (info)
        set(
          rows.draw,
          `DRAW ${info.drawCalls} · TRI ${formatCount(info.triangles)} · GEO ${info.geometries} · TEX ${info.textures}`,
          info.drawCalls > budget.drawCalls || info.triangles > budget.triangles,
        )
      const mem = (performance as { memory?: { usedJSHeapSize?: number } }).memory
      rows.heap.textContent =
        mem?.usedJSHeapSize != null
          ? `HEAP ${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB`
          : 'HEAP n/a'
    },
    setDiagnostics(d) {
      rows.env.textContent = `BKND ${d.backend} · TIER ${d.tier}`
      rows.gpu.textContent = `GPU  ${d.gpu}`
    },
    setVisible(on) {
      visible = on
      root.style.display = on ? 'block' : 'none'
    },
    isVisible: () => visible,
    dispose: () => root.remove(),
  }
}

function row(css = ''): HTMLDivElement {
  const d = document.createElement('div')
  d.style.cssText = css
  return d
}

function set(el: HTMLElement, text: string, over: boolean): void {
  el.textContent = text
  el.style.color = over ? '#ffcf5a' : ''
}

/** 1234 -> "1.2k", 384000 -> "384k", 1.2e6 -> "1.2M". */
export function formatCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}
