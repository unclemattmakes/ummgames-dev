// @ts-check
/**
 * `umm-dev gpu run [<name> [<minutes>]] [--name N] [--minutes M] [--long] [--wait-limit M] -- <command...>`
 * `umm-dev gpu status [--json]` · `umm-dev gpu wait [--timeout M]` · `umm-dev gpu release <name> [--force]`
 *
 * One machine-wide GPU lease for parallel agent sessions. See src/agent/lease.mjs for the
 * protocol and docs/agent.md for how to use it and how it shares a lock with older scripts.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { acquire, formatStatus, Lease, SIGNALS } from '../agent/lease.mjs'
import { killTree, resolveCommand, sleep, WIN } from '../agent/proc.mjs'
import { loadConfig } from '../config.mjs'

export const describe = 'share one GPU between parallel sessions: run, status, wait, release'

const HELP = `usage: umm-dev gpu run [<name> [<minutes>]] [options] -- <command...>
       umm-dev gpu status [--json]
       umm-dev gpu wait [--timeout <minutes>]
       umm-dev gpu release <name> [--force]

  run       queue, take the lease, run the command, hand the lease back (always: on success,
            failure, Ctrl-C or a signal), exit with the command's code. Options and the two
            positionals go before --; everything after -- is the command, run without a
            shell (put a pipeline or && in a package script).
    --name <name>        who is asking; give each session its own (default: GPU_LEASE_NAME,
                         else the folder name of the checkout's root)
    --minutes <n>        the booking, whole minutes >= 1 (default gpu.defaultMinutes, 25)
    --long               lift the gpu.maxHoldMinutes cap (45) for one genuinely long run;
                         GPU_LONG=1 does the same
    --wait-limit <n>     minutes to wait in the queue before giving up (default
                         gpu.waitLimitMinutes, 240)
  status    who holds it, since when, its booking, who waits; sweeps dead tickets
    --json               the same as JSON
  wait      block until nobody holds it and nobody waits. It does not take the lease
    --timeout <n>        minutes before giving up (default gpu.waitLimitMinutes, 240)
  release   remove a lease left behind under <name> (its run is gone). It does not check
            that the holder has stopped
    --force              release whoever holds it, whatever the name

  The lease dir is GPU_LEASE_DIR, else ~/.umm-dev/gpu: one per machine, never per repository,
  and config cannot move it. Other env: GPU_LEASE_NAME, GPU_LONG=1, GPU_PRIORITY=normal,
  GPU_POLL_SECONDS (default 3), UMM_DEV_BASH (Windows: the bash for the bridge, or none).
  Never delete files in the lease dir by hand. Docs: docs/agent.md.

exit: run: the command's own code; 2 gave up waiting; 124 stopped at the end of its booking
      (gpu.overrun "kill"); 127 the command could not start; 130 interrupted; 64 usage
      status: 0; wait: 0 free, 2 still busy at the timeout; release: 0 released or nothing
      held, 1 refused (held under another name); 64 usage`

const WATCHDOG = fileURLToPath(new URL('../agent/watchdog.mjs', import.meta.url))

const DEFAULTS = {
  defaultMinutes: 25,
  maxHoldMinutes: 45,
  waitLimitMinutes: 240,
  staleGraceSeconds: 10,
  /** @type {'warn' | 'kill'} */
  overrun: 'warn',
  /** @type {'below' | 'normal'} */
  priority: 'below',
}

/** Test hook: how long a "minute" is, for bookings and wait limits. */
const minuteMs = () => Number(process.env.UMM_DEV_GPU_MINUTE_MS) || 60_000
const pollMs = () => Math.max(20, (Number(process.env.GPU_POLL_SECONDS) || 3) * 1000)

/** @param {string} line */
const say = (line) => console.log(line)

/**
 * @param {string[]} argv
 * @param {{ cwd: string }} ctx
 */
export async function run(argv, ctx) {
  const sub = argv[0]
  const rest = argv.slice(1)
  if (!sub || sub === '--help' || sub === '-h' || sub === 'help') {
    console.log(HELP)
    return sub ? 0 : 64
  }
  const cfg = await loadConfig('gpu', DEFAULTS, ctx.cwd)
  if (sub === 'run') return runCmd(rest, cfg)
  if (sub === 'status') return statusCmd(rest)
  if (sub === 'wait') return waitCmd(rest, cfg)
  if (sub === 'release') return releaseCmd(rest)
  console.error(`umm-dev gpu: no subcommand "${sub}"\n\n${HELP}`)
  return 64
}

