/**
 * Copies from a game's own sources (`runtime.sources`, `umm-dev copy --from`): the header, copy
 * and drift against a real git checkout, a source named from a linked worktree, and the CLI.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { copySource } from '../../src/runtime/copy.mjs'
import { advice, scanDrift, sourceOriginal } from '../../src/runtime/drift.mjs'
import {
  bodyHash,
  parseCopy,
  parseSourceCopy,
  stamp,
  stampSource,
} from '../../src/runtime/header.mjs'
import { lastCommit, mainCheckout, resolveSources } from '../../src/runtime/sources.mjs'
import { A_TS, B_TS, cleanup, makeGame, read, tempDir, writeTree } from './fixture.mjs'

afterAll(cleanup)

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../bin/umm-dev.mjs')

/** @param {string} cwd @param {string[]} args */
function git(cwd, ...args) {
  return execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'core.autocrlf=false', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
}

/** @param {string} repo @param {Record<string, string>} files @param {string} msg */
function commit(repo, files, msg) {
  writeTree(repo, files)
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', msg)
  return git(repo, 'rev-parse', 'HEAD').trim()
}

/** A source checkout with client/a.ts and client/b.ts, one commit. */
function makeSource() {
  const repo = tempDir('umm-dev-src-')
  git(repo, 'init', '-q', '-b', 'main')
  const first = commit(repo, { 'client/a.ts': A_TS, 'client/b.ts': B_TS, 'other.md': 'x\n' }, 'one')
  return { repo, first }
}

/** @param {string} repo @param {string} root */
function setup(repo, root = makeGame()) {
  const sources = resolveSources({ net: { repo } }, root)
  copySource({ name: 'net', spec: 'client/a.ts', root, sources, to: 'src/net/a.ts' })
  return { root, sources }
}

describe('source header', () => {
  it('names the source, the commit and the path, and reads back', () => {
    const text = stampSource({
      file: 'x.ts',
      name: 'net',
      commit: '0123456789ab',
      srcPath: 'client/a.ts',
      source: A_TS,
    })
    const [first, ...rest] = text.split('\n')
    expect(first).toBe(
      `// Copied from net 0123456789ab client/a.ts (sha256 ${bodyHash(A_TS)}). Change it there and copy it again; \`umm-dev drift\` compares.`,
    )
    expect(rest.join('\n')).toBe(A_TS)
    expect(parseSourceCopy(text)).toMatchObject({
      name: 'net',
      commit: '0123456789ab',
      srcPath: 'client/a.ts',
    })
    expect(parseCopy(text)).toBeNull()
  })

  it('never reads a kit header as a source copy, or trusts an unsafe name or path', () => {
    const kit = stamp({
      file: 'x.ts',
      version: 'v1.0.0',
      runtimePath: 'runtime/k/a.ts',
      source: A_TS,
    })
    expect(parseSourceCopy(kit)).toBeNull()
    const h = `(sha256 ${bodyHash(A_TS)})`
    expect(parseSourceCopy(`// Copied from net 0123456789ab ../a.ts ${h}\n${A_TS}`)).toBeNull()
    expect(parseSourceCopy(`// Copied from net 0123456789ab a/../b.ts ${h}\n${A_TS}`)).toBeNull()
    expect(parseSourceCopy(`// Copied from net main client/a.ts ${h}\n${A_TS}`)).toBeNull()
    expect(() => resolveSources({ 'ummgames-dev': { repo: '.' } }, makeGame())).toThrow(
      /not a usable/,
    )
    expect(() => resolveSources({ 'a b': { repo: '.' } }, makeGame())).toThrow(/not a usable/)
    expect(() => resolveSources({ net: /** @type {any} */ ({}) }, makeGame())).toThrow(/needs repo/)
  })
})

