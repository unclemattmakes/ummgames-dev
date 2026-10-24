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
 *   node watchdog.mjs <owner pid> <child pid> <child start ms> <lease dir> <token> <name>
 *
 * The owner kills this process when it finishes normally. If it is ever still running after a
 * normal finish, it finds the lease no longer carries its token and exits without killing.
 */
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
  if (WIN) for (const pid of treeTops(snapshot(), childPid, Number(started))) killTree(pid)
  else killTree(childPid)
  if (L.releaseOwn(token)) {
    L.log(`RUN ${name}: umm-dev died; killed its command tree and released`)
  }
}

main().then(
  () => process.exit(0),
  () => process.exit(1),
)
