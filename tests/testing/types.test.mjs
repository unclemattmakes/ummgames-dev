// @ts-check
/**
 * The public entry points by their package names, so tsc checks the hand-written `.d.ts` files
 * against real Vite types and Vite's resolver finds them through `exports`.
 */
import * as testing from '@ummgames/dev/testing'
import * as vite from '@ummgames/dev/vite'
import { describe, expect, it } from 'vitest'

/** Never called: it only has to typecheck. */
function _typesOnly() {
  /** @type {import('vite').Plugin[]} */
  const plugins = [
    vite.headers({ immutableAssets: true }),
    vite.notFoundPage(),
    vite.licences({ page: 'licences.html' }),
    vite.appIcon({ svg: 'icon.svg', shareCard: true }),
  ]
  void plugins
  /** @type {Record<string, string>} */
  const h = testing.headersFor('dist', '/')
  void h
}
void _typesOnly

describe('the package entry points', () => {
  it('export what their .d.ts files declare', () => {
    expect(testing).toHaveProperty('headersFor')
    for (const name of ['headers', 'securityHeaders', 'notFoundPage', 'licences', 'appIcon']) {
      expect(vite).toHaveProperty(name)
    }
  })
})
