// @ts-check
/**
 * The repo guards against temp git repos: em-dash, CLAUDE.md budget, the denylist runner and the
 * hooks install-hooks writes (which a real `git commit` then runs).
 */
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { relativeLinks } from '../../src/guard/claude-md.mjs'
import { compile } from '../../src/guard/denylist.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const BIN = path.join(ROOT, 'bin/umm-dev.mjs')
const DASH = String.fromCharCode(0x2014)
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'umm-dev-guard-')))
/** @type {string[]} */
const links = []
afterAll(() => {
  // Unlink the link into this repo first; if that fails, leave the temp dir rather than recurse.
  for (const l of links) {
    try {
      fs.unlinkSync(l)
    } catch {
      return
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true })
})

let n = 0
/**
 * A temp game repo with a config.
 * @param {object} [guard]
 */
function repo(guard) {
  const dir = path.join(tmp, `r${n++}`)
  fs.mkdirSync(dir)
  fs.writeFileSync(path.join(dir, 'package.json'), '{}')
  if (guard) {
    fs.writeFileSync(
      path.join(dir, 'umm-dev.config.mjs'),
      `export default ${JSON.stringify({ guard })}`,
    )
  }
  git(['init', '-q', '-b', 'main'], dir)
  git(['config', 'core.autocrlf', 'false'], dir)
  return dir
}

