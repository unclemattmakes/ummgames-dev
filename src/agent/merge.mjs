// @ts-check
/**
 * Two resolvers for the markdown conflicts parallel sessions make, and a git merge driver that
 * runs them.
 *
 * keep-both: several sessions each append a block to the end of the same file (a changelog, a
 * findings log). Every merge after the first conflicts at the end, and both blocks belong. It
 * refuses anything but markdown: on code, keeping both sides drops the SHARED line between two
 * adjacent hunks (the `}` that closes ours and opens theirs is emitted once). It puts a blank
 * line between the sides whenever both meet on text, because a `---` straight under a paragraph
 * line is a setext heading underline, not a rule, and the previous entry's last line silently
 * becomes a heading.
 *
 * resolve-table: both sides rewrote rows of the same table, each changing a DIFFERENT subset
 * (two sessions ticking their own rows). keep-both would emit every row twice, and that looks
 * fine in a diff. This takes each row from the side that changed it relative to the merge base,
 * keyed on the row's first cell, and refuses when both changed the same row, when a side has a
 * line that is not a row, when a key repeats, or when the sides hold different keys.
 */

/** @param {string} file */
export const isMarkdown = (file) => /\.(md|markdown)$/i.test(file)

/** @param {number} n */
function markers(n = 7) {
  const m = (/** @type {string} */ c) => new RegExp(`^${c.repeat(n).replace(/[|]/g, '\\|')}`)
  return {
    open: m('<'),
    base: m('|'),
    mid: m('='),
    close: m('>'),
    any: new RegExp(`^(?:<{${n}}|\\|{${n}}|={${n}}|>{${n}})`, 'm'),
  }
}

/**
 * @typedef {{ ok: true, text: string, blocks: number, notes: string[] } | { ok: false, reason: string }} Resolved
 */

/**
 * Resolve every conflict block by keeping both sides, ours first. Keeps the file's line endings.
 * @param {string} original
 * @param {number} [markerSize]
 * @returns {Resolved}
 */
export function keepBoth(original, markerSize = 7) {
  const M = markers(markerSize)
  const eol = original.includes('\r\n') ? '\r\n' : '\n'
  const lines = original.split(/\r?\n/)
  /** @type {string[]} */
  const out = []
  /** @type {string[]} */
  let ours = []
  /** @type {string[]} */
  let theirs = []
  /** @type {'copy' | 'ours' | 'base' | 'theirs'} */
  let mode = 'copy'
  let blocks = 0
  let dropped = 0 // marker lines and diff3 base lines, which SHOULD go
  for (const line of lines) {
    if (mode === 'copy' && M.open.test(line)) {
      dropped += line.length + eol.length
      mode = 'ours'
      ours = []
      theirs = []
      blocks++
      continue
    }
    if (mode !== 'copy' && M.base.test(line)) {
      dropped += line.length + eol.length
      mode = 'base'
      continue
    }
    if (mode !== 'copy' && M.mid.test(line)) {
      dropped += line.length + eol.length
      mode = 'theirs'
      continue
    }
    if (mode !== 'copy' && M.close.test(line)) {
      dropped += line.length + eol.length
      const oursEndsOnText = ours.length > 0 && (ours[ours.length - 1] ?? '').trim() !== ''
      const theirsStartsOnText = theirs.length > 0 && (theirs[0] ?? '').trim() !== ''
      out.push(...ours, ...(oursEndsOnText && theirsStartsOnText ? [''] : []), ...theirs)
      mode = 'copy'
      continue
    }
    if (mode === 'copy') out.push(line)
    else if (mode === 'ours') ours.push(line)
    else if (mode === 'theirs') theirs.push(line)
    else dropped += line.length + eol.length
  }
  if (mode !== 'copy') return { ok: false, reason: 'unterminated conflict block' }
  if (blocks === 0) return { ok: false, reason: 'no conflict markers found' }
  const text = out.join(eol)
  if (M.any.test(text)) return { ok: false, reason: 'markers survived the resolve' }
  // Only the marker lines (and a diff3 base section) may go away.
  if (text.length + dropped < original.length - eol.length) {
    return { ok: false, reason: `result SHRANK (${original.length} -> ${text.length})` }
  }
  return { ok: true, text, blocks, notes: [`${blocks} conflict block(s), both sides kept`] }
}

