/**
 * The `gpu` and `worktree` sections of a game's `umm-dev.config.mjs`. docs/agent.md has the
 * same keys as tables. Every key is optional: a key left out keeps its default. A plain object
 * merges one level deep with the default; an array or anything else replaces it.
 */

/**
 * `umm-dev gpu`: the machine-wide GPU lease. The lease folder is not here on purpose: it is
 * `GPU_LEASE_DIR`, else `~/.umm-dev/gpu`, so that every repository on the machine shares one lock.
 */
export interface GpuConfig {
  /** Minutes `gpu run` books when neither `--minutes` nor a second positional gives one. Default `25`. */
  defaultMinutes?: number
  /** The most a booking may be. A larger one is cut to this, unless `--long` or `GPU_LONG=1`. Default `45`. */
  maxHoldMinutes?: number
  /** Minutes `gpu run` waits in the queue before giving up (exit 2); also `gpu wait`'s timeout. Default `240`. */
  waitLimitMinutes?: number
  /** Seconds a dead holder must stay unchanged before the head of the queue reclaims its lock. Default `10`. */
  staleGraceSeconds?: number
  /** At the end of a booking: `'warn'` prints and logs it; `'kill'` stops the command, which exits 124. Default `'warn'`. */
  overrun?: 'warn' | 'kill'
  /**
   * With `overrun: 'warn'`, minutes past the booking at which a run still going is stopped anyway
   * (exit 124), so a hung command cannot hold the GPU for hours. `0` stops it at the booking, as
   * `'kill'` does. Default `30`.
   */
  overrunGraceMinutes?: number
  /** `'below'` runs the command below normal CPU priority; `'normal'` leaves it. `GPU_PRIORITY` overrides. Default `'below'`. */
  priority?: 'below' | 'normal'
}

/**
 * `umm-dev worktree`: what a fresh worktree is given, and where `remove <name>` looks. Paths are
 * relative to the checkout's root (the nearest folder holding a package.json).
 */
export interface WorktreeConfig {
  /** Where `worktree remove <name>` looks for `<name>`, from the main checkout. Default `'.claude/worktrees'`. */
  dir?: string
  /** Command `hydrate` runs in the worktree when `node_modules/.modules.yaml` is missing, or `false` for none. Split on spaces, no shell. Default `'pnpm install --frozen-lockfile'`. */
  install?: string | false
  /** Directories linked from the main checkout (a junction on Windows, a symlink elsewhere). Read-only use only. Default `[]`. */
  link?: string[]
  /** Files or directories copied from the main checkout, links followed; an existing one is left alone. Default `[]`. */
  copy?: string[]
  /** Entries of `link` or `copy` that may be empty in the main checkout without failing the count. Default `[]`. */
  allowEmpty?: string[]
  /** The env file `envExample`, `envKeys` and `envDefaults` write, in the worktree. Default `'.env'`. */
  envFile?: string
  /** A file in the worktree copied to `envFile` when the worktree has no `envFile` after the copy step, or `null`. Default `null`. */
  envExample?: string | null
  /** Keys copied, whole line, from the main checkout's `envFile` when the worktree's lacks them. A key in neither fails hydration. Default `[]`. */
  envKeys?: string[]
  /** `KEY: 'value'` pairs appended to the worktree's `envFile` when the key is missing. Default `{}`. */
  envDefaults?: Record<string, string>
}
