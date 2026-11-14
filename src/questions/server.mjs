// @ts-check
/**
 * The answering page: a small HTTP server on 127.0.0.1 that reads the questions files on every
 * request and writes each answer to the answers file beside its question, as it is given.
 *
 * Nothing is cached, so a question an agent adds while the page is open shows on the next
 * refresh, and every answer is on disk the moment it is given. The server answers only requests
 * addressed to localhost from its own page: a Host check stops DNS rebinding, and a write must be
 * a JSON POST from the page's own origin.
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PERMISSIONS_POLICY } from '../vite/headers.mjs'
import { addEntry, parseQuestions, removeEntry, stamp } from './parse.mjs'
import { filesIn, reposUnder, scan } from './scan.mjs'

const PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'page')
export const APP_ID = 'umm-dev questions'
const ASSETS = /** @type {const} */ ({
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
  '/icon.svg': ['icon.svg', 'image/svg+xml'],
})
/** Files the page may open from a repo, as plain text. */
const READABLE = /\.(md|txt|json|jsonc|ya?ml|toml|csv|log)$/i
const CHOICES = new Set(['yes', 'no', 'drop', 'reply'])

/** The kit's security headers, without HSTS (this is plain http on loopback), with a full CSP. */
export const HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Permissions-Policy': PERMISSIONS_POLICY,
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store',
}

/**
 * @typedef {object} ServeOptions
 * @property {string[]} roots folders to read: a repo, or a folder of repos
 * @property {number} port 0 picks a free one
 * @property {string} [host] default 127.0.0.1
 * @property {number} [idleMinutes] stop after this long with no request from a page; 0 never
 * @property {() => Date} [now] test hook
 */

/**
 * Find a question by its key, read fresh from its file, so an answer always matches the words on
 * disk now.
 * @param {string[]} roots
 * @param {string} key `<project>/<rel>#<id>`
 */
export function findQuestion(roots, key) {
  const hash = key.lastIndexOf('#')
  if (hash < 0) return null
  const where = key.slice(0, hash)
  const id = key.slice(hash + 1)
  for (const repo of reposUnder(roots)) {
    for (const f of filesIn(repo)) {
      if (`${f.project}/${f.rel}` !== where) continue
      const q = parseQuestions(fs.readFileSync(f.file, 'utf8')).find((x) => x.id === id)
      if (q) return { q, file: f }
    }
  }
  return null
}

/**
 * Start the server. Resolves once it is listening.
 * @param {ServeOptions} opts
 * @returns {Promise<{ server: http.Server, url: string, close: () => Promise<void> }>}
 */
