// @ts-check
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createImportGraph } from '../../src/testing/index.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'umm-graph-'))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

/** @type {Record<string, string>} */
const FILES = {
  'src/entry.ts': `import { a } from './a'
import { b } from '@/b.js'
import type { T } from './types'
import { type U, c } from './c'
import './side.css'
import data from './data.json?raw'
import three from 'three'
const later = () => import('./lazy')
`,
  'src/a.ts': `import { deep } from './dir'\nexport const a = 1\n`,
  'src/dir/index.ts': `export const deep = 1\n`,
  'src/b.ts': `export const b = 1\n`,
  'src/c.ts': `export const c = 1\n`,
  'src/types.ts': `export type T = number\n`,
  'src/side.css': `@import './nothing';\n`,
  'src/data.json': `{ "from": "'./a'" }\n`,
  'src/lazy.ts': `export const never = 1\n`,
  'src/a.test.ts': `export {}\n`,
  'src/ambient.d.ts': `export {}\n`,
  'tools/run.mjs': `import { a } from '../src/a'\nimport { x } from './x.mjs'\n`,
  'tools/x.mjs': `export const x = 1\n`,
  'tests/width.test.ts': `import '../src/a.test'\nimport '../src/ambient.d'\nimport '../src/b'\n`,
}
for (const [file, text] of Object.entries(FILES)) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
  fs.writeFileSync(path.join(root, file), text)
}

const graph = createImportGraph({ root })
const entry = path.join(root, 'src/entry.ts')
/** @param {import('../../src/testing/index.d.ts').ImportWalkOptions} [o] */
const walked = (o) => [...graph.walkImports(entry, o)].map((n) => graph.rel(n.file))

describe('createImportGraph', () => {
  it('walks relative imports, the alias, a folder index and a .js spelling of .ts', () => {
    expect(walked()).toEqual(
      expect.arrayContaining(['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/dir/index.ts']),
    )
  })

  it('yields the entry first, with the chain that reached each file', () => {
    const nodes = [...graph.walkImports(entry)]
    expect(nodes[0]?.file).toBe(entry)
    const deep = nodes.find((n) => n.file.endsWith('index.ts'))
    expect(deep?.chain.map(graph.rel)).toEqual(['src/entry.ts', 'src/a.ts', 'src/dir/index.ts'])
  })

  it('follows side-effect imports and strips a query, but treats non-source files as leaves', () => {
    expect(walked()).toEqual(expect.arrayContaining(['src/side.css', 'src/data.json']))
    expect(graph.importsOf(path.join(root, 'src/entry.ts'))).toContain('./side.css')
  })

  it('stops at packages and does not follow a dynamic import', () => {
    expect(graph.resolveSpecifier(entry, 'three')).toBeNull()
    expect(walked()).not.toContain('src/lazy.ts')
  })

  it('valueOnly drops a whole type statement, but not an inline type', () => {
    expect(walked()).toContain('src/types.ts')
    const values = walked({ valueOnly: true })
    expect(values).not.toContain('src/types.ts')
    expect(values).toContain('src/c.ts')
  })

  it('resolves .mjs, for a walk from plain Node tools', () => {
    const tool = path.join(root, 'tools/run.mjs')
    const files = [...graph.walkImports(tool)].map((n) => graph.rel(n.file))
    expect(files).toEqual(expect.arrayContaining(['tools/x.mjs', 'src/a.ts']))
  })

  it('takes another alias', () => {
    const other = createImportGraph({ root, alias: { '~/': 'src/dir/' } })
    expect(other.resolveSpecifier(entry, '~/index')).toBe(path.join(root, 'src/dir/index.ts'))
    expect(other.resolveSpecifier(entry, '@/b')).toBeNull()
  })

  it('counts a file width: modules under src, not tests or declarations', () => {
    const width = graph.reachable(path.join(root, 'tests/width.test.ts'))
    expect([...width]).toEqual(['src/b.ts'])
  })
})
