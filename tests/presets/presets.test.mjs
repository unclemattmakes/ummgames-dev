import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { playwrightConfig, resolveFlags } from '../../config/playwright.mjs'
import { rootDir, vitestConfig } from '../../config/vitest.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
/** @param {string} f */
const json = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'))

describe('biome preset', () => {
  const preset = json('config/biome.preset.json')

  it('holds the shared style and rules, and leaves files and root to the game', () => {
    expect(preset.formatter).toEqual({
      enabled: true,
      indentStyle: 'space',
      indentWidth: 2,
      lineWidth: 100,
    })
    expect(preset.javascript.formatter).toEqual({
      quoteStyle: 'single',
      semicolons: 'asNeeded',
      trailingCommas: 'all',
    })
    expect(preset.linter.rules.preset).toBe('recommended')
    expect(preset.linter.rules.style.useNodejsImportProtocol).toBe('error')
    expect(preset).not.toHaveProperty('files')
    expect(preset).not.toHaveProperty('root')
  })

  it('is not named biome.json, which Biome would take for a nested root', () => {
    expect(fs.existsSync(path.join(ROOT, 'config/biome.json'))).toBe(false)
    expect(fs.existsSync(path.join(ROOT, 'config/biome.jsonc'))).toBe(false)
  })
})

describe('tsconfig preset', () => {
  const { compilerOptions, ...rest } = json('config/tsconfig.json')

  it('is strict, Bundler-resolved and emits nothing', () => {
    expect(compilerOptions).toMatchObject({
      strict: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      moduleResolution: 'Bundler',
      module: 'ESNext',
      noEmit: true,
    })
  })

  it('leaves paths, types and includes to the game (they resolve from the file that sets them)', () => {
    expect(compilerOptions).not.toHaveProperty('paths')
    expect(compilerOptions).not.toHaveProperty('types')
    expect(rest).not.toHaveProperty('include')
    expect(rest).not.toHaveProperty('files')
  })
})

describe('vitestConfig', () => {
  it('defaults to node unit tests with an @ alias to src', () => {
    const c = vitestConfig({ root: '/game' })
    expect(c.test).toEqual({ include: ['tests/unit/**/*.test.ts'], environment: 'node' })
    expect(c.resolve.alias).toEqual({ '@': path.resolve('/game', 'src') })
  })

  it('takes a config file’s own URL as its folder', () => {
    const dir = path.resolve('/game')
    expect(rootDir(pathToFileURL(path.join(dir, 'vitest.config.ts')).href)).toBe(dir)
    expect(rootDir(pathToFileURL(dir))).toBe(dir)
    expect(rootDir(undefined)).toBe(process.cwd())
  })

  it('merges the game’s overrides a key at a time', () => {
    const c = vitestConfig({
      root: '/game',
      include: ['test/**/*.spec.ts'],
      alias: { '~': 'app' },
      test: { environment: 'happy-dom', testTimeout: 10_000 },
      resolve: { alias: { extra: '/x' }, dedupe: ['three'] },
      plugins: [],
    })
    expect(c.test).toEqual({
      include: ['test/**/*.spec.ts'],
      environment: 'happy-dom',
      testTimeout: 10_000,
    })
    expect(c.resolve).toEqual({
      alias: { '~': path.resolve('/game', 'app'), extra: '/x' },
      dedupe: ['three'],
    })
    expect(c.plugins).toEqual([])
    expect(vitestConfig({ alias: false }).resolve.alias).toEqual({})
  })
})

describe('playwrightConfig', () => {
  it('builds one Chromium project with WebGPU on, headless, and a dev server on the port', () => {
    const c = playwrightConfig({
      port: 5555,
      env: {},
      device: { viewport: { width: 1, height: 1 } },
    })
    expect(c).toMatchObject({
      testDir: 'tests/e2e',
      timeout: 60_000,
      workers: 1,
      fullyParallel: false,
      use: { baseURL: 'http://localhost:5555', headless: true, trace: 'retain-on-failure' },
      webServer: {
        command: 'pnpm dev --port 5555 --strictPort',
        port: 5555,
        reuseExistingServer: true,
      },
    })
    const project = /** @type {{ use: Record<string, any> }} */ (c.projects[0])
    expect(project.use.viewport).toEqual({ width: 1, height: 1 })
    expect(project.use.channel).toBeUndefined()
    expect(project.use.launchOptions.args).toEqual([
      '--enable-unsafe-webgpu',
      '--ignore-gpu-blocklist',
      '--window-position=0,0',
    ])
  })

  it('lets E2E_HEADED, E2E_PORT, E2E_CHANNEL and E2E_IGPU override the options', () => {
    const env = { E2E_HEADED: '1', E2E_PORT: '6100', E2E_CHANNEL: 'chrome', E2E_IGPU: '1' }
    expect(resolveFlags({ port: 5555, env })).toEqual({
      port: 6100,
      headed: true,
      channel: 'chrome',
      igpu: true,
    })
    expect(resolveFlags({ headed: true, env: { E2E_HEADED: '0' } }).headed).toBe(false)
    expect(resolveFlags({ headed: true, env: {} }).headed).toBe(true)
    expect(resolveFlags({ env: {} }).port).toBe(5173)
    expect(() => resolveFlags({ env: { E2E_PORT: 'abc' } })).toThrow(/not a port/)

    const c = playwrightConfig({ env })
    const project = /** @type {{ use: Record<string, any> }} */ (c.projects[0])
    expect(project.use.channel).toBe('chrome')
    expect(project.use.launchOptions.args).toContain('--force_low_power_gpu')
    expect(c.use.headless).toBe(false)
  })

  it('passes the rest through, and drops the web server on request', () => {
    const c = playwrightConfig({ env: {}, webServer: false, retries: 2, use: { trace: 'on' } })
    expect(c).not.toHaveProperty('webServer')
    expect(c.retries).toBe(2)
    expect(c.use.trace).toBe('on')
    expect(c).not.toHaveProperty('env')
    expect(c).not.toHaveProperty('device')
  })
})
