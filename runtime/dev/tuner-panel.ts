/**
 * Live tuner panel: a slider and a number box per field of a tuning set, docked left. Edits
 * write `set.values` in place, so whatever reads that object feels them on its next step.
 *
 * Save POSTs the values as JSON to the dev server (`saveUrl`, default `/__dev/tuning/<id>`); the
 * game's dev server writes the file. A dot marks a field that differs from what was last saved.
 * Revert returns to the saved values, Defaults to the spec's, and Copy puts the JSON on the
 * clipboard (the way out when no dev server is running, on a deployed build).
 */

export interface TuningField {
  label: string
  default: number
  min: number
  max: number
  step: number
  unit?: string
  hint?: string
}

export type TuningSpec = Readonly<Record<string, TuningField>>

/** The shape the panel reads: a game's own tuning sets need only match it. */
export interface TuningSet<S extends TuningSpec = TuningSpec> {
  id: string
  title: string
  spec: S
  /** Live values; the panel writes into this object. */
  values: { -readonly [K in keyof S]: number }
  /** As last loaded or saved, for the changed-dots and Revert. */
  saved: { -readonly [K in keyof S]: number }
  /** A readout of derived values, shown under the sliders. (Method syntax keeps a specific set
   *  assignable to `TuningSet`.) */
  describe?(v: { -readonly [K in keyof S]: number }): string
}

export interface TunerPanelOptions {
  /** Where Save POSTs. Default `/__dev/tuning/<id>`. */
  saveUrl?: (id: string) => string
  /** What the status line says after a save. Default `saved <id>`. */
  savedText?: (id: string) => string
  /** The panel's element id. Default `dev-tuner`. */
  id?: string
}

export interface TunerPanel {
  isOpen(): boolean
  close(): void
}

const defaultSaveUrl = (id: string): string => `/__dev/tuning/${encodeURIComponent(id)}`

export async function saveTuning(
  set: TuningSet,
  saveUrl: (id: string) => string = defaultSaveUrl,
): Promise<void> {
  const res = await fetch(saveUrl(set.id), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(set.values),
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  Object.assign(set.saved, set.values)
}

export function openTunerPanel(
  set: TuningSet,
  onClose: () => void,
  options: TunerPanelOptions = {},
): TunerPanel {
  const panelId = options.id ?? 'dev-tuner'
  const saveUrl = options.saveUrl ?? defaultSaveUrl
  const savedText = options.savedText ?? ((id: string) => `saved ${id}`)
  document.getElementById(panelId)?.remove()
  const root = document.createElement('div')
  root.id = panelId
  root.dataset.set = set.id
  root.style.cssText = [
    'position:fixed',
    'left:12px',
    'top:12px',
    'z-index:110',
    'width:300px',
    'max-height:calc(100vh - 24px)',
    'overflow:auto',
    'padding:10px 12px',
    'background:rgba(16,24,40,0.9)',
    'color:#eef4fa',
    'font:12px/1.4 ui-monospace,Consolas,monospace',
    'border-radius:8px',
    'box-shadow:0 8px 28px rgba(0,0,0,0.3)',
  ].join(';')
  // Keys typed into the panel are the panel's (Space on a focused button must not jump).
  root.addEventListener('keydown', (e) => e.stopPropagation())
  root.addEventListener('keyup', (e) => e.stopPropagation())

  const head = el('div', 'display:flex;justify-content:space-between;margin-bottom:8px')
  const title = el('strong', '')
  title.textContent = `Tune: ${set.title}`
  const x = button('×', () => close())
  head.append(title, x)
  root.appendChild(head)

  const rows: { key: string; range: HTMLInputElement; num: HTMLInputElement; dot: HTMLElement }[] =
    []
  const values = set.values as Record<string, number>
  const saved = set.saved as Record<string, number>

  for (const [key, f] of Object.entries(set.spec)) {
    const row = el('div', 'margin:6px 0')
    const label = el('div', 'display:flex;justify-content:space-between;opacity:0.9')
    const name = el('span', '')
    name.textContent = f.label
    if (f.hint) name.title = f.hint
    const dot = el('span', 'color:#ffcf5a')
    const unit = el('span', 'opacity:0.6')
    unit.textContent = f.unit ?? ''
    label.append(name, dot, unit)

    const ctl = el('div', 'display:flex;gap:6px;align-items:center')
    const range = input('range', f, 'flex:1')
    const num = input('number', f, 'width:72px')
    num.dataset.key = key
    const apply = (v: number) => {
      if (!Number.isFinite(v)) return
      values[key] = Math.min(f.max, Math.max(f.min, v))
      refresh()
    }
    range.addEventListener('input', () => apply(range.valueAsNumber))
    num.addEventListener('change', () => apply(num.valueAsNumber))
    ctl.append(range, num)
    row.append(label, ctl)
    root.appendChild(row)
    rows.push({ key, range, num, dot })
  }

  const derived = el('div', 'margin:8px 0;opacity:0.75')
  const status = el('div', 'min-height:1.4em;margin-top:6px;opacity:0.85')
  const actions = el('div', 'display:flex;gap:6px;flex-wrap:wrap')
  actions.append(
    button('Save', async () => {
      status.textContent = 'saving…'
      try {
        await saveTuning(set, saveUrl)
        status.textContent = savedText(set.id)
      } catch (e) {
        status.textContent = `save failed (dev server only): ${(e as Error).message}`
      }
      refresh()
    }),
    button('Revert', () => {
      Object.assign(values, saved)
      refresh()
    }),
    button('Defaults', () => {
      for (const [k, f] of Object.entries(set.spec)) values[k] = f.default
      refresh()
    }),
    button('Copy', async () => {
      await navigator.clipboard?.writeText(`${JSON.stringify(values, null, 2)}\n`)
      status.textContent = 'copied JSON'
    }),
  )
  root.append(derived, actions, status)
  document.body.appendChild(root)

  function refresh(): void {
    for (const r of rows) {
      const v = values[r.key] ?? 0
      r.range.value = String(v)
      if (document.activeElement !== r.num) r.num.value = String(round(v))
      r.dot.textContent = Math.abs(v - (saved[r.key] ?? v)) > 1e-9 ? '●' : ''
    }
    derived.textContent = set.describe ? set.describe(set.values) : ''
  }

  // Picks up outside changes (a hand-edited file arriving by hot reload) while open.
  const poll = window.setInterval(refresh, 500)
  refresh()

  let open = true
  function close(): void {
    if (!open) return
    open = false
    window.clearInterval(poll)
    root.remove()
    onClose()
  }

  return { isOpen: () => open, close }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, css: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  e.style.cssText = css
  return e
}

function input(
  type: 'range' | 'number',
  f: { min: number; max: number; step: number },
  css: string,
): HTMLInputElement {
  const i = el('input', css)
  i.type = type
  i.min = String(f.min)
  i.max = String(f.max)
  i.step = String(f.step)
  return i
}

function button(text: string, onClick: () => void | Promise<void>): HTMLButtonElement {
  const b = el(
    'button',
    'background:#2e4a6e;color:#eef4fa;border:0;border-radius:5px;padding:4px 10px;font:inherit;cursor:pointer',
  )
  b.textContent = text
  b.addEventListener('click', () => {
    b.blur()
    void onClick()
  })
  return b
}

const round = (v: number) => Math.round(v * 10000) / 10000
