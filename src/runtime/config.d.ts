/**
 * The `runtime` section of a game's `umm-dev.config.mjs`. `umm-dev copy` reads it;
 * `umm-dev drift` reads no config. See docs/runtime.md.
 *
 *   export default defineConfig({ runtime: { into: 'src/shared' } })
 */
export interface RuntimeConfig {
  /**
   * The folder, from the game root, that a copy without `--to` goes under:
   * `<into>/<path under runtime/>`, so `runtime/dev/fuzzy.ts` lands at `<into>/dev/fuzzy.ts`.
   * Default `'src'`.
   */
  into?: string
}
