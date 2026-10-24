/**
 * Dev tool registry: one discriminated union for every tool the Ctrl/Cmd+K command bar can run.
 * Types and one list, no imports, so it never pulls a renderer or a sim into the graph.
 *
 * A group is any string; the command bar shows it beside each tool. {@link DEV_TOOL_GROUPS}
 * holds the usual ones, and a game adds its own (`'Voice'`, `'Sound'`) by using them.
 */

/** The groups most games use. */
export const DEV_TOOL_GROUPS = [
  'Tuners', // docked live-tuning panels
  'Toggles', // live on/off overlays, no reload
  'Render', // boot-time render params that need a reload
  'Scenes', // standalone URL modes (editors, viewers)
  'Actions', // one-shot commands
] as const

export type DevToolGroup = (typeof DEV_TOOL_GROUPS)[number] | (string & {})

interface DevToolBase {
  /** Stable kebab id (`toggle.perf`). Also the command bar row's `data-tool`. */
  id: string
  label: string
  group: DevToolGroup
  /** Extra space-separated terms the fuzzy search matches beyond the label. */
  keywords?: string
  /** One line under the label in the command bar. */
  hint?: string
}

/** A standalone scene reached by a URL param: sets `param=value` and navigates. */
export interface SceneTool extends DevToolBase {
  kind: 'scene'
  param: string
  value?: string
}

/** Open (or toggle shut) a docked panel. */
export interface PanelTool extends DevToolBase {
  kind: 'panel'
  open: () => void | Promise<void>
  isOpen?: () => boolean
}

/** A live on/off overlay. No reload. */
export interface ToggleTool extends DevToolBase {
  kind: 'toggle'
  toggle: () => void
  isOn: () => boolean
}

/**
 * A boot-time param that applies on reload. `flag` toggles its presence (`?perf`); `value`
 * sets a value (`?backend=webgl2`). With a fixed `value` and `isOn`, running it again clears
 * the param; with no `value` it prompts for one.
 */
export interface ParamTool extends DevToolBase {
  kind: 'param'
  param: string
  mode: 'flag' | 'value'
  value?: string
  isOn?: () => boolean
}

/** A one-shot command (respawn, copy, download). */
export interface ActionTool extends DevToolBase {
  kind: 'action'
  run: () => void | Promise<void>
}

export type DevTool = SceneTool | PanelTool | ToggleTool | ParamTool | ActionTool
