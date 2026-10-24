/**
 * Options for {@link vitestConfig}. Anything else is passed through to the config. See
 * docs/presets.md.
 */
export interface VitestPresetOptions {
  /**
   * The folder the aliases resolve from: a path, a folder URL, or the config file's
   * `import.meta.url`. Default the cwd. It does not set Vitest's own `root`.
   */
  root?: string | URL
  /** `test.include`. Default `['tests/unit/**\/*.test.ts']`. */
  include?: string[]
  /** `test.environment`. Default `'node'`. */
  environment?: string
  /** Import aliases, each a path from `root`. Default `{ '@': 'src' }`; `false` for none. */
  alias?: Record<string, string> | false
  /**
   * Merged over the preset's `test`, a key at a time. A key here wins over `include` and
   * `environment`.
   */
  test?: Record<string, unknown>
  /** Merged over the preset's `resolve`; its `alias`, an object, merges over the aliases. */
  resolve?: Record<string, unknown>
  [key: string]: unknown
}

/** What {@link vitestConfig} returns: a plain object for Vitest's `defineConfig`. */
export interface VitestPresetConfig {
  /** `alias` holds absolute paths. */
  resolve: Record<string, unknown> & { alias: Record<string, string> }
  test: Record<string, unknown> & { include: string[]; environment: string }
  [key: string]: unknown
}

/**
 * The shared Vitest config with the game's overrides. Wrap it in Vitest's `defineConfig`:
 *
 *   export default defineConfig(vitestConfig({ root: import.meta.url }))
 */
export declare function vitestConfig(options?: VitestPresetOptions): VitestPresetConfig
/** The folder a `root` option names: a file URL ending in a script's extension gives its folder. */
export declare function rootDir(root: string | URL | undefined): string
export default vitestConfig
