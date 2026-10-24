# Config presets

Every game starts from the same lint, type and test configs. Each preset holds what the games
share; the game's own file keeps its paths, aliases and includes, and any rule it adds or turns
off. The presets are **linked**: they run from `node_modules`, so a game takes a change by
bumping the kit's tag. Reach for them when setting up a game, and when its configs drift apart
from the others.

| Export | File | Used as |
|---|---|---|
| `@ummgames/dev/biome` | `config/biome.preset.json` | `"extends": ["@ummgames/dev/biome"]` in `biome.json` |
| `@ummgames/dev/tsconfig` | `config/tsconfig.json` | `"extends": "@ummgames/dev/tsconfig"` in `tsconfig.json` |
| `@ummgames/dev/vitest` | `config/vitest.mjs` | `vitestConfig()` in `vitest.config.ts` |
| `@ummgames/dev/playwright` | `config/playwright.mjs` | `playwrightConfig()` in `playwright.config.ts` |

## Quick start

In a game that is a git checkout with a `.gitignore`, and has the kit installed:

```jsonc
// biome.json
{
  "$schema": "https://biomejs.dev/schemas/2.5.9/schema.json",
  "extends": ["@ummgames/dev/biome"],
  "files": { "includes": ["**", "!public"] }
}
```

```jsonc
// tsconfig.json
{
  "extends": "@ummgames/dev/tsconfig",
  "compilerOptions": { "types": ["vite/client"], "paths": { "@/*": ["./src/*"] } },
  "include": ["src/**/*"]
}
```

```sh
pnpm exec biome check .
pnpm exec tsc -p .
```

When it works, Biome ends with `Checked <n> files in <t>ms. No fixes applied.` and exits 0, and
tsc prints nothing and exits 0. Under npm, run them with `npx`.

## Biome: `@ummgames/dev/biome`

```jsonc
{ "extends": ["@ummgames/dev/biome"] }
```

**The exact form.** `extends` is an array holding the bare specifier. Biome refuses a plain
string (``The `extends` field must be either `//` or an array of paths.``), and the package's
`exports` map has no other name for the file: `@ummgames/dev/biome.preset.json` and
`@ummgames/dev/config/biome.preset.json` do not resolve.

**The preset sets:**

| Setting | Value |
|---|---|
| `vcs` | `enabled`, `clientKind: "git"`, `useIgnoreFile: true` |
| `formatter` | spaces, `indentWidth` 2, `lineWidth` 100 |
| `javascript.formatter` | `quoteStyle: "single"`, `semicolons: "asNeeded"`, `trailingCommas: "all"` |
| `linter.rules` | `preset: "recommended"`, plus `style.useNodejsImportProtocol` as an error and `suspicious.noExplicitAny` and `style.noNonNullAssertion` as warnings |

**The game sets:** `files.includes` (the preset sets no `files` and no `root`), and any rule it
adds or changes.

**Overriding a rule.** Biome merges rules a key at a time, so a game's rule replaces that one
rule and keeps the rest:

```jsonc
{
  "extends": ["@ummgames/dev/biome"],
  "files": { "includes": ["**", "!public"] },
  "linter": { "rules": { "style": { "noNonNullAssertion": "off" } } }
}
```

**The game needs an ignore file.** The preset sets `vcs.useIgnoreFile`, so Biome stops with an
error unless it finds a `.gitignore` at the game's root or a `.git` folder (whose
`info/exclude` it reads). A git checkout with a `.gitignore` has both.

**The file is `biome.preset.json` on purpose.** A `biome.json` inside `config/` would be a second
root config under this repo's own, which Biome refuses.

Verified with Biome 2.5.9, under pnpm (`link:` and `git+file:`) and npm (a folder path,
`git+file:` and `github:`).

## TypeScript: `@ummgames/dev/tsconfig`

```jsonc
{ "extends": "@ummgames/dev/tsconfig" }
```

**The exact form.** A string, the bare specifier. TypeScript resolves it through the package's
`exports` map, so `@ummgames/dev/tsconfig.json` and `@ummgames/dev/config/tsconfig.json` fail
with `TS6053: File '<name>' not found.`

**To typecheck `umm-dev.config.mjs` as well,** add `"allowJs": true` to the game's
`compilerOptions`, and the file to `include`. The preset sets neither, so by default `tsc`
ignores the config file, and only an editor checks it.

