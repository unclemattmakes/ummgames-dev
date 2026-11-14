// @ts-check
/**
 * The answering page. It asks the server for the open questions, shows them one at a time or as
 * a list, and posts each answer as it is given. The server writes it to disk at once, so closing
 * the tab loses nothing.
 */

/**
 * @typedef {{ key: string, id: string, num: string | null, project: string, rel: string,
 *   section: string, urgent: boolean, headline: string, context: string, rec: string,
 *   line: number }} Q
 * @typedef {{ project: string, rel: string, open: number, answered: number,
 *   lastCommit: number }} F
 */

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id))
const button = (/** @type {string} */ id) =>
  /** @type {HTMLButtonElement} */ (document.getElementById(id))
const note = /** @type {HTMLTextAreaElement} */ ($('note'))

const state = {
  /** @type {Q[]} */ open: [],
  /** @type {F[]} */ files: [],
  /** @type {string} */ project: '',
  /** @type {'card' | 'list'} */ mode: 'card',
  /** @type {string | null} */ current: null,
  /** keys put off this sitting, in the order they were put off */
  /** @type {string[]} */ later: [],
  /** keys answered this sitting, newest last, for undo */
  /** @type {{ q: Q, choice: string }[]} */ done: [],
  /** keys seen before the current one, for back */
  /** @type {string[]} */ history: [],
}

try {
  const saved = localStorage.getItem('umm-questions-mode')
  if (saved === 'list' || saved === 'card') state.mode = saved
} catch {}

// ---------------------------------------------------------------------------------------------
// Markdown, inline only: escape everything, then code spans, bold, italic and links.

/** @param {string} s */
const esc = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/**
 * @param {string} link
 * @param {Q} q
 */
function docHref(link, q) {
  if (/^https?:\/\//i.test(link)) return link
  if (/^[a-z]+:/i.test(link) || link.startsWith('#')) return null
  const p = new URLSearchParams({ project: q.project, rel: q.rel, link })
  return `/doc?${p}`
}

/**
 * @param {string} md
 * @param {Q} q
 */
function inline(md, q) {
  /** @type {string[]} */
  const codes = []
  let s = md.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c)
    return `${codes.length - 1}`
  })
  s = esc(s)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, link) => {
    const href = docHref(link.replace(/&#38;/g, '&'), q)
    return href
      ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`
      : text
  })
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
  s = s.replace(/(\d+)/g, (_, i) => {
    const c = codes[Number(i)] ?? ''
    const html = `<code>${esc(c)}</code>`
    // A path to a doc in a code span opens it too.
    if (/^[\w./-]+\.(md|txt|json)$/i.test(c)) {
      const href = docHref(c, q)
      if (href)
        return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${html}</a>`
    }
    return html
  })
  return s
}

// ---------------------------------------------------------------------------------------------
// Data

/** Bumped by every answer and undo the page shows before the server has it. */
let changes = 0

async function load() {
  const started = changes
  const r = await fetch('/api/questions', { cache: 'no-store' })
  if (!r.ok) throw new Error(`questions: ${r.status}`)
  const data = await r.json()
  // A read that began before a local change would bring the answered card back. The read that
  // follows the change's write is the one to keep.
  if (changes !== started) return
  state.open = data.open
  state.files = data.files
  const keys = new Set(state.open.map((q) => q.key))
  state.later = state.later.filter((k) => keys.has(k))
  state.history = state.history.filter((k) => keys.has(k))
  if (state.project && !state.files.some((f) => f.project === state.project && f.open > 0))
    state.project = ''
  if (state.current && !keys.has(state.current)) state.current = null
  render()
}

/** The open questions in the chosen project, in the server's order, put-off ones last. */
function queue() {
  const shown = state.open.filter((q) => !state.project || q.project === state.project)
  const later = new Set(state.later)
  return [
    ...shown.filter((q) => !later.has(q.key)),
    ...state.later.map((k) => shown.find((q) => q.key === k)).filter((q) => !!q),
  ]
}

function currentQ() {
  const list = queue()
  const hit = list.find((q) => q.key === state.current)
  if (hit) return hit
  const first = list[0] ?? null
  state.current = first?.key ?? null
  return first
}

// ---------------------------------------------------------------------------------------------
// Render

