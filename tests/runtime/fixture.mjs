// Throwaway packages and games under the OS temp dir, for the copy and drift tests.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** @type {string[]} */
const made = []

/** @param {string} prefix */
export function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  made.push(dir)
  return dir
}

export function cleanup() {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true })
}

/**
 * @param {string} root
 * @param {Record<string, string>} files posix path -> text
 */
export function writeTree(root, files) {
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(root, ...rel.split('/'))
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text)
  }
}

export const A_TS = '/** a */\nexport const a = 1\n'
export const B_TS = "import { a } from './a'\n\nexport const b = a + 1\n"
export const STYLE_CSS = '.x {\n  color: red;\n}\n'

/** A package root with a small runtime/ at `version`. */
export function makePackage(version = '9.9.9') {
  const root = tempDir('umm-dev-pkg-')
  writeTree(root, {
    'package.json': JSON.stringify({ name: '@ummgames/dev', version }),
    'runtime/tsconfig.json': '{}',
    'runtime/kit/a.ts': A_TS,
    'runtime/kit/b.ts': B_TS,
    'runtime/kit/style.css': STYLE_CSS,
    'runtime/kit/data.json': '{}\n',
    'runtime/other/c.ts': 'export const c = 3\n',
  })
  return root
}

/** An empty game: a folder with a package.json. */
export function makeGame() {
  const root = tempDir('umm-dev-game-')
  writeTree(root, { 'package.json': '{"name":"game"}' })
  return root
}

/** @param {string} root @param {string} rel */
export const read = (root, rel) => fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8')
