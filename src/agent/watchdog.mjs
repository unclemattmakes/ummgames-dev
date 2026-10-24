// @ts-check
/**
 * The run watchdog: when `umm-dev gpu run` dies without cleaning up (a stopped session, a
 * TerminateProcess, a SIGKILL), kill the command's whole tree and release the lease.
 *
 * Why a separate process: a session's stop often kills the runner outright, which runs no
 * handler, and a command tree outlives its parent. Left alone, the GPU job keeps running while
 * the lease says FREE, and the next session lands on top of it.
 *
 * Why it must FIND the tree on Windows: Node runs a child in a job object that dies with Node,
 * so the direct child goes with it, but the job lets the child's own children break away. So
 * the watchdog asks Windows once, at that moment, for every live process whose parent chain
 * leads back to the child (started after the child, so a reused pid cannot match), and kills
 * each of those trees. On POSIX the command is its own process group and the group is killed.
 *
 *   node watchdog.mjs <owner pid> <child pid> <child start ms> <lease dir> <token> <name>
 *
 * The owner kills this process when it finishes normally. If it is ever still running after a
 * normal finish, it finds the lease no longer carries its token and exits without killing.
 */
import { spawnSync } from 'node:child_process'
import { Lease } from './lease.mjs'
import { killTree, pidAlive, sleep, WIN } from './proc.mjs'

/**
 * Live descendants of `root` (which may itself be dead), created at or after `since`.
 * @param {number} root
 * @param {number} since  epoch ms
 * @returns {number[]}  the direct children of root, each the top of a tree to kill
 */
export function orphansOf(root, since) {
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
  /** @type {Map<number, number[]>} */
  const kids = new Map()
  for (const line of (ps.stdout ?? '').split(/\r?\n/)) {
    const [pid, ppid, created] = line.trim().split(' ').map(Number)
    if (!pid || ppid === undefined || created === undefined || created + 1000 < since) continue
    const list = kids.get(ppid) ?? []
    list.push(pid)
    kids.set(ppid, list)
  }
  return kids.get(root) ?? []
}

async function main() {
  const [owner, child, started, dir, token, name] = process.argv.slice(2)
  const ownerPid = Number(owner)
  const childPid = Number(child)
  while (pidAlive(ownerPid)) await sleep(500)
  const L = new Lease(String(dir), null)
  if (L.holder()?.node?.token !== token) return // finished normally
  if (WIN) {
    killTree(childPid)
    for (const pid of orphansOf(childPid, Number(started))) killTree(pid)
  } else killTree(childPid)
  if (L.releaseOwn(String(token))) {
    L.log(`RUN ${name}: umm-dev died; killed its command tree and released`)
  }
}

main().then(
  () => process.exit(0),
  () => process.exit(1),
)
