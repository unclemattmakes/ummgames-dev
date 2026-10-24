// @ts-check
/**
 * The markdown resolvers, as functions and as a real git merge driver in a temp repo.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { keepBoth, resolveTable } from '../../src/agent/merge.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const BIN = path.join(ROOT, 'bin/umm-dev.mjs').replace(/\\/g, '/')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'umm-dev-merge-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

const conflict = (/** @type {string} */ ours, /** @type {string} */ theirs) =>
  `# Log\n\nentry one\n<<<<<<< HEAD\n${ours}\n=======\n${theirs}\n>>>>>>> other\n`

describe('keepBoth', () => {
  it('keeps both appended blocks, ours first, with a blank line where they meet on text', () => {
    const r = keepBoth(conflict('ours line', '---\ntheirs line'))
    expect(r.ok && r.text).toBe('# Log\n\nentry one\nours line\n\n---\ntheirs line\n')
  })

  it('keeps CRLF line endings and drops a diff3 base section', () => {
    const text =
      'a\r\n<<<<<<< ours\r\nx\r\n||||||| base\r\nold\r\n=======\r\ny\r\n>>>>>>> theirs\r\n'
    const r = keepBoth(text)
    expect(r.ok && r.text).toBe('a\r\nx\r\n\r\ny\r\n')
  })

  it('refuses a file with no markers, or an unterminated block', () => {
    expect(keepBoth('plain\n')).toEqual({ ok: false, reason: 'no conflict markers found' })
    expect(keepBoth('<<<<<<< a\nx\n').ok).toBe(false)
  })
})

describe('resolveTable', () => {
  const base = '| id | state |\n|---|---|\n| a | todo |\n| b | todo |\n'
  it('takes each row from the side that changed it', () => {
    const text = `| id | state |\n|---|---|\n<<<<<<< HEAD\n| a | done |\n| b | todo |\n=======\n| a | todo |\n| b | done |\n>>>>>>> x\n`
    const r = resolveTable(text, base)
    expect(r.ok && r.text).toBe('| id | state |\n|---|---|\n| a | done |\n| b | done |\n')
  })

  it('refuses a row both sides changed, and a side that added a row', () => {
    const both = `<<<<<<< HEAD\n| a | done |\n=======\n| a | dropped |\n>>>>>>> x\n`
    expect(resolveTable(both, base)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('BOTH'),
    })
    const added = `<<<<<<< HEAD\n| a | todo |\n| c | new |\n=======\n| a | todo |\n>>>>>>> x\n`
    expect(resolveTable(added, base).ok).toBe(false)
  })
})

describe('umm-dev merge driver', () => {
  /** @param {string[]} args @param {string} cwd */
  const git = (args, cwd) =>
    spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
      cwd,
      encoding: 'utf8',
    })

  it('resolves an append conflict and a table conflict during a real merge', () => {
    const repo = path.join(tmp, 'repo')
    fs.mkdirSync(repo)
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
    git(['config', 'core.autocrlf', 'false'], repo)
    fs.writeFileSync(
      path.join(repo, '.gitattributes'),
      'log.md merge=umm-keep-both\nstatus.md merge=umm-table\n',
    )
    fs.writeFileSync(path.join(repo, 'log.md'), '# Log\n\nfirst\n')
    fs.writeFileSync(
      path.join(repo, 'status.md'),
      '| id | state |\n|---|---|\n| a | todo |\n| b | todo |\n',
    )
    for (const [name, how] of [
      ['umm-keep-both', 'keep-both'],
      ['umm-table', 'resolve-table'],
    ]) {
      git(
        ['config', `merge.${name}.driver`, `node "${BIN}" merge driver ${how} %O %A %B %L %P`],
        repo,
      )
    }
    git(['add', '.'], repo)
    git(['commit', '-q', '-m', 'base'], repo)
    git(['checkout', '-q', '-b', 'side'], repo)
    fs.appendFileSync(path.join(repo, 'log.md'), '\ntheirs entry\n')
    fs.writeFileSync(
      path.join(repo, 'status.md'),
      '| id | state |\n|---|---|\n| a | todo |\n| b | done |\n',
    )
    git(['commit', '-q', '-am', 'side'], repo)
    git(['checkout', '-q', 'main'], repo)
    fs.appendFileSync(path.join(repo, 'log.md'), '\nours entry\n')
    fs.writeFileSync(
      path.join(repo, 'status.md'),
      '| id | state |\n|---|---|\n| a | done |\n| b | todo |\n',
    )
    git(['commit', '-q', '-am', 'main'], repo)

    const m = git(['merge', '-q', '--no-edit', 'side'], repo)
    expect(m.status, m.stderr + m.stdout).toBe(0)
    expect(fs.readFileSync(path.join(repo, 'log.md'), 'utf8')).toBe(
      '# Log\n\nfirst\n\nours entry\n\ntheirs entry\n',
    )
    expect(fs.readFileSync(path.join(repo, 'status.md'), 'utf8')).toBe(
      '| id | state |\n|---|---|\n| a | done |\n| b | done |\n',
    )
  })

  it('leaves a conflict it cannot resolve for a person', () => {
    const repo = path.join(tmp, 'repo')
    git(['checkout', '-q', '-b', 'clash'], repo)
    fs.writeFileSync(
      path.join(repo, 'status.md'),
      '| id | state |\n|---|---|\n| a | dropped |\n| b | done |\n',
    )
    git(['commit', '-q', '-am', 'clash'], repo)
    git(['checkout', '-q', 'main'], repo)
    fs.writeFileSync(
      path.join(repo, 'status.md'),
      '| id | state |\n|---|---|\n| a | shipped |\n| b | done |\n',
    )
    git(['commit', '-q', '-am', 'main again'], repo)
    const m = git(['merge', '--no-edit', 'clash'], repo)
    expect(m.status).not.toBe(0)
    expect(fs.readFileSync(path.join(repo, 'status.md'), 'utf8')).toContain('<<<<<<<')
    git(['merge', '--abort'], repo)
  })
})