/** @param {string} l */
const isRow = (l) => /^\s*\|/.test(l)
/** @param {string} l */
const rowKey = (l) => l.split('|')[1]?.trim() ?? ''

/**
 * Resolve every conflict block of table rows against the merge base's text.
 * @param {string} original
 * @param {string} baseText
 * @param {number} [markerSize]
 * @returns {Resolved}
 */
export function resolveTable(original, baseText, markerSize = 7) {
  const M = markers(markerSize)
  const eol = original.includes('\r\n') ? '\r\n' : '\n'
  const lines = original.split(/\r?\n/)
  const baseRows = new Map(
    baseText
      .split(/\r?\n/)
      .filter(isRow)
      .map((l) => [rowKey(l), l]),
  )
  /** @type {string[]} */
  const out = []
  /** @type {string[]} */
  const notes = []
  let blocks = 0
  for (let i = 0; i < lines.length; i++) {
    const line = /** @type {string} */ (lines[i])
    if (!M.open.test(line)) {
      out.push(line)
      continue
    }
    const mid = lines.findIndex((l, j) => j > i && M.mid.test(l))
    const end = lines.findIndex((l, j) => j > mid && M.close.test(l))
    if (mid < 0 || end < 0) return { ok: false, reason: 'unterminated conflict block' }
    const b3 = lines.findIndex((l, j) => j > i && j < mid && M.base.test(l))
    const r = resolveRows(
      lines.slice(i + 1, b3 >= 0 ? b3 : mid),
      lines.slice(mid + 1, end),
      baseRows,
    )
    if (!r.ok) return r
    out.push(...r.rows)
    notes.push(...r.notes)
    blocks++
    i = end
  }
  if (blocks === 0) return { ok: false, reason: 'no conflict markers found' }
  return { ok: true, text: out.join(eol), blocks, notes }
}

/**
 * @param {string[]} ours
 * @param {string[]} theirs
 * @param {Map<string, string>} base
 * @returns {{ ok: true, rows: string[], notes: string[] } | { ok: false, reason: string }}
 */
function resolveRows(ours, theirs, base) {
  /** @param {string[]} arr @param {string} side */
  const byKey = (arr, side) => {
    /** @type {Map<string, string>} */
    const map = new Map()
    for (const l of arr) {
      if (!isRow(l)) {
        if (l.trim() !== '') return `${side} has a non-table line inside the conflict: "${l}"`
        continue
      }
      if (map.has(rowKey(l))) return `${side} has two rows keyed "${rowKey(l)}"`
      map.set(rowKey(l), l)
    }
    return map
  }
  const O = byKey(ours, 'ours')
  if (typeof O === 'string') return { ok: false, reason: O }
  const T = byKey(theirs, 'theirs')
  if (typeof T === 'string') return { ok: false, reason: T }
  const order = [...O.keys()]
  if (order.length !== T.size || order.some((k) => !T.has(k))) {
    return {
      ok: false,
      reason:
        'the two sides do not hold the same row keys (a row added or removed): resolve by hand',
    }
  }
  /** @type {string[]} */
  const rows = []
  /** @type {string[]} */
  const notes = []
  for (const k of order) {
    const b = base.get(k)
    const o = /** @type {string} */ (O.get(k))
    const t = /** @type {string} */ (T.get(k))
    const oChanged = o !== b
    const tChanged = t !== b
    if (oChanged && tChanged && o !== t) {
      return { ok: false, reason: `row "${k}": BOTH sides changed it; resolve by hand` }
    }
    rows.push(oChanged ? o : tChanged ? t : o)
    notes.push(`row ${k}: took ${oChanged ? 'OURS' : tChanged ? 'THEIRS' : 'base (identical)'}`)
  }
  return { ok: true, rows, notes }
}