/**
 * @template {Record<string, { type: 'string' | 'boolean', short?: string }>} O
 * @param {string[]} argv
 * @param {O} options
 */
function parse(argv, options) {
  try {
    return parseArgs({
      args: argv,
      allowPositionals: true,
      options: { ...options, help: { type: 'boolean', short: 'h' } },
    })
  } catch (e) {
    console.error(`umm-dev gpu: ${e instanceof Error ? e.message : e}\n\n${HELP}`)
    return null
  }
}

/**
 * @param {string[]} argv
 * @param {typeof DEFAULTS & { root: string }} cfg
 */
async function runCmd(argv, cfg) {
  const dd = argv.indexOf('--')
  if (dd < 0 || dd === argv.length - 1) {
    console.error(`umm-dev gpu run: put the command after --\n\n${HELP}`)
    return 64
  }
  const command = argv.slice(dd + 1)
  const p = parse(argv.slice(0, dd), {
    name: { type: 'string' },
    minutes: { type: 'string' },
    long: { type: 'boolean' },
    'wait-limit': { type: 'string' },
  })
  if (!p) return 64
  if (p.values.help) {
    console.log(HELP)
    return 0
  }
  // The older form, `run <name> <minutes> -- cmd`, still works.
  const [posName, posMinutes] = p.positionals
  const name = String(
    p.values.name ?? posName ?? process.env.GPU_LEASE_NAME ?? path.basename(cfg.root),
  )
  const minText = String(p.values.minutes ?? posMinutes ?? cfg.defaultMinutes)
  if (!/^\d+$/.test(minText) || Number(minText) < 1) {
    console.error(`GPU LEASE: minutes must be a whole number, got '${minText}'.`)
    return 64
  }
  let minutes = Number(minText)
  const long = Boolean(p.values.long) || process.env.GPU_LONG === '1'
  if (minutes > cfg.maxHoldMinutes && !long) {
    say(
      `GPU LEASE: ${minutes}m is over the ${cfg.maxHoldMinutes}m cap. Booking ${cfg.maxHoldMinutes}m.`,
    )
    say('  Book the GPU for one run and book again for the next. --long (or GPU_LONG=1) is')
    say('  for one genuinely long run: a full e2e suite, a release gate, a baseline.')
    minutes = cfg.maxHoldMinutes
  }
  const waitLimit = Number(p.values['wait-limit'] ?? cfg.waitLimitMinutes)

  const L = await Lease.open()
  const got = await acquire(L, {
    name,
    minutes,
    waitLimitMs: waitLimit * minuteMs(),
    pollMs: pollMs(),
    staleGraceMs: cfg.staleGraceSeconds * 1000,
    say,
  })
  if (!got.ok) {
    L.close()
    return got.code
  }
  const { token } = got

  const priority = process.env.GPU_PRIORITY ?? cfg.priority
  if (priority !== 'normal') {
    // A child starts at its parent's priority (on Windows, when the parent is below normal), so
    // the whole command tree yields a contended core to the person at the desk. It changes who
    // wins a core, not what the command does.
    try {
      os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL)
    } catch {}
  }

  const [cmd, ...args] = command
  const r = resolveCommand(/** @type {string} */ (cmd), args)
  /** @type {import('node:child_process').ChildProcess} */
  let child
  try {
    child = spawn(r.file, r.args, {
      stdio: 'inherit',
      detached: !WIN,
      windowsVerbatimArguments: r.verbatim,
    })
  } catch (e) {
    L.releaseOwn(token)
    L.close()
    console.error(`GPU LEASE: could not start ${cmd}: ${e instanceof Error ? e.message : e}`)
    return 127
  }
  const since = Math.floor(Date.now() / 1000)
  /** @type {import('node:child_process').ChildProcess | null} */
  let watchdog = null
  if (child.pid) {
    L.writeHolder({ who: name, since, asked: minutes, child: child.pid, token })
    // If this process dies without cleaning up, the watchdog kills the command tree and releases.
    watchdog = spawn(
      process.execPath,
      [WATCHDOG, String(process.pid), String(child.pid), String(Date.now()), L.dir, token, name],
      { detached: true, stdio: 'ignore', windowsHide: true },
    )
    watchdog.unref()
  }

  /** @type {number | null} */
  let forced = null
  /** @param {number} code */
  const stop = (code) => {
    forced = code
    killTree(child.pid)
  }
  const onSignal = () => stop(130)
  for (const s of SIGNALS) process.on(s, onSignal)

  const overrun = setTimeout(() => {
    if (cfg.overrun === 'kill') {
      console.error(
        `GPU LEASE: '${name}' ran past its ${minutes}m booking; stopping the command (gpu.overrun is "kill").`,
      )
      L.log(`OVERRUN ${name}: killed at the end of its ${minutes}m booking`)
      stop(124)
    } else {
      console.error(
        `GPU LEASE: '${name}' is past its ${minutes}m booking. Finish and hand the GPU back; book again for the next run.`,
      )
      L.log(`OVERRUN ${name}: past its ${minutes}m booking`)
    }
  }, minutes * minuteMs())

  const rc = await new Promise((resolve) => {
    child.on('error', (e) => {
      console.error(`GPU LEASE: could not start ${cmd}: ${e.message}`)
      resolve(127)
    })
    child.on('exit', (code, signal) =>
      resolve(code ?? (signal ? 128 + (os.constants.signals[signal] ?? 0) : 1)),
    )
  })
  clearTimeout(overrun)
  for (const s of SIGNALS) process.off(s, onSignal)
  const code = forced ?? rc
  const released = L.releaseOwn(token)
  try {
    if (watchdog?.pid) process.kill(watchdog.pid)
  } catch {}
  if (released) say(`GPU LEASE RELEASED by ${name}.`)
  else say(`GPU LEASE: '${name}' no longer held the lease at the end (released by hand?).`)
  L.log(`RUN ${name} exited ${code}`)
  L.close()
  return code
}

