// @ts-check
/**
 * `umm-dev questions [serve] [--root <dir>]... [--port N] [--no-open] [--idle M]`
 * `umm-dev questions list [--root <dir>]... [--json]`
 *
 * A page for answering the questions agents leave in a repo's questions file, one card at a time,
 * and a text list of the same. See src/questions/ and docs/questions.md.
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { scan } from '../questions/scan.mjs'
import { APP_ID, serve } from '../questions/server.mjs'

export const describe = 'answer the questions agents leave for you, on a local page'

const HELP = `usage: umm-dev questions [serve] [options]
       umm-dev questions list [options]

  serve     (the default) start a page on 127.0.0.1 that shows each open question with its
            recommendation, and writes each answer, as it is given, to ANSWERS.md beside the
            questions file. Opens it in the browser. Stop with Ctrl-C
    --port <n>       the port (default 4646). If the page is already running there, opens it
                     and exits
    --no-open        do not open a browser
    --idle <m>       stop after m minutes with no page open (default 0, never). An open
                     page pings once a minute, even in a hidden tab, so use 2 or more
  list      print the open questions as text
    --json           as JSON: { open: [...], files: [...] }

  --root <dir>       what to read: a repo, or a folder whose subfolders are repos (each main
                     checkout one level down; linked worktrees are left out). Repeat for
                     more. Default: the current directory
  A questions file is docs/ or the repo root's QUESTIONS.md, questions-for-<name>.md and the
  like. Format, the answers file and the rules for agents: docs/questions.md.

exit: 0; 1 the port is taken by something else; 64 usage`

/** @param {string} url */
function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]]
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).unref()
  } catch {}
}

/** @param {number} port */
async function alreadyRunning(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/ping`, {
      signal: AbortSignal.timeout(1500),
    })
    const data = await r.json()
    return data?.app === APP_ID
  } catch {
    return false
  }
}

/**
 * @param {string[]} argv
 * @param {{ cwd: string }} ctx
 */
export async function run(argv, ctx) {
  const sub = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'serve'
  const rest = sub === argv[0] ? argv.slice(1) : argv
  if (sub !== 'serve' && sub !== 'list') {
    console.error(`umm-dev questions: no subcommand "${sub}".\n\n${HELP}`)
    return 64
  }
  /** @type {ReturnType<typeof parseArgs>['values']} */
  let values
  try {
    ;({ values } = parseArgs({
      args: rest,
      options: {
        root: { type: 'string', multiple: true },
        port: { type: 'string' },
        'no-open': { type: 'boolean' },
        idle: { type: 'string' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    }))
  } catch (e) {
    console.error(`umm-dev questions: ${/** @type {Error} */ (e).message}\n\n${HELP}`)
    return 64
  }
  if (values.help) {
    console.log(HELP)
    return 0
  }
  const rootValues = /** @type {string[] | undefined} */ (values.root)
  const roots = (rootValues?.length ? rootValues : ['.']).map((r) => path.resolve(ctx.cwd, r))

  if (sub === 'list') {
    const s = scan(roots)
    if (values.json) {
      console.log(JSON.stringify(s, null, 2))
      return 0
    }
    if (!s.open.length) {
      console.log('No open questions.')
      return 0
    }
    let last = ''
    for (const q of s.open) {
      const where = `${q.project}/${q.rel}`
      if (where !== last) console.log(`\n${where}`)
      last = where
      const mark = q.urgent ? '!' : ' '
      console.log(` ${mark} ${q.num ? `${q.num}. ` : ''}${q.headline}`)
      if (q.rec) console.log(`     ${q.rec.length > 140 ? `${q.rec.slice(0, 137)}...` : q.rec}`)
    }
    const n = new Set(s.open.map((q) => q.project)).size
    console.log(`\n${s.open.length} open in ${n} project${n === 1 ? '' : 's'}.`)
    return 0
  }

  const port = values.port === undefined ? 4646 : Number(values.port)
  const idle = values.idle === undefined ? 0 : Number(values.idle)
  if (!Number.isInteger(port) || port < 0 || port > 65535 || !(idle >= 0)) {
    console.error(`umm-dev questions: bad --port or --idle.\n\n${HELP}`)
    return 64
  }
  try {
    const { url, server } = await serve({ roots, port, idleMinutes: idle })
    const s = scan(roots)
    console.log(`Questions: ${s.open.length} open, at ${url}  (Ctrl-C to stop)`)
    if (!values['no-open']) openBrowser(url)
    await new Promise((resolve) => {
      server.on('close', resolve)
      process.once('SIGINT', () => {
        server.close(resolve)
        server.closeAllConnections()
      })
    })
    return 0
  } catch (e) {
    if (/** @type {NodeJS.ErrnoException} */ (e).code === 'EADDRINUSE') {
      if (await alreadyRunning(port)) {
        const url = `http://localhost:${port}/`
        console.log(`Questions is already running at ${url}`)
        if (!values['no-open']) openBrowser(url)
        return 0
      }
      console.error(`umm-dev questions: port ${port} is taken by something else; try --port.`)
      return 1
    }
    throw e
  }
}
