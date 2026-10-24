/**
 * Options for {@link playwrightConfig}. Anything else is passed through to the config, except
 * `projects`: the preset always sets its one Chromium project. See docs/presets.md.
 */
export interface PlaywrightPresetOptions {
  /** The dev server's port and `baseURL`. `E2E_PORT` overrides it. Default 5173. */
  port?: number
  /** Where the specs are. Default `'tests/e2e'`. */
  testDir?: string
  /**
   * Started as `<devCommand> --port <port> --strictPort`. Default `'pnpm dev'`. Under npm pass
   * `'npm run dev --'`, or npm keeps the flags for itself.
   */
  devCommand?: string
  /** Run headed. `E2E_HEADED=1` (or `=0`) overrides it. Default false. */
  headed?: boolean
  /** A browser channel (`'chrome'`). `E2E_CHANNEL` overrides it. Default Playwright's Chromium. */
  channel?: string
  /** Ask Chrome for the low-power GPU. `E2E_IGPU=1` (or `=0`) overrides it. Default false. */
  igpu?: boolean
  /** The device descriptor to start from: `devices['Desktop Chrome']`. Default none. */
  device?: Record<string, unknown>
  /** Per-test timeout, ms. Default 60 000. */
  timeout?: number
  /** Extra Chrome flags, after the preset's. */
  launchArgs?: string[]
  /** Where the `E2E_*` flags are read from. Default `process.env`. */
  env?: Record<string, string | undefined>
  /** Merged over the preset's top-level `use` (`baseURL`, `headless`, `trace`). */
  use?: Record<string, unknown>
  /** Merged over the preset's `webServer`; `false` for none. */
  webServer?: Record<string, unknown> | false
  [key: string]: unknown
}

/** Chrome flags every project gets: WebGPU on, the GPU blocklist off, the window at the corner. */
export declare const BASE_LAUNCH_ARGS: string[]
/** Chrome flags `igpu` adds: the low-power adapter. */
export declare const IGPU_LAUNCH_ARGS: string[]

/**
 * The port, headed, channel and igpu settings once the environment has overridden them. Throws
 * `E2E_PORT is not a port: <value>` unless the port is a positive integer.
 */
export declare function resolveFlags(options?: PlaywrightPresetOptions): {
  port: number
  headed: boolean
  channel: string | undefined
  igpu: boolean
}

/**
 * The shared Playwright config with the game's overrides. Wrap it in Playwright's `defineConfig`:
 *
 *   export default defineConfig(playwrightConfig({ device: devices['Desktop Chrome'], port: 5180 }))
 */
export declare function playwrightConfig(
  options?: PlaywrightPresetOptions,
): Record<string, unknown> & { use: Record<string, unknown>; projects: Record<string, unknown>[] }
export default playwrightConfig