**On an older codebase,** expect many errors from `noUncheckedIndexedAccess`; one game showed
hundreds from that option alone. Setting it to `false` in the game's `compilerOptions` while you
work through them is fine. Tested on TypeScript 6.0.3 and 7.0.2.

**The preset sets:** `target` ES2022, `lib` ES2022 with `DOM` and `DOM.Iterable`, `module`
ESNext with `moduleResolution` Bundler, `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`,
`isolatedModules`, `resolveJsonModule`, `skipLibCheck`, `forceConsistentCasingInFileNames` and
`noEmit`.

**The game sets:**
- **`types`.** TypeScript 6 and later load no `@types` package unless `types` names it:
  `["vite/client"]` for `import.meta.env`, `"node"` for config files that use Node.
- **`paths`, `include` and `exclude`.** TypeScript resolves them from the file that sets them,
  so in the preset they would point inside `node_modules`.

```jsonc
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

**Overriding an option.** Set it in the game's `compilerOptions`; the game's value wins. A game
may add more, such as `noUnusedLocals`, `verbatimModuleSyntax` or `jsx`.

Verified with TypeScript 6.0.3 and 7.0.2, under pnpm and npm.

## Vitest: `@ummgames/dev/vitest`

**For games that use Vitest.** A game on another runner (for example `node:test` through `tsx`)
skips this preset; nothing else in the kit depends on it. Pointing Vitest at `node:test` files
runs them, and then reports "No test suite found".

```ts
// vitest.config.ts
import { vitestConfig } from '@ummgames/dev/vitest'
import { defineConfig } from 'vitest/config'

export default defineConfig(vitestConfig({ root: import.meta.url }))
```

`vitestConfig(options?)` returns a plain config object: unit tests in Node, under
`tests/unit/`, with an `@` alias to `<root>/src`. Wrap it in Vitest's `defineConfig`. It imports
nothing from Vitest, so it works with whichever Vitest the game has.

| Option | Value | Default | What it does |
|---|---|---|---|
| `root` | a path, a folder URL, or the config file's `import.meta.url` | the cwd | The folder the aliases resolve from. It does not set Vitest's own `root`. |
| `include` | glob array | `['tests/unit/**/*.test.ts']` | `test.include`. |
| `environment` | string | `'node'` | `test.environment`. |
| `alias` | `{ name: path }`, or `false` | `{ '@': 'src' }` | Import aliases, each a path from `root`. `false` for none. |
| `test` | object | | Merged over the preset's `test`, a key at a time. |
| `resolve` | object | | Merged over the preset's `resolve`; its `alias` merges over the preset's aliases. |
| anything else | | | Passed through (`plugins`, `define`). |

**Overriding.** Pass the option, or the key inside `test`:
`vitestConfig({ root: import.meta.url, test: { environment: 'jsdom', setupFiles: ['tests/setup.ts'] } })`.
A key in `test` wins over the matching option.

## Playwright: `@ummgames/dev/playwright`

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test'
import { playwrightConfig } from '@ummgames/dev/playwright'

export default defineConfig(playwrightConfig({ device: devices['Desktop Chrome'], port: 5180 }))
```

`playwrightConfig(options?)` gives one Chromium project with WebGPU on and the GPU blocklist off.
It runs one worker, not fully parallel, with a 60 s timeout, a `list` reporter, and traces kept
on failure. It starts `<devCommand> --port <port> --strictPort`, or reuses a server already on
the port. It imports nothing from Playwright: pass `devices['Desktop Chrome']` as `device`.