/** @param {string[]} args @param {string} cwd */
function git(args, cwd) {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

/** @param {string[]} args @param {string} cwd */
const umm = (args, cwd) =>
  spawnSync(process.execPath, [BIN, 'guard', ...args], { cwd, encoding: 'utf8' })

describe('guard hook with the denylist off', () => {
  it('skips the denylist when guard.denylist is false, as it does for null', () => {
    for (const off of [false, null]) {
      const r = repo({ denylist: off, hooks: { 'pre-commit': ['denylist'] } })
      fs.writeFileSync(path.join(r, 'a.txt'), 'x\n')
      git(['add', '.'], r)
      const res = umm(['hook', 'pre-commit'], r)
      expect(res.status, `${off}: ${res.stderr}`).toBe(0)
    }
  })
})

describe('guard em-dash', () => {
  it('finds every line with one in the named files, and in every listed file with none named', () => {
    const r = repo()
    fs.writeFileSync(path.join(r, 'a.md'), `fine\nbad ${DASH} line\n`)
    fs.writeFileSync(path.join(r, 'b.md'), 'clean\n')
    const one = umm(['em-dash', 'a.md'], r)
    expect(one.status).toBe(1)
    expect(one.stderr).toContain('a.md:2:')
    expect(umm(['em-dash', 'b.md'], r).status).toBe(0)
    expect(umm(['em-dash'], r).stderr).toContain('1 line(s)')
  })

  it('in --staged mode flags added lines only, lets moved lines and excluded paths through', () => {
    const r = repo({ emDash: { exclude: ['gen/**'] } })
    fs.writeFileSync(path.join(r, 'old.md'), `carried ${DASH} line\n`)
    git(['add', '.'], r)
    git(['commit', '-q', '-m', 'before the rule'], r)
    // Move the old line to a new file: allowed. Generated output: allowed.
    fs.rmSync(path.join(r, 'old.md'))
    fs.writeFileSync(path.join(r, 'new.md'), `carried ${DASH} line\n`)
    fs.mkdirSync(path.join(r, 'gen'))
    fs.writeFileSync(path.join(r, 'gen', 'out.md'), `tool ${DASH} output\n`)
    git(['add', '-A'], r)
    expect(umm(['em-dash', '--staged'], r).status).toBe(0)
    fs.appendFileSync(path.join(r, 'new.md'), `fresh ${DASH} writing\n`)
    git(['add', '-A'], r)
    const bad = umm(['em-dash', '--staged'], r)
    expect(bad.status).toBe(1)
    expect(bad.stderr).toContain('new.md:2:')
  })

  it('checks a commit message, ignoring comment lines', () => {
    const r = repo()
    fs.writeFileSync(path.join(r, 'msg'), `Subject\n# a comment ${DASH} ignored\n`)
    expect(umm(['em-dash', '--message', 'msg'], r).status).toBe(0)
    fs.writeFileSync(path.join(r, 'msg'), `Subject ${DASH} here\n`)
    expect(umm(['em-dash', '--message', 'msg'], r).status).toBe(1)
  })
})

describe('guard claude-md', () => {
  it('holds the root and nested files to their caps and every relative link alive', () => {
    const r = repo({
      claudeMd: { rootMaxLines: 3, nestedMaxLines: 2, mustMention: 'docs/keep-small.md' },
    })
    fs.mkdirSync(path.join(r, 'docs'))
    fs.writeFileSync(path.join(r, 'docs', 'keep-small.md'), 'x')
    fs.writeFileSync(path.join(r, 'CLAUDE.md'), 'one\nsee [it](docs/keep-small.md)\nthree\n')
    fs.mkdirSync(path.join(r, 'src'))
    fs.writeFileSync(path.join(r, 'src', 'CLAUDE.md'), 'a\nb\n')
    expect(umm(['claude-md'], r).status).toBe(0)
    fs.writeFileSync(path.join(r, 'src', 'CLAUDE.md'), 'a\nb\n[gone](../docs/missing.md)\n')
    const bad = umm(['claude-md'], r)
    expect(bad.status).toBe(1)
    expect(bad.stderr).toContain('src/CLAUDE.md: 3 lines, over its cap of 2')
    expect(bad.stderr).toContain('dead link -> ../docs/missing.md')
  })

  it('reads links without anchors or URLs', () => {
    expect(relativeLinks('[x](docs/a.md#b) [y](https://e.com) [z](#here) [w](mailto:a@b)')).toEqual(
      ['docs/a.md'],
    )
  })
})

/** A rule table like a game would write: nothing here is any game's. */
const RULES = {
  maxBytes: 64,
  extensions: [{ group: 'mesh', why: 'meshes live in the bucket', ext: ['.glb'] }],
  prefixes: [{ prefix: 'public/assets/', why: 'built assets live in the bucket' }],
  segments: [{ segment: 'Vendor Pack', why: 'a bought pack copied in' }],
  names: [{ pattern: '^\\.env(\\..+)?$', except: '^\\.env\\.example$', why: 'local env' }],
  allow: [{ glob: 'public/assets/manifest.json', why: 'tiny and load-bearing' }],
  sizeAllow: [{ glob: 'docs/**/*.md', why: 'prose', max: 1024 }],
  allowEnv: 'GAME_ALLOW_ASSETS',
}

describe('guard denylist', () => {
  it('applies each kind of rule', () => {
    const check = compile(RULES)
    expect(check('models/ship.GLB', 10).map((v) => v.rule)).toEqual(['denied-ext'])
    expect(check('public/assets/x.json', 10).map((v) => v.rule)).toEqual(['denied-path'])
    expect(check('public/assets/manifest.json', 10)).toEqual([])
    expect(check('src/Vendor Pack/a.txt', 10).map((v) => v.rule)).toEqual(['denied-dir'])
    expect(check('.env.local', 1).map((v) => v.rule)).toEqual(['denied-name'])
    expect(check('.env.example', 1)).toEqual([])
    expect(check('src/big.ts', 65).map((v) => v.rule)).toEqual(['too-big'])
    expect(check('docs/a/long.md', 1000)).toEqual([])
    expect(check('docs/a/long.md', 2000).map((v) => v.rule)).toEqual(['too-big'])
  })

  it('runs over staged files with their staged sizes, and fails with no rules', () => {
    const r = repo({ denylist: 'rules.json' })
    fs.writeFileSync(path.join(r, 'rules.json'), JSON.stringify(RULES))
    fs.writeFileSync(path.join(r, 'ship.glb'), 'x')
    fs.writeFileSync(path.join(r, 'big.ts'), 'y'.repeat(100))
    fs.writeFileSync(path.join(r, 'ok.ts'), 'z')
    git(['add', '.'], r)
    const bad = umm(['denylist', '--staged'], r)
    expect(bad.status).toBe(1)
    expect(bad.stderr).toContain('ship.glb')
    expect(bad.stderr).toContain('big.ts')
    expect(bad.stderr).not.toContain('ok.ts')
    const allowed = spawnSync(process.execPath, [BIN, 'guard', 'denylist', '--staged'], {
      cwd: r,
      encoding: 'utf8',
      env: { ...process.env, GAME_ALLOW_ASSETS: '1' },
    })
    expect(allowed.status).toBe(0)
    expect(umm(['denylist', '--files', 'ok.ts'], r).status).toBe(0)
    expect(umm(['denylist', '--staged'], repo()).status).toBe(2)
  })
})

describe('guard install-hooks', () => {
  it('writes hooks that block a commit, and leaves a hook it did not write alone', () => {
    const r = repo({ denylist: { ...RULES, maxBytes: 4096 } })
    // The game's node_modules/@ummgames/dev, as an install would leave it.
    const pkg = path.join(r, 'node_modules', '@ummgames', 'dev')
    fs.mkdirSync(path.dirname(pkg), { recursive: true })
    fs.symlinkSync(ROOT, pkg, process.platform === 'win32' ? 'junction' : 'dir')
    links.push(pkg)
    fs.writeFileSync(path.join(r, '.gitignore'), 'node_modules/\n')

    const hooksDir = path.join(r, '.git', 'hooks')
    fs.mkdirSync(hooksDir, { recursive: true })
    fs.writeFileSync(path.join(hooksDir, 'commit-msg'), '#!/bin/sh\nexit 0\n')
    const inst = umm(['install-hooks'], r)
    expect(inst.status).toBe(1) // commit-msg was someone else's
    expect(inst.stdout).toContain('is not a hook this tool wrote')
    expect(fs.readFileSync(path.join(hooksDir, 'commit-msg'), 'utf8')).toBe('#!/bin/sh\nexit 0\n')
    expect(fs.readFileSync(path.join(hooksDir, 'pre-commit'), 'utf8')).toContain(
      'guard hook pre-commit',
    )
    expect(umm(['install-hooks', '--force'], r).status).toBe(0)

    fs.writeFileSync(path.join(r, 'notes.md'), `a ${DASH} b\n`)
    git(['add', '.'], r)
    const blocked = spawnSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-m', 'x'],
      {
        cwd: r,
        encoding: 'utf8',
      },
    )
    expect(blocked.status).not.toBe(0)
    expect(blocked.stderr).toContain('em-dash')

    fs.writeFileSync(path.join(r, 'notes.md'), 'a, b\n')
    fs.writeFileSync(path.join(r, 'ship.glb'), 'x')
    git(['add', '.'], r)
    const glb = spawnSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-m', 'x'],
      {
        cwd: r,
        encoding: 'utf8',
      },
    )
    expect(glb.status).not.toBe(0)
    expect(glb.stderr).toContain('ship.glb')

    git(['rm', '-q', '--cached', 'ship.glb'], r)
    const ok = spawnSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-m', 'clean'],
      {
        cwd: r,
        encoding: 'utf8',
      },
    )
    expect(ok.status, ok.stderr).toBe(0)
  })
})

