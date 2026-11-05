// The little controls under a toy's stage: a slider, a toggle, a segmented choice, buttons, a
// drop-down, tabs, a search box and a readout row, styled by `.demo-controls` and `.demo-readouts`
// in site.css. No framework.

export interface Controls {
  slider(opts: {
    label: string
    min: number
    max: number
    step: number
    value: number
    format?: (v: number) => string
    onInput: (v: number) => void
  }): { set(v: number): void }
  toggle(opts: { label: string; value: boolean; onChange: (v: boolean) => void }): {
    set(v: boolean): void
  }
  segmented<T extends string>(opts: {
    options: readonly { value: T; label: string }[]
    value: T
    onChange: (v: T) => void
  }): { set(v: T | null): void }
  button(label: string, onClick: () => void): void
  /** A wrapping block of small buttons, which stay side by side on a phone. The last pressed stays lit. */
  buttons<T extends string>(opts: {
    options: readonly { value: T; label: string }[]
    value: T
    onClick: (v: T) => void
  }): void
  /** A drop-down, for a choice too long for `segmented` on a phone. */
  select<T extends string>(opts: {
    label: string
    options: readonly { value: T; label: string }[]
    value: T
    onChange: (v: T) => void
  }): { set(v: T): void }
  /**
   * Tabs: a segmented row and one pane of controls per option, one shown at a
   * time, so a toy with many sliders stays on a phone's screen with its stage.
   */
  tabs<T extends string>(opts: {
    options: readonly { value: T; label: string }[]
    value: T
  }): Record<T, Controls>
  search(placeholder: string, onInput: (text: string) => void, value?: string): void
  /** A row of `label: value` pairs. `update` takes the current pairs; a pair may carry a class. */
  readouts(): {
    update(rows: readonly { label: string; value: string; tone?: 'good' | 'bad' }[]): void
  }
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag)
  if (className) e.className = className
  if (text !== undefined) e.textContent = text
  return e
}

export const createControls = (host: HTMLElement): Controls => {
  const row = el('div', 'demo-controls')
  host.append(row)
  // Readouts sit in their own row beneath the controls, created on first use.
  let readoutRow: HTMLElement | null = null

  return {
    slider({ label, min, max, step, value, format, onInput }) {
      const wrap = el('label')
      wrap.append(el('span', undefined, label))
      const input = el('input')
      input.type = 'range'
      input.min = String(min)
      input.max = String(max)
      input.step = String(step)
      input.value = String(value)
      const out = el('span', 'readout')
      const fmt = format ?? ((v: number) => String(v))
      out.textContent = fmt(value)
      input.addEventListener('input', () => {
        const v = Number(input.value)
        out.textContent = fmt(v)
        onInput(v)
      })
      wrap.append(input, out)
      row.append(wrap)
      return {
        set(v: number) {
          input.value = String(v)
          out.textContent = fmt(v)
        },
      }
    },
    toggle({ label, value, onChange }) {
      const wrap = el('label')
      const box = el('input')
      box.type = 'checkbox'
      box.checked = value
      box.addEventListener('change', () => onChange(box.checked))
      wrap.append(box, el('span', undefined, label))
      row.append(wrap)
      return {
        set(v: boolean) {
          box.checked = v
        },
      }
    },
    segmented({ options, value, onChange }) {
      const seg = el('span', 'seg')
      const buttons = options.map((o) => {
        const b = el('button', o.value === value ? 'on' : '', o.label)
        b.type = 'button'
        b.addEventListener('click', () => {
          for (const x of buttons) x.classList.remove('on')
          b.classList.add('on')
          onChange(o.value)
        })
        return b
      })
      seg.append(...buttons)
      row.append(seg)
      return {
        // Lights one button without firing it; null lights none.
        set(v) {
          buttons.forEach((b, i) => {
            b.classList.toggle('on', options[i]?.value === v)
          })
        },
      }
    },
    buttons<T extends string>({
      options,
      value,
      onClick,
    }: {
      options: readonly { value: T; label: string }[]
      value: T
      onClick: (v: T) => void
    }) {
      const block = el('span', 'btns')
      const all = options.map((o) => {
        const b = el('button', o.value === value ? 'on' : '', o.label)
        b.type = 'button'
        b.addEventListener('click', () => {
          for (const x of all) x.classList.remove('on')
          b.classList.add('on')
          onClick(o.value)
        })
        return b
      })
      block.append(...all)
      row.append(block)
    },
    select<T extends string>({
      label,
      options,
      value,
      onChange,
    }: {
      label: string
      options: readonly { value: T; label: string }[]
      value: T
      onChange: (v: T) => void
    }) {
      const wrap = el('label')
      wrap.append(el('span', undefined, label))
      const box = el('select')
      for (const o of options) {
        const opt = el('option', undefined, o.label)
        opt.value = o.value
        box.append(opt)
      }
      box.value = value
      box.addEventListener('change', () => onChange(box.value as T))
      wrap.append(box)
      row.append(wrap)
      return {
        set(v: T) {
          box.value = v
        },
      }
    },
    tabs<T extends string>({
      options,
      value,
    }: {
      options: readonly { value: T; label: string }[]
      value: T
    }) {
      const seg = el('span', 'seg')
      const panes = new Map<T, HTMLElement>()
      const out = {} as Record<T, Controls>
      const show = (v: T) => {
        for (const [k, pane] of panes) pane.hidden = k !== v
      }
      const buttons = options.map((o) => {
        const b = el('button', o.value === value ? 'on' : '', o.label)
        b.type = 'button'
        b.addEventListener('click', () => {
          for (const x of buttons) x.classList.remove('on')
          b.classList.add('on')
          show(o.value)
        })
        return b
      })
      seg.append(...buttons)
      row.append(seg)
      for (const o of options) {
        const pane = el('div')
        host.append(pane)
        panes.set(o.value, pane)
        out[o.value] = createControls(pane)
      }
      show(value)
      return out
    },
    search(placeholder, onInput, value = '') {
      const input = el('input', 'search')
      input.type = 'search'
      input.placeholder = placeholder
      input.value = value
      input.addEventListener('input', () => onInput(input.value))
      row.append(input)
    },
    button(label, onClick) {
      const b = el('button', undefined, label)
      b.type = 'button'
      b.addEventListener('click', onClick)
      row.append(b)
    },
    readouts() {
      if (!readoutRow) {
        readoutRow = el('div', 'demo-readouts')
        host.append(readoutRow)
      }
      const target = readoutRow
      return {
        update(rows) {
          target.replaceChildren(
            ...rows.map((r) => {
              const s = el('span')
              s.append(`${r.label} `)
              s.append(el('b', r.tone ?? '', r.value))
              return s
            }),
          )
        },
      }
    },
  }
}
