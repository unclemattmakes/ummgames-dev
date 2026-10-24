// @ts-check
/**
 * `umm-dev guard install-hooks`: write git hooks that run the game's guards.
 *
 * Only when someone runs it. Never from an install script: the package installs from git, and
 * pnpm would run a `prepare` in every worktree (CLAUDE.md rule 5).
 *
 * Each hook is a few lines of POSIX sh (Git Bash on Windows, any sh elsewhere) that finds this
 * package in the work tree's node_modules, or the main checkout's (a fresh worktree has none),
 * and runs `umm-dev guard hook <name>`. Which checks run is the game's `guard.hooks` config, so
 * changing them never needs a reinstall. The hook FAILS CLOSED: no node, or no package, refuses
 * the commit, because "cannot check" must never read as "nothing wrong".
 */
import fs from 'node:fs'
import path from 'node:path'
import { git } from './git.mjs'

export const HOOK_MARK = '# umm-dev hook:'

/** @param {string} name */
export function hookScript(name) {
  return `#!/bin/sh
${HOOK_MARK} written by \`umm-dev guard install-hooks\`. It runs the checks listed under
# guard.hooks in umm-dev.config.mjs. Re-run install-hooks to rewrite it; delete it to stop.
set -u
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 1
bin="$root/node_modules/@ummgames/dev/bin/umm-dev.mjs"
if [ ! -f "$bin" ]; then
  common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
  bin="$(dirname "$common")/node_modules/@ummgames/dev/bin/umm-dev.mjs"
fi
if [ ! -f "$bin" ]; then
  echo "${name}: @ummgames/dev is not installed here or in the main checkout; refusing blind." >&2
  echo "${name}: run pnpm install, or bypass deliberately with --no-verify." >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "${name}: node is not on PATH, so the guards cannot run. Bypass deliberately with --no-verify." >&2
  exit 1
fi
exec node "$bin" guard hook ${name} "$@"
`
}

/**
 * @param {{ cwd: string, dir?: string, hooks: string[], force?: boolean }} o
 * @param {(line: string) => void} say
 * @returns {number}
 */
export function installHooks(o, say) {
  let dir = o.dir
  if (!dir) {
    try {
      dir = git(['rev-parse', '--path-format=absolute', '--git-path', 'hooks'], o.cwd).trim()
    } catch {
      say('install-hooks: not inside a git work tree; nothing to install.')
      return 1
    }
  }
  dir = path.resolve(o.cwd, dir)
  fs.mkdirSync(dir, { recursive: true })
  let refused = 0
  for (const name of o.hooks) {
    const file = path.join(dir, name)
    const exists = fs.existsSync(file)
    if (exists && !fs.readFileSync(file, 'utf8').includes(HOOK_MARK) && !o.force) {
      say(`install-hooks: ${file} exists and is not ours; left alone (--force replaces it).`)
      refused++
      continue
    }
    fs.writeFileSync(file, hookScript(name))
    try {
      fs.chmodSync(file, 0o755)
    } catch {}
    say(`install-hooks: ${exists ? 'rewrote' : 'wrote'} ${file}`)
  }
  return refused > 0 ? 1 : 0
}
