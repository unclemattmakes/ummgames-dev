/**
 * The real runtime/ folder (CLAUDE.md rule 4): every file can be copied, imports nothing outside
 * its own subfolder, and carries no provenance header of its own. And the commands, end to end.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { commentStyleFor } from '../../src/runtime/header.mjs'
import { listRuntime, PACKAGE_ROOT } from '../../src/runtime/source.mjs'
import { cleanup, makeGame, read } from './fixture.mjs'

afterAll(cleanup)

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const BIN = path.join(ROOT, 'bin/umm-dev.mjs')
const files = listRuntime()

/** @param {string} cwd @param {string[]} args */
function umm(cwd, ...args) {
  try {
    return {
      code: 0,
      out: execFileSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' }),
    }
  } catch (e) {
    const err = /** @type {{ status: number, stdout: string, stderr: string }} */ (e)
    return { code: err.status, out: `${err.stdout}${err.stderr}` }
  }
}

describe('runtime/', () => {
  it('is this package’s own', () => {
    expect(PACKAGE_ROOT).toBe(ROOT)
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files)('%s can carry a header and has none yet', (f) => {
    expect(commentStyleFor(f), 'a file type copy can stamp').not.toBeNull()
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8')
    expect(text).not.toMatch(/^.*(Copied|Forked) from/)
  })

  it.each(files.filter((f) => /\.[cm]?[jt]sx?$/.test(f)))(
    '%s imports nothing outside its own folder',
    (f) => {
      const text = fs.readFileSync(path.join(ROOT, f), 'utf8')
      const top = f.split('/')[1]
      const specs = [
        ...text.matchAll(/\b(?:import|export)\b[^'";]*?\sfrom\s*['"]([^'"]+)['"]/g),
        ...text.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm),
        ...text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
      ].map((m) => /** @type {string} */ (m[1]))
      for (const s of specs) {
        expect(s.startsWith('.'), `${s}: bare imports do not travel with a copy`).toBe(true)
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(f), s))
        expect(target.split('/')[1], `${s} leaves runtime/${top}/`).toBe(top)
      }
    },
  )
})

describe('umm-dev copy and drift', () => {
  it('copies a runtime folder into a game, then reports it current, then a change', () => {
    const game = makeGame()
    const copied = umm(game, 'copy', 'dev')
    expect(copied.code).toBe(0)
    expect(copied.out).toMatch(/written +src\/dev\/fuzzy\.ts/)
    expect(read(game, 'src/dev/fuzzy.ts')).toMatch(/^\/\/ Copied from ummgames-dev v\d/)

    let report = JSON.parse(umm(game, 'drift', '--json').out)
    expect(report.copies.length).toBe(files.filter((f) => f.startsWith('runtime/dev/')).length)
    expect(
      report.copies.every((/** @type {{ status: string }} */ c) => c.status === 'current'),
    ).toBe(true)

    fs.appendFileSync(path.join(game, 'src/dev/fuzzy.ts'), '// tuned here\n')
    report = JSON.parse(umm(game, 'drift', '--json').out)
    const fuzzy = report.copies.find(
      (/** @type {{ file: string }} */ c) => c.file === 'src/dev/fuzzy.ts',
    )
    expect(fuzzy.status).toBe('changed-here')

    const text = umm(game, 'drift', '--diff')
    expect(text.code).toBe(0)
    expect(text.out).toMatch(/src\/dev\/fuzzy\.ts +v\S+ +changed here/)
    expect(text.out).toContain('+// tuned here')
    expect(umm(game, 'drift', '--strict').code).toBe(1)

    const again = umm(game, 'copy', 'dev/fuzzy.ts')
    expect(again.code).toBe(1)
    expect(again.out).toMatch(/refused +src\/dev\/fuzzy\.ts: changed here/)
    expect(umm(game, 'copy', 'dev/fuzzy.ts', '--force').code).toBe(0)
    expect(umm(game, 'drift', '--strict').code).toBe(0)
  })

  it('lists what it can copy, and exits 2 on usage errors', () => {
    const game = makeGame()
    const list = umm(game, 'copy', '--list')
    expect(list.code).toBe(0)
    expect(list.out).toContain('input/pad-profiles.ts')
    expect(umm(game, 'copy').code).toBe(2)
    expect(umm(game, 'copy', 'no/such.ts').code).toBe(2)
    expect(umm(game, 'drift', '--bogus').code).toBe(2)
    expect(umm(game, 'drift').out).toMatch(/no runtime copies/)
  })

  it('reads runtime.into from the game’s config', () => {
    const game = makeGame()
    fs.writeFileSync(
      path.join(game, 'umm-dev.config.mjs'),
      "export default { runtime: { into: 'app/shared' } }\n",
    )
    expect(umm(game, 'copy', 'input/pad-profiles.ts').code).toBe(0)
    expect(fs.existsSync(path.join(game, 'app/shared/input/pad-profiles.ts'))).toBe(true)
  })
})
