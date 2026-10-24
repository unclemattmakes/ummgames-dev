/**
 * CLAUDE.md rule 1: this repo is public. `.private-names` (untracked, one name per line, `#`
 * comments) lists what must never appear in a tracked file. Without that file the test skips:
 * it guards the maintainer's machine, where the names are known, and leaks none of them here.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LIST = path.join(ROOT, '.private-names')
const names = fs.existsSync(LIST)
  ? fs
      .readFileSync(LIST, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.replace(/#.*/, '').trim())
      .filter(Boolean)
  : []

describe.skipIf(names.length === 0)('public names', () => {
  it('no file that would be published names anything in .private-names', () => {
    const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean)
    const hits = []
    for (const f of files) {
      const text = fs.readFileSync(path.join(ROOT, f), 'utf8').toLowerCase()
      for (const n of names) if (text.includes(n.toLowerCase())) hits.push(`${f}: ${n}`)
    }
    expect(hits).toEqual([])
  })
})