| Option | Value | Default | What it does |
|---|---|---|---|
| `port` | number | 5173 | The dev server's port and `baseURL`. `E2E_PORT=<n>` overrides it. |
| `headed` | boolean | `false` | Run headed. `E2E_HEADED=1` (or `=0`) overrides it. GPU perf specs need the real GPU. |
| `channel` | string | Playwright's Chromium | A browser channel. `E2E_CHANNEL=chrome` overrides it (the installed Chrome). |
| `igpu` | boolean | `false` | Ask Chrome for the low-power GPU of a dual-GPU laptop. `E2E_IGPU=1` (or `=0`) overrides it. Pair it with headed. |
| `device` | a device descriptor | none | Spread into the project's `use`. |
| `testDir` | string | `'tests/e2e'` | Where the specs are. |
| `devCommand` | string | `'pnpm dev'` | The command the web server runs, before `--port <port> --strictPort`. Under npm: `'npm run dev --'`. |
| `timeout` | ms | 60 000 | Per test. |
| `launchArgs` | string array | none | Extra Chrome flags, after the preset's. |
| `env` | object | `process.env` | Where the `E2E_*` flags are read from. |
| `use` | object | | Merged over the preset's top-level `use` (`baseURL`, `headless`, `trace`). |
| `webServer` | object, or `false` | | Merged over the preset's `webServer`; `false` for none. |
| anything else | | | Passed through (`retries`, `expect`, `workers`, `reporter`). `projects` is not: the preset always sets its own. |

`E2E_PORT` must be a positive integer, or the config throws `E2E_PORT is not a port: <value>`. An
existing server on the port is reused, so it must be this checkout's.

## File formats

| Export | File | Format |
|---|---|---|
| `@ummgames/dev/biome` | `config/biome.preset.json` | Biome config JSON |
| `@ummgames/dev/tsconfig` | `config/tsconfig.json` | tsconfig JSON, `compilerOptions` only |
| `@ummgames/dev/vitest` | `config/vitest.mjs`, types in `config/vitest.d.ts` | ESM; default and named `vitestConfig`, and `rootDir` |
| `@ummgames/dev/playwright` | `config/playwright.mjs`, types in `config/playwright.d.ts` | ESM; default and named `playwrightConfig`, and `resolveFlags`, `BASE_LAUNCH_ARGS`, `IGPU_LAUNCH_ARGS` |

## How it works

- **Each preset is reached through the package's `exports` map.** Biome and TypeScript both
  resolve the bare specifier through it, so only the names in the table above work.
- **pnpm and npm behave the same.** Under pnpm (`link:` or a git URL) and npm (a folder path, which
  npm links, or a git URL), both `extends` forms resolve and the `umm-dev` bin runs. The one
  difference a game sees is the Playwright preset's `devCommand`, which defaults to pnpm.
- **The JS presets return plain objects.** They import nothing from Vitest or Playwright, so they
  work with the game's own versions.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Found a nested root configuration, but there's already a root configuration.` | A second `biome.json` sits under the game's root (a tools folder, a vendored package). | Give the nested file `"root": false` (and `"extends": "//"` to inherit the game's), or delete it. |
| `Biome couldn't find an ignore file in the following folder: <root>` | The preset sets `vcs.useIgnoreFile`, and the game has no `.gitignore` and no `.git`. | Add a `.gitignore` at the game's root. |
| ``The `extends` field must be either `//` or an array of paths.`` | `"extends": "@ummgames/dev/biome"`, a string. | `"extends": ["@ummgames/dev/biome"]`. |
| `Could not resolve @ummgames/dev/biome: module not found` | The kit is not installed, or the specifier names a file path. | Install the kit; use exactly `@ummgames/dev/biome`. |
| `error TS6053: File '@ummgames/dev/tsconfig' not found.` | The kit is not installed, or the specifier has `.json` or `config/` in it. | Install the kit; use exactly `@ummgames/dev/tsconfig`. |
| `Cannot find name 'process'` (TS2591), or `Property 'env' does not exist on type 'ImportMeta'` | TypeScript 6 and later load no `@types` unless `types` names them. | Add `"node"` or `"vite/client"` to the game's `types`. |
| Playwright's web server never starts under npm. | `devCommand` defaults to `pnpm dev`, and `npm run dev --port <n>` swallows the flags. | `playwrightConfig({ devCommand: 'npm run dev --' })`. |
| A game's `projects` in `playwrightConfig` has no effect. | The preset always sets its one Chromium project. | Build the config, then replace or extend its `projects` before `defineConfig`. |

## For agents

- **Use the exact `extends` forms** in the table at the top. Never point at a file inside
  `node_modules/@ummgames/dev`.
- **Never edit `node_modules/@ummgames/dev`.** Override in the game's own config; report a preset
  bug upstream.
- **Change a rule in the game's file, one key.** Do not copy the preset's contents into the game.
- **Keep `paths`, `include`, `exclude` and `types` in the game's tsconfig.** They do not work in
  the preset.
