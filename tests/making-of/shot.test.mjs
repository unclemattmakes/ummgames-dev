// @ts-check
/** What counts as a problem on a shot page, and the command's usage. */
import { describe, expect, it, vi } from 'vitest'
import { run } from '../../src/commands/making-of.mjs'
import { MIN_COLOURS, problemsIn } from '../../src/making-of/shot.mjs'

const toy = { id: 'a', file: 'a.png', colours: 200, unmounted: false, readouts: '' }
const clean = { url: 'u', toys: [toy], errors: [], overflow: [] }

describe('problemsIn', () => {
  it('passes a page whose toys drew', () => {
    expect(problemsIn(clean)).toEqual([])
  })

  it('names a toy that drew nothing, and one that never mounted', () => {
    expect(problemsIn({ ...clean, toys: [{ ...toy, colours: MIN_COLOURS - 1 }] })).toEqual([
      `a: drew nothing (${MIN_COLOURS - 1} colours)`,
    ])
    expect(problemsIn({ ...clean, toys: [{ ...toy, unmounted: true }] })).toEqual([
      'a: never mounted',
    ])
  })

  it('counts console errors and anything past the edge', () => {
    expect(problemsIn({ ...clean, errors: ['boom'], overflow: ['div.wide (500px)'] })).toEqual([
      'console: boom',
      'past the edge: div.wide (500px)',
    ])
  })
})

describe('umm-dev making-of', () => {
  it('exits 2 on no subcommand, no pages, or a bad option', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await run([], { cwd: process.cwd() })).toBe(2)
    expect(await run(['shot'], { cwd: process.cwd() })).toBe(2)
    expect(await run(['shot', 'http://x/', '--wait', 'soon'], { cwd: process.cwd() })).toBe(2)
    expect(await run(['shot', '--nope'], { cwd: process.cwd() })).toBe(2)
    err.mockRestore()
  })
})
