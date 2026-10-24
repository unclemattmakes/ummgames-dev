/**
 * Dev tool dispatcher and URL helpers. `runTool` is the one way a tool runs: it switches on
 * `tool.kind` exhaustively, so a new kind without a case fails to compile. Scene and param tools
 * rebuild the current URL, keeping every other param, and navigate.
 */
import type { DevTool, ParamTool } from './registry-types'

/**
 * A URL with query-param changes applied: `null` deletes, a string sets. `href` is injectable
 * so this runs in node, with no `window`.
 */
export function buildUrl(
  mutations: Record<string, string | null>,
  href: string = window.location.href,
): string {
  const url = new URL(href)
  for (const [key, value] of Object.entries(mutations)) {
    if (value === null) url.searchParams.delete(key)
    else url.searchParams.set(key, value)
  }
  return url.toString()
}

function runParam(tool: ParamTool): void {
  if (tool.mode === 'flag') {
    const has = new URLSearchParams(window.location.search).has(tool.param)
    window.location.assign(buildUrl({ [tool.param]: has ? null : '' }))
    return
  }
  if (tool.value !== undefined && tool.isOn?.()) {
    window.location.assign(buildUrl({ [tool.param]: null }))
    return
  }
  let value = tool.value
  if (value === undefined) {
    const entered = window.prompt(`Value for ?${tool.param}=`, '')
    if (entered === null || entered.trim() === '') return
    value = entered.trim()
  }
  window.location.assign(buildUrl({ [tool.param]: value }))
}

/** Whether a tool has an on/off state (the command bar's dot). */
export function toolHasState(tool: DevTool): boolean {
  return (
    tool.kind === 'toggle' ||
    tool.kind === 'panel' ||
    (tool.kind === 'param' && tool.isOn !== undefined)
  )
}

export function toolIsOn(tool: DevTool): boolean {
  if (tool.kind === 'toggle') return tool.isOn()
  if (tool.kind === 'panel') return tool.isOpen?.() ?? false
  if (tool.kind === 'param') return tool.isOn?.() ?? false
  return false
}

/** True when the URL has `param` set to `value` (or present at all, with no value). */
export function urlHas(
  param: string,
  value?: string,
  search: string = window.location.search,
): boolean {
  const p = new URLSearchParams(search)
  return value === undefined ? p.has(param) : p.get(param) === value
}

export function runTool(tool: DevTool): void {
  switch (tool.kind) {
    case 'toggle':
      tool.toggle()
      return
    case 'action':
      void tool.run()
      return
    case 'panel':
      void tool.open()
      return
    case 'scene':
      window.location.assign(buildUrl({ [tool.param]: tool.value ?? '1' }))
      return
    case 'param':
      runParam(tool)
      return
  }
}
