/**
 * Dev command bar: a Ctrl/Cmd+K fuzzy search over a `DevTool[]`. Esc closes it, the arrows
 * move, Enter runs. The overlay takes no pointer events and has no backdrop, so the game stays
 * visible behind it; only the box takes clicks.
 *
 * Two listener layers, on purpose:
 * - a capture-phase window keydown owns Ctrl/Cmd+K and, while open, Esc, so closing the bar
 *   never also reaches the game's pause binding;
 * - the box stops propagation of every keydown and keyup, so typed characters never reach the
 *   game (the "w" in "tune" must not walk the player forward).
 *
 * And `suspendKeys`, when the game passes one, is held while the bar is open, so no key typed
 * after Ctrl/Cmd+K drives the game even when the box lacks focus (before focus lands, or after
 * a click on the game behind it). It returns the release.
 */

import { fuzzyScore } from './fuzzy'
import { runTool, toolHasState, toolIsOn } from './registry'
import type { DevTool } from './registry-types'

const BAR_ID = 'dev-cmdbar'
const STYLE_ID = 'dev-cmdbar-style'

export interface CommandBarOptions {
  /** Called on open; the function it returns is called on close. Hold the game's keyboard here. */
  suspendKeys?: () => () => void
  /** The input's placeholder. */
  placeholder?: string
}

export interface CommandBar {
  open(): void
  close(): void
  isOpen(): boolean
  destroy(): void
}

function matchText(tool: DevTool): string {
  return `${tool.label} ${tool.group} ${tool.keywords ?? ''}`
}

