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

  hydrate   run the install, then link, copy and write the env keys a fresh worktree lacks
            (the game's worktree config), then count entries in each linked or copied path
            against the main checkout. Ends "Hydration OK." (exit 0) or "HYDRATION FAILED"
            (exit 1): trust no test count from a tree that did not end OK. <path> defaults to
            the current directory. A fresh worktree has no umm-dev of its own, so run it from
            the main checkout and name the worktree's path.
    --main <path>     the checkout to hydrate from (default: git's main checkout)
    --skip-install    do not run worktree.install; a missing node_modules then fails
  remove    the only safe way to delete a hydrated worktree (rm -rf and git worktree remove
            --force follow its links into the main checkout). Unlinks every link (never its
            target), proves every outside target kept its entries, deletes the folder, prunes
            git's list. Run it from the main checkout. <name> is a folder name under
            worktree.dir (default .claude/worktrees); give any other worktree as an absolute
            path (a relative path is also read under worktree.dir).
    --dry-run         list the links and their targets; change nothing, prune nothing
    --force           also remove a tree with uncommitted changes (untracked files included)
                      or a detached HEAD on a commit no branch or tag contains. Both are LOST.
                      It never skips the other refusals.
            Ignored files are never checked: they are deleted with the folder, --force or not.

exit: 0 ok; 1 a check failed, a removal was refused, or git failed; 64 usage, or hydrate
      refused (not a git checkout, or the main checkout itself)`

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
