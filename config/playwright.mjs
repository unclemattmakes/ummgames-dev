// @ts-check
/**
 * `@ummgames/dev/playwright`: the shared Playwright config for a game's browser tests.
 *
 *   // playwright.config.ts
 *   import { defineConfig, devices } from '@playwright/test'
 *   import { playwrightConfig } from '@ummgames/dev/playwright'
 *   export default defineConfig(playwrightConfig({ device: devices['Desktop Chrome'], port: 5180 }))
 *
 * One Chromium project with WebGPU on, one worker, a dev server it starts (or reuses), headless
 * unless asked. Four environment flags override the options at run time:
 *
 * - `E2E_HEADED=1` runs headed (GPU perf specs need the real GPU); `E2E_HEADED=0` forces headless.
 * - `E2E_PORT=<n>` uses another port, when another checkout's dev server holds the usual one.
 *   An existing server on the port is reused, so it must be this checkout's.
 * - `E2E_CHANNEL=chrome` uses the installed Chrome.
 * - `E2E_IGPU=1` asks Chrome for the low-power GPU of a dual-GPU laptop (Chrome ignores WebGPU's
 *   powerPreference on Windows). Pair it with `E2E_HEADED=1`.
 *
 * This file imports nothing from Playwright: pass `devices['Desktop Chrome']` as `device`.
 */

/**
 * @typedef {{
 *   port?: number,
 *   testDir?: string,
 *   devCommand?: string,
 *   headed?: boolean,
 *   channel?: string,
 *   igpu?: boolean,
 *   device?: Record<string, unknown>,
 *   timeout?: number,
 *   launchArgs?: string[],
 *   env?: Record<string, string | undefined>,
 *   use?: Record<string, unknown>,
 *   webServer?: Record<string, unknown> | false,
 *   [key: string]: unknown,
 * }} PlaywrightPresetOptions
 */

/** Chrome flags every project gets: WebGPU on, the blocklist off, the window at the corner. */
export const BASE_LAUNCH_ARGS = [
  '--enable-unsafe-webgpu',
  '--ignore-gpu-blocklist',
  '--window-position=0,0',
]

/** Chrome flags for `igpu`: the low-power adapter. */
export const IGPU_LAUNCH_ARGS = [
  '--force_low_power_gpu',
  '--use-webgpu-power-preference=force-low-power',
]

/** @param {string | undefined} v @returns {boolean | undefined} */
const flag = (v) => (v === undefined || v === '' ? undefined : v === '1' || v === 'true')

/**
 * The settings after the environment has had its say.
 * @param {PlaywrightPresetOptions} options
 */
export function resolveFlags(options = {}) {
  const env = options.env ?? process.env
  const port = env.E2E_PORT ? Number(env.E2E_PORT) : (options.port ?? 5173)
  if (!Number.isInteger(port) || port <= 0)
    throw new Error(`E2E_PORT is not a port: ${env.E2E_PORT}`)
  return {
    port,
    headed: flag(env.E2E_HEADED) ?? options.headed ?? false,
    channel: env.E2E_CHANNEL || options.channel,
    igpu: flag(env.E2E_IGPU) ?? options.igpu ?? false,
  }
}

/**
 * @param {PlaywrightPresetOptions} [options]
 * @returns {Record<string, unknown> & { use: Record<string, unknown>, projects: Record<string, unknown>[] }}
 */
export function playwrightConfig(options = {}) {
  const {
    port: _port,
    headed: _headed,
    channel: _channel,
    igpu: _igpu,
    env: _env,
    testDir = 'tests/e2e',
    devCommand = 'pnpm dev',
    device = {},
    timeout = 60_000,
    launchArgs = [],
    use = {},
    webServer,
    ...rest
  } = options
  const { port, headed, channel, igpu } = resolveFlags(options)
  return {
    testDir,
    timeout,
    fullyParallel: false,
    workers: 1,
    reporter: 'list',
    ...rest,
    use: {
      baseURL: `http://localhost:${port}`,
      headless: !headed,
      trace: 'retain-on-failure',
      ...use,
    },
    projects: [
      {
        name: 'chromium',
        use: {
          ...device,
          ...(channel ? { channel } : {}),
          launchOptions: {
            args: [...BASE_LAUNCH_ARGS, ...(igpu ? IGPU_LAUNCH_ARGS : []), ...launchArgs],
          },
        },
      },
    ],
    ...(webServer === false
      ? {}
      : {
          webServer: {
            command: `${devCommand} --port ${port} --strictPort`,
            port,
            reuseExistingServer: true,
            timeout: 60_000,
            ...webServer,
          },
        }),
  }
}

export default playwrightConfig
