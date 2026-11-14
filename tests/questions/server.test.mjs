// @ts-check
/**
 * The answering page's server and scan, on two throwaway repos and a linked worktree.
 */
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { reposUnder, scan } from '../../src/questions/scan.mjs'
import { HEADERS, serve } from '../../src/questions/server.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'umm-dev-questions-'))
/** @param {string} rel @param {string} text */
const put = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true })
  fs.writeFileSync(path.join(tmp, rel), text)
}
// Two main checkouts, and a linked worktree (its .git is a file) that must be left out.
put('alpha/.git/HEAD', 'ref: refs/heads/main\n')
put(
  'alpha/docs/QUESTIONS.md',
  '# Questions\n\n1. **Ship it?** Ready. Recommend yes. See [notes](notes.md).\n2. **Rename it?** Recommend no.\n',
)
put('alpha/docs/notes.md', 'the notes\n')
put('alpha/.env', 'SECRET=1\n')
put('beta/.git/HEAD', 'ref: refs/heads/main\n')
put('beta/questions-for-me.md', '## URGENT\n\n- Pay the bill? Recommend yes.\n')
put('alpha-wt/.git', 'gitdir: ../alpha/.git/worktrees/wt\n')
put('alpha-wt/docs/QUESTIONS.md', '- Branch copy? Recommend no.\n')

/** @type {Awaited<ReturnType<typeof serve>>} */
let app
let base = ''
beforeAll(async () => {
  app = await serve({ roots: [tmp], port: 0, now: () => new Date(2026, 0, 2, 3, 4) })
  base = app.url.replace(/\/$/, '')
})
afterAll(async () => {
  await app?.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

/** @param {string} p @param {unknown} body @param {Record<string, string>} [headers] */
const post = (p, body, headers = {}) =>
  fetch(`${base}${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })

describe('scan', () => {
  it('reads main checkouts only, urgent first', () => {
    expect(
      reposUnder([tmp])
        .map((r) => path.basename(r))
        .sort(),
    ).toEqual(['alpha', 'beta'])
    const s = scan([tmp])
    expect(s.open.map((q) => q.headline)).toEqual(['Pay the bill?', 'Ship it?', 'Rename it?'])
    expect(s.open[0]?.key).toMatch(/^beta\/questions-for-me\.md#[0-9a-f]{10}$/)
  })

  it('reads one repo when the root is the repo', () => {
    expect(scan([path.join(tmp, 'alpha')]).open).toHaveLength(2)
  })
})

describe('serve', () => {
  it('serves the page with the security headers', async () => {
    const r = await fetch(`${base}/`)
    expect(r.status).toBe(200)
    for (const [k, v] of Object.entries(HEADERS)) expect(r.headers.get(k), k).toBe(v)
    expect(await r.text()).toContain('<script src="/app.js"')
  })

  it('refuses another host name, which stops DNS rebinding', async () => {
    // fetch will not send a Host of our choosing, so this goes by hand.
    const status = await new Promise((resolve, reject) => {
      const req = http.get(
        `${base}/api/questions`,
        { headers: { Host: 'evil.example' } },
        (res) => {
          res.resume()
          resolve(res.statusCode)
        },
      )
      req.on('error', reject)
    })
    expect(status).toBe(421)
  })

  it('refuses a write from another origin, or one that is not JSON', async () => {
    const q = (await (await fetch(`${base}/api/questions`)).json()).open[1]
    expect(
      (await post('/api/answer', { key: q.key, choice: 'yes' }, { Origin: 'https://evil.example' }))
        .status,
    ).toBe(403)
    const form = await fetch(`${base}/api/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ key: q.key, choice: 'yes' }),
    })
    expect(form.status).toBe(415)
    expect(fs.existsSync(path.join(tmp, 'alpha/docs/ANSWERS.md'))).toBe(false)
  })

  it('writes an answer beside the questions file, hides it, and undo takes it back', async () => {
    const open = (await (await fetch(`${base}/api/questions`)).json()).open
    const ship = open.find((/** @type {any} */ q) => q.headline === 'Ship it?')
    const r = await post('/api/answer', { key: ship.key, choice: 'reply', note: 'Yes, Friday.' })
    expect(r.status).toBe(200)
    const file = path.join(tmp, 'alpha/docs/ANSWERS.md')
    const text = fs.readFileSync(file, 'utf8')
    expect(text).toContain('## 2026-01-02 03:04, question 1')
    expect(text).toContain('> Yes, Friday.')
    const after = (await (await fetch(`${base}/api/questions`)).json()).open
    expect(after.map((/** @type {any} */ q) => q.headline)).not.toContain('Ship it?')

    expect((await post('/api/undo', { key: ship.key })).status).toBe(200)
    expect(fs.existsSync(file)).toBe(false)
    expect((await post('/api/undo', { key: ship.key })).status).toBe(404)
  })

  it('refuses a reply with no words, a made-up key and an unknown choice', async () => {
    const q = (await (await fetch(`${base}/api/questions`)).json()).open[0]
    expect((await post('/api/answer', { key: q.key, choice: 'reply', note: ' ' })).status).toBe(400)
    expect(
      (await post('/api/answer', { key: 'alpha/docs/QUESTIONS.md#0000000000', choice: 'yes' }))
        .status,
    ).toBe(409)
    expect((await post('/api/answer', { key: q.key, choice: 'maybe' })).status).toBe(400)
  })

  it('opens a linked doc as text, and nothing outside the repo or of another kind', async () => {
    const doc = (/** @type {string} */ link) =>
      fetch(
        `${base}/doc?${new URLSearchParams({ project: 'alpha', rel: 'docs/QUESTIONS.md', link })}`,
      )
    const ok = await doc('notes.md')
    expect(ok.status).toBe(200)
    expect(await ok.text()).toBe('the notes\n')
    expect((await doc('../.env')).status).toBe(404)
    expect((await doc('../../beta/questions-for-me.md')).status).toBe(404)
    expect((await doc('../.git/HEAD')).status).toBe(404)
  })
})