function renderProjects() {
  /** @type {Map<string, { open: number, urgent: number, last: number }>} */
  const by = new Map()
  for (const f of state.files) {
    const e = by.get(f.project) ?? { open: 0, urgent: 0, last: 0 }
    e.open += f.open
    e.last = Math.max(e.last, f.lastCommit)
    by.set(f.project, e)
  }
  for (const q of state.open) {
    const e = by.get(q.project)
    if (q.urgent && e) e.urgent++
  }
  const nav = $('projects')
  nav.replaceChildren()
  const total = state.open.length
  const mk = (
    /** @type {string} */ name,
    /** @type {string} */ label,
    /** @type {number} */ n,
    /** @type {boolean} */ hot,
  ) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'proj'
    b.setAttribute('aria-current', String(state.project === name))
    b.innerHTML = `<span class="proj-label">${esc(label)}</span><span class="n${hot ? ' hot' : ''}">${n}</span>`
    b.addEventListener('click', () => {
      state.project = name
      state.current = null
      render()
    })
    nav.append(b)
    if (state.project === name)
      requestAnimationFrame(() => b.scrollIntoView({ block: 'nearest', inline: 'nearest' }))
  }
  mk(
    '',
    'All projects',
    total,
    state.open.some((q) => q.urgent),
  )
  for (const [name, e] of by) if (e.open > 0) mk(name, name, e.open, e.urgent > 0)
}

function renderTally() {
  const n = state.open.length
  const projects = new Set(state.open.map((q) => q.project)).size
  const done = state.done.length
  $('tally').innerHTML =
    n === 0
      ? 'All answered'
      : `<b>${n}</b> open in ${projects} project${projects === 1 ? '' : 's'}` +
        (done ? ` &middot; <b>${done}</b> answered this sitting` : '')
}

