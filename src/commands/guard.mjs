// @ts-check
/**
 * `umm-dev guard em-dash [paths...] | --staged | --message <file>`
 * `umm-dev guard claude-md`
 * `umm-dev guard denylist --staged | --tree | --history | --files <paths...> | --stdin | --list-rules`
 * `umm-dev guard install-hooks [--dir <hooks dir>] [--force]`
 * `umm-dev guard hook <pre-commit|commit-msg> [args]`
 *
 * Repo guards. Settings are the game's `guard` section of umm-dev.config.mjs; see docs/guard.md.
 */
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { loadConfig } from '../config.mjs'
import { CLAUDE_MD_DEFAULTS, checkClaudeMd } from '../guard/claude-md.mjs'
import {
  collectHistory,
  collectStaged,
  collectTree,
  compile,
  listRules,
  loadRules,
  report,
} from '../guard/denylist.mjs'
import { checkFiles, checkMessage, checkStaged, HOW, reportHits } from '../guard/em-dash.mjs'
import { normalise, topLevel } from '../guard/git.mjs'
import { installHooks } from '../guard/hooks.mjs'

export const describe = 'repo guards: em-dash, CLAUDE.md size, path denylist, git hooks'

const HELP = `usage: umm-dev guard em-dash [<path>...] [--staged] [--message <file>]
       umm-dev guard claude-md
       umm-dev guard denylist [--staged | --tree | --history | --files <path>... | --stdin]
                              [--rules <file.json>] [--max-bytes N] [--quiet] [--list-rules]
       umm-dev guard install-hooks [--dir <hooks dir>] [--force]
       umm-dev guard hook <pre-commit | commit-msg> [args]

  em-dash        no em-dash: every line of <path>s (every file git lists when none), only the
                 lines a commit adds (--staged), or a commit message (--message)
  claude-md      every CLAUDE.md within its line cap (guard.claudeMd), every relative link alive
  denylist       the game's rule table (guard.denylist, or --rules) over staged files, the tree,
                 all history, or named files. Ships no rules.
  install-hooks  write pre-commit and commit-msg hooks into git's hooks dir that run guard hook
  hook           what the hooks run: the checks guard.hooks lists for that hook

exit: 0 clean; 1 found something; 2 the check itself failed or has nothing to check against`

const DEFAULTS = {
  emDash: { exclude: /** @type {string[]} */ ([]) },
  claudeMd: CLAUDE_MD_DEFAULTS,
  /** @type {unknown} */
  denylist: null,
  hooks: {
    'pre-commit': ['denylist', 'em-dash'],
    'commit-msg': ['em-dash'],
  },
}

/** @typedef {typeof DEFAULTS & { root: string }} GuardConfig */

/** @param {string} s */
const err = (s) => process.stderr.write(s)

/**
 * @param {string[]} argv
 * @param {{ cwd: string }} ctx
 */
export async function run(argv, ctx) {
  const [sub, ...rest] = argv
  if (!sub || sub === '--help' || sub === '-h') {
    console.log(HELP)
    return sub ? 0 : 2
  }
  const cfg = /** @type {GuardConfig} */ (await loadConfig('guard', DEFAULTS, ctx.cwd))
  try {
    if (sub === 'em-dash') return emDash(rest, ctx.cwd, cfg)
    if (sub === 'claude-md') return claudeMd(cfg)
    if (sub === 'denylist') return denylist(rest, ctx.cwd, cfg)
    if (sub === 'install-hooks') return hooks(rest, ctx.cwd, cfg)
    if (sub === 'hook') return hook(rest, ctx.cwd, cfg)
  } catch (e) {
    err(`umm-dev guard ${sub}: the check failed: ${e instanceof Error ? e.message : e}\n`)
    return 2
  }
  err(`umm-dev guard: no subcommand "${sub}"\n\n${HELP}\n`)
  return 2
}

/**
 * @template {Record<string, { type: 'string' | 'boolean', short?: string }>} O
 * @param {string[]} argv
 * @param {O} options
 */
function parse(argv, options) {
  return parseArgs({ args: argv, allowPositionals: true, options })
}

/**
 * @param {string[]} argv
 * @param {string} cwd
 * @param {GuardConfig} cfg
 */
function emDash(argv, cwd, cfg) {
  const { values, positionals } = parse(argv, {
    staged: { type: 'boolean' },
    message: { type: 'string' },
  })
  const exclude = cfg.emDash.exclude ?? []
  if (values.message) {
    if (!checkMessage(String(values.message))) return 0
    err(`em-dash: the commit message carries an em-dash. ${HOW}\n`)
    return 1
  }
  const hits = values.staged ? checkStaged(cwd, exclude) : checkFiles(positionals, cwd, exclude)
  if (hits.length === 0) return 0
  reportHits(hits, values.staged ? 'added line(s)' : 'line(s)', err)
  return 1
}

