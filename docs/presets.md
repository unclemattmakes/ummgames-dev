# Config presets

Every game starts from the same lint, type and test configs. Each preset holds what the games
share. The game's own file keeps only its paths, aliases and includes, and any rule it adds.

| Export | File | Used as |
|---|---|---|
| `@ummgames/dev/biome` | `config/biome.preset.json` | `"extends"` in `biome.json` |
| `@ummgames/dev/tsconfig` | `config/tsconfig.json` | `"extends"` in `tsconfig.json` |
| `@ummgames/dev/vitest` | `config/vitest.mjs` | `vitestConfig()` in `vitest.config.ts` |
| `@ummgames/dev/playwright` | `config/playwright.mjs` | `playwrightConfig()` in `playwright.config.ts` |

## Biome

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.9/schema.json",
  "extends": ["@ummgames/dev/biome"],
  "files": { "includes": ["**", "!public", "!**/*.generated.ts"] }
}
```

- **The preset holds:** the formatter (2 spaces, 100 columns), single quotes, no semicolons,
  trailing commas, the recommended rules plus `useNodejsImportProtocol` as an error and
  `noExplicitAny` and `noNonNullAssertion` as warnings, and VCS ignore files.
- **The game keeps:** `files.includes`, and any rule it adds. Biome merges rules a key at a time,
  so a game's `"linter": { "rules": { "complexity": { "noImportantStyles": "warn" } } }` adds to
  the preset's rules and replaces none.
- **The game must be a git checkout,** since the preset sets `vcs.useIgnoreFile`.
- **The file is `biome.preset.json` on purpose.** A `biome.json` inside `config/` would be a
  nested config, and Biome would stop treating this repo's own root config as the only root.

Verified with Biome 2.5.9 (and it works the same on 2.5.12), installed either with
`pnpm add -D link:<path>` or from git. The bare package specifier resolves through
package.json `exports`.

## TypeScript

```json
{
  "extends": "@ummgames/dev/tsconfig",
  "compilerOptions": {
    "types": ["vite/client", "node"],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src/**/*", "tests/**/*", "vite.config.ts", "vitest.config.ts", "playwright.config.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- **The preset holds:** ES2022 with the DOM libs, ESNext modules with Bundler resolution,
  `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`,
  `noFallthroughCasesInSwitch`, `isolatedModules`, `resolveJsonModule`, `skipLibCheck`,
  `forceConsistentCasingInFileNames` and `noEmit`.
- **The game keeps:** `types`, `paths`, `include` and `exclude`. TypeScript resolves `paths` and
  `include` from the file that sets them, so in the preset they would point inside
  `node_modules`.
- **A game may add more:** `noUnusedLocals`, `verbatimModuleSyntax` or `jsx`, say.

## Vitest

```ts
import { vitestConfig } from '@ummgames/dev/vitest'
import { defineConfig } from 'vitest/config'

export default defineConfig(vitestConfig({ root: import.meta.url }))
```

| Option | Default |
|---|---|
| `root` | The cwd. Takes a path, a folder URL, or the config file's own `import.meta.url`. |
| `include` | `['tests/unit/**/*.test.ts']` |
| `environment` | `'node'` |
| `alias` | `{ '@': 'src' }`, each a path from the root; `false` for none. |
| `test`, `resolve` | Merged over the preset's, a key at a time. |
| anything else | Passed through (`plugins`, `define`). |

## Playwright

```ts
import { defineConfig, devices } from '@playwright/test'
import { playwrightConfig } from '@ummgames/dev/playwright'

export default defineConfig(playwrightConfig({ device: devices['Desktop Chrome'], port: 5180 }))
```

The preset gives one Chromium project with WebGPU on and the GPU blocklist off. It runs one
worker, not fully parallel, with a 60 s timeout, a `list` reporter, and traces kept on failure.
It starts `<devCommand> --port <port> --strictPort`, or reuses a server already on the port.

| Option | Default | Overridden at run time by |
|---|---|---|
| `port` | 5173 | `E2E_PORT=<n>` (when another checkout's server holds the port) |
| `headed` | false | `E2E_HEADED=1`, or `=0` (GPU perf specs need the real GPU) |
| `channel` | Playwright's Chromium | `E2E_CHANNEL=chrome` (the installed Chrome) |
| `igpu` | false | `E2E_IGPU=1`, or `=0` (low-power GPU on a dual-GPU laptop; pair with headed) |
| `device` | none | Pass `devices['Desktop Chrome']`: the preset imports nothing from Playwright. |
| `testDir` | `'tests/e2e'` | |
| `devCommand` | `'pnpm dev'` | |
| `timeout` | 60 000 | |
| `launchArgs` | none | Extra Chrome flags. |
| `use`, `webServer` | | Merged over the preset's; `webServer: false` for none. |
| anything else | | Passed through (`retries`, `expect`). |
