// @ts-check
/** The source pass: numbers read statically, snippets cut by name, and every failure loud. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  ANY_MARKER,
  clearSourceCache,
  constRefsIn,
  cutSnippet,
  formatConstant,
  highlight,
  lookupConstant,
  resolveSources,
  snippetRefsIn,
} from '../../src/making-of/index.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'umm-making-of-'))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

/** @param {string} file @param {string} text */
const write = (file, text) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
  fs.writeFileSync(path.join(root, file), text)
}

write(
  'src/sim/tuning.ts',
  `import { BASE } from './base'
import { SHARED } from '@/shared'
export { RENAMED as OUTER } from './base'
const half = (x: number) => x / 2
const sum = (a: number, b = 3) => { return a + b }
export const SIM_DT = 1 / 60
export const TUNING = {
  hull: BASE * 2,
  turn: half(BASE),
  added: sum(1),
  far: SHARED + 1,
  spun: Math.PI * 2,
  name: 'hull' as const,
  on: true,
  weird: new Map(),
  method() { return 1 },
  list: [{ wavelength: 12 }, { wavelength: 24 }],
}
export const NOPE = Math.random()
export const STATS = () => ({ top: 9 })
export class Ship {
  /** The comment stays out. */
  steer(by: number) {
    return by * 2
  }
}
/** Left out. */
export function tierFor(t: number): number {
  return t > 1 ? 2 : 1
}
`,
)
write('src/sim/base.ts', `export const BASE = 4\nexport const RENAMED = 7\n`)
write('src/shared.ts', `export const SHARED = 10\n`)
write('src/data.json', `{ "first": { "react": 0.25 } }\n`)

/** @param {string} ref */
const value = (ref) => lookupConstant(root, ref).value

