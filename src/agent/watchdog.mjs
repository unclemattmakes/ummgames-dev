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
 * the watchdog asks Windows once, at that moment, for the live processes whose parent was the
 * child, and kills each of those trees. It never kills by the child's pid alone: Windows reuses
 * pids, and a process holding it that was created after the command started is a stranger. On POSIX the command is its own process group and the group is killed.
 *
 * Why it raises its priority first: `gpu run` lowers itself to `gpu.priority` before starting
 * this, so this process and the PowerShell it starts run below normal too. Asking Windows takes
 * about a second on a quiet machine, but on a busy one a below-normal PowerShell waits for every
 * normal process and takes more than 12 s. The command then runs on, and the head of the queue
 * reclaims the lease on top of it after `gpu.staleGraceSeconds`. The yielding is for the GPU job;
 * this is one short query that decides when the GPU comes back.
 *
 *   node watchdog.mjs <owner pid> <child pid> <child start ms> <lease dir> <token> <name>
 *
 * The owner kills this process when it finishes normally. If it is ever still running after a
 * normal finish, it finds the lease no longer carries its token and exits without killing.
 */
import os from 'node:os'
import { Lease } from './lease.mjs'
import { killTree, pidAlive, sleep, WIN } from './proc.mjs'
import { snapshot, treeTops } from './tree.mjs'

async function main() {
  const [owner, child, started, dir, token, name] = process.argv.slice(2)
  const ownerPid = Number(owner)
  const childPid = Number(child)
  while (pidAlive(ownerPid)) await sleep(500)
  if (!token || !dir || !childPid) return
  const L = new Lease(dir, null)
  if (L.holder()?.node?.token !== token) return // finished normally
  // Never kill the child's pid blind on Windows: the job has already killed it, so that pid may
  // now be someone else's. treeTops checks who holds it.
  if (WIN) {
    try {
      os.setPriority(os.constants.priority.PRIORITY_NORMAL)
    } catch {}
    for (const pid of treeTops(snapshot(), childPid, Number(started))) killTree(pid)
  } else killTree(childPid)
  if (L.releaseOwn(token)) {
    L.log(`RUN ${name}: umm-dev died; killed its command tree and released`)
  }
}

main().then(
  () => process.exit(0),
  () => process.exit(1),
)
