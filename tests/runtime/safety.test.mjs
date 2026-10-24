/**
 * Regressions for two review findings: a game file's header must never steer a read or a fetch
 * outside runtime/, and a folder copy must never overwrite the game's own files.
 */
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { copyRuntime } from '../../src/runtime/copy.mjs'
import { fetchOriginal, RAW_BASE, rawUrl, scanDrift } from '../../src/runtime/drift.mjs'
import { bodyHash, isSafeRuntimePath, isSafeVersion, parseCopy } from '../../src/runtime/header.mjs'
import { readRuntime, runtimeFile } from '../../src/runtime/source.mjs'
import { A_TS, cleanup, makeGame, makePackage, read, writeTree } from './fixture.mjs'

afterAll(cleanup)

const SECRET = 'not for anyone\n'
/** @param {string} version @param {string} p @param {string} body */
const forged = (version, p, body) =>
  `// Copied from ummgames-dev ${version} ${p} (sha256 ${bodyHash(body)}). Owned here now; \`umm-dev drift\` compares.\n${body}`

describe('a forged header cannot read outside runtime/', () => {
  it('rejects . and .. segments and odd versions in a header', () => {
    expect(parseCopy(forged('v0.1.0', 'runtime/../secret.txt', SECRET))).toBeNull()
    expect(parseCopy(forged('v0.1.0', 'runtime/./dev/a.ts', SECRET))).toBeNull()
    expect(parseCopy(forged('v0.1.0/../x', 'runtime/dev/a.ts', SECRET))).toBeNull()
    expect(parseCopy(forged('v0.1.0', 'runtime/dev/a.ts', SECRET))).not.toBeNull()
    expect(isSafeRuntimePath('runtime/dev/..')).toBe(false)
    expect(isSafeRuntimePath('runtime')).toBe(false)
    expect(isSafeVersion('v1.2.3-rc.1')).toBe(true)
    expect(isSafeVersion('main')).toBe(false)
  })

  it('never lists or reads a file outside the installed runtime/, hash match or not', () => {
    const pkg = makePackage()
    writeTree(pkg, { 'secret.txt': SECRET })
    const game = makeGame()
    writeTree(game, { 'src/steal.ts': forged('v9.9.9', 'runtime/../secret.txt', SECRET) })
    expect(scanDrift({ root: game, pkgRoot: pkg })).toEqual([])
    expect(() => readRuntime('runtime/../secret.txt', pkg)).toThrow(/not a runtime path/)
    expect(() => runtimeFile('runtime/kit/../../secret.txt', pkg)).toThrow(/not a runtime path/)
    expect(readRuntime('runtime/kit/a.ts', pkg)).toBe(A_TS)
  })
})

describe('a forged header cannot fetch another repo', () => {
  it('builds URLs only under this repo’s runtime/ at the tag', () => {
    expect(rawUrl('v0.1.0', 'runtime/dev/fuzzy.ts')).toBe(`${RAW_BASE}/v0.1.0/runtime/dev/fuzzy.ts`)
    expect(rawUrl('v0.1.0', 'runtime/../../../someone/else/main/x.ts')).toBeNull()
    expect(rawUrl('v0.1.0/../../other', 'runtime/x.ts')).toBeNull()
    expect(rawUrl('v0.1.0', 'runtime/dev/a%2F..%2Fb.ts')).toBeNull()
  })

  it('neither runs git nor fetches for an unsafe header, and shows nothing', async () => {
    /** @type {string[]} */
    const urls = []
    const fetch = async (/** @type {string} */ url) => {
      urls.push(url)
      return { ok: true, status: 200, text: async () => SECRET }
    }
    const got = await fetchOriginal({
      runtimePath: 'runtime/../../../someone/else/main/x.ts',
      version: 'v0.1.0',
      hash: bodyHash(SECRET),
      env: { UMM_DEV_REPO: process.cwd() },
      fetch,
    })
    expect(got.text).toBeNull()
    expect('why' in got && got.why).toMatch(/unsafe header/)
    expect(urls).toEqual([])
  })
})

describe('copy --force on a folder', () => {
  it('overwrites changed copies but never the game’s own files', () => {
    const pkg = makePackage()
    const game = makeGame()
    copyRuntime({ spec: 'kit/a.ts', root: game, pkgRoot: pkg })
    fs.appendFileSync(path.join(game, 'src/kit/a.ts'), '// tuned\n')
    writeTree(game, { 'src/kit/b.ts': 'export const mine = 1\n' })

    const r = copyRuntime({ spec: 'kit', root: game, pkgRoot: pkg, force: true })
    const by = Object.fromEntries(r.map((x) => [x.file, x]))
    expect(by['src/kit/a.ts']?.outcome).toBe('updated')
    expect(by['src/kit/b.ts']?.outcome).toBe('refused')
    expect(by['src/kit/b.ts']?.reason).toMatch(/never overwrites.*umm-dev copy kit\/b\.ts --force/)
    expect(read(game, 'src/kit/b.ts')).toBe('export const mine = 1\n')
    expect(read(game, 'src/kit/a.ts')).not.toContain('// tuned')
  })

  it('overwrites a file that is not a copy when the spec names exactly that file', () => {
    const pkg = makePackage()
    const game = makeGame()
    writeTree(game, { 'src/kit/b.ts': 'export const mine = 1\n' })
    expect(copyRuntime({ spec: 'kit/b.ts', root: game, pkgRoot: pkg })[0]?.outcome).toBe('refused')
    const r = copyRuntime({ spec: 'runtime/kit/b.ts', root: game, pkgRoot: pkg, force: true })
    expect(r[0]?.outcome).toBe('updated')
    expect(read(game, 'src/kit/b.ts')).toMatch(/^\/\/ Copied from ummgames-dev v9\.9\.9/)
  })
})
