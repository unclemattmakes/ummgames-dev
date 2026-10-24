import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { findGameRoot, loadConfig } from '../src/config.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'umm-dev-config-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

describe('loadConfig', () => {
  it('finds the game root from a subfolder and merges one level deep', async () => {
    fs.writeFileSync(path.join(tmp, 'package.json'), '{}')
    fs.writeFileSync(
      path.join(tmp, 'umm-dev.config.mjs'),
      "export default { capture: { port: 6000, query: { splash: '0' } } }",
    )
    const sub = path.join(tmp, 'tools', 'deep')
    fs.mkdirSync(sub, { recursive: true })
    expect(findGameRoot(sub)).toBe(tmp)
    const cfg = await loadConfig('capture', { port: 5432, fps: 60, query: { dpr: '1' } }, sub)
    expect(cfg).toEqual({ port: 6000, fps: 60, query: { dpr: '1', splash: '0' }, root: tmp })
  })

  it('returns the defaults when a section is missing', async () => {
    const cfg = await loadConfig('store', { out: 'dist-store' }, tmp)
    expect(cfg.out).toBe('dist-store')
  })
})
