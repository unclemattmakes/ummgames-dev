/**
 * The `guard` section of a game's `umm-dev.config.mjs`. docs/guard.md has the same keys as
 * tables. Every key is optional. `emDash`, `claudeMd` and `hooks` merge one level deep with
 * their defaults, so setting one hook leaves the other at its default; `denylist` replaces.
 */

/** A check a git hook can run. */
export type GuardCheck = 'denylist' | 'em-dash' | 'claude-md'

/** `umm-dev guard em-dash`. */
export interface EmDashConfig {
  /** Globs (`*`, `?`, `**`, from the repo root) never checked, in every mode but `--message`. Default `[]`. */
  exclude?: string[]
}

/** `umm-dev guard claude-md`. */
export interface ClaudeMdConfig {
  /** Most lines the root CLAUDE.md may have. Default `200`. */
  rootMaxLines?: number
  /** Most lines any nested CLAUDE.md may have, or `null` for no cap. Default `100`. */
  nestedMaxLines?: number | null
  /** Text the root CLAUDE.md must contain (normally the path of the page on keeping it small), or `null`. Default `null`. */
  mustMention?: string | null
  /** Check that every relative link in every CLAUDE.md resolves. Default `true`. */
  links?: boolean
}

/** An extension group: every listed extension is denied. */
export interface DenyExtension {
  /** A label printed beside the extension. No default. */
  group?: string
  /** Why these are denied; printed on a hit. Required. */
  why: string
  /** Extensions with the dot, matched case-insensitively against the last dot of the name: `['.glb']`. Required. */
  ext: string[]
}

/** A path prefix: everything under it is denied. */
export interface DenyPrefix {
  /** Repo-relative, forward slashes, matched case-insensitively: `'public/assets/'`. Required. */
  prefix: string
  /** Why; printed on a hit. Required. */
  why: string
}

/** A folder name denied at any depth. */
export interface DenySegment {
  /** A whole folder name, matched case-insensitively against each folder in the path (never the file name). Required. */
  segment: string
  /** Why; printed on a hit. Default: "a denied folder name". */
  why?: string
}

/** A file-name pattern. */
export interface DenyName {
  /** A regular expression over the file name only (a string in JSON, or a RegExp in a `.mjs` config). Required. */
  pattern: string | RegExp
  /** Flags for a string `pattern` and `except`. Default `'i'`. Ignored for a RegExp. */
  flags?: string
  /** A name that matches this is let through. No default. */
  except?: string | RegExp
  /** Why; printed on a hit. Required. */
  why: string
}

/** A reviewed exception. */
export interface DenyAllow {
  /** A repo-relative glob (`*`, `?`, `**`). Required. */
  glob: string
  /** Why it is allowed. Required. */
  why: string
}

/** A reviewed exception to the size rule only. */
export interface DenySizeAllow extends DenyAllow {
  /** This entry's own size cap in bytes. Default: the table's `hardCeiling`. */
  max?: number
}

/** A game's denylist rule table. The package ships none. */
export interface DenylistRules {
  /** Size ceiling in bytes for any file not in `sizeAllow`; unset, only `sizeAllow` files are size-checked. `--max-bytes` overrides. No default. */
  maxBytes?: number
  /** Size cap in bytes for `sizeAllow` files that set no `max`. Default `2097152` (2 MiB). */
  hardCeiling?: number
  /** Denied extensions. Default `[]`. */
  extensions?: DenyExtension[]
  /** Denied path prefixes. Default `[]`. */
  prefixes?: DenyPrefix[]
  /** Denied folder names: a bare string, or an object with a reason. Default `[]`. */
  segments?: (string | DenySegment)[]
  /** Denied file-name patterns. Default `[]`. */
  names?: DenyName[]
  /** Paths exempt from every rule. Default `[]`. */
  allow?: DenyAllow[]
  /** Paths exempt from `maxBytes`, still capped by their `max` or `hardCeiling`. Default `[]`. */
  sizeAllow?: DenySizeAllow[]
  /** An env var that, when set, lets a `--staged` check print its findings and pass. Other modes ignore it. No default. */
  allowEnv?: string
  /** Lines printed under "What to do instead" on a hit. Default `[]`. */
  advice?: string[]
}

/**
 * The checks each git hook runs, by hook name. `install-hooks` writes one hook per key whose list
 * is not empty. Every listed check runs, and the hook exits with the worst result.
 */
export interface HooksConfig {
  /** Checks run before a commit, on what is staged. Default `['denylist', 'em-dash']`. */
  'pre-commit'?: GuardCheck[]
  /** Checks run on the commit message. Only `'em-dash'` reads the message. Default `['em-dash']`. */
  'commit-msg'?: GuardCheck[]
  /** Any other git hook name gets a hook too; `em-dash` then checks staged lines. No default. */
  [hook: string]: GuardCheck[] | undefined
}

/** `umm-dev guard`. */
export interface GuardConfig {
  /** `guard em-dash` settings. Default `{ exclude: [] }`. */
  emDash?: EmDashConfig
  /** `guard claude-md` settings. Default `{ rootMaxLines: 200, nestedMaxLines: 100, mustMention: null, links: true }`. */
  claudeMd?: ClaudeMdConfig
  /** The rule table, or the path of a JSON file holding it (from the game root). `null` or `false`: no denylist, and hooks skip the check. Default `null`. */
  denylist?: DenylistRules | string | null | false
  /** Which checks each hook runs. Read at commit time, so a change needs no reinstall. Default `{ 'pre-commit': ['denylist', 'em-dash'], 'commit-msg': ['em-dash'] }`. */
  hooks?: HooksConfig
}
