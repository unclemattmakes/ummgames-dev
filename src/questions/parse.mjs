// @ts-check
/**
 * Read a questions file into items, and read and write the answers file beside it.
 *
 * A questions file is markdown that agents keep for the person who makes the calls. Each open
 * question is one list item: a question, some context, and a sentence starting "Recommend". The
 * parser accepts the shapes that grew up in practice (numbered or bulleted, a bold lead-in or
 * none, wrapped lines, task-list boxes, sections) so no file has to be rewritten to be read.
 * docs/questions.md has the format and the rules.
 */
import { createHash } from 'node:crypto'

/**
 * @typedef {object} Question
 * @property {string} id stable for as long as the question's own words stay the same
 * @property {string | null} num the item's number, if the file numbers them
 * @property {string} section the heading the item sits under, or ''
 * @property {boolean} urgent the section's heading says it comes first
 * @property {string} headline the question itself, as markdown
 * @property {string} context what comes between the question and the recommendation
 * @property {string} rec the recommendation, from "Recommend" on, or ''
 * @property {string} text the whole item, as written
 * @property {number} line 1-based line of the item's first line
 */

/** Sections whose items are not open questions. */
const CLOSED_SECTION = /\b(answered|settled|closed|done|history|archive|rules?)\b/i
/** Sections whose items come first. */
const URGENT_SECTION = /\b(urgent|first|blocking|blocker|needs you|asap)\b/i
/** An item that says it is no longer open. */
const CLOSED_ITEM =
  /^(?:\*\*[^*]{0,60}?:?\*\*:?\s*)?(?:\*\*)?(settled|superseded|answered|closed|done|withdrawn|dropped)\b/i
