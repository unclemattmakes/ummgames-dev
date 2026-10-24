// @ts-check
/**
 * Hydrate a real git worktree from a temp main checkout, then remove it and prove the main
 * checkout's linked tree survived.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findLinks } from '../../src/agent/worktree.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const BIN = path.join(ROOT, 'bin/umm-dev.mjs')

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'umm-dev-wt-')))
const main = path.join(tmp, 'main')
const wt = path.join(main, '.claude', 'worktrees', 'one')
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

/** @param {string[]} args @param {string} cwd */
const git = (args, cwd) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

/** @param {string[]} args @param {string} cwd */
const umm = (args, cwd) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' })

beforeAll(() => {
  fs.mkdirSync(main, { recursive: true })
  fs.writeFileSync(path.join(main, 'package.json'), '{"name":"game"}')
  fs.writeFileSync(
    path.join(main, 'umm-dev.config.mjs'),
    `export default { worktree: {
      install: false,
      link: ['assets'],
      copy: ['fonts', 'index.tsv'],
      envKeys: ['SOURCE_DIR'],
      envDefaults: { BASE_URL: '/' },
    } }`,
  )
  fs.writeFileSync(path.join(main, '.gitignore'), 'assets/\nfonts/\nindex.tsv\n.env\n.claude/\n')
  git(['init', '-q', '-b', 'main'], main)
  git(['add', '.'], main)
  git(['commit', '-q', '-m', 'init'], main)
  fs.mkdirSync(path.join(main, 'assets', 'sub'), { recursive: true })
  for (const f of ['a.bin', 'b.bin', 'sub/c.bin'])
    fs.writeFileSync(path.join(main, 'assets', f), 'x')
  fs.mkdirSync(path.join(main, 'fonts'))
  fs.writeFileSync(path.join(main, 'fonts', 'face.woff2'), 'f')
  fs.writeFileSync(path.join(main, 'index.tsv'), 'a\tb\n')
  fs.writeFileSync(path.join(main, '.env'), 'SOURCE_DIR=/somewhere\nOTHER=secret\n')
  git(['worktree', 'add', '-q', '-b', 'one', wt], main)
})

describe('umm-dev worktree', () => {
  it('hydrates a worktree from the main checkout and counts what it linked and copied', () => {
    const r = umm(['worktree', 'hydrate', wt], main)
    expect(r.stdout).toContain('Hydration OK.')
    expect(r.status).toBe(0)
    expect(fs.lstatSync(path.join(wt, 'assets')).isSymbolicLink()).toBe(true)
    expect(fs.lstatSync(path.join(wt, 'fonts')).isSymbolicLink()).toBe(false)
    expect(fs.readFileSync(path.join(wt, 'fonts', 'face.woff2'), 'utf8')).toBe('f')
    const env = fs.readFileSync(path.join(wt, '.env'), 'utf8')
    expect(env).toContain('SOURCE_DIR=/somewhere')
    expect(env).toContain('BASE_URL=/')
    expect(env).not.toContain('OTHER')
    expect(r.stdout).not.toContain('/somewhere') // values are never printed
    expect(r.stdout).toContain('1 link(s) point out of this worktree')
    // A second run changes nothing and still passes.
    expect(umm(['worktree', 'hydrate', wt], main).status).toBe(0)
  })

  it('refuses to hydrate the main checkout', () => {
    const r = umm(['worktree', 'hydrate', main], main)
    expect(r.status).toBe(64)
    expect(r.stdout).toContain('is the main checkout')
  })

  it('refuses the main checkout, an unknown path, and a dirty worktree', () => {
    expect(umm(['worktree', 'remove', main], main).stdout).toContain('is the main checkout')
    expect(umm(['worktree', 'remove', path.join(tmp, 'nowhere')], main).stdout).toContain(
      'not a worktree git knows about',
    )
    fs.writeFileSync(path.join(wt, 'note.md'), 'unsaved')
    const r = umm(['worktree', 'remove', 'one'], main)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('uncommitted change')
    fs.rmSync(path.join(wt, 'note.md'))
  })

  it('removes the worktree without touching what its links point at', () => {
    const dry = umm(['worktree', 'remove', 'one', '--dry-run'], main)
    expect(dry.stdout).toContain('1 pointing outside the worktree')
    expect(fs.existsSync(wt)).toBe(true)

    const r = umm(['worktree', 'remove', 'one'], main)
    expect(r.stdout).toContain('target survived')
    expect(r.status).toBe(0)
    expect(fs.existsSync(wt)).toBe(false)
    expect(fs.readdirSync(path.join(main, 'assets')).sort()).toEqual(['a.bin', 'b.bin', 'sub'])
    expect(fs.existsSync(path.join(main, 'assets', 'sub', 'c.bin'))).toBe(true)
    expect(git(['worktree', 'list'], main)).not.toContain('one')
    expect(findLinks(main)).toEqual([])
  })
})
