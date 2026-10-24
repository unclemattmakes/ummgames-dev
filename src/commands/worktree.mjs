// @ts-check
/**
 * `umm-dev worktree hydrate [<path>] [--main <path>] [--skip-install]`
 * `umm-dev worktree remove <name|path>... [--dry-run] [--force]`
 *
 * What to link and copy is the game's `worktree` section of umm-dev.config.mjs. See
 * src/agent/worktree.mjs for the safety rules and docs/agent.md for the config keys.
 */
import path from 'node:path'
import { parseArgs } from 'node:util'
import { hydrate, mainCheckout, removeWorktrees, WORKTREE_DEFAULTS } from '../agent/worktree.mjs'
import { loadConfig } from '../config.mjs'

export const describe = 'hydrate a new git worktree, or remove one without following its links'

const HELP = `usage: umm-dev worktree hydrate [<path>] [--main <path>] [--skip-install]
       umm-dev worktree remove <name|path>... [--dry-run] [--force]

  hydrate   install, link and copy what a fresh worktree lacks (the game's worktree config),
            then count entries against the main checkout. Ends "Hydration OK." or exits 1.
            <path> defaults to the current directory.
    --main <path>     the checkout to hydrate from (default: git's main checkout)
    --skip-install    do not run worktree.install; fail if node_modules is missing
  remove    unlink every link in the worktree (never its target), prove every outside target
            kept its entries, then delete the folder and prune git's list. <name> is a folder
            under worktree.dir (.claude/worktrees), or a path.
    --dry-run         list the links and their targets, change nothing
    --force           remove even with uncommitted changes (they are lost)

exit: 0 ok; 1 a check failed or something was refused; 64 usage`

/** @param {string} line */
const say = (line) => console.log(line)

/**
 * @param {string[]} argv
 * @param {{ cwd: string }} ctx
 */
export async function run(argv, ctx) {
  /** @type {ReturnType<typeof parseArgs>} */
  let args
  try {
    args = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        main: { type: 'string' },
        'skip-install': { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        force: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    })
  } catch (e) {
    console.error(`umm-dev worktree: ${e instanceof Error ? e.message : e}\n\n${HELP}`)
    return 64
  }
  const { values, positionals } = args
  const [sub, ...rest] = positionals
  if (values.help || !sub) {
    console.log(HELP)
    return values.help ? 0 : 64
  }
  try {
    if (sub === 'hydrate') {
      const wt = path.resolve(ctx.cwd, rest[0] ?? '.')
      let cfg
      try {
        cfg = await loadConfig('worktree', WORKTREE_DEFAULTS, wt)
      } catch (e) {
        // A fresh worktree has no node_modules, so a config that imports @ummgames/dev cannot
        // load there yet: read the main checkout's instead.
        const main = values.main ? path.resolve(ctx.cwd, String(values.main)) : mainCheckout(wt)
        say(
          `  (the worktree's config does not load yet: ${e instanceof Error ? e.message.split('\n')[0] : e}; using the main checkout's)`,
        )
        cfg = { ...(await loadConfig('worktree', WORKTREE_DEFAULTS, main)), root: wt }
      }
      return hydrate(
        wt,
        {
          ...cfg,
          main: values.main ? path.resolve(ctx.cwd, String(values.main)) : undefined,
          skipInstall: Boolean(values['skip-install']),
        },
        say,
      )
    }
    if (sub === 'remove') {
      if (rest.length === 0) {
        console.error(`umm-dev worktree remove: name at least one worktree\n\n${HELP}`)
        return 64
      }
      const cfg = await loadConfig('worktree', WORKTREE_DEFAULTS, ctx.cwd)
      return removeWorktrees(
        rest,
        {
          cwd: ctx.cwd,
          dir: cfg.dir,
          dryRun: Boolean(values['dry-run']),
          force: Boolean(values.force),
        },
        say,
      )
    }
  } catch (e) {
    console.error(`umm-dev worktree: ${e instanceof Error ? e.message : e}`)
    return 1
  }
  console.error(`umm-dev worktree: no subcommand "${sub}"\n\n${HELP}`)
  return 64
}