/** Where the recommendation starts. */
const REC = /(?:\*Rec(?:ommendation)?:|\bRec(?:ommendation)?:|\bRecommend(?:ation|ed|s)?\b)/
const ITEM = /^( ?)(?:[-*+]|(\d+)[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/

/**
 * The id of a question: a short hash of its number and headline, so editing the context or the
 * recommendation keeps it, and rewording the question itself makes it a new one.
 * @param {string | null} num
 * @param {string} headline
 */
export function questionId(num, headline) {
  const norm = headline.toLowerCase().replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim()
  return createHash('sha1')
    .update(`${num ?? ''}|${norm}`)
    .digest('hex')
    .slice(0, 10)
}

/**
 * Split an item's text into its question, context and recommendation.
 * @param {string} text the item with its marker, number and box removed, lines joined
 */
export function splitItem(text) {
  let headline = ''
  let rest = text
  const bold = /^\*\*(.+?)\*\*:?\s*/.exec(text)
  if (bold?.[1]) {
    const label = /:\s*$/.test(bold[1]) || /^\*\*[^*]+\*\*:/.test(bold[0])
    headline = bold[1].trim().replace(/:$/, '')
    rest = text.slice(bold[0].length)
    // A bold label with the question after it ("**Flight:** jet, or hover-jet?"): the question
    // is part of the headline.
    const q = questionMark(rest)
    const recAt = rest.search(REC)
    if (label && q >= 0 && q < 320 && (recAt < 0 || q < recAt)) {
      headline = `${headline}: ${rest.slice(0, q + 1).trim()}`
      rest = rest.slice(q + 1).trim()
    }
  } else {
    const q = questionMark(text)
    const recAt = text.search(REC)
    if (q > 0 && q < 320 && (recAt < 0 || q < recAt)) {
      headline = text.slice(0, q + 1).trim()
      rest = text.slice(q + 1).trim()
    } else {
      // No question mark before the recommendation: the lead-in is the text to the first colon
      // or full stop, as in "Phone: there are no touch controls yet."
      const m = /^(.{3,160}?)(?::\s|\.\s)/.exec(text)
      headline = (m?.[1] ?? text.slice(0, 160)).trim()
      rest = text.slice(m ? m[0].length : headline.length).trim()
    }
  }
  const at = rest.search(REC)
  let context = at < 0 ? rest : rest.slice(0, at)
  let rec = at < 0 ? '' : rest.slice(at)
  // "*Rec: ...*" ends its italic; drop the closing star with the opening one.
  if (rec.startsWith('*Rec')) rec = rec.slice(1).replace(/(?<!\*)\*(?!\*)/, '')
  context = context.trim()
  // The page labels it, so a bare "Rec:" or "Recommendation:" prefix goes.
  rec = rec.replace(/^Rec(?:ommendation)?:\s*/, '').trim()
  return { headline, context, rec }
}

/**
 * Where the first question mark that ends a question is: not in a code span or a link, and
 * followed by a space, the end or closing punctuation (so `?debug=1` is not one). -1 when none.
 * @param {string} text
 */
export function questionMark(text) {
  let code = false
  let link = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '`') code = !code
    else if (code) continue
    else if (c === '(' && text[i - 1] === ']') link++
    else if (c === ')' && link > 0) link--
    else if (c === '?' && link === 0 && /^(?:$|[\s)*_"'\u201d\]])/.test(text.slice(i + 1, i + 2)))
      return i
  }
  return -1
}

/**
 * Parse a questions file.
 * @param {string} md
 * @returns {Question[]}
 */
export function parseQuestions(md) {
  const lines = md.split(/\r?\n/)
  /** @type {Question[]} */
  const out = []
  let section = ''
  let closedSection = false
  let fenced = false
  /** @type {{ num: string | null, box: string | undefined, parts: string[], line: number } | null} */
  let cur = null
  let blank = false
  /** The open table's columns: question, recommendation, number (-1 when absent). */
  /** @type {{ q: number, rec: number, num: number } | null} */
  let table = null

  const flush = () => {
    if (!cur) return
    const item = cur
    cur = null
    if (closedSection || (item.box && item.box !== ' ')) return
    const text = item.parts.join(' ').replace(/\s+/g, ' ').trim()
    if (!text || CLOSED_ITEM.test(text)) return
    if (!text.includes('?') && !REC.test(text)) return
    const { headline, context, rec } = splitItem(text)
    out.push({
      id: questionId(item.num, headline),
      num: item.num,
      section,
      urgent: URGENT_SECTION.test(section),
      headline,
      context,
      rec,
      text,
      line: item.line,
    })
  }

  for (const [i, raw] of lines.entries()) {
    if (/^\s*(```|~~~)/.test(raw)) {
      fenced = !fenced
      flush()
      continue
    }
    if (fenced) continue
    if (/^\s*\|/.test(raw)) {
      flush()
      const cells = raw
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((c) => c.trim())
      if (cells.every((c) => /^:?-+:?$/.test(c))) continue
      if (!table) {
        const qCol = cells.findIndex((c) => /question/i.test(c))
        table = {
          q: qCol,
          rec: cells.findIndex((c) => /^rec/i.test(c)),
          num: cells.findIndex((c) => /^(#|no\.?|id|n)$/i.test(c)),
        }
        continue
      }
      if (table.q < 0 || closedSection) continue
      const num = table.num >= 0 ? (cells[table.num] ?? '').replace(/\D/g, '') || null : null
      const qText = cells[table.q] ?? ''
      const recText = table.rec >= 0 ? (cells[table.rec] ?? '') : ''
      if (!qText || CLOSED_ITEM.test(qText)) continue
      const { headline, context } = splitItem(qText)
      out.push({
        id: questionId(num, headline),
        num,
        section,
        urgent: URGENT_SECTION.test(section),
        headline,
        context,
        rec: recText,
        text: recText ? `${qText} ${recText}` : qText,
        line: i + 1,
      })
      continue
    }
    table = null
    const h = HEADING.exec(raw)
    if (h) {
      flush()
      section = (h[2] ?? '').replace(/[*_`]/g, '')
      closedSection = (h[1] ?? '').length > 1 && CLOSED_SECTION.test(section)
      continue
    }
    const m = ITEM.exec(raw)
    if (m) {
      flush()
      cur = { num: m[2] ?? null, box: m[3], parts: [m[4] ?? ''], line: i + 1 }
      blank = false
      continue
    }
    if (!raw.trim()) {
      blank = true
      continue
    }
    if (cur) {
      const indented = /^\s{2,}/.test(raw)
      if (indented || !blank) {
        // A continuation line, or a nested list item, which belongs to its parent.
        cur.parts.push(raw.trim().replace(/^(?:[-*+]|\d+[.)])\s+/, ''))
        blank = false
        continue
      }
      flush()
    }
    if (/^-{3,}\s*$|^\*{3,}\s*$/.test(raw)) continue
  }
  flush()
  return out
}

