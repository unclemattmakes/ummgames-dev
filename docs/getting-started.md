# Getting started

This page takes a game from nothing to using the kit, in about ten minutes. It assumes a web game
built with Vite, in a git repo, with Node 22 or later. Every step stands alone, so stop after any
step and the game still works.

If your game already has its own copies of these tools, read [adopting.md](adopting.md) instead.
It covers replacing them without losing your changes.

## 1. Install it

**Pin a tag.** pnpm (10 or 11):

```sh
pnpm add -D github:unclemattmakes/ummgames-dev#v0.2.1
```

npm (tested on 11):

```sh
npm i -D github:unclemattmakes/ummgames-dev#v0.2.1
```

Your lockfile records the exact commit behind the tag, so every checkout and every worktree gets
the same code.

**No credentials are needed:** the repo is public.
- pnpm downloads GitHub's tarball.
- npm writes a `git+ssh` URL into its lockfile, but falls back to HTTPS when SSH is not
  available. That was tested with SSH disabled.

**Check it worked:**

```sh
pnpm exec umm-dev help      # npm: npx umm-dev help
```

You should see eleven commands, from `capture` to `worktree`.

## 2. Add the config file

Create `umm-dev.config.mjs` at the game's root, next to `package.json`:

```js
// @ts-check
import { defineConfig } from '@ummgames/dev'

export default defineConfig({})
```

It can stay empty. Every command has generic defaults and reads only its own section, so you add
a section only for a tool you use.

**`defineConfig` is typed.** An editor flags an unknown section or a mistyped key straight away.
For `tsc` (and an agent's typecheck) to catch it too, the game's tsconfig needs
`"allowJs": true`, with `umm-dev.config.mjs` in `include`; step 3 shows both. Without them, `tsc`
passes a broken config.

**How the root is found:** commands find the root by walking up from the working directory to the
nearest `package.json`. So they also work from a subfolder or from inside a git worktree.

## 3. Take the presets

Replace your lint, TypeScript and test configs with the shared ones. Each keeps only what is
yours: paths, aliases and the dev-server port.

**The presets configure tools; they do not install them.** Add the ones you use. The kit is
tested with these versions:

```sh
pnpm add -D @biomejs/biome@2.5.9 typescript@6.0.3 vitest@4.1.12 @playwright/test@1.62.1
```

A newer Biome works, but prints a notice that the preset's schema version does not match. It
points at the preset inside `node_modules`: never run `biome migrate` there.

**Biome:**

```jsonc
// biome.json
{ "extends": ["@ummgames/dev/biome"], "files": { "includes": ["**", "!public"] } }
```

**TypeScript.** `allowJs` and the config file in `include` let `tsc` check `umm-dev.config.mjs`
(step 2):

```jsonc
// tsconfig.json
{
  "extends": "@ummgames/dev/tsconfig",
  "compilerOptions": {
    "allowJs": true,
    "types": ["vite/client"],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src/**/*", "tests/**/*", "umm-dev.config.mjs"]
}
```

**Vitest**, only if the game uses Vitest. A game on another runner (for example `node:test` run
through `tsx`) skips this preset; nothing else depends on it.

```ts
// vitest.config.ts
import { vitestConfig } from '@ummgames/dev/vitest'
import { defineConfig } from 'vitest/config'

export default defineConfig(vitestConfig({ root: import.meta.url }))
```

**Playwright:**

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test'
import { playwrightConfig } from '@ummgames/dev/playwright'

export default defineConfig(playwrightConfig({ device: devices['Desktop Chrome'], port: 5173 }))
```

**Under npm,** pass `devCommand: 'npm run dev --'` to `playwrightConfig`. Its default is
`pnpm dev`, and without the `--`, npm swallows the `--port` flag.

**Check it worked:** `pnpm exec biome check .` and `pnpm exec tsc --noEmit` both run. Every
option and override is in [presets.md](presets.md).

**Expect a first round of findings in older code.** The TypeScript preset turns on
`noUncheckedIndexedAccess`, and an older codebase can show hundreds of errors from it alone.
Turning it off in the game's `compilerOptions` while you work through them is fine.

## 4. Add the site build plugins

Add the plugins to `vite.config`:

```js
// vite.config.mjs
import { headers, notFoundPage } from '@ummgames/dev/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [headers({ immutableAssets: true }), notFoundPage()],
})
```

**Check it worked:** `vite build` writes `dist/_headers` and `dist/404.html`. The licences page,
the app icon and the share card are plugins too, in [build.md](build.md).

## 5. Make store art (optional)

Capture, cut and store need a way to tell when your game is ready. Expose a small debug handle on
`window` in dev builds, then point the `capture` section at it:

```js
export default defineConfig({
  capture: {
    debugGlobal: '__game',
    ready: (game) => (game?.frames ?? 0) > 60,
  },
})
```

**If the game runs Playwright,** also set `capture.out` to a folder of its own, such as
`captures/`. The default is `test-results/capture`, and Playwright empties `test-results/` on
every run.

Then write a shots file, and run `umm-dev capture <shot>`. To see what a CrazyGames store kit
needs before you make anything, run `umm-dev store --steps check`. The full walk-through, from
first capture to a passing store kit, is in [media.md](media.md).

## 6. Tell your agents

If AI agents work in the game, paste the block from [agents.md](agents.md) into the game's
`CLAUDE.md`. It is a dozen lines, and it stops the most common mistakes:
- editing `node_modules`;
- leaving duplicate copies;
- removing a worktree by hand.

## What next

- [docs/README.md](README.md) maps every page.
- [upgrading.md](upgrading.md) covers moving to a newer tag.
- [troubleshooting.md](troubleshooting.md) collects the errors you are most likely to hit.
