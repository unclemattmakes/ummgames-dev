import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { listCommands } from '../bin/umm-dev.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BIN = path.join(ROOT, 'bin/umm-dev.mjs')

describe('umm-dev', () => {
  it('lists every command file, each with a describe and a run', async () => {
    for (const name of listCommands()) {
      const mod = await import(path.join(ROOT, 'src/commands', `${name}.mjs`))
      expect(typeof mod.describe, name).toBe('string')
      expect(typeof mod.run, name).toBe('function')
    }
  })

  it('prints help and exits 0', () => {
    const out = execFileSync(process.execPath, [BIN, 'help'], { encoding: 'utf8' })
    expect(out).toContain('usage: umm-dev')
  })

  it('exits 2 on an unknown command', () => {
    let code = 0
    try {
      execFileSync(process.execPath, [BIN, 'no-such-command'], { stdio: 'pipe' })
    } catch (e) {
      code = /** @type {{ status: number }} */ (e).status
    }
    expect(code).toBe(2)
  })

  it('documents every command in the README', () => {
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')
    for (const name of listCommands()) expect(readme, name).toContain(`umm-dev ${name}`)
  })

  it('ships every path package.json exports', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    for (const [key, target] of Object.entries(pkg.exports)) {
      const files = typeof target === 'string' ? [target] : Object.values(target)
      for (const f of files) expect(fs.existsSync(path.join(ROOT, f)), `${key} -> ${f}`).toBe(true)
    }
  })

  it('has no install-time scripts (CLAUDE.md rule 5)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    for (const s of ['prepare', 'preinstall', 'install', 'postinstall'])
      expect(pkg.scripts?.[s], s).toBeUndefined()
  })

  it('links no TypeScript (CLAUDE.md rule 3)', () => {
    /** @type {(d: string) => string[]} */
    const walk = (d) =>
      fs
        .readdirSync(d, { withFileTypes: true })
        .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]))
    for (const dir of ['bin', 'src', 'config']) {
      const ts = walk(path.join(ROOT, dir)).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
      expect(ts, dir).toEqual([])
    }
  })
})
