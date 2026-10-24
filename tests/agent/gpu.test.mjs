// @ts-check
/**
 * The GPU lease, with real concurrent processes: each test starts `umm-dev gpu run` several times
 * against one temp lease dir and reads back when each command started and ended.
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { leaseDir, parseHolder, parseTicket } from '../../src/agent/lease.mjs'
import { findBash } from '../../src/agent/msys.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const BIN = path.join(ROOT, 'bin/umm-dev.mjs')
const HOLD = path.join(ROOT, 'tests/agent/fixtures/hold.mjs')
const LEGACY = path.join(ROOT, 'tests/agent/fixtures/legacy-lease.sh')
const WIN = process.platform === 'win32'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'umm-dev-gpu-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

let n = 0
/** A game root with an optional gpu config, and its own lease dir. @param {object} [gpu] */
function setup(gpu) {
  const dir = path.join(tmp, `g${n++}`)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), '{}')
  if (gpu) {
    fs.writeFileSync(
      path.join(dir, 'umm-dev.config.mjs'),
      `export default ${JSON.stringify({ gpu })}`,
    )
  }
  const lease = path.join(dir, 'lease')
  const log = path.join(dir, 'events.log')
  return { dir, lease, log }
}

/**
 * @param {{ dir: string, lease: string }} g
 * @param {string[]} args
 * @param {Record<string, string>} [env]
 */
function start(g, args, env = {}) {
  const proc = spawn(process.execPath, [BIN, 'gpu', ...args], {
    cwd: g.dir,
    env: { ...process.env, GPU_LEASE_DIR: g.lease, GPU_POLL_SECONDS: '0.05', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  proc.stdout.on('data', (d) => {
    out += d
  })
  proc.stderr.on('data', (d) => {
    out += d
  })
  /** @type {Promise<{ code: number | null, out: string }>} */
  const done = new Promise((resolve) => proc.on('exit', (code) => resolve({ code, out })))
  return { proc, done, out: () => out }
}

/** @param {() => boolean} cond @param {number} [ms] */
async function until(cond, ms = 8000) {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 20))
  }
}

/** @param {string} log @returns {Record<string, { start: number, end: number }>} */
function events(log) {
  /** @type {Record<string, { start: number, end: number }>} */
  const out = {}
  for (const line of fs.readFileSync(log, 'utf8').split('\n').filter(Boolean)) {
    const [tag = '', what, t] = line.split(' ')
    out[tag] ??= { start: 0, end: 0 }
    out[tag][/** @type {'start' | 'end'} */ (what)] = Number(t)
  }
  return out
}

/** @param {string} lease */
const ticketCount = (lease) => {
  try {
    return fs.readdirSync(path.join(lease, 'gpu.queue')).filter((f) => /^[0-9]/.test(f)).length
  } catch {
    return 0
  }
}

/** A pid that is certainly gone. */
function deadPid() {
  return /** @type {number} */ (spawnSync(process.execPath, ['-e', '0']).pid)
}

describe('lease format', () => {
  it('reads the holder and ticket lines older scripts write, and its own marker', () => {
    const legacy = parseHolder('old-name\n1700000000\n20\n')
    expect(legacy).toMatchObject({
      who: 'old-name',
      since: 1700000000,
      asked: 20,
      pid: null,
      node: null,
    })
    const ours = parseHolder('a\n1700000000\n25\n4242\numm-dev/1 99 100 abc\n')
    expect(ours.pid).toBe(4242)
    expect(ours.node).toEqual({ pid: 99, child: 100, token: 'abc' })
    const t = parseTicket('17000000001234567-1', 'f', 'w\n4242\n1700000000\numm-dev/1 99\n')
    expect(t).toMatchObject({ who: 'w', pid: 4242, born: 1700000000, node: { pid: 99 } })
  })

  it('orders microsecond and nanosecond ticket names by time', () => {
    const names = ['1761300000123457-9', '1761300000123456789-1', '1761300000000001-5']
    expect(names.sort()).toEqual([
      '1761300000000001-5',
      '1761300000123456789-1',
      '1761300000123457-9',
    ])
  })

  it('lives in one machine-wide dir, never per repository', () => {
    expect(leaseDir({})).toBe(path.join(os.homedir(), '.umm-dev', 'gpu'))
    expect(leaseDir({ GPU_LEASE_DIR: path.join(tmp, 'x') })).toBe(path.join(tmp, 'x'))
    if (WIN) expect(leaseDir({ GPU_LEASE_DIR: '/c/lease' })).toBe(path.resolve('c:/lease'))
  })
})