function injectStyle(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    #${BAR_ID}{position:fixed;inset:0;z-index:120;display:none;pointer-events:none;
      font:13px/1.4 var(--dev-font-mono,ui-monospace,Consolas,monospace);
      color:var(--dev-ink,#e8eef2)}
    #${BAR_ID}.open{display:block}
    #${BAR_ID} .cmdbar-box{pointer-events:auto;position:absolute;top:11vh;left:50%;
      transform:translateX(-50%);width:min(560px,92vw);background:rgba(8,14,24,.97);
      border:1px solid var(--dev-line,rgba(120,160,190,.35));border-radius:9px;
      box-shadow:0 20px 64px rgba(0,0,0,.6);overflow:hidden}
    #${BAR_ID} input{width:100%;box-sizing:border-box;padding:14px 16px;background:transparent;
      border:none;border-bottom:1px solid var(--dev-line,rgba(120,160,190,.25));
      color:var(--dev-ink,#e8eef2);font:14px var(--dev-font-mono,ui-monospace,Consolas,monospace);
      outline:none}
    #${BAR_ID} input::placeholder{color:var(--dev-ink-dim,#7c93a6)}
    #${BAR_ID} ul{list-style:none;margin:0;padding:6px;max-height:48vh;overflow-y:auto}
    #${BAR_ID} li{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;
      padding:8px 12px;border-radius:6px;cursor:pointer}
    #${BAR_ID} li.sel{background:rgba(77,214,255,.16)}
    #${BAR_ID} .ci-label{font-size:13px}
    #${BAR_ID} .ci-label.ci-on{color:var(--dev-accent,#4dd6ff)}
    #${BAR_ID} .ci-label.ci-on::after{content:' ●';font-size:9px}
    #${BAR_ID} .ci-hint{font-size:10px;opacity:.55;margin-top:1px;
      overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #${BAR_ID} .ci-group{font-size:9px;letter-spacing:.14em;text-transform:uppercase;
      opacity:.5;white-space:nowrap}
    #${BAR_ID} .cmdbar-empty{padding:14px 16px;opacity:.5;font-size:12px}
  `
  document.head.appendChild(style)
}

/** Rank `tools` for `query`: registry order when empty, else by fuzzy score. */
export function filterTools(tools: readonly DevTool[], query: string): DevTool[] {
  if (query.trim() === '') return tools.slice()
  const scored: Array<{ tool: DevTool; score: number }> = []
  for (const tool of tools) {
    const s = fuzzyScore(query, matchText(tool))
    if (s !== null) scored.push({ tool, score: s })
  }
  scored.sort((a, b) => a.score - b.score)
  return scored.map((s) => s.tool)
}

export function installCommandBar(
  tools: readonly DevTool[],
  options: CommandBarOptions = {},
): CommandBar {
  document.getElementById(BAR_ID)?.remove()
  injectStyle()

  const overlay = document.createElement('div')
  overlay.id = BAR_ID
  const box = document.createElement('div')
  box.className = 'cmdbar-box'
  const input = document.createElement('input')
  input.type = 'text'
  input.placeholder = options.placeholder ?? 'Search dev tools…'
  input.setAttribute('aria-label', 'Search dev tools')
  const list = document.createElement('ul')
  box.append(input, list)
  overlay.appendChild(box)
  document.body.appendChild(overlay)

  let isOpen = false
  let releaseKeys: (() => void) | null = null
  let filtered: DevTool[] = tools.slice()
  let sel = 0

  function render(query: string): void {
    filtered = filterTools(tools, query)
    sel = 0
    paint()
  }

  function paint(): void {
    list.replaceChildren()
    if (filtered.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'cmdbar-empty'
      empty.textContent = 'No matching dev tools'
      list.appendChild(empty)
      return
    }
    filtered.forEach((tool, i) => {
      const li = document.createElement('li')
      li.dataset.tool = tool.id
      if (i === sel) li.classList.add('sel')

      const main = document.createElement('div')
      const label = document.createElement('div')
      label.className = 'ci-label'
      label.textContent = tool.label
      if (toolHasState(tool) && toolIsOn(tool)) label.classList.add('ci-on')
      main.appendChild(label)
      if (tool.hint) {
        const hint = document.createElement('div')
        hint.className = 'ci-hint'
        hint.textContent = tool.hint
        main.appendChild(hint)
      }

      const group = document.createElement('span')
      group.className = 'ci-group'
      group.textContent = tool.group

      li.append(main, group)
      li.addEventListener('mousemove', () => {
        if (sel !== i) {
          sel = i
          updateSel()
        }
      })
      li.addEventListener('click', () => run(tool))
      list.appendChild(li)
    })
  }

  function updateSel(): void {
    const items = list.querySelectorAll('li')
    items.forEach((li, i) => {
      li.classList.toggle('sel', i === sel)
    })
    items[sel]?.scrollIntoView({ block: 'nearest' })
  }

  function moveSel(delta: number): void {
    if (filtered.length === 0) return
    sel = Math.max(0, Math.min(filtered.length - 1, sel + delta))
    updateSel()
  }

  function run(tool: DevTool): void {
    close()
    runTool(tool)
  }

  function open(): void {
    if (isOpen) return
    isOpen = true
    releaseKeys = options.suspendKeys?.() ?? null
    overlay.classList.add('open')
    input.value = ''
    render('')
    // Focus now, not next frame: focus() flushes style, so the input is already shown and
    // takes the caret, and the very next key lands in it.
    input.focus()
  }

  function close(): void {
    if (!isOpen) return
    isOpen = false
    releaseKeys?.()
    releaseKeys = null
    overlay.classList.remove('open')
    input.blur()
  }

  input.addEventListener('input', () => render(input.value))

  // Typed keys and arrow nudges stay out of the game; the box handles its own navigation.
  box.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.code === 'ArrowDown') {
      e.preventDefault()
      moveSel(1)
    } else if (e.code === 'ArrowUp') {
      e.preventDefault()
      moveSel(-1)
    } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault()
      const tool = filtered[sel]
      if (tool) run(tool)
    }
  })
  box.addEventListener('keyup', (e) => e.stopPropagation())

  // Capture phase: Ctrl/Cmd+K toggles; Esc closes while open.
  const onKeyCapture = (e: KeyboardEvent): void => {
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') {
      e.preventDefault()
      e.stopPropagation()
      if (isOpen) close()
      else open()
      return
    }
    if (isOpen && e.code === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }
  window.addEventListener('keydown', onKeyCapture, true)

  return {
    open,
    close,
    isOpen: () => isOpen,
    destroy() {
      window.removeEventListener('keydown', onKeyCapture, true)
      close()
      overlay.remove()
      document.getElementById(STYLE_ID)?.remove()
    },
  }
}
