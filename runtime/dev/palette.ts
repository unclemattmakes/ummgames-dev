/**
 * Dev palette: the tool list and the Ctrl/Cmd+K command bar over it. The game owns the list;
 * this gives it the parts most games share (a tuner per tuning set, the perf HUD toggle, render
 * params that reload) and installs the bar.
 *
 *   const palette = installDevPalette([
 *     ...tunerTools(sets),
 *     perfHudTool(hud),
 *     { id: 'action.respawn', label: 'Respawn player', group: 'Actions', kind: 'action', run },
 *     paramTool('backend', 'webgl2', 'Force WebGL2 backend', 'fallback'),
 *   ], { suspendKeys })
 *
 * Load it lazily from a dev build only, so none of it ships in the production entry chunk.
 * Tuner panels are single-active: opening one closes the other, and running an open one again
 * closes it. A tuner panel given its own `id` needs the same `tunerId` here, so `destroy()`
 * finds it. This file imports every other file in its folder: copy the folder.
 */
import { type CommandBarOptions, installCommandBar } from './command-bar'
import type { PerfHud } from './perf-hud'
import { urlHas } from './registry'
import type { DevTool, DevToolGroup } from './registry-types'
import {
  openTunerPanel,
  type TunerPanel,
  type TunerPanelOptions,
  type TuningSet,
} from './tuner-panel'

export interface DevPalette {
  tools: readonly DevTool[]
  destroy(): void
}

/** One panel tool per tuning set, sharing one docked panel. */
export function tunerTools(
  sets: readonly TuningSet[],
  options: TunerPanelOptions & { hint?: (set: TuningSet) => string } = {},
): DevTool[] {
  let panel: { id: string; handle: TunerPanel } | null = null
  return sets.map(
    (set): DevTool => ({
      id: `tune.${set.id}`,
      label: `Tune: ${set.title}`,
      group: 'Tuners',
      keywords: `tuning feel ${set.id} ${Object.keys(set.spec).join(' ')}`,
      hint: options.hint?.(set) ?? `Live-edit the ${set.id} tuning`,
      kind: 'panel',
      isOpen: () => panel?.id === set.id && panel.handle.isOpen(),
      open: () => {
        const wasThis = panel?.id === set.id
        panel?.handle.close()
        if (wasThis) return
        const handle = openTunerPanel(
          set,
          () => {
            if (panel?.handle === handle) panel = null
          },
          options,
        )
        panel = { id: set.id, handle }
      },
    }),
  )
}

/** The perf HUD's on/off toggle. The default hint names `?perf=1`, which the game reads itself. */
export function perfHudTool(hud: PerfHud, hint = 'Also ?perf=1'): DevTool {
  return {
    id: 'toggle.perf',
    label: 'Perf HUD',
    group: 'Toggles',
    keywords: 'fps frame time draw calls stats',
    hint,
    kind: 'toggle',
    isOn: () => hud.isVisible(),
    toggle: () => hud.setVisible(!hud.isVisible()),
  }
}

/** A boot-time `?param=value` that reloads; running it again clears it. */
export function paramTool(
  param: string,
  value: string,
  label: string,
  keywords = '',
  group: DevToolGroup = 'Render',
): DevTool {
  return {
    id: `param.${param}.${value}`,
    label,
    group,
    keywords,
    hint: `Reload with ?${param}=${value} (run again to clear)`,
    kind: 'param',
    mode: 'value',
    param,
    value,
    isOn: () => urlHas(param, value),
  }
}

/** Install the command bar over `tools`. `destroy()` takes the bar and any open tuner down. */
export function installDevPalette(
  tools: readonly DevTool[],
  options: CommandBarOptions & { tunerId?: string } = {},
): DevPalette {
  const bar = installCommandBar(tools, options)
  return {
    tools,
    destroy() {
      bar.destroy()
      document.getElementById(options.tunerId ?? 'dev-tuner')?.remove()
    },
  }
}
