// @ts-check
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { headersFor } from '../../src/testing/index.mjs'
import { headersFile } from '../../src/vite/index.mjs'

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'umm-headers-for-'))
afterAll(() => fs.rmSync(dist, { recursive: true, force: true }))

describe('headersFor', () => {
  it('reads every rule that matches a path, in order, with names lower-cased', () => {
    fs.writeFileSync(
      path.join(dist, '_headers'),
      `# a comment\n${headersFile({ immutableAssets: true, rules: { '/assets/*': { 'X-Extra': '1' } } })}`,
    )
    expect(headersFor(dist, '/')).toMatchObject({
      'x-frame-options': 'SAMEORIGIN',
      'content-security-policy': "frame-ancestors 'self'",
    })
    expect(headersFor(dist, '/')).not.toHaveProperty('cache-control')
    expect(headersFor(dist, '/assets/index-CmsxLgAy.js')).toMatchObject({
      'x-frame-options': 'SAMEORIGIN',
      'cache-control': 'public, max-age=31536000, immutable',
      'x-extra': '1',
    })
  })

  it('is empty for a build with no _headers', () => {
    expect(headersFor(path.join(dist, 'nowhere'), '/')).toEqual({})
  })
})
