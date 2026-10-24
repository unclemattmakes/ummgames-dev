// @ts-check
/**
 * Process helpers for the agent kit: is a pid alive, kill a whole tree, and spawn a command
 * the same way on Windows and elsewhere.
 *
 * Windows needs care in three places:
 * - Node refuses to spawn a `.cmd` or `.bat` shim (pnpm, npx) without a shell, so those run
 *   through `cmd.exe /d /s /c` with each argument quoted here, never with `shell: true`.
 * - A Windows child outlives its parent, and `process.kill` reaches one process only, so a tree
 *   is killed with `taskkill /T /F`.
 * - A pid printed by Git Bash (`$$`, `$!`) is an MSYS pid, not a Windows one. `pidAlive` here
 *   answers for native pids only; `msys.mjs` answers for MSYS pids.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export const WIN = process.platform === 'win32'

/**
 * True while a native process with this pid exists. EPERM means it exists and is not ours.
 * @param {number | null | undefined} pid
 */
export function pidAlive(pid) {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return /** @type {NodeJS.ErrnoException} */ (e).code === 'EPERM'
  }
}

/** @param {number} ms */
export function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** @param {number} ms */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Kill a process and everything it started. On POSIX the command was spawned as its own process
 * group (`detached`), so the group gets SIGTERM, then SIGKILL if it is still there after 2 s.
 * @param {number | null | undefined} pid
 */
export function killTree(pid) {
  if (!pid) return
  if (WIN) {
    if (pidAlive(pid)) {
      spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], {
        stdio: 'ignore',
        windowsHide: true,
      })
    }
    return
  }
  // The group outlives its leader, so signal it even when `pid` itself is gone. Only the group:
  // the command is always spawned detached, so it leads its own, and a bare pid could be reused.
  /** @param {NodeJS.Signals | 0} sig */
  const send = (sig) => {
    try {
      process.kill(-pid, sig)
      return true
    } catch {
      return false
    }
  }
  if (!send('SIGTERM')) return
  for (let i = 0; i < 20 && send(0); i++) sleepSync(100)
  if (send(0)) send('SIGKILL')
}

/**
 * Find an executable on PATH the way cmd.exe would (PATHEXT), or null.
 * @param {string} cmd
 * @param {NodeJS.ProcessEnv} [env]
 */
export function which(cmd, env = process.env) {
  const exts = WIN ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : ['']
  const hasExt = WIN && path.extname(cmd) !== ''
  /** @param {string} base */
  const tryBase = (base) => {
    for (const ext of hasExt ? ['', ...exts] : exts) {
      const f = base + ext
      try {
        if (fs.statSync(f).isFile()) return f
      } catch {}
    }
    return null
  }
  if (cmd.includes('/') || cmd.includes('\\')) return tryBase(path.resolve(cmd))
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean)
  for (const d of dirs) {
    const f = tryBase(path.join(d, cmd))
    if (f) return f
  }
  return null
}

/**
 * Quote one argument for a cmd.exe command line.
 * @param {string} arg
 */
function quoteCmd(arg) {
  if (arg === '') return '""'
  return /[\s"&|<>^(),;=!%]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg
}

/**
 * How to spawn `cmd args` on this platform, without `shell: true`.
 * @param {string} cmd
 * @param {string[]} args
 * @returns {{ file: string, args: string[], verbatim: boolean }}
 */
export function resolveCommand(cmd, args) {
  if (!WIN) return { file: cmd, args, verbatim: false }
  const found = which(cmd)
  if (found && /\.(exe|com)$/i.test(found)) return { file: found, args, verbatim: false }
  // A .cmd/.bat shim, or something only cmd.exe knows (a builtin): one quoted command line.
  const line = [found ?? cmd, ...args].map(quoteCmd).join(' ')
  return {
    file: process.env.ComSpec ?? 'cmd.exe',
    args: ['/d', '/s', '/c', `"${line}"`],
    verbatim: true,
  }
}