describe('guard install-hooks never overwrites what it did not write', () => {
  it('leaves a symlinked hook and its target alone, and --force replaces only the link', () => {
    const r = repo()
    const hooksDir = path.join(r, '.git', 'hooks')
    fs.mkdirSync(hooksDir, { recursive: true })
    const target = path.join(tmp, `shared-hook-${n}`)
    fs.writeFileSync(target, '#!/bin/sh\necho shared\n')
    fs.symlinkSync(target, path.join(hooksDir, 'pre-commit'), 'file')
    const res = umm(['install-hooks'], r)
    expect(res.status).toBe(1)
    expect(res.stdout).toContain('is a link')
    expect(fs.readFileSync(target, 'utf8')).toBe('#!/bin/sh\necho shared\n')
    expect(umm(['install-hooks', '--force'], r).status).toBe(0)
    expect(fs.lstatSync(path.join(hooksDir, 'pre-commit')).isSymbolicLink()).toBe(false)
    expect(fs.readFileSync(path.join(hooksDir, 'pre-commit'), 'utf8')).toContain(
      'guard hook pre-commit',
    )
    expect(fs.readFileSync(target, 'utf8')).toBe('#!/bin/sh\necho shared\n')
  })

  it('rewrites its own unedited hook, but keeps one a person edited', () => {
    const r = repo()
    expect(umm(['install-hooks'], r).status).toBe(0)
    const again = umm(['install-hooks'], r)
    expect(again.status).toBe(0)
    expect(again.stdout).toContain('rewrote')
    const hook = path.join(r, '.git', 'hooks', 'pre-commit')
    fs.appendFileSync(hook, '# my own addition\n')
    const edited = umm(['install-hooks'], r)
    expect(edited.status).toBe(1)
    expect(edited.stdout).toContain('edited since')
    expect(fs.readFileSync(hook, 'utf8')).toContain('# my own addition')
  })
})