/** @param {string[]} argv */
async function statusCmd(argv) {
  const p = parse(argv, { json: { type: 'boolean' } })
  if (!p) return 64
  const L = await Lease.open()
  try {
    const s = await L.status()
    console.log(p.values.json ? JSON.stringify(s, null, 2) : formatStatus(s))
    return 0
  } finally {
    L.close()
  }
}

/**
 * @param {string[]} argv
 * @param {typeof DEFAULTS} cfg
 */
async function waitCmd(argv, cfg) {
  const p = parse(argv, { timeout: { type: 'string' } })
  if (!p) return 64
  const limit = Number(p.values.timeout ?? cfg.waitLimitMinutes) * minuteMs()
  const deadline = Date.now() + limit
  const L = await Lease.open()
  try {
    let spoke = 0
    for (;;) {
      const s = await L.status()
      if (!s.held && s.queue.length === 0) {
        say('GPU LEASE: FREE, nobody waiting.')
        return 0
      }
      if (spoke === 0 || Date.now() - spoke >= 60_000) {
        spoke = Date.now()
        say(formatStatus(s))
      }
      if (Date.now() > deadline) {
        say('GPU LEASE: still busy at the timeout.')
        return 2
      }
      await sleep(pollMs())
    }
  } finally {
    L.close()
  }
}

/** @param {string[]} argv */
async function releaseCmd(argv) {
  const p = parse(argv, { force: { type: 'boolean' } })
  if (!p) return 64
  const who = p.positionals[0]
  if (!who) {
    console.error(`umm-dev gpu release: name the holder\n\n${HELP}`)
    return 64
  }
  const L = await Lease.open({ bridge: false })
  try {
    if (!L.held()) {
      say('GPU LEASE: not held by anyone. Nothing to release.')
      return 0
    }
    const h = L.holder()
    if (h?.who !== who && !p.values.force) {
      say(
        `GPU LEASE: held by '${h?.who ?? '?'}', not by '${who}'. REFUSING to release someone else's lease.`,
      )
      return 1
    }
    L.log(`RELEASE ${h?.who ?? '?'} by hand${p.values.force ? ' (forced)' : ''}`)
    fs.rmSync(L.lock, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    say(`GPU LEASE RELEASED (${h?.who ?? '?'}).`)
    return 0
  } finally {
    L.close()
  }
}
