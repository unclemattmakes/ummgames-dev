// @ts-check
/**
 * Loads making-of pages in a real browser, scrolls to each toy, shoots it, and reports what a
 * page needs to be right: every toy drew something, nothing logged an error, and nothing sticks
 * out past the screen's edge. See docs/making-of.md.
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { launchChromium, MediaError } from '../media/util.mjs'

/** A stage with fewer distinct colours than this drew nothing: a flat fill, or nearly. */
export const MIN_COLOURS = 4

/** How long a toy's slot may wait for the host to build its stage before it counts as unmounted. */
const STAGE_TIMEOUT_MS = 10_000

export const VIEWPORTS = {
  desktop: { width: 1280, height: 800, scale: 1 },
  phone: { width: 375, height: 812, scale: 2 },
}

/** @typedef {import('./shot.d.mts').ToyShot} ToyShot */
/** @typedef {import('./shot.d.mts').PageShot} PageShot */
/** @typedef {import('./shot.d.mts').ShotOptions} ShotOptions */

/**
 * What is wrong with a page's shots, one line each. `[]` is a clean page.
 * @param {PageShot} page
 * @returns {string[]}
 */
export function problemsIn(page) {
  const out = []
  for (const t of page.toys) {
    if (t.unmounted) out.push(`${t.id}: never mounted`)
    else if (t.colours < MIN_COLOURS) out.push(`${t.id}: drew nothing (${t.colours} colours)`)
  }
  for (const e of page.errors) out.push(`console: ${e}`)
  for (const w of page.overflow) out.push(`past the edge: ${w}`)
  return out
}

/**
 * Distinct colours in a PNG, at 5 bits a channel, counted on a blank page's canvas. The stage is
 * read from a screenshot because a WebGL canvas reads back empty once it has presented.
 * @param {import('playwright').Page} probe
 * @param {Buffer} png
 */
const coloursIn = (probe, png) =>
  probe.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return 0
    ctx.drawImage(bitmap, 0, 0)
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
    const seen = new Set()
    for (let i = 0; i < data.length; i += 4) {
      const r = (data[i] ?? 0) >> 3
      const g = (data[i + 1] ?? 0) >> 3
      const b = (data[i + 2] ?? 0) >> 3
      seen.add(r | (g << 5) | (b << 10))
    }
    return seen.size
  }, png.toString('base64'))

/**
 * Element by element: `body { overflow-x: hidden }` hides page overflow from `scrollWidth`. An
 * element inside something that scrolls or clips is its container's business.
 * @param {import('playwright').Page} page
 * @returns {Promise<string[]>}
 */
const pastTheEdge = (page) =>
  page.evaluate(() => {
    const edge = document.documentElement.clientWidth + 1
    /** @param {Element | null} el */
    const contained = (el) => {
      for (let at = el?.parentElement; at && at !== document.body; at = at.parentElement) {
        const x = getComputedStyle(at).overflowX
        if (x !== 'visible') return true
      }
      return false
    }
    /** @type {string[]} */
    const wide = []
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.right <= edge || contained(el)) continue
      wide.push(`${el.tagName.toLowerCase()}.${el.className} (${Math.round(r.right)}px)`)
      if (wide.length === 5) break
    }
    return wide
  })

/**
 * Shoot every toy on each page.
 * @param {readonly string[]} urls
 * @param {ShotOptions} [options]
 * @returns {Promise<PageShot[]>}
 */
export async function shootPages(urls, options = {}) {
  const { out = 'test-results/making-of', phone = false, wait = 2500, log = console.log } = options
  /** @type {typeof import('playwright')} */
  let pw
  try {
    pw = await import('playwright')
  } catch {
    throw new MediaError('shots drive Chromium through Playwright: add playwright to the game')
  }
  mkdirSync(out, { recursive: true })
  const view = phone ? VIEWPORTS.phone : VIEWPORTS.desktop
  const browser = await launchChromium(
    pw,
    {
      headless: true,
      args: ['--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
    },
    log,
  )
  /** @type {PageShot[]} */
  const shots = []
  try {
    const probe = await browser.newPage()
    for (const url of urls) {
      const page = await browser.newPage({
        viewport: { width: view.width, height: view.height },
        deviceScaleFactor: view.scale,
      })
      /** @type {string[]} */
      const errors = []
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text().slice(0, 400))
      })
      page.on('pageerror', (e) => errors.push(String(e).slice(0, 400)))
      await page.goto(url, { waitUntil: 'load' })
      const slug = new URL(url).pathname.split('/').filter(Boolean).join('-') || 'index'
      /** @type {import('./shot.d.mts').ToyShot[]} */
      const toys = []
      const found = page.locator('[data-toy]')
      const count = await found.count()
      for (let i = 0; i < count; i++) {
        const toy = found.nth(i)
        const id = (await toy.getAttribute('data-toy')) ?? `toy-${i}`
        const stage = toy.locator('.demo-stage')
        // `load` can fire while the page's script is still importing its toys.
        await stage.waitFor({ state: 'attached', timeout: STAGE_TIMEOUT_MS }).catch(() => {})
        const staged = (await stage.count()) > 0
        // Centre the stage, not the toy, and read it before anything else moves the page. A toy
        // taller than the screen leaves its stage off the top, and a capture that has to scroll
        // back to it can wake the toy above: that toy's controls push the page down mid-capture,
        // and the shot comes back as flat page background.
        await (staged ? stage : toy).evaluate((el) => {
          el.scrollIntoView({ block: 'center', behavior: 'instant' })
        })
        await page.waitForTimeout(wait)
        const unmounted = !staged || (await stage.locator('.poster').count()) > 0
        const colours = staged ? await coloursIn(probe, await stage.screenshot()) : 0
        const file = path.join(out, `${slug}--${id}${phone ? '-phone' : ''}.png`)
        await toy.screenshot({ path: file })
        const readouts = await toy
          .locator('.demo-readouts')
          .innerText({ timeout: 500 })
          .catch(() => '')
        toys.push({ id, file, colours, unmounted, readouts: readouts.replaceAll('\n', ' ') })
      }
      const overflow = await pastTheEdge(page)
      await page.close()
      const shot = { url, toys, errors, overflow }
      shots.push(shot)
      const problems = problemsIn(shot)
      log(`${url}: ${toys.length} toys, ${problems.length ? 'PROBLEMS' : 'clean'}`)
      for (const t of toys) log(`  ${t.id}: ${t.colours} colours  ${t.readouts}`)
      for (const p of problems) log(`  ! ${p}`)
    }
  } finally {
    await browser.close()
  }
  return shots
}
