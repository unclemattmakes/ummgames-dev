// @ts-check
/**
 * Which processes the run watchdog may kill once umm-dev has died. Windows reuses pids, so a
 * process holding the dead command's pid must never be mistaken for it.
 */
import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { killTree, pidAlive } from '../../src/agent/proc.mjs'
import { treeTops } from '../../src/agent/tree.mjs'

const since = 1_000_000

describe('treeTops', () => {
  it('kills nothing when the dead command pid now belongs to a newer process', () => {
    const procs = [
      { pid: 100, ppid: 4, created: since + 5000 }, // a stranger that reused the pid
      { pid: 101, ppid: 100, created: since + 6000 }, // the stranger's own child
    ]
    expect(treeTops(procs, 100, since)).toEqual([])
  })

  it('kills the orphans of a dead command, not an old process that names the pid as parent', () => {
    const procs = [
      { pid: 201, ppid: 100, created: since + 200 }, // the command's child, now an orphan
      { pid: 202, ppid: 100, created: since - 60_000 }, // a child of an older process with that pid
      { pid: 203, ppid: 201, created: since + 300 }, // a grandchild: taskkill /T on 201 takes it
    ]
    expect(treeTops(procs, 100, since)).toEqual([201])
  })

  it('kills the command itself while it is still the process holding its pid', () => {
    expect(treeTops([{ pid: 100, ppid: 4, created: since - 5 }], 100, since)).toEqual([100])
  })
})

describe.skipIf(process.platform === 'win32')('killTree on POSIX', () => {
  it('signals only a process group, never a bare pid that leads none', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], {
      stdio: 'ignore',
    })
    await new Promise((r) => child.once('spawn', r))
    killTree(child.pid)
    expect(pidAlive(child.pid)).toBe(true)
    child.kill('SIGKILL')
  })
})
