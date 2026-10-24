// @ts-check
/**
 * The MSYS bridge: how a Node process on Windows takes part in a lease that Git Bash scripts
 * also read.
 *
 * Git Bash numbers its processes itself. `kill -0 <pid>` in bash sees only those MSYS pids, and
 * Node's `process.kill(pid, 0)` sees only Windows pids. So a bash-era lease script would sweep a
 * ticket that carries Node's pid as dead, and Node cannot tell whether a bash ticket's pid lives.
 *
 * The bridge is one small bash process per lease user, started from Git's own bash:
 * - its `$$` is an MSYS pid that every Git Bash on the machine sees, so it goes in the pid field
 *   that bash scripts check;
 * - it answers `kill -0` questions about MSYS pids, one per line on its stdin;
 * - it exits when its stdin closes, which happens when the Node process ends in any way,
 *   TerminateProcess included, so its pid dies with the Node process that owns it.
 */
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { WIN } from './proc.mjs'

/**
 * Git's bash on Windows, or null. `UMM_DEV_BASH` names one (or `none` to turn the bridge off).
 * Found through `git --exec-path` rather than PATH, because `bash` on a Windows PATH can be
 * WSL's, whose pids are a third namespace.
 */
export function findBash() {
  const env = process.env.UMM_DEV_BASH
  if (env === 'none' || env === '0') return null
  if (env) return env
  if (!WIN) return null
  try {
    const exec = execFileSync('git', ['--exec-path'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim()
    const root = path.resolve(exec, '..', '..', '..')
    for (const rel of ['usr/bin/bash.exe', 'bin/bash.exe']) {
      const p = path.join(root, rel)
      if (fs.existsSync(p)) return p
    }
  } catch {}
  return null
}

const SCRIPT =
  'echo $$; while IFS= read -r p; do if kill -0 "$p" 2>/dev/null; then echo 1; else echo 0; fi; done'

/**
 * @typedef {{ pid: number, alive: (pid: number) => Promise<boolean>, close: () => void }} Bridge
 */

/**
 * Start a bridge, or resolve null when there is no bash or it does not answer in 5 s.
 * @param {string | null} [bash]
 * @returns {Promise<Bridge | null>}
 */
export function openBridge(bash = findBash()) {
  if (!bash) return Promise.resolve(null)
  return new Promise((resolve) => {
    const child = spawn(bash, ['--noprofile', '--norc', '-c', SCRIPT], {
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    })
    /** @type {((line: string) => void)[]} */
    const waiting = []
    let buf = ''
    let pid = 0
    let closed = false
    const timer = setTimeout(() => finish(null), 5000)
    /** @param {Bridge | null} b */
    function finish(b) {
      clearTimeout(timer)
      if (!b) close()
      resolve(b)
    }
    function close() {
      if (closed) return
      closed = true
      try {
        child.stdin.end()
      } catch {}
      try {
        child.kill()
      } catch {}
      for (const w of waiting.splice(0)) w('')
    }
    child.on('error', () => finish(null))
    child.on('exit', () => {
      closed = true
      for (const w of waiting.splice(0)) w('')
    })
    child.stdin.on('error', () => {})
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (/** @type {string} */ d) => {
      buf += d
      for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!pid) {
          pid = Number(line)
          if (!Number.isInteger(pid) || pid <= 0) return finish(null)
          finish({
            pid,
            close,
            alive: (p) =>
              new Promise((res) => {
                if (closed || !Number.isInteger(p) || p <= 0) return res(false)
                waiting.push((ans) => res(ans === '1'))
                child.stdin.write(`${p}\n`)
              }),
          })
        } else {
          waiting.shift()?.(line)
        }
      }
    })
  })
}
