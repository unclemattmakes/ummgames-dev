#!/usr/bin/env node
// @ts-check
/**
 * `umm-dev <command> [args]`: one entry point for every tool in @ummgames/dev.
 *
 * Each command is `src/commands/<name>.mjs`, exporting `describe` (one line) and
 * `run(argv, ctx)`. Adding a command is adding a file: package.json never changes.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const COMMANDS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/commands')

/** @returns {string[]} */
export function listCommands() {
  if (!fs.existsSync(COMMANDS)) return []
  return fs
    .readdirSync(COMMANDS)
    .filter((f) => f.endsWith('.mjs') && !f.startsWith('_'))
    .map((f) => f.slice(0, -'.mjs'.length))
    .sort()
}

/**
 * @param {string} name
 * @returns {Promise<{ describe: string, run: (argv: string[], ctx: { cwd: string }) => Promise<number | void> | number | void }>}
 */
async function load(name) {
  return import(pathToFileURL(path.join(COMMANDS, `${name}.mjs`)).href)
}

async function help() {
  console.log('usage: umm-dev <command> [args]   (umm-dev <command> --help for its options)\n')
  for (const name of listCommands()) {
    const { describe } = await load(name)
    console.log(`  ${name.padEnd(12)} ${describe}`)
  }
}

/**
 * `--help` or `-h` anywhere before `--`: print the command's help and run nothing, even after a
 * subcommand (`gpu wait --help` would otherwise wait). What follows `--` belongs to a wrapped
 * command (`gpu run -- vite --help`).
 * @param {string[]} args the arguments after the command name
 */
export function wantsHelp(args) {
  const own = args.includes('--') ? args.slice(0, args.indexOf('--')) : args
  return own.includes('--help') || own.includes('-h')
}

/** @param {string[]} argv */
export async function main(argv) {
  const [name, ...rest] = argv
  if (!name || name === 'help' || name === '--help' || name === '-h') {
    await help()
    return 0
  }
  if (!listCommands().includes(name)) {
    console.error(`umm-dev: no command "${name}". Run umm-dev help.`)
    return 2
  }
  const command = await load(name)
  if (wantsHelp(rest)) {
    const code = await command.run(['--help'], { cwd: process.cwd() })
    return typeof code === 'number' ? code : 0
  }
  const code = await command.run(rest, { cwd: process.cwd() })
  return typeof code === 'number' ? code : 0
}

const invoked =
  process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
if (invoked) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : err)
      process.exit(1)
    },
  )
}