describe('umm-dev gpu', () => {
  it('runs two holders one after the other, and waiters in the order they asked', async () => {
    const g = setup()
    const a = start(g, ['run', 'a', '5', '--', process.execPath, HOLD, g.log, 'a', '600'])
    await until(() => a.out().includes('ACQUIRED'))
    const b = start(g, ['run', 'b', '5', '--', process.execPath, HOLD, g.log, 'b', '200'])
    await until(() => ticketCount(g.lease) === 1)
    const c = start(g, ['run', 'c', '5', '--', process.execPath, HOLD, g.log, 'c', '100'])
    await until(() => ticketCount(g.lease) === 2)

    const status = spawnSync(process.execPath, [BIN, 'gpu', 'status', '--json'], {
      cwd: g.dir,
      env: { ...process.env, GPU_LEASE_DIR: g.lease },
      encoding: 'utf8',
    })
    const s = JSON.parse(status.stdout)
    expect(s.holder.who).toBe('a')
    expect(s.queue.map((/** @type {{ who: string }} */ q) => q.who)).toEqual(['b', 'c'])

    const results = await Promise.all([a.done, b.done, c.done])
    expect(results.map((r) => r.code)).toEqual([0, 0, 0])
    const e = events(g.log)
    expect(e.b?.start).toBeGreaterThanOrEqual(e.a?.end ?? Infinity)
    expect(e.c?.start).toBeGreaterThanOrEqual(e.b?.end ?? Infinity)
    expect(fs.existsSync(path.join(g.lease, 'gpu.lock'))).toBe(false)
    const log = fs.readFileSync(path.join(g.lease, 'gpu-lease.log'), 'utf8')
    expect(log.match(/ACQUIRE/g)).toHaveLength(3)
    expect(log.match(/RELEASE/g)).toHaveLength(3)
  })

  it("exits with the command's own code and hands the lease back", async () => {
    const g = setup()
    const r = await start(g, [
      'run',
      '--name',
      'x',
      '--',
      process.execPath,
      '-e',
      'process.exit(3)',
    ]).done
    expect(r.code).toBe(3)
    expect(fs.existsSync(path.join(g.lease, 'gpu.lock'))).toBe(false)
  })

  it('reclaims a stale lock once every process it named is gone', async () => {
    const g = setup({ staleGraceSeconds: 0.2 })
    fs.mkdirSync(path.join(g.lease, 'gpu.lock'), { recursive: true })
    const dead = deadPid()
    fs.writeFileSync(
      path.join(g.lease, 'gpu.lock', 'holder'),
      `crashed\n${Math.floor(Date.now() / 1000)}\n5\n${dead}\numm-dev/1 ${dead} ${dead} t0\n`,
    )
    const r = await start(g, ['run', 'next', '5', '--', process.execPath, '-e', '0']).done
    expect(r.code).toBe(0)
    expect(r.out).toContain("reclaimed a stale lease of 'crashed'")
    expect(fs.readFileSync(path.join(g.lease, 'gpu-lease.log'), 'utf8')).toMatch(
      /RECLAIM stale lease of 'crashed'/,
    )
  })

  it('never reclaims a lock whose holder names no process it can check', async () => {
    const g = setup({ staleGraceSeconds: 0.1 })
    fs.mkdirSync(path.join(g.lease, 'gpu.lock'), { recursive: true })
    const holder = `old-script\n${Math.floor(Date.now() / 1000)}\n20\n`
    fs.writeFileSync(path.join(g.lease, 'gpu.lock', 'holder'), holder)
    const r = await start(
      g,
      ['run', 'waiter', '5', '--wait-limit', '1', '--', process.execPath, '-e', '0'],
      {
        UMM_DEV_GPU_MINUTE_MS: '500',
      },
    ).done
    expect(r.code).toBe(2)
    expect(r.out).toContain("held by 'old-script'")
    expect(fs.readFileSync(path.join(g.lease, 'gpu.lock', 'holder'), 'utf8')).toBe(holder)
    expect(ticketCount(g.lease)).toBe(0)
  })

  it('kills the command tree and releases when umm-dev itself is killed', async () => {
    const g = setup()
    // A grandchild behind a non-Node parent: on Windows it escapes the job Node puts children in.
    const tree = WIN
      ? [path.join(ROOT, 'tests/agent/fixtures/hold-tree.cmd'), g.log, 'a', '3000']
      : ['sh', '-c', `"${process.execPath}" "${HOLD}" "${g.log}" a 3000; :`]
    const a = start(g, ['run', 'a', '5', '--', ...tree])
    await until(() => fs.existsSync(g.log))
    a.proc.kill('SIGKILL') // umm-dev only: no handler runs
    await a.done
    const b = await start(g, ['run', 'b', '5', '--', process.execPath, HOLD, g.log, 'b', '50']).done
    expect(b.code).toBe(0)
    const e = events(g.log)
    expect(e.b?.start).toBeLessThan((e.a?.start ?? 0) + 3000)
    await new Promise((r) => setTimeout(r, Math.max(0, (e.a?.start ?? 0) + 3300 - Date.now())))
    expect(events(g.log).a?.end).toBe(0)
    expect(fs.readFileSync(path.join(g.lease, 'gpu-lease.log'), 'utf8')).toContain('umm-dev died')
  })

  it('caps a booking at the max hold, and --long lifts the cap', async () => {
    const g = setup()
    const print = `console.log('BOOKED', require('fs').readFileSync(process.env.GPU_LEASE_DIR + '/gpu.lock/holder', 'utf8').split('\\n')[2])`
    const capped = await start(g, ['run', 'big', '90', '--', process.execPath, '-e', print]).done
    expect(capped.out).toContain('over the 45m cap')
    expect(capped.out).toContain('BOOKED 45')
    const long = await start(g, ['run', 'big', '90', '--long', '--', process.execPath, '-e', print])
      .done
    expect(long.out).toContain('BOOKED 90')
  })

  it('stops a command at the end of its booking when gpu.overrun is "kill"', async () => {
    const g = setup({ overrun: 'kill' })
    const t0 = Date.now()
    const r = await start(
      g,
      ['run', 'slow', '1', '--', process.execPath, HOLD, g.log, 'slow', '8000'],
      {
        UMM_DEV_GPU_MINUTE_MS: '300',
      },
    ).done
    expect(r.code).toBe(124)
    expect(Date.now() - t0).toBeLessThan(5000)
    expect(events(g.log).slow?.end).toBe(0)
    expect(fs.existsSync(path.join(g.lease, 'gpu.lock'))).toBe(false)
    expect(fs.readFileSync(path.join(g.lease, 'gpu-lease.log'), 'utf8')).toContain('OVERRUN slow')
  })

  it('wait returns once the lease is free, and release refuses another name', async () => {
    const g = setup()
    const a = start(g, ['run', 'a', '5', '--', process.execPath, HOLD, g.log, 'a', '400'])
    await until(() => a.out().includes('ACQUIRED'))
    const env = { ...process.env, GPU_LEASE_DIR: g.lease, GPU_POLL_SECONDS: '0.05' }
    const refused = spawnSync(process.execPath, [BIN, 'gpu', 'release', 'someone-else'], {
      cwd: g.dir,
      env,
      encoding: 'utf8',
    })
    expect(refused.status).toBe(1)
    const w = start(g, ['wait'])
    const r = await w.done
    expect(r.code).toBe(0)
    expect(events(g.log).a?.end).toBeGreaterThan(0)
    await a.done
  })
})