describe('copySource', () => {
  it('copies committed work only, stamped with the commit that last changed the file', () => {
    const { repo, first } = makeSource()
    fs.appendFileSync(path.join(repo, 'client/a.ts'), 'export const uncommitted = 1\n')
    const { root } = setup(repo)
    const copy = parseSourceCopy(read(root, 'src/net/a.ts'))
    expect(copy?.commit).toBe(first.slice(0, 12))
    expect(copy?.body).toBe(A_TS)
  })

  it('is current after an unrelated commit, and updates an untouched copy after a change', () => {
    const { repo } = makeSource()
    const { root, sources } = setup(repo)
    commit(repo, { 'other.md': 'y\n' }, 'unrelated')
    const again = () =>
      copySource({ name: 'net', spec: 'client/a.ts', root, sources, to: 'src/net/a.ts' })
    expect(again()[0]?.outcome).toBe('current')
    const second = commit(repo, { 'client/a.ts': `${A_TS}export const two = 2\n` }, 'two')
    expect(again()[0]?.outcome).toBe('updated')
    expect(parseSourceCopy(read(root, 'src/net/a.ts'))?.commit).toBe(second.slice(0, 12))
  })

  it('refuses a copy changed here, or a game file that is not a copy, without --force', () => {
    const { repo } = makeSource()
    const { root, sources } = setup(repo)
    fs.appendFileSync(path.join(root, 'src/net/a.ts'), 'export const mine = 1\n')
    commit(repo, { 'client/a.ts': `${A_TS}export const two = 2\n` }, 'two')
    const go = (/** @type {boolean} */ force) =>
      copySource({ name: 'net', spec: 'client/a.ts', root, sources, to: 'src/net/a.ts', force })
    expect(go(false)[0]).toMatchObject({ outcome: 'refused', reason: /changed here/ })
    expect(go(true)[0]?.outcome).toBe('updated')

    writeTree(root, { 'src/own/b.ts': 'export const own = 1\n' })
    const own = copySource({ name: 'net', spec: 'client/b.ts', root, sources, to: 'src/own/b.ts' })
    expect(own[0]).toMatchObject({ outcome: 'refused', reason: /not a copy/ })
  })

  it('copies a folder, lands it under runtime.into by default, and names a missing source', () => {
    const { repo } = makeSource()
    const root = makeGame()
    const sources = resolveSources({ net: { repo } }, root)
    const out = copySource({ name: 'net', spec: 'client', root, sources })
    expect(out.map((r) => [r.file, r.outcome])).toEqual([
      ['src/client/a.ts', 'written'],
      ['src/client/b.ts', 'written'],
    ])
    expect(() => copySource({ name: 'nope', spec: 'client', root, sources })).toThrow(
      /no source "nope" in runtime.sources \(it has net\)/,
    )
    expect(() => copySource({ name: 'net', spec: 'missing.ts', root, sources })).toThrow(/no file/)
  })

  it('reads at the configured ref, not the checkout', () => {
    const { repo } = makeSource()
    git(repo, 'checkout', '-q', '-b', 'side')
    commit(repo, { 'client/a.ts': 'export const side = 1\n' }, 'side')
    const root = makeGame()
    copySource({
      name: 'net',
      spec: 'client/a.ts',
      root,
      sources: resolveSources({ net: { repo, ref: 'main' } }, root),
      to: 'a.ts',
    })
    expect(parseSourceCopy(read(root, 'a.ts'))?.body).toBe(A_TS)
  })
})

