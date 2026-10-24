import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { copyRuntime } from '../../src/runtime/copy.mjs'
import { diffLines, unifiedDiff } from '../../src/runtime/diff.mjs'
import { advice, fetchOriginal, RAW_BASE, scanDrift } from '../../src/runtime/drift.mjs'
import { bodyHash } from '../../src/runtime/header.mjs'
import { A_TS, B_TS, cleanup, makeGame, makePackage, tempDir, writeTree } from './fixture.mjs'

afterAll(cleanup)

/** A game with kit/a.ts and kit/b.ts copied in, and the package they came from. */
function setup() {
  const pkg = makePackage('1.0.0')
  const game = makeGame()
  copyRuntime({ spec: 'kit/a.ts', root: game, pkgRoot: pkg })
  copyRuntime({ spec: 'kit/b.ts', root: game, pkgRoot: pkg })
  return { pkg, game }
}

describe('scanDrift', () => {
  it('finds each copy by its header, and calls untouched copies current', () => {
    const { pkg, game } = setup()
    writeTree(game, { 'src/own.ts': 'export const own = 1\n', 'node_modules/x/y.ts': '' })
    const entries = scanDrift({ root: game, pkgRoot: pkg })
    expect(entries.map((e) => [e.file, e.runtimePath, e.version, e.status])).toEqual([
      ['src/kit/a.ts', 'runtime/kit/a.ts', 'v1.0.0', 'current'],
      ['src/kit/b.ts', 'runtime/kit/b.ts', 'v1.0.0', 'current'],
    ])
  })

  it('tells a change here from a change upstream from both, and a file no longer shipped', () => {
    const { pkg, game } = setup()
    fs.appendFileSync(path.join(game, 'src/kit/a.ts'), 'export const mine = 1\n')
    writeTree(pkg, { 'runtime/kit/b.ts': `${B_TS}export const theirs = 1\n` })
    let by = Object.fromEntries(scanDrift({ root: game, pkgRoot: pkg }).map((e) => [e.file, e]))
    expect(by['src/kit/a.ts']?.status).toBe('changed-here')
    expect(by['src/kit/b.ts']?.status).toBe('changed-upstream')
    expect(advice(/** @type {any} */ (by['src/kit/b.ts']))).toBe(
      'take it: umm-dev copy kit/b.ts --to src/kit/b.ts',
    )

    writeTree(pkg, { 'runtime/kit/a.ts': `${A_TS}export const theirs = 2\n` })
    fs.rmSync(path.join(pkg, 'runtime/kit/b.ts'))
    by = Object.fromEntries(scanDrift({ root: game, pkgRoot: pkg }).map((e) => [e.file, e]))
    expect(by['src/kit/a.ts']?.status).toBe('changed-both')
    expect(by['src/kit/b.ts']?.status).toBe('gone-upstream')
  })

  it('scans a git checkout through git, so ignored output is skipped', () => {
    const { pkg, game } = setup()
    execFileSync('git', ['init', '-q'], { cwd: game })
    writeTree(game, { '.gitignore': 'build/\n' })
    fs.cpSync(path.join(game, 'src/kit'), path.join(game, 'build/kit'), { recursive: true })
    const files = scanDrift({ root: game, pkgRoot: pkg }).map((e) => e.file)
    expect(files).toEqual(['src/kit/a.ts', 'src/kit/b.ts'])
  })
})

describe('fetchOriginal', () => {
  const hash = bodyHash(A_TS)
  const ask = { runtimePath: 'runtime/kit/a.ts', version: 'v1.0.0', hash }

  it('reads the tag from the clone UMM_DEV_REPO names', async () => {
    const repo = tempDir('umm-dev-clone-')
    writeTree(repo, { 'runtime/kit/a.ts': A_TS })
    const git = (/** @type {string[]} */ ...a) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo })
    git('init', '-q')
    git('add', '-A')
    git('commit', '-qm', 'one')
    git('tag', 'v1.0.0')
    writeTree(repo, { 'runtime/kit/a.ts': `${A_TS}// later\n` })
    git('commit', '-qam', 'two')
    const noFetch = async () => {
      throw new Error('should not fetch')
    }
    const got = await fetchOriginal({ ...ask, env: { UMM_DEV_REPO: repo }, fetch: noFetch })
    expect(got).toEqual({ text: A_TS, from: 'UMM_DEV_REPO at v1.0.0' })
  })

  it('falls back to the public repo at the tag', async () => {
    /** @type {string[]} */
    const urls = []
    const fetch = async (/** @type {string} */ url) => {
      urls.push(url)
      return { ok: true, status: 200, text: async () => A_TS }
    }
    const got = await fetchOriginal({
      ...ask,
      env: { UMM_DEV_REPO: tempDir('umm-dev-empty-') },
      fetch,
    })
    expect(urls).toEqual([`${RAW_BASE}/v1.0.0/runtime/kit/a.ts`])
    expect(got.text).toBe(A_TS)
  })

  it('fails gracefully offline, or when what it gets is not the original', async () => {
    const offline = async () => {
      throw new Error('getaddrinfo ENOTFOUND')
    }
    const got = await fetchOriginal({ ...ask, env: {}, fetch: offline })
    expect(got.text).toBeNull()
    expect('why' in got && got.why).toMatch(/unreachable.*ENOTFOUND/)

    const wrong = async () => ({ ok: true, status: 200, text: async () => 'something else\n' })
    const bad = await fetchOriginal({ ...ask, env: {}, fetch: wrong })
    expect('why' in bad && bad.why).toMatch(/does not match/)

    const missing = async () => ({ ok: false, status: 404, text: async () => '' })
    const gone = await fetchOriginal({ ...ask, env: {}, fetch: missing })
    expect('why' in gone && gone.why).toMatch(/answered 404/)
  })
})

describe('unifiedDiff', () => {
  it('is empty for equal texts, CRLF or not', () => {
    expect(unifiedDiff('a\nb\n', 'a\r\nb\r\n')).toBe('')
  })

  it('prints hunks with context, removals before additions', () => {
    // Changes more than twice the context apart get hunks of their own, as GNU diff does.
    const a = Array.from({ length: 14 }, (_, i) => String(i + 1))
    const b = [...a.slice(0, 3), 'four', ...a.slice(4), '15']
    expect(unifiedDiff(a.join('\n'), b.join('\n'), { from: 'old', to: 'new' })).toBe(
      [
        '--- old',
        '+++ new',
        '@@ -1,7 +1,7 @@',
        ' 1',
        ' 2',
        ' 3',
        '-4',
        '+four',
        ' 5',
        ' 6',
        ' 7',
        '@@ -12,3 +12,4 @@',
        ' 12',
        ' 13',
        ' 14',
        '+15',
        '',
      ].join('\n'),
    )
  })

  it('finds the longest common run', () => {
    const ops = diffLines(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd', 'e'])
    expect(ops.map((o) => `${o.op}${o.text}`)).toEqual([' a', '-b', '+x', ' c', ' d', '+e'])
  })
})