/** @param {GuardConfig} cfg */
function claudeMd(cfg) {
  const c = { ...CLAUDE_MD_DEFAULTS, ...cfg.claudeMd }
  const r = checkClaudeMd(cfg.root, c)
  for (const f of r.files)
    console.log(
      `  ${f.file.padEnd(40)} ${String(f.lines).padStart(4)} lines${f.cap != null ? ` (cap ${f.cap})` : ''}`,
    )
  if (r.problems.length === 0) return 0
  err(`claude-md: ${r.problems.length} problem(s)\n`)
  for (const p of r.problems) err(`  ${p}\n`)
  return 1
}

/**
 * @param {string[]} argv
 * @param {string} cwd
 * @param {GuardConfig} cfg
 */
function denylist(argv, cwd, cfg) {
  const { values, positionals } = parse(argv, {
    staged: { type: 'boolean' },
    tree: { type: 'boolean' },
    history: { type: 'boolean' },
    files: { type: 'boolean' },
    stdin: { type: 'boolean' },
    rules: { type: 'string' },
    'max-bytes': { type: 'string' },
    quiet: { type: 'boolean' },
    'list-rules': { type: 'boolean' },
  })
  const rules = values.rules
    ? loadRules(String(values.rules), cwd)
    : loadRules(cfg.denylist, cfg.root)
  if (!rules) {
    err('guard denylist: no rules (set guard.denylist in umm-dev.config.mjs, or pass --rules).\n')
    return 2
  }
  if (values['list-rules']) {
    listRules(rules, (s) => process.stdout.write(s))
    return 0
  }
  const maxBytes = values['max-bytes'] ? Number(values['max-bytes']) : undefined
  if (maxBytes !== undefined && !(maxBytes > 0)) {
    err('guard denylist: --max-bytes needs a positive number\n')
    return 2
  }
  const mode = values.staged
    ? 'staged'
    : values.tree
      ? 'tree'
      : values.history
        ? 'history'
        : values.stdin
          ? 'stdin'
          : values.files || positionals.length > 0
            ? 'files'
            : null
  if (!mode) {
    err(`guard denylist: say what to check\n\n${HELP}\n`)
    return 2
  }
  const root = topLevel(cwd)
  /** @param {string} f */
  const sized = (f) => {
    try {
      return {
        file: root ? normalise(path.relative(root, path.resolve(cwd, f))) : normalise(f),
        size: fs.statSync(path.resolve(cwd, f)).size,
      }
    } catch {
      return { file: normalise(f), size: undefined }
    }
  }
  /** @type {{ file: string, size: number | undefined }[]} */
  let items
  if (mode === 'files') items = positionals.map(sized)
  else if (mode === 'stdin') {
    items = fs
      .readFileSync(0, 'utf8')
      .split(/[\0\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map(sized)
  } else {
    if (!root) {
      err(`guard denylist: --${mode} needs a git work tree\n`)
      return 2
    }
    items =
      mode === 'staged'
        ? collectStaged(root)
        : mode === 'tree'
          ? collectTree(root)
          : collectHistory(root)
  }
  const check = compile(rules, { maxBytes })
  const bad = []
  for (const it of items) {
    const v = check(it.file, it.size)
    if (v.length > 0) bad.push({ file: normalise(it.file), size: it.size, violations: v })
  }
  if (bad.length === 0) {
    if (!values.quiet)
      console.log(`guard denylist: OK, ${items.length} file(s) checked (${mode}), nothing denied.`)
    return 0
  }
  report(bad, mode, rules, err)
  if (mode === 'staged' && rules.allowEnv && process.env[rules.allowEnv]) {
    err(`guard denylist: ${rules.allowEnv} is set; passing anyway. CI will re-run this.\n`)
    return 0
  }
  return 1
}

/**
 * @param {string[]} argv
 * @param {string} cwd
 * @param {GuardConfig} cfg
 */
function hooks(argv, cwd, cfg) {
  const { values } = parse(argv, { dir: { type: 'string' }, force: { type: 'boolean' } })
  const names = Object.entries(cfg.hooks ?? {})
    .filter(([, checks]) => Array.isArray(checks) && checks.length > 0)
    .map(([name]) => name)
  return installHooks(
    {
      cwd,
      dir: values.dir ? String(values.dir) : undefined,
      hooks: names,
      force: Boolean(values.force),
    },
    (l) => console.log(l),
  )
}

/**
 * Run the checks a hook lists. Every check runs, so one commit reports them all.
 * @param {string[]} argv
 * @param {string} cwd
 * @param {GuardConfig} cfg
 */
function hook(argv, cwd, cfg) {
  const [name, ...args] = argv
  const table = /** @type {Record<string, string[] | undefined> | undefined} */ (cfg.hooks)
  const checks = (name && table?.[name]) || []
  let worst = 0
  for (const c of checks) {
    let rc = 0
    if (c === 'em-dash') {
      rc =
        name === 'commit-msg'
          ? emDash(['--message', args[0] ?? ''], cwd, cfg)
          : emDash(['--staged'], cwd, cfg)
    } else if (c === 'denylist') {
      if (cfg.denylist == null) continue
      rc = denylist(['--staged', '--quiet'], cwd, cfg)
    } else if (c === 'claude-md') {
      rc = claudeMd(cfg)
    } else {
      err(`guard hook: unknown check "${c}" in guard.hooks.${name}\n`)
      rc = 2
    }
    worst = Math.max(worst, rc)
  }
  return worst
}
