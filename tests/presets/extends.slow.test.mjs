/**
 * The presets resolve the way a game names them: a throwaway game under the OS temp dir with
 * this repo linked as node_modules/@ummgames/dev (what `pnpm add -D link:<repo>` makes), then
 * this repo's own Biome and tsc run there.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const game = fs.mkdtempSync(path.join(os.tmpdir(), 'umm-dev-extends-'))
afterAll(() => fs.rmSync(game, { recursive: true, force: true }))

/** @param {string} rel @param {string} text */
const write = (rel, text) => {
  const f = path.join(game, rel)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, text)
}

/** @param {string} bin @param {string[]} args */
function run(bin, args) {
  const js = {
    biome: path.join(ROOT, 'node_modules/@biomejs/biome/bin/biome'),
    tsc: path.join(ROOT, 'node_modules/typescript/bin/tsc'),
  }[bin]
  const r = spawnSync(process.execPath, [/** @type {string} */ (js), ...args], {
    cwd: game,
    encoding: 'utf8',
  })
  return { code: r.status, out: `${r.stdout}${r.stderr}` }
}

beforeAll(() => {
  // The preset reads .gitignore (vcs.useIgnoreFile), as every game is a git checkout.
  spawnSync('git', ['init', '-q'], { cwd: game })
  write('.gitignore', 'node_modules/\n')
  fs.mkdirSync(path.join(game, 'node_modules/@ummgames'), { recursive: true })
  fs.symlinkSync(ROOT, path.join(game, 'node_modules/@ummgames/dev'), 'junction')
  write('package.json', '{ "name": "game", "private": true, "type": "module" }\n')
  write(
    'biome.json',
    JSON.stringify({ extends: ['@ummgames/dev/biome'], files: { includes: ['src/**'] } }),
  )
  write(
    'tsconfig.json',
    JSON.stringify({
      extends: '@ummgames/dev/tsconfig',
      compilerOptions: { types: [], paths: { '@/*': ['./src/*'] } },
      include: ['src/**/*'],
    }),
  )
  write('src/ok.ts', 'export const pick = (xs: number[]): number => xs[0] ?? 0\n')
})

describe('extends from @ummgames/dev', () => {
  it('Biome: "extends": ["@ummgames/dev/biome"] applies the preset’s style', () => {
    write('src/style.ts', 'export const s = "double"\n')
    const r = run('biome', ['format', 'src/style.ts'])
    // Biome's default is double quotes; the preset's is single.
    expect(r.out).toContain("export·const·s·=·'double'")
    fs.rmSync(path.join(game, 'src/style.ts'))
    expect(run('biome', ['check', 'src']).code).toBe(0)
  })

  it('tsc: "extends": "@ummgames/dev/tsconfig" applies the strict base', () => {
    expect(run('tsc', ['-p', '.']).code).toBe(0)
    write('src/loose.ts', 'export const first = (xs: number[]): number => xs[0]\n')
    const r = run('tsc', ['-p', '.'])
    // noUncheckedIndexedAccess comes from the preset.
    expect(r.out).toMatch(/loose\.ts.*TS2322/)
    fs.rmSync(path.join(game, 'src/loose.ts'))
  })
})