function renderCard() {
  const q = currentQ()
  const card = $('card')
  if (!q) {
    card.hidden = true
    return
  }
  card.hidden = false
  const tags = [`<span class="tag project">${esc(q.project)}</span>`]
  if (q.urgent) tags.push('<span class="tag urgent">First</span>')
  if (q.num) tags.push(`<span class="tag">Q${esc(q.num)}</span>`)
  if (q.section && !/^questions/i.test(q.section))
    tags.push(`<span class="tag">${esc(q.section)}</span>`)
  $('meta').innerHTML = tags.join('')
  $('headline').innerHTML = inline(q.headline, q)
  const ctx = $('context')
  ctx.innerHTML = inline(q.context, q)
  ctx.hidden = !q.context
  ctx.classList.add('clamped')
  requestAnimationFrame(() => {
    $('more').hidden = ctx.scrollHeight <= ctx.clientHeight + 2
  })
  const rec = $('rec')
  rec.classList.toggle('none', !q.rec)
  $('rec-text').innerHTML = q.rec ? inline(q.rec, q) : 'None given. Answer in your own words.'
  button('act-yes').disabled = !q.rec
  updateReply()
  const list = queue()
  const at = list.findIndex((x) => x.key === q.key) + 1
  const file = `${q.rel}, line ${q.line}`
  const href = docHref(q.rel.split('/').pop() ?? q.rel, q)
  $('where').innerHTML =
    `${at} of ${list.length}${state.project ? ` in ${esc(state.project)}` : ''} &middot; ` +
    (href
      ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(file)}</a>`
      : esc(file))
}

function renderList() {
  const list = queue()
  $('list-title').textContent = `${list.length} open${state.project ? ` in ${state.project}` : ''}`
  const yesAll = button('yes-all')
  const withRec = list.filter((q) => q.rec).length
  yesAll.hidden = withRec === 0
  yesAll.textContent = `Go with all ${withRec} recs shown`
  const rows = $('rows')
  rows.replaceChildren()
  for (const q of list) {
    const li = document.createElement('li')
    li.className = 'row'
    li.dataset.key = q.key
    const meta = [state.project ? '' : q.project, q.num ? `Q${q.num}` : '', q.urgent ? 'first' : '']
      .filter(Boolean)
      .join(' · ')
    li.innerHTML = `<div class="row-main">
        <div class="row-meta">${esc(meta)}</div>
        <div class="row-q">${inline(q.headline, q)}</div>
        <div class="row-rec">${q.rec ? inline(q.rec, q) : '<em>No recommendation</em>'}</div>
      </div>
      <div class="row-acts">
        <button type="button" class="act yes"${q.rec ? '' : ' disabled'}>Yes</button>
        <button type="button" class="act no">No</button>
        <button type="button" class="act quiet">Drop</button>
      </div>`
    li.querySelector('.row-main')?.addEventListener('click', (e) => {
      if (/** @type {HTMLElement} */ (e.target).closest('a')) return
      state.current = q.key
      setMode('card')
    })
    const [yes, no, drop] = li.querySelectorAll('.row-acts button')
    yes?.addEventListener('click', () => answer(q, 'yes', ''))
    no?.addEventListener('click', () => answer(q, 'no', ''))
    drop?.addEventListener('click', () => answer(q, 'drop', ''))
    rows.append(li)
  }
}

function render() {
  renderProjects()
  renderTally()
  const empty = queue().length === 0
  $('empty').hidden = !empty
  $('empty-text').textContent = state.project
    ? `Nothing left in ${state.project}.`
    : 'Every question here has an answer. New ones show up when agents add them.'
  $('card').hidden = empty || state.mode !== 'card'
  $('list').hidden = empty || state.mode !== 'list'
  $('mode-card').setAttribute('aria-selected', String(state.mode === 'card'))
  $('mode-list').setAttribute('aria-selected', String(state.mode === 'list'))
  $('keys').hidden = state.mode !== 'card'
  if (!empty && state.mode === 'card') renderCard()
  if (!empty && state.mode === 'list') renderList()
}

/** @param {'card' | 'list'} mode */
function setMode(mode) {
  state.mode = mode
  try {
    localStorage.setItem('umm-questions-mode', mode)
  } catch {}
  render()
  window.scrollTo({ top: 0 })
}

function updateReply() {
  button('act-reply').disabled = !note.value.trim()
}

// ---------------------------------------------------------------------------------------------
// Answering

/** @type {number | undefined} */
let toastTimer

/** @param {string} text @param {boolean} undo */
function toast(text, undo) {
  $('toast-text').textContent = text
  $('toast-undo').hidden = !undo
  $('toast').hidden = false
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    $('toast').hidden = true
  }, 5000)
}

/** @param {string} path @param {unknown} body */
async function post(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error ?? `${r.status}`)
  return data
}

const WORDS = { yes: 'Yes', no: 'No', drop: 'Dropped', reply: 'Replied' }

/**
 * Writes go one after another, so an undo never overtakes the answer it undoes.
 * @type {Promise<unknown>}
 */
let writes = Promise.resolve()
let pending = 0

/** @param {() => Promise<unknown>} fn */
function enqueue(fn) {
  pending++
  const next = writes.then(fn).finally(() => {
    pending--
    // Once the writes settle, read the files again for anything an agent changed meanwhile.
    if (pending === 0) void refresh()
  })
  writes = next.catch(() => {})
  return next
}

/**
 * Take a question out of the page at once and save the answer behind it, so the next card shows
 * with no wait. A failed save puts it back.
 * @param {Q} q
 * @param {'yes' | 'no' | 'drop' | 'reply'} choice
 * @param {string} text
 */
function answer(q, choice, text) {
  if (state.mode === 'card') {
    const list = queue()
    const i = list.findIndex((x) => x.key === q.key)
    state.history.push(q.key)
    state.current = list[i + 1]?.key ?? list[i - 1]?.key ?? null
    note.value = ''
  }
  state.open = state.open.filter((x) => x.key !== q.key)
  const f = state.files.find((x) => x.project === q.project && x.rel === q.rel)
  if (f) f.open--
  state.done.push({ q, choice })
  changes++
  render()
  toast(`${WORDS[choice]}: ${q.project}${q.num ? ` Q${q.num}` : ''}`, true)
  return enqueue(() => post('/api/answer', { key: q.key, choice, note: text })).catch((e) => {
    state.done = state.done.filter((d) => d.q.key !== q.key)
    state.current = q.key
    toast(`Not saved: ${/** @type {Error} */ (e).message}`, false)
  })
}

function undo() {
  const last = state.done.pop()
  if (!last) return
  state.current = last.q.key
  state.history = state.history.filter((k) => k !== last.q.key)
  if (!state.open.some((x) => x.key === last.q.key)) state.open.unshift(last.q)
  changes++
  render()
  toast(`Undone: ${last.q.project}${last.q.num ? ` Q${last.q.num}` : ''}`, false)
  void enqueue(() => post('/api/undo', { key: last.q.key })).catch((e) =>
    toast(`Could not undo: ${/** @type {Error} */ (e).message}`, false),
  )
}

function later() {
  const q = currentQ()
  if (!q) return
  const list = queue()
  const i = list.findIndex((x) => x.key === q.key)
  state.later = [...state.later.filter((k) => k !== q.key), q.key]
  state.history.push(q.key)
  state.current = list[i + 1]?.key ?? null
  note.value = ''
  render()
}

function back() {
  const prev = state.history.pop()
  if (!prev) return
  state.current = prev
  render()
}

/** @param {'yes' | 'no' | 'drop' | 'reply'} choice */
function act(choice) {
  const q = currentQ()
  if (!q) return
  if (choice === 'yes' && !q.rec) return
  const text = note.value.trim()
  if (choice === 'reply' && !text) {
    note.focus()
    return
  }
  const btn = $(`act-${choice}`)
  btn.classList.add('flash')
  setTimeout(() => btn.classList.remove('flash'), 180)
  void answer(q, choice, text)
}

// ---------------------------------------------------------------------------------------------
// Wiring

$('act-yes').addEventListener('click', () => act('yes'))
$('act-no').addEventListener('click', () => act('no'))
$('act-reply').addEventListener('click', () => act('reply'))
$('act-drop').addEventListener('click', () => act('drop'))
$('act-skip').addEventListener('click', later)
$('toast-undo').addEventListener('click', undo)
$('mode-card').addEventListener('click', () => setMode('card'))
$('mode-list').addEventListener('click', () => setMode('list'))
$('more').addEventListener('click', () => {
  $('context').classList.remove('clamped')
  $('more').hidden = true
})
note.addEventListener('input', updateReply)
note.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    act('reply')
  } else if (e.key === 'Escape') {
    note.blur()
  }
})

$('yes-all').addEventListener('click', async () => {
  const list = queue().filter((q) => q.rec)
  const dialog = /** @type {HTMLDialogElement} */ ($('confirm'))
  $('confirm-text').textContent =
    `Answer yes to ${list.length} question${list.length === 1 ? '' : 's'}${state.project ? ` in ${state.project}` : ' across every project'}, each going with its recommendation? Each is written as its own answer, and each can be undone.`
  dialog.showModal()
  const ok = await new Promise((r) =>
    dialog.addEventListener('close', () => r(dialog.returnValue === 'ok'), { once: true }),
  )
  if (!ok) return
  for (const q of list) void answer(q, 'yes', '')
  toast(`Yes to ${list.length}. U undoes them one at a time.`, false)
})

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return
  const t = /** @type {HTMLElement} */ (e.target)
  if (t.closest('textarea, input, dialog')) return
  const k = e.key.toLowerCase()
  if (k === 'l') return setMode(state.mode === 'list' ? 'card' : 'list')
  if (k === 'u') return void undo()
  if (state.mode !== 'card') return
  if (k === 'y' || k === 'g') act('yes')
  else if (k === 'n') act('no')
  else if (k === 'd') act('drop')
  else if (k === 's' || e.key === 'ArrowRight') later()
  else if (e.key === 'ArrowLeft') back()
  else if (k === '/' || (e.key === 'Enter' && t === document.body)) {
    e.preventDefault()
    note.focus()
  } else return
  e.preventDefault()
})

/** Show that the server is gone, in place of the cards. */
function stopped() {
  for (const id of ['card', 'list']) $(id).hidden = true
  $('empty').hidden = false
  $('empty').querySelector('h1')?.replaceChildren('The page has stopped')
  $('empty-text').textContent =
    'Its server is not running. Start it again with umm-dev questions; every answer given is saved.'
}

const refresh = () => load().catch(stopped)

// New questions appear when the tab comes back, and every minute while it is open. A hidden tab
// still pings, so a server started with --idle stays up while the page is open anywhere.
window.addEventListener('focus', () => void refresh())
setInterval(() => {
  if (!document.hidden && pending === 0) void refresh()
  else fetch('/api/ping', { cache: 'no-store' }).catch(() => {})
}, 60_000)

void refresh()
