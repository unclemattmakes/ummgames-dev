/** Options for {@link vitestConfig}. Anything else is passed through to the config. */
export interface VitestPresetOptions {
  /** The game's root: a path, a folder URL, or the config file's `import.meta.url`. Default cwd. */
  root?: string | URL
  /** Test globs. Default `['tests/unit/**\/*.test.ts']`. */
  include?: string[]
  /** Default `'node'`. */
  environment?: string
  /** Import aliases, each a path from the root. Default `{ '@': 'src' }`; `false` for none. */
  alias?: Record<string, string> | false
  /** Merged over the preset's `test`, a key at a time. */
  test?: Record<string, unknown>
  /** Merged over the preset's `resolve`; its `alias` merges over the preset's aliases. */
  resolve?: Record<string, unknown>
  [key: string]: unknown
}

export interface VitestPresetConfig {
  resolve: Record<string, unknown> & { alias: Record<string, string> }
  test: Record<string, unknown> & { include: string[]; environment: string }
  [key: string]: unknown
}

/** The shared Vitest config with the game's overrides. Wrap it in Vitest's `defineConfig`. */
export declare function vitestConfig(options?: VitestPresetOptions): VitestPresetConfig
/** The folder a `root` option names. */
export declare function rootDir(root: string | URL | undefined): string
export default vitestConfig