const bash = WIN ? findBash() : 'bash'
const haveBash = Boolean(bash && spawnSync(bash, ['-c', 'exit 0']).status === 0)

describe.skipIf(!haveBash)('sharing a lock with a bash-era lease script', () => {
  it('excludes it, and keeps its place in the line ahead of it', async () => {
    const g = setup()
    const a = start(g, ['run', 'a', '5', '--', process.execPath, HOLD, g.log, 'a', '700'])
    await until(() => a.out().includes('ACQUIRED'))
    const b = start(g, ['run', 'b', '5', '--', process.execPath, HOLD, g.log, 'b', '200'])
    await until(() => ticketCount(g.lease) === 1)
    const legacy = spawn(
      /** @type {string} */ (bash),
      [LEGACY, g.lease, 'old', process.execPath, HOLD, g.log, 'old', '100'],
      { stdio: 'ignore' },
    )
    const legacyDone = new Promise((r) => legacy.on('exit', (code) => r(code)))
    await until(() => ticketCount(g.lease) === 2)
    const [ra, rb, rl] = await Promise.all([a.done, b.done, legacyDone])
    expect([ra.code, rb.code, rl]).toEqual([0, 0, 0])
    const e = events(g.log)
    expect(e.b?.start).toBeGreaterThanOrEqual(e.a?.end ?? Infinity)
    expect(e.old?.start).toBeGreaterThanOrEqual(e.b?.end ?? Infinity)
  })
})