describe('lookupConstant', () => {
  it('evaluates through arithmetic, imports, the alias, calls and defaults', () => {
    expect(value('src/sim/tuning.ts#TUNING.hull')).toBe(8)
    expect(value('src/sim/tuning.ts#TUNING.turn')).toBe(2)
    expect(value('src/sim/tuning.ts#TUNING.added')).toBe(4)
    expect(value('src/sim/tuning.ts#TUNING.far')).toBe(11)
    expect(value('src/sim/tuning.ts#TUNING.spun')).toBeCloseTo(Math.PI * 2)
    expect(value('src/sim/tuning.ts#SIM_DT')).toBeCloseTo(1 / 60)
    expect(value('src/sim/tuning.ts#OUTER')).toBe(7)
  })

  it('reads strings, booleans, array indices and a function on the path', () => {
    expect(value('src/sim/tuning.ts#TUNING.name')).toBe('hull')
    expect(value('src/sim/tuning.ts#TUNING.on')).toBe(true)
    expect(value('src/sim/tuning.ts#TUNING.list.1.wavelength')).toBe(24)
    expect(value('src/sim/tuning.ts#STATS.top')).toBe(9)
  })

  it('reads a path into a JSON file', () => {
    expect(value('src/data.json#first.react')).toBe(0.25)
  })

  it('fails on one exotic field only when it is read', () => {
    expect(value('src/sim/tuning.ts#TUNING.hull')).toBe(8)
    expect(() => value('src/sim/tuning.ts#TUNING.weird')).toThrow(/does not resolve/)
    expect(() => value('src/sim/tuning.ts#TUNING.method')).toThrow(/is a method/)
  })

  it('never executes: a call outside the subset throws', () => {
    expect(() => value('src/sim/tuning.ts#NOPE')).toThrow(/does not resolve/)
  })

  it('throws naming the reference for a missing name, file or a non-value', () => {
    expect(() => value('src/sim/tuning.ts#GONE')).toThrow(/GONE/)
    expect(() => value('src/gone.ts#X')).toThrow(/does not exist/)
    expect(() => value('no-hash')).toThrow(/must be <file>#<name>/)
    expect(() => value('src/sim/tuning.ts#TUNING.list')).toThrow(/not a number, string or boolean/)
  })

  it('takes another alias, and a game lookup goes first', () => {
    write('lib/other.ts', `import { BASE } from '~/base'\nexport const X = BASE + 1\n`)
    const alias = { '~/': 'src/sim/' }
    expect(lookupConstant(root, 'lib/other.ts#X', { alias }).value).toBe(5)
    const lookup = (/** @type {string} */ _root, /** @type {string} */ ref) =>
      ref === 'sheet.key' ? { ref, file: '', value: 3, unit: 'm', note: 'measured' } : null
    expect(lookupConstant(root, 'sheet.key', { lookup }).value).toBe(3)
    expect(lookupConstant(root, 'src/sim/tuning.ts#SIM_DT', { lookup }).file).toContain('tuning')
  })
})

describe('formatConstant', () => {
  const hit = { ref: 'r', file: 'f', value: 0.123456789, unit: 'm' }

  it('trims to six significant figures, or fixes the decimals', () => {
    expect(formatConstant(hit)).toBe('0.123457')
    expect(formatConstant({ ...hit, value: 2 })).toBe('2')
    expect(formatConstant(hit, { digits: '2' })).toBe('0.12')
  })

  it('scales, takes the reciprocal, and adds a unit after a no-break space', () => {
    expect(formatConstant({ ...hit, value: 0.5 }, { scale: '1000', unit: 'ms' })).toBe('500 ms')
    expect(formatConstant({ ...hit, value: 0.25 }, { reciprocal: true })).toBe('4')
    expect(formatConstant(hit, { digits: '1', unit: 'auto' })).toBe('0.1 m')
  })
})

describe('cutSnippet', () => {
  it('cuts by name, without the doc comment, and gives the lines', () => {
    const hit = cutSnippet(root, 'src/sim/tuning.ts#tierFor')
    expect(hit.text.startsWith('export function tierFor')).toBe(true)
    expect(hit.text).not.toContain('Left out')
    expect(hit.endLine - hit.startLine).toBe(2)
  })

  it('cuts one member of a class, dedented', () => {
    const hit = cutSnippet(root, 'src/sim/tuning.ts#Ship.steer')
    expect(hit.text).toBe('steer(by: number) {\n  return by * 2\n}')
  })

  it('throws naming what is missing', () => {
    expect(() => cutSnippet(root, 'src/sim/tuning.ts#gone')).toThrow(/no top-level declaration/)
    expect(() => cutSnippet(root, 'src/sim/tuning.ts#Ship.gone')).toThrow(/no member named gone/)
    expect(() => cutSnippet(root, 'src/gone.ts#x')).toThrow(/does not exist/)
  })

  it('reads a file again after clearSourceCache', () => {
    write('src/moves.ts', `export const a = 1\n`)
    expect(cutSnippet(root, 'src/moves.ts#a').text).toContain('= 1')
    write('src/moves.ts', `export const a = 2\n`)
    expect(cutSnippet(root, 'src/moves.ts#a').text).toContain('= 1')
    clearSourceCache()
    expect(cutSnippet(root, 'src/moves.ts#a').text).toContain('= 2')
  })
})

describe('highlight', () => {
  it('marks tokens and escapes the text', () => {
    const out = highlight(`const a = 'x<y' // note`)
    expect(out).toContain('<span class="mo-tok-kw">const</span>')
    expect(out).toContain('<span class="mo-tok-str">&#39;x'.replace('&#39;', "'"))
    expect(out).toContain('x&lt;y')
  })
})

describe('resolveSources', () => {
  const page = `<p><span data-const="src/sim/tuning.ts#TUNING.hull" data-unit="m" data-digits="1"></span></p>
<pre data-snippet="src/sim/tuning.ts#tierFor" data-caption="The rule"></pre>`

  it('finds the markers, and leaves none behind', () => {
    expect(constRefsIn(page)).toEqual(['src/sim/tuning.ts#TUNING.hull'])
    expect(snippetRefsIn(page)).toEqual(['src/sim/tuning.ts#tierFor'])
    const out = resolveSources(root, page, 'making-of/x')
    expect(out).not.toMatch(ANY_MARKER)
    expect(out).toContain('<span class="mo-const" title="src/sim/tuning.ts#TUNING.hull">8.0 m')
    expect(out).toContain('<figure class="mo-snippet">')
    expect(out).toContain('The rule · ')
  })

  it('links a snippet only when the game names its repo', () => {
    expect(resolveSources(root, page, 'x')).not.toContain('<a href')
    const out = resolveSources(root, page, 'x', {
      repoBlob: 'https://example.com/me/game/blob/main',
    })
    expect(out).toMatch(
      /href="https:\/\/example\.com\/me\/game\/blob\/main\/src\/sim\/tuning\.ts#L\d+-L\d+"/,
    )
  })

  it('puts a lookup note in the tooltip', () => {
    const lookup = () => ({ ref: 'k', file: '', value: 1, note: 'trust: measured' })
    const out = resolveSources(root, '<span data-const="k"></span>', 'x', { lookup })
    expect(out).toContain('title="k · trust: measured"')
  })

  it('a filled element is not a marker: the source carries no copy of the value', () => {
    const filled = '<span data-const="src/gone.ts#X">9</span>'
    expect(constRefsIn(filled)).toEqual([])
    expect(filled).toMatch(ANY_MARKER)
  })

  it('names the page when one does not resolve', () => {
    expect(() =>
      resolveSources(root, '<span data-const="src/gone.ts#X"></span>', 'making-of/flight'),
    ).toThrow(/making-of\/flight: data-const "src\/gone\.ts#X"/)
  })
})