export function serve(opts) {
  const roots = opts.roots.map((r) => path.resolve(r))
  const host = opts.host ?? '127.0.0.1'
  const now = opts.now ?? (() => new Date())
  let lastSeen = Date.now()
  /** @type {NodeJS.Timeout | undefined} */
  let idle

  /**
   * @param {http.ServerResponse} res
   * @param {number} status
   * @param {string | Buffer} body
   * @param {string} type
   */
  const send = (res, status, body, type) => {
    res.writeHead(status, { ...HEADERS, 'Content-Type': type })
    res.end(body)
  }
  /** @param {http.ServerResponse} res @param {number} status @param {unknown} data */
  const json = (res, status, data) =>
    send(res, status, JSON.stringify(data), 'application/json; charset=utf-8')

  /** @param {http.IncomingMessage} req */
  const readJson = (req) =>
    new Promise((resolve, reject) => {
      let size = 0
      /** @type {Buffer[]} */
      const chunks = []
      req.on('data', (/** @type {Buffer} */ c) => {
        size += c.length
        if (size > 64 * 1024) {
          reject(new Error('too large'))
          req.destroy()
        } else chunks.push(c)
      })
      req.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } catch (e) {
          reject(e)
        }
      })
      req.on('error', reject)
    })

  const server = http.createServer(async (req, res) => {
    const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port
    const okHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`])
    if (!okHosts.has(req.headers.host ?? '')) return send(res, 421, 'wrong host', 'text/plain')
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    lastSeen = Date.now()

    if (req.method === 'GET') {
      const asset = ASSETS[/** @type {keyof typeof ASSETS} */ (url.pathname)]
      if (asset) return send(res, 200, fs.readFileSync(path.join(PAGE, asset[0])), asset[1])
      if (url.pathname === '/api/ping') return json(res, 200, { app: APP_ID })
      if (url.pathname === '/api/questions') {
        const s = scan(roots)
        return json(res, 200, { ...s, roots: roots.map((r) => path.basename(r)) })
      }
      if (url.pathname === '/doc') {
        // A file a question links to: ?project=<name>&rel=<questions file>&link=<its link>.
        const project = url.searchParams.get('project') ?? ''
        const rel = url.searchParams.get('rel') ?? ''
        const link = (url.searchParams.get('link') ?? '').split('#')[0] ?? ''
        const repo = reposUnder(roots).find((r) => path.basename(r) === project)
        if (!repo || !link) return send(res, 404, 'not found', 'text/plain')
        const fromDir = path.dirname(path.join(repo, rel))
        const candidates = [path.resolve(fromDir, link), path.resolve(repo, link)]
        const file = candidates.find((c) => {
          const inside = path.relative(repo, c)
          return (
            !inside.startsWith('..') &&
            !path.isAbsolute(inside) &&
            !inside.split(path.sep).includes('.git') &&
            READABLE.test(c) &&
            fs.existsSync(c) &&
            fs.statSync(c).isFile()
          )
        })
        if (!file) return send(res, 404, `no readable file at ${link}`, 'text/plain; charset=utf-8')
        return send(res, 200, fs.readFileSync(file), 'text/plain; charset=utf-8')
      }
      return send(res, 404, 'not found', 'text/plain')
    }

    if (req.method === 'POST') {
      const origin = req.headers.origin
      if (origin && !okHosts.has(origin.replace(/^http:\/\//, '')))
        return json(res, 403, { error: 'wrong origin' })
      if (!(req.headers['content-type'] ?? '').startsWith('application/json'))
        return json(res, 415, { error: 'json only' })
      /** @type {any} */
      let body
      try {
        body = await readJson(req)
      } catch {
        return json(res, 400, { error: 'bad json' })
      }
      const key = typeof body?.key === 'string' ? body.key : ''
      const found = findQuestion(roots, key)

      if (url.pathname === '/api/answer') {
        const choice = String(body?.choice ?? '')
        const note = typeof body?.note === 'string' ? body.note.slice(0, 8000) : ''
        if (!CHOICES.has(choice)) return json(res, 400, { error: 'bad choice' })
        if (choice === 'reply' && !note.trim())
          return json(res, 400, { error: 'a reply needs words' })
        if (!found) return json(res, 409, { error: 'that question has changed or gone' })
        const prev = fs.existsSync(found.file.answers)
          ? fs.readFileSync(found.file.answers, 'utf8')
          : null
        const a = {
          id: found.q.id,
          choice: /** @type {import('./parse.mjs').Choice} */ (choice),
          note,
          at: stamp(now()),
        }
        fs.writeFileSync(found.file.answers, addEntry(prev, found.q, a))
        return json(res, 200, {
          ok: true,
          answers: path.relative(found.file.repo, found.file.answers),
        })
      }

      if (url.pathname === '/api/undo') {
        const hash = key.lastIndexOf('#')
        const id = key.slice(hash + 1)
        const where = key.slice(0, hash)
        const f = reposUnder(roots)
          .flatMap(filesIn)
          .find((x) => `${x.project}/${x.rel}` === where)
        if (!f || !/^[0-9a-f]{6,40}$/.test(id) || !fs.existsSync(f.answers))
          return json(res, 404, { error: 'nothing to undo' })
        const before = fs.readFileSync(f.answers, 'utf8')
        const after = removeEntry(before, id)
        if (after === before) return json(res, 404, { error: 'nothing to undo' })
        if (after) fs.writeFileSync(f.answers, after)
        else fs.rmSync(f.answers)
        return json(res, 200, { ok: true })
      }
      return json(res, 404, { error: 'not found' })
    }
    return send(res, 405, 'method not allowed', 'text/plain')
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port, host, () => {
      server.off('error', reject)
      const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port
      const close = () =>
        new Promise((/** @type {(v?: void) => void} */ done) => {
          if (idle) clearInterval(idle)
          server.close(() => done())
          server.closeAllConnections()
        })
      if (opts.idleMinutes && opts.idleMinutes > 0) {
        const limit = opts.idleMinutes * 60_000
        idle = setInterval(() => {
          if (Date.now() - lastSeen > limit) void close()
        }, 10_000)
        idle.unref()
      }
      resolve({ server, url: `http://localhost:${port}/`, close })
    })
  })
}
