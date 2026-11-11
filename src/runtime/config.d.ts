/**
 * The `runtime` section of a game's `umm-dev.config.mjs`. `umm-dev copy` reads it, and
 * `umm-dev drift` reads its `sources`. See docs/runtime.md.
 *
 *   export default defineConfig({
 *     runtime: { into: 'src/shared', sources: { net: { repo: '../network' } } },
 *   })
 */
export interface RuntimeConfig {
  /**
   * The folder, from the game root, that a copy without `--to` goes under:
   * `<into>/<path under runtime/>`, so `runtime/dev/fuzzy.ts` lands at `<into>/dev/fuzzy.ts`.
   * A copy from a source lands at `<into>/<its path in the source>`. Default `'src'`.
   */
  into?: string
  /**
   * The game's own sources: git checkouts on this machine that `umm-dev copy --from <name>`
   * copies from, for code that cannot go in the public kit. Keyed by the name the copy's header
   * carries (letters, digits, `_` and `-`; not `ummgames-dev`). Default `{}`.
   */
  sources?: Record<string, RuntimeSource>
}

/** One entry of `runtime.sources`. */
export interface RuntimeSource {
  /**
   * The source's git checkout. A relative path is read from the game's main checkout, so it
   * means the same folder from every linked worktree.
   */
  repo: string
  /**
   * The commit-ish files are read at: committed work only, never the working tree.
   * Default `'HEAD'`, the checkout's current commit.
   */
  ref?: string
}
