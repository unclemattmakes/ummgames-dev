// @ts-check
/** The shot tool against real pages in a real browser: it must see a blank toy and an error. */
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { problemsIn, shootPages, VIEWPORTS } from '../../src/making-of/shot.mjs'
import { launchChromium } from '../../src/media/util.mjs'

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'umm-shot-'))

/** How far the wandering reader moves at a time, and how long a toy gets to build, well over its 40 ms. */
const STEP = 300
const SETTLE_MS = 250

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
  // Taller than a phone, so a toy centred on screen has its stage above the top. Scrolling back up
  // to it wakes what is above, as a toy remounting does, and the page grows under the capture.
  '/tall/': page(
    `<div id="above" style="height:3000px"></div>
    <div data-toy="tall"><div class="demo-stage" style="width:320px;height:180px">${DRAWN}</div>
    <div style="height:1000px"></div></div><div style="height:3000px"></div><script>
      let was = 0
      addEventListener('scroll', () => {
        if (scrollY < was) document.getElementById('above').style.height = '3600px'
        was = scrollY
      })
    </script>`,
  ),
  // A page's script is still importing its toys when `load` fires: the slot is there, its stage is not.
  '/late/': page(
    `<div data-toy="late"></div><script>
      setTimeout(() => {
        document.querySelector('[data-toy]').innerHTML =
          '<div class="demo-stage" style="width:320px;height:180px"><canvas id="c" width="320" height="180"></canvas></div>'
        const g = document.getElementById('c').getContext('2d')
        for (let x = 0; x < 320; x += 4) { g.fillStyle = 'hsl(' + x + ',80%,50%)'; g.fillRect(x, 0, 4, 180) }
      }, 400)
    </script>`,
  ),
  '/clipped/': page(
    `${stage('drawn', DRAWN)}<div style="overflow:auto"><div style="width:2000px;height:2px"></div></div>`,
  ),
}

/** @type {http.Server} */
let server
let origin = ''
/** @type {import('vite').ViteDevServer} */
let hostPage
let hostOrigin = ''

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
  hostPage = await createServer({
    configFile: false,
    logLevel: 'silent',
    root: fileURLToPath(new URL('./host-page/', import.meta.url)),
    server: { host: '127.0.0.1', port: 0, fs: { strict: false } },
  })
  await hostPage.listen()
  const hostAddress = /** @type {import('node:net').AddressInfo} */ (hostPage.httpServer?.address())
  hostOrigin = `http://127.0.0.1:${hostAddress.port}`
})

afterAll(async () => {
  server.close()
  await hostPage.close()
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

  it('reads a stage above the screen on a page that shifts when scrolled to it', async () => {
    expect(problemsIn(await shoot('/tall/', true))).toEqual([])
  })

  it('waits for a stage the page builds after load', async () => {
    expect(problemsIn(await shoot('/late/'))).toEqual([])
  })

  it('sees a console error', async () => {
    expect(problemsIn(await shoot('/error/'))).toEqual(['console: toy failed'])
  })

  it('sees an element past the edge that body overflow hides, but not one in a scroller', async () => {
    expect(problemsIn(await shoot('/wide/', true)).join()).toMatch(/past the edge: div/)
    expect(problemsIn(await shoot('/clipped/', true))).toEqual([])
  })
})

describe('the toy host, past its cap', () => {
  // A shot passes each toy once, and the fault is in coming back: a toy evicted inside the near
  // margin has no margin to cross. So this reader goes down two steps and back one, all the way.
  it('leaves no toy on its poster on screen for a reader who scrolls back', async () => {
    const pw = await import('playwright')
    const browser = await launchChromium(pw, { headless: true }, () => {})
    try {
      const page = await browser.newPage({ viewport: VIEWPORTS.phone })
      await page.goto(`${hostOrigin}/`, { waitUntil: 'load' })
      await page.locator('[data-toy="toy-13"] .demo-stage').waitFor({ state: 'attached' })
      const max = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)
      /** @type {string[]} */
      const stuck = []
      for (let y = 0; y < max; y += STEP) {
        for (const at of [y + STEP * 2, y + STEP]) {
          await page.evaluate((top) => scrollTo({ top, behavior: 'instant' }), at)
          // Observers fire on frames, and headless Chrome can go seconds without one.
          await page.evaluate(
            () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
          )
          await page.waitForTimeout(SETTLE_MS)
          stuck.push(
            ...(await page.$$eval('[data-toy]', (toys) =>
              toys
                .filter((toy) => {
                  const r = toy.getBoundingClientRect()
                  return r.bottom > 0 && r.top < innerHeight && toy.querySelector('.poster')
                })
                .map((toy) => `${toy.getAttribute('data-toy')} at ${Math.round(scrollY)}`),
            )),
          )
        }
      }
      expect(stuck).toEqual([])
    } finally {
      await browser.close()
    }
  })
})
