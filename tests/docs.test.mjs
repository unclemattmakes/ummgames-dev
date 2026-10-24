/**
 * The docs drift from the code unless something checks them. This checks the mechanical part:
 * links resolve, every command's --help runs and names its docs page, and every config section
 * a game can set has a Config table. Accuracy of the prose is the reviewer's job
 * (docs/maintaining.md, "Writing docs").
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { listCommands } from '../bin/umm-dev.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BIN = path.join(ROOT, 'bin/umm-dev.mjs')
const docs = fs
  .readdirSync(path.join(ROOT, 'docs'))
  .filter((f) => f.endsWith('.md'))
  .map((f) => path.join('docs', f))
const pages = ['README.md', 'CLAUDE.md', 'CHANGELOG.md', ...docs]
const read = (/** @type {string} */ f) => fs.readFileSync(path.join(ROOT, f), 'utf8')

/** Markdown headings as GitHub anchors. */
function anchors(/** @type {string} */ text) {
  const out = new Set()
  let fenced = false
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('```')) fenced = !fenced
    const m = fenced ? null : /^#{1,6}\s+(.*)$/.exec(line)
    if (m?.[1]) {
      out.add(
        m[1]
          .trim()
          .toLowerCase()
          .replace(/[^\w\- ]/g, '')
          .replace(/ /g, '-'),
      )
    }
  }
  return out
}

describe('docs', () => {
  it('every relative link and anchor resolves', () => {
    const broken = []
    for (const page of pages) {
      const text = read(page).replace(/```[\s\S]*?```/g, '')
      for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
        if (!target || /^[a-z]+:/i.test(target)) continue
        const [file, anchor] = target.split('#')
        const resolved = file ? path.join(path.dirname(page), file) : page
        if (!fs.existsSync(path.join(ROOT, resolved))) {
          broken.push(`${page}: ${target}`)
          continue
        }
        if (anchor && resolved.endsWith('.md') && !anchors(read(resolved)).has(anchor))
          broken.push(`${page}: ${target} (no such heading)`)
      }
    }
    expect(broken).toEqual([])
  })

  it('links in shipped docs point only at shipped files, so they work inside node_modules', () => {
    const pkg = JSON.parse(read('package.json'))
    const shipped = new Set([...pkg.files, 'package.json'])
    const broken = []
    for (const page of ['README.md', 'CHANGELOG.md', ...docs]) {
      const text = read(page).replace(/```[\s\S]*?```/g, '')
      for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
        if (!target || /^[a-z]+:/i.test(target) || target.startsWith('#')) continue
        const from = path.posix.dirname(page.split(path.sep).join('/'))
        const file = path.posix.normalize(path.posix.join(from, target.split('#')[0] ?? ''))
        if (!shipped.has(file.split('/')[0] ?? '')) broken.push(`${page}: ${target}`)
      }
    }
    expect(broken).toEqual([])
  })

  it('every command has --help that runs, and a docs page that names it', () => {
    for (const name of listCommands()) {
      const out = execFileSync(process.execPath, [BIN, name, '--help'], { encoding: 'utf8' })
      expect(out, name).toMatch(/usage: umm-dev/)
      const page = docs.find((d) => read(d).includes(`umm-dev ${name}`))
      expect(page, `no docs page mentions "umm-dev ${name}"`).toBeTruthy()
    }
  })

  it('every config section a game can set has a Config table in docs/', () => {
    const types = read('src/index.d.ts')
    const block = /export interface UmmDevConfig \{([\s\S]*?)\n\}/.exec(types)?.[1] ?? ''
    const sections = [...block.matchAll(/^\s+(\w+)\?:/gm)].map((m) => m[1])
    expect(sections.length).toBeGreaterThan(0)
    const all = docs.map(read).join('\n')
    for (const s of sections) expect(all, s).toContain(`## Config: \`${s}\``)
  })
})
