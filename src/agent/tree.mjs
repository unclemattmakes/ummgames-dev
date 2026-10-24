// @ts-check
/**
 * Finding a dead command's process tree on Windows, for the run watchdog (watchdog.mjs).
 */
import { spawnSync } from 'node:child_process'

/** @typedef {{ pid: number, ppid: number, created: number }} Proc */

/**
 * Every process on this machine, from one CIM query.
 * @returns {Proc[]}
 */
export function snapshot() {
  const ps = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "Get-CimInstance Win32_Process | ForEach-Object { '{0} {1} {2}' -f $_.ProcessId, $_.ParentProcessId, ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() }",
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 30_000 },
  )
  /** @type {Proc[]} */
  const out = []
  for (const line of (ps.stdout ?? '').split(/\r?\n/)) {
    const [pid, ppid, created] = line.trim().split(' ').map(Number)
    if (pid && ppid !== undefined && created !== undefined) out.push({ pid, ppid, created })
  }
  return out
}

/**
 * The tops of the trees to kill for a command whose root pid was `root`, spawned just before
 * `since`.
 *
 * By the time the watchdog looks, Node's job has usually killed the root, and Windows reuses
 * pids. A live process holding the root's pid that was created AFTER `since` is a stranger, and
 * so is anything whose parent pid points at it: then nothing is killed (the lease is still
 * released). A live root created before `since` can only be the command itself, since two live
 * processes never share a pid.
 * @param {Proc[]} procs
 * @param {number} root
 * @param {number} since  epoch ms, taken just after the root was spawned
 * @returns {number[]}
 */
export function treeTops(procs, root, since) {
  const self = procs.find((p) => p.pid === root)
  if (self) return self.created > since ? [] : [root]
  // Orphans keep their dead parent's pid; one created long before the command is not its child.
  return procs.filter((p) => p.ppid === root && p.created + 1000 >= since).map((p) => p.pid)
}
