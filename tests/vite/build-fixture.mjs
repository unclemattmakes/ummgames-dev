// @ts-check
/** Build the fixture game (or another root) with Vite into a fresh temporary folder. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const FIXTURE = path.join(REPO, 'tests/vite/fixtures/game')

/** @type {string[]} */
const made = []

/** A fresh empty folder under the OS temp dir; `cleanUp()` removes them all. */
export function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'umm-vite-'))
  made.push(dir)
  return dir
}

export function cleanUp() {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true })
}

/**
 * @param {{
 *   root?: string,
 *   mode?: string,
 *   base?: string,
 *   publicDir?: string | false,
 *   plugins?: import('vite').PluginOption[],
 * }} [options]
 * @returns {Promise<{ out: string, files: string[], read: (f: string) => string }>}
 */
export async function buildFixture(options = {}) {
  const out = tempDir()
  await build({
    root: options.root ?? FIXTURE,
    configFile: false,
    logLevel: 'silent',
    mode: options.mode ?? 'production',
    base: options.base ?? '/',
    publicDir: options.publicDir ?? 'public',
    plugins: options.plugins ?? [],
    build: { outDir: out, emptyOutDir: true, minify: false, target: 'es2022' },
  })
  const files = fs
    .readdirSync(out, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => path.relative(out, path.join(d.parentPath, d.name)).replace(/\\/g, '/'))
    .sort()
  return { out, files, read: (f) => fs.readFileSync(path.join(out, f), 'utf8') }
}
