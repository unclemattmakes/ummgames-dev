/** Options for {@link playwrightConfig}. Anything else is passed through to the config. */
export interface PlaywrightPresetOptions {
  /** The dev server's port. `E2E_PORT` overrides it. Default 5173. */
  port?: number
  /** Default `'tests/e2e'`. */
  testDir?: string
  /** Started as `<devCommand> --port <port> --strictPort`. Default `'pnpm dev'`. */
  devCommand?: string
  /** Run headed. `E2E_HEADED=1` (or `=0`) overrides it. Default false. */
  headed?: boolean
  /** A browser channel (`'chrome'`). `E2E_CHANNEL` overrides it. */
  channel?: string
  /** Ask Chrome for the low-power GPU. `E2E_IGPU=1` (or `=0`) overrides it. Default false. */
  igpu?: boolean
  /** The device descriptor to start from: `devices['Desktop Chrome']`. */
  device?: Record<string, unknown>
  /** Per-test timeout, ms. Default 60 000. */
  timeout?: number
  /** Extra Chrome flags. */
  launchArgs?: string[]
  /** Where the flags are read from. Default `process.env`. */
  env?: Record<string, string | undefined>
  /** Merged over the preset's top-level `use`. */
  use?: Record<string, unknown>
  /** Merged over the preset's `webServer`; `false` for none. */
  webServer?: Record<string, unknown> | false
  [key: string]: unknown
}

export declare const BASE_LAUNCH_ARGS: string[]
export declare const IGPU_LAUNCH_ARGS: string[]

/** The port, headed, channel and igpu settings once the environment has overridden them. */
export declare function resolveFlags(options?: PlaywrightPresetOptions): {
  port: number
  headed: boolean
  channel: string | undefined
  igpu: boolean
}

/** The shared Playwright config with the game's overrides. Wrap it in Playwright's `defineConfig`. */
export declare function playwrightConfig(
  options?: PlaywrightPresetOptions,
): Record<string, unknown> & { use: Record<string, unknown>; projects: Record<string, unknown>[] }
export default playwrightConfig
