// @ts-check
/** The shot tool against real pages in a real browser: it must see a blank toy and an error. */
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { problemsIn, shootPages } from '../../src/making-of/shot.mjs'

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'umm-shot-'))

const page = (/** @type {string} */ body) =>
  `<!doctype html><body style="margin:0;background:#111;overflow-x:hidden">${body}</body>`
const stage = (/** @type {string} */ id, /** @type {string} */ inner) =>
  `<div data-toy="${id}"><div class="demo-stage" style="width:320px;height:180px">${inner}</div><div class="demo-readouts">speed 40</div></div>`
const DRAWN = `<canvas id="c" width="320" height="180"></canvas><script>
  const g = document.getElementById('c').getContext('2d')
  for (let x = 0; x < 320; x += 4) { g.fillStyle = 'hsl(' + x + ',80%,50%)'; g.fillRect(x, 0, 4, 180) }
</script>`

/** @type {Record<string, string>} */
const PAGES = {
  '/good/': page(stage('drawn', DRAWN)),
  '/blank/': page(stage('blank', '<canvas width="320" height="180"></canvas>')),
  '/poster/': page(stage('waiting', '<div class="poster">Title</div>')),
  '/error/': page(`${stage('drawn', DRAWN)}<script>console.error('toy failed')</script>`),
  '/wide/': page(`${stage('drawn', DRAWN)}<div style="width:2000px;height:2px"></div>`),
  '/clipped/': page(
    `${stage('drawn', DRAWN)}<div style="overflow:auto"><div style="width:2000px;height:2px"></div></div>`,
  ),
}

/** @type {http.Server} */
let server
let origin = ''

beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(PAGES[req.url ?? ''] ?? page(''))
  })
  await new Promise((done) => {
    server.listen(0, '127.0.0.1', () => done(null))
  })
  const address = /** @type {import('node:net').AddressInfo} */ (server.address())
  origin = `http://127.0.0.1:${address.port}`
})

afterAll(() => {
  server.close()
  fs.rmSync(out, { recursive: true, force: true })
})

/** @param {string} pathname @param {boolean} [phone] */
const shoot = async (pathname, phone = false) => {
  const [shot] = await shootPages([`${origin}${pathname}`], {
    out,
    phone,
    wait: 50,
    log: () => {},
  })
  if (!shot) throw new Error('no shot')
  return shot
}

describe('shootPages', () => {
  it('passes a toy that drew, keeps its shot and reads its readouts', async () => {
    const shot = await shoot('/good/')
    expect(problemsIn(shot)).toEqual([])
    const toy = shot.toys[0]
    expect(toy?.colours).toBeGreaterThan(20)
    expect(toy?.readouts).toBe('speed 40')
    expect(fs.existsSync(toy?.file ?? '')).toBe(true)
  })

  it('sees a blank stage, and a stage still on its poster', async () => {
    expect(problemsIn(await shoot('/blank/')).join()).toMatch(/blank: drew nothing/)
    expect(problemsIn(await shoot('/poster/'))).toEqual(['waiting: never mounted'])
  })

  it('sees a console error', async () => {
    expect(problemsIn(await shoot('/error/'))).toEqual(['console: toy failed'])
  })

  it('sees an element past the edge that body overflow hides, but not one in a scroller', async () => {
    expect(problemsIn(await shoot('/wide/', true)).join()).toMatch(/past the edge: div/)
    expect(problemsIn(await shoot('/clipped/', true))).toEqual([])
  })
})