describe('drift on source copies', () => {
  it('reports current, changed upstream with the line to take it, here, and both', () => {
    const { repo } = makeSource()
    const { root, sources } = setup(repo)
    const one = () =>
      /** @type {import('../../src/runtime/drift.mjs').DriftEntry} */ (
        scanDrift({ root, sources })[0]
      )
    expect(one()).toMatchObject({ file: 'src/net/a.ts', source: 'net', status: 'current' })

    commit(repo, { 'client/a.ts': `${A_TS}export const two = 2\n` }, 'two')
    expect(one().status).toBe('changed-upstream')
    expect(advice(one())).toBe('take it: umm-dev copy --from net client/a.ts --to src/net/a.ts')

    fs.appendFileSync(path.join(root, 'src/net/a.ts'), 'export const mine = 1\n')
    expect(one().status).toBe('changed-both')
    const original = sourceOriginal(one(), sources)
    expect(original).toMatchObject({ text: A_TS })
  })

  it('says source not found when the game does not name it, and gone when the file left', () => {
    const { repo } = makeSource()
    const { root, sources } = setup(repo)
    expect(scanDrift({ root })[0]?.status).toBe('no-source')
    expect(advice(/** @type {any} */ (scanDrift({ root })[0]))).toMatch(
      /name net in runtime.sources/,
    )
    git(repo, 'rm', '-q', 'client/a.ts')
    git(repo, 'commit', '-q', '-m', 'gone')
    expect(scanDrift({ root, sources })[0]?.status).toBe('gone-upstream')
  })

  it('sees kit copies and source copies side by side', () => {
    const { repo } = makeSource()
    const { root, sources } = setup(repo)
    writeTree(root, {
      'src/k.ts': stamp({
        file: 'k.ts',
        version: 'v1.0.0',
        runtimePath: 'runtime/k/a.ts',
        source: A_TS,
      }),
    })
    const got = scanDrift({ root, sources, pkgRoot: tempDir('umm-dev-nopkg-') })
    expect(got.map((e) => [e.file, e.source])).toEqual([
      ['src/k.ts', null],
      ['src/net/a.ts', 'net'],
    ])
  })
})

describe('a source named from a linked worktree', () => {
  it('reads a relative repo from the main checkout, however deep the worktree sits', () => {
    const parent = tempDir('umm-dev-projects-')
    const src = path.join(parent, 'network')
    fs.mkdirSync(src)
    git(src, 'init', '-q', '-b', 'main')
    commit(src, { 'client/a.ts': A_TS }, 'one')
    const game = path.join(parent, 'game')
    fs.mkdirSync(game)
    git(game, 'init', '-q', '-b', 'main')
    commit(game, { 'package.json': '{"name":"game"}' }, 'one')
    const wt = path.join(game, '.claude', 'worktrees', 'deep')
    git(game, 'worktree', 'add', '-q', wt, '-b', 'deep')

    expect(fs.realpathSync(mainCheckout(wt))).toBe(fs.realpathSync(game))
    const sources = resolveSources({ net: { repo: '../network' } }, wt)
    expect(fs.realpathSync(/** @type {any} */ (sources.net).repo)).toBe(fs.realpathSync(src))
    expect(lastCommit(/** @type {any} */ (sources.net), 'client/a.ts')).toMatch(/^[0-9a-f]{12}$/)
  })
})

describe('umm-dev copy --from and drift, end to end', () => {
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

  it('copies from a source named in the config, lists it, and drift calls the copy current', () => {
    const { repo } = makeSource()
    const game = makeGame()
    fs.writeFileSync(
      path.join(game, 'umm-dev.config.mjs'),
      `export default { runtime: { sources: { net: { repo: ${JSON.stringify(repo)} } } } }\n`,
    )
    const list = umm(game, 'copy', '--from', 'net', '--list')
    expect(list.code).toBe(0)
    expect(list.out).toContain('  client/a.ts')

    const copied = umm(game, 'copy', '--from', 'net', 'client/a.ts', '--to', 'src/net/a.ts')
    expect(copied).toMatchObject({ code: 0 })
    expect(copied.out).toContain('written  src/net/a.ts  (from net client/a.ts)')

    const drift = umm(game, 'drift', '--strict')
    expect(drift.code).toBe(0)
    expect(drift.out).toMatch(/src\/net\/a\.ts\s+[0-9a-f]{12}\s+current/)

    expect(umm(game, 'copy', '--from', 'nope', 'client/a.ts').code).toBe(2)
    expect(umm(game, 'copy', '--from', 'net', 'missing.ts').code).toBe(2)
  })
})