// ---------------------------------------------------------------------------------------------
// Answers

/** @typedef {'yes' | 'no' | 'drop' | 'reply'} Choice */

/** What each choice records, in words an agent can quote. */
export const CHOICE_WORDS = /** @type {const} */ ({
  yes: 'Yes, go with the recommendation.',
  no: 'No.',
  drop: 'Drop this question: it is no longer needed.',
  reply: 'In my own words (below).',
})

export const ANSWERS_HEADER = `# Answers

Written by \`umm-dev questions\`. Each entry answers one open item in the questions file beside
this one, in the words given. **For agents:** fold each entry into the decision log as the
answer, in these words and dated; then remove or update the question, delete the entry here,
and commit. Delete this file when it is empty. Format: docs/questions.md in \`@ummgames/dev\`.
`

/**
 * @typedef {object} Answer
 * @property {string} id the question's id
 * @property {Choice} choice
 * @property {string} note what the person typed, or ''
 * @property {string} at local time, "YYYY-MM-DD HH:MM"
 */

const ENTRY_ID = /<!--\s*question\s+([0-9a-f]{6,40})\s+(yes|no|drop|reply)\s*-->/g

/**
 * The ids already answered in an answers file.
 * @param {string} md
 * @returns {Set<string>}
 */
export function answeredIds(md) {
  return new Set([...md.matchAll(ENTRY_ID)].map((m) => m[1] ?? ''))
}

/** @param {Date} d */
export function stamp(d) {
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * One answer as a markdown block.
 * @param {Question} q
 * @param {Answer} a
 */
export function formatEntry(q, a) {
  const label = q.num ? `question ${q.num}` : `line ${q.line}`
  const quote = (/** @type {string} */ s) =>
    s
      .trim()
      .split(/\r?\n/)
      .map((l) => `> ${l}`)
      .join('\n')
  const lines = [
    `## ${a.at}, ${label}`,
    `<!-- question ${q.id} ${a.choice} -->`,
    '',
    `**Q:** ${q.headline}`,
    '',
    `**Answer:** ${CHOICE_WORDS[a.choice]}`,
  ]
  if (a.note.trim()) lines.push('', quote(a.note))
  if (q.rec) lines.push('', `The recommendation was: ${q.rec}`)
  return `${lines.join('\n')}\n`
}

/**
 * Add an entry to an answers file's text, making the file if it is new. Keeps the file's line
 * endings.
 * @param {string | null} md the file's text, or null when there is none
 * @param {Question} q
 * @param {Answer} a
 */
export function addEntry(md, q, a) {
  const eol = md?.includes('\r\n') ? '\r\n' : '\n'
  const base = md ?? ANSWERS_HEADER
  const entry = formatEntry(q, a)
  const joined = `${base.replace(/\s*$/, '\n')}\n${entry}`
  return eol === '\n' ? joined : joined.replace(/\r?\n/g, '\r\n')
}

/**
 * Remove a question's entry from an answers file's text (undo). Returns the text unchanged when
 * the entry is not there. Returns '' when nothing but the header is left.
 * @param {string} md
 * @param {string} id
 */
export function removeEntry(md, id) {
  const eol = md.includes('\r\n') ? '\r\n' : '\n'
  const parts = md.split(/\r?\n(?=## )/)
  const kept = parts.filter((p) => !new RegExp(`<!--\\s*question\\s+${id}\\b`).test(p))
  if (kept.length === parts.length) return md
  const text = `${kept.join('\n').replace(/\s*$/, '')}\n`
  if (answeredIds(text).size === 0) return ''
  return eol === '\n' ? text : text.replace(/\r?\n/g, '\r\n')
}
