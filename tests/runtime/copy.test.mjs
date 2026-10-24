import fs from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { copyRuntime, missingSiblings } from '../../src/runtime/copy.mjs'
import { bodyHash, makeHeader, parseCopy, stamp } from '../../src/runtime/header.mjs'
import { listRuntime, resolveRuntime } from '../../src/runtime/source.mjs'
import { A_TS, cleanup, makeGame, makePackage, read, STYLE_CSS, writeTree } from './fixture.mjs'

afterAll(cleanup)

describe('header', () => {
  it('stamps line 1 in each file type’s comment syntax and reads it back', () => {
    const ts = stamp({
      file: 'x.ts',
      version: 'v1.2.3',
      runtimePath: 'runtime/kit/a.ts',
      source: A_TS,
    })
    const [first, ...rest] = ts.split('\n')
    expect(first).toBe(
      `// Copied from ummgames-dev v1.2.3 runtime/kit/a.ts (sha256 ${bodyHash(A_TS)}). Owned here now; \`umm-dev drift\` compares.`,
    )
    expect(rest.join('\n')).toBe(A_TS)
    expect(parseCopy(ts)).toMatchObject({ version: 'v1.2.3', runtimePath: 'runtime/kit/a.ts' })

    const h = { version: 'v1.0.0', runtimePath: 'runtime/kit/x', hash: '0123456789abcdef' }
    expect(makeHeader({ file: 'x.css', ...h })).toMatch(/^\/\* Copied from .* compares\. \*\/$/)
    expect(makeHeader({ file: 'x.html', ...h })).toMatch(/^<!-- Copied from .* compares\. -->$/)
    expect(makeHeader({ file: 'x.sh', ...h })).toMatch(/^# Copied from /)
    expect(() => makeHeader({ file: 'x.json', ...h })).toThrow(/no comment syntax/)
  })

  it('hashes CRLF and LF bodies the same', () => {
    expect(bodyHash('a\r\nb\r\n')).toBe(bodyHash('a\nb\n'))
    expect(bodyHash('a\nb\n')).toHaveLength(16)
    const crlf = stamp({ file: 'x.ts', version: 'v1', runtimePath: 'runtime/k/a.ts', source: A_TS })
      .split('\n')
      .join('\r\n')
    const copy = /** @type {NonNullable<ReturnType<typeof parseCopy>>} */ (parseCopy(crlf))
    expect(bodyHash(copy.body)).toBe(copy.hash)
  })

  it('is not fooled by a file that merely mentions the package', () => {
    expect(parseCopy('// see ummgames-dev for the original\nexport {}\n')).toBeNull()
  })
})

describe('runtime sources', () => {
  it('lists runtime files, minus the folder’s own tooling, and resolves files and folders', () => {
    const pkg = makePackage()
    expect(listRuntime(pkg)).toEqual([
      'runtime/kit/a.ts',
      'runtime/kit/b.ts',
      'runtime/kit/data.json',
      'runtime/kit/style.css',
      'runtime/other/c.ts',
    ])
    expect(resolveRuntime('kit/a.ts', pkg)).toEqual(['runtime/kit/a.ts'])
    expect(resolveRuntime('runtime/kit/a.ts', pkg)).toEqual(['runtime/kit/a.ts'])
    expect(resolveRuntime('other/', pkg)).toEqual(['runtime/other/c.ts'])
    expect(resolveRuntime('nope.ts', pkg)).toEqual([])
  })
})

describe('copyRuntime', () => {
  it('writes into <into>/<path under runtime> by default, stamped with the version', () => {
    const pkg = makePackage('2.0.0')
    const game = makeGame()
    const r = copyRuntime({ spec: 'kit/a.ts', root: game, pkgRoot: pkg })
    expect(r).toEqual([
      { runtimePath: 'runtime/kit/a.ts', file: 'src/kit/a.ts', outcome: 'written' },
    ])
    const text = read(game, 'src/kit/a.ts')
    expect(text.split('\n')[0]).toContain('ummgames-dev v2.0.0 runtime/kit/a.ts')
    expect(text.endsWith(A_TS)).toBe(true)
  })

  it('says current when the copy already matches, and updates an untouched copy', () => {
    const pkg = makePackage()
    const game = makeGame()
    copyRuntime({ spec: 'kit/a.ts', root: game, pkgRoot: pkg })
    expect(copyRuntime({ spec: 'kit/a.ts', root: game, pkgRoot: pkg })[0]?.outcome).toBe('current')
    writeTree(pkg, { 'runtime/kit/a.ts': `${A_TS}export const more = 2\n` })
    expect(copyRuntime({ spec: 'kit/a.ts', root: game, pkgRoot: pkg })[0]?.outcome).toBe('updated')
    expect(read(game, 'src/kit/a.ts')).toContain('more = 2')
  })

  it('refuses to overwrite a changed copy, or a file that is not a copy, without force', () => {
    const pkg = makePackage()
    const game = makeGame()
    copyRuntime({ spec: 'kit/a.ts', root: game, pkgRoot: pkg })
    fs.appendFileSync(path.join(game, 'src/kit/a.ts'), '// mine\n')
    const refused = copyRuntime({ spec: 'kit/a.ts', root: game, pkgRoot: pkg })[0]
    expect(refused?.outcome).toBe('refused')
    expect(refused?.reason).toMatch(/changed here/)
    expect(read(game, 'src/kit/a.ts')).toContain('// mine')
    expect(
      copyRuntime({ spec: 'kit/a.ts', root: game, pkgRoot: pkg, force: true })[0]?.outcome,
    ).toBe('updated')
    expect(read(game, 'src/kit/a.ts')).not.toContain('// mine')

    writeTree(game, { 'src/other/c.ts': 'export const c = "the game’s own"\n' })
    expect(copyRuntime({ spec: 'other/c.ts', root: game, pkgRoot: pkg })[0]?.reason).toMatch(
      /not a copy/,
    )
  })

  it('copies a folder, and refuses a file type that cannot carry a header', () => {
    const pkg = makePackage()
    const game = makeGame()
    const r = copyRuntime({ spec: 'kit', root: game, pkgRoot: pkg, to: 'lib/kit/' })
    expect(r.map((x) => [x.file, x.outcome])).toEqual([
      ['lib/kit/a.ts', 'written'],
      ['lib/kit/b.ts', 'written'],
      ['lib/kit/data.json', 'refused'],
      ['lib/kit/style.css', 'written'],
    ])
    expect(read(game, 'lib/kit/style.css')).toMatch(/^\/\* Copied from .*\*\/\n/)
    expect(read(game, 'lib/kit/style.css').endsWith(STYLE_CSS)).toBe(true)
  })

  it('takes --to as a file, or as a folder with a trailing slash; dry runs write nothing', () => {
    const pkg = makePackage()
    const game = makeGame()
    expect(
      copyRuntime({ spec: 'kit/a.ts', root: game, pkgRoot: pkg, to: 'x/alpha.ts' })[0]?.file,
    ).toBe('x/alpha.ts')
    expect(copyRuntime({ spec: 'kit/a.ts', root: game, pkgRoot: pkg, to: 'y/' })[0]?.file).toBe(
      'y/a.ts',
    )
    const dry = copyRuntime({ spec: 'kit/b.ts', root: game, pkgRoot: pkg, dryRun: true })
    expect(dry[0]?.outcome).toBe('would-write')
    expect(fs.existsSync(path.join(game, 'src/kit/b.ts'))).toBe(false)
    expect(() => copyRuntime({ spec: 'kit/none.ts', root: game, pkgRoot: pkg })).toThrow(
      /no runtime/,
    )
  })

  it('names the sibling imports a copy still needs', () => {
    const pkg = makePackage()
    const game = makeGame()
    copyRuntime({ spec: 'kit/b.ts', root: game, pkgRoot: pkg })
    expect(missingSiblings(path.join(game, 'src/kit/b.ts'))).toEqual(['./a'])
    copyRuntime({ spec: 'kit/a.ts', root: game, pkgRoot: pkg })
    expect(missingSiblings(path.join(game, 'src/kit/b.ts'))).toEqual([])
  })
})
