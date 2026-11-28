# Perf: the probe, CPU profiles and fewer draws

A game's frame budget is checked by a **perf probe**: a Playwright spec that loads a staged
worst case from the production build, lets it settle, and reads the frame times from a handle
the game puts on `window`. It runs on a desktop viewport and on a phone viewport with the CPU
throttled 4x, and times a cold load on throttled networks. When a number is over, a CPU
profile of the same run says where the time went, and `umm-dev perf top` sums it by function.

| Piece | Kind | What it does |
|---|---|---|
| `perfConfig` in `@ummgames/dev/playwright` | linked | The probe's own Playwright config: build, `vite preview`, the perf spec only |
| `measureFrames`, `coldLoad`, `cpuProfile` and friends in `@ummgames/dev/testing` | linked | The probe's steps: throttle, wait, read the handle, profile |
| `umm-dev perf top` | linked | A `.cpuprofile` summed by function |
| `runtime/dev/perf-handle.ts` | copied | The handle on `window`: `frames` and `stats()`, plus the game's own readings |
| `runtime/render/bake.ts` | copied | Merges a three.js part's per-material meshes into a few draws |

A game that bends its world in a shader pays per draw if the shader reads `modelMatrix`:
[bend.md](bend.md#how-it-works) has the finding and the module that avoids it.

## Quick start

1. Copy the handle and the recorder into the game, and install the handle in every build (the
   probe measures the production build):

   ```sh
   pnpm exec umm-dev copy dev/perf-handle.ts
   pnpm exec umm-dev copy dev/perf-recorder.ts
   ```

   ```ts
   import { installPerfHandle } from './dev/perf-handle'

   const pf = installPerfHandle({
     extras: { info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }) },
   })
   function frame(now: number) {
     pf.frame(now)
     // ... step and render
     requestAnimationFrame(frame)
   }
   ```

2. Give the probe its own config, and keep the main config off the perf spec:

   ```ts
   // playwright.perf.config.ts
   import { defineConfig, devices } from '@playwright/test'
   import { perfConfig } from '@ummgames/dev/playwright'

   export default defineConfig(perfConfig({ device: devices['Desktop Chrome'], port: 5591, channel: 'chrome' }))
   ```

   ```ts
   // playwright.config.ts: add testIgnore
   import { PERF_SPEC, playwrightConfig } from '@ummgames/dev/playwright'
   export default defineConfig({ ...playwrightConfig({ device: devices['Desktop Chrome'] }), testIgnore: [PERF_SPEC] })
   ```

3. Write `tests/e2e/perf.spec.ts`:

   ```ts
   import { expect, test } from '@playwright/test'
   import { coldLoad, formatFrames, measureFrames, NETWORKS, PERF_DEVICES } from '@ummgames/dev/testing'

   for (const [device, budget] of [[PERF_DEVICES.desktop, 1000 / 55], [PERF_DEVICES.phone, 50]] as const) {
     test.describe(device.name, () => {
       test.use(device.use)
       test(`the worst case holds its budget (${device.name})`, async ({ page }) => {
         const { stats, extra } = await measureFrames(page, {
           url: '/?stress=300&seed=7&mute=1',
           cpu: device.cpu,
           read: ['info'],
           ...(device.cpu > 1 ? { profileMs: 3000, profileOut: 'captures/perf/phone.cpuprofile' } : {}),
         })
         console.log(`PERF ${device.name}: ${formatFrames(stats)}`, extra.info)
         expect(stats.p95Ms).toBeLessThan(budget)
       })
     })
   }

   test('a cold load on slow 4G reaches the first frame in time', async ({ page }) => {
     const ms = await coldLoad(page, '/?mute=1', { network: NETWORKS.slow4g })
     expect(ms).toBeLessThan(12_000)
   })
   ```

4. Run it inside the GPU lease, and sum the profile:

   ```sh
   pnpm exec umm-dev gpu run --name my-game-perf -- playwright test -c playwright.perf.config.ts --reporter=line
   pnpm exec umm-dev perf top captures/perf/phone.cpuprofile 15
   ```

## `perfConfig(options?)`: the probe's config

`perfConfig` is `playwrightConfig` (see [presets.md](presets.md#playwright-ummgamesdevplaywright))
with four changes:
- the web server runs `<buildCommand> && <previewCommand> --port <port> --strictPort`, so the
  probe measures the minified build players get, with three.js in production mode;
- it never reuses a server already on the port, so it cannot measure a stale build or another
  checkout's server: a busy port fails the run instead;
- only `PERF_SPEC` (every `perf.spec.ts`) runs;
- the test timeout is 120 s and the server's 300 s, for a cold build.

| Option | Value | Default | What it does |
|---|---|---|---|
| `buildCommand` | string | `'pnpm exec vite build'` | Builds the production bundle. |
| `previewCommand` | string | `'pnpm exec vite preview'` | Serves it. The preset adds `--port <port> --strictPort`. Under npm: `'npx vite preview'`. |
| `testMatch` | string or string array | `PERF_SPEC` | Which specs run. |
| `port` | number | 4173 | The preview's port and `baseURL`. `E2E_PORT` overrides it. |
| `timeout` | ms | 120 000 | Per test. |
| `webServer` | object, or `false` | | Merged over `{ reuseExistingServer: false, timeout: 300_000 }`, then over the preset's. |
| anything else | | | As `playwrightConfig`: `device`, `channel`, `headed`, `igpu`, `launchArgs`, `use`. |

`PERF_SPEC` is the glob for `perf.spec.ts`. Put it in the main config's `testIgnore`, so the
everyday e2e run skips the probe.

## The perf helpers: `@ummgames/dev/testing`

Every helper takes Playwright's `page` and drives Chrome's DevTools protocol, so they work in
Chromium only. A page keeps one protocol session, and the throttles stay on the page: use a
fresh page per case.

### `measureFrames(page, options?)`

Throttles the CPU, loads `url`, waits until the handle has counted `minFrames` frames, waits
`settleMs` more (shaders compile, the swarm fills), records a CPU profile when asked, then reads
`stats()` and each method in `read`. Returns `{ stats, extra, profile? }`. Throws
`measureFrames: window.<handle>.stats() gave nothing` when the handle is missing.

| Option | Value | Default | What it does |
|---|---|---|---|
| `url` | string | none | Load this first. Without it, measure the page where it is. |
| `cpu` | number | 1 | CPU throttle rate, set before the load. 4 is a quarter speed. |
| `handle` | string | `'__pf'` | The handle's name on `window`. |
| `minFrames` | number | 120 | Frames counted before the settle starts. |
| `settleMs` | ms | 8000 | The wait after `minFrames`. |
| `timeout` | ms | 45 000 | How long to wait for `minFrames`. |
| `read` | string array | `[]` | More handle methods to call, into `extra` by name; `null` where there is none. |
| `profileMs` | ms | 0 | Record a CPU profile this long, after the settle and before the read. |
| `profileOut` | path | none | Write the profile here, folders made. |

### `coldLoad(page, url, options)`

Throttles the network (cache off) and the CPU, navigates, and returns the milliseconds until the
handle has counted `frames` frames. `vite preview` does not compress, so scripts arrive at their
raw size: treat the result as an upper bound on a real host.

| Option | Value | Default | What it does |
|---|---|---|---|
| `network` | a `Network` | required | `NETWORKS.fast4g`, `NETWORKS.slow4g`, or the game's own. |
| `cpu` | number | 4 | CPU throttle rate. |
| `frames` | number | 2 | Frames the handle must count: 2 means the first frame was drawn. |
| `handle` | string | `'__pf'` | |
| `timeout` | ms | 60 000 | |

### The rest

| Export | What it does |
|---|---|
| `PERF_DEVICES` | `desktop`: 1280x720 at DPR 1, no throttle. `phone`: 812x375 at DPR 2, CPU 4x, a mid phone held sideways. Each is `{ name, use, cpu }`; `use` goes to `test.use`. The GPU stays this machine's, so a phone run speaks for the CPU side only. |
| `NETWORKS` | `fast4g`: 9 Mbit/s down, 60 ms latency. `slow4g`: 1.6 Mbit/s down, 150 ms. Up is a quarter of down. Bytes a second, as Chrome takes them. |
| `throttleCpu(page, rate)` | `Emulation.setCPUThrottlingRate`. Throws on a rate under 1. |
| `throttleNetwork(page, network, { cache? })` | `Network.emulateNetworkConditions`, with the cache off unless `cache: true`. |
| `waitForFrames(page, n, { handle?, timeout? })` | Waits until `window[handle].frames` is over `n`. |
| `readPerfHandle(page, method, { handle? })` | `window[handle][method]()`, or `null`. The result must be plain data. |
| `cpuProfile(page, ms, out?)` | A CPU profile over `ms`, written to `out` when given. |
| `formatFrames(stats)` | `p50 12.3 ms, p95 15.1 ms, fps 60, hitches 0`. |
| `selfTime(profile)`, `formatTop(summed, n?)` | What `umm-dev perf top` runs, for a spec that prints its own top functions. |

## `umm-dev perf`

```
umm-dev perf top <profile.cpuprofile> [n] [--json]
```

`perf top` sums a CPU profile's self time by function and prints the top `n`: share of the
profile, milliseconds, function, file and line. Functions with the same name, file and line are
one row. Chrome's own entries (`(program)`, `(idle)`, `(garbage collector)`) have no file.

| Option | Value | Default | What it does |
|---|---|---|---|
| `n` | whole number from 1 | 20 | Rows printed. |
| `--json` | | off | Every row as JSON: `{ totalMs, rows: [{ key, functionName, url, line, ms, share }] }`. |
| `-h`, `--help` | | | Print the usage. |

```
 31.2%     936.4 ms  (program)
 12.8%     384.0 ms  stepWorld assets/index-Cq2.js:1
  ...
100.0%    3001.7 ms  total
```

A minified build puts everything on line 1 of one file, so the function names carry the
meaning. For lines that mean something, profile an unminified build
(`vite build --minify false`).

**Exit codes:** 0 printed; 1 the file is missing or not a CPU profile; 64 usage.

## `runtime/dev/perf-handle.ts`

**Exports:** `installPerfHandle(options?)`, and the types `PerfHandle`, `PerfHandleOptions`,
`InstalledPerfHandle`. Imports `perf-recorder`; copy both.

`installPerfHandle` puts `{ frames, stats(), ...extras }` on `window` and returns
`{ handle, recorder, frame(now), remove() }`. Call `frame(now)` once per rAF: it samples the
recorder and counts the frame. Share `recorder` with a perf HUD rather than making a second one.

| Option | Default | What it does |
|---|---|---|
| `name` | `'__pf'` | The name on `target`. |
| `recorder` | a new `createPerfRecorder()` | The recorder `stats()` reads. |
| `extras` | none | More readings, each a function returning plain data: draw calls, a sim and render split, GPU time. A spec reads them with `read`. |
| `target` | `globalThis` | Where the handle goes. |

A game with its own handle of the same shape (`frames`, `stats()`) needs no copy: the helpers
read any object with those two.

## `runtime/render/bake.ts`

**Exports:** `bake(objects, space, options?)`, `bakeInPlace(part, options?)`,
`isPlainMaterial(material)`, `isBakeable(object)`, and the types `BakeOptions`,
`BakeInPlaceOptions`. Imports `three`, which the game must depend on.

A glTF from Blender arrives as one mesh per material, one draw call each. `bake` merges the
visible meshes under `objects` into `space`'s frame and folds each plain material into vertex
colour, so a part becomes one draw per plain finish (roughness, metalness, flat shading, side,
fog) plus one per material that keeps its own draw:
- glows: an emissive colour above black at an intensity above 0;
- see-through: `transparent`, or `alphaTest` above 0;
- anything vertex colour cannot stand in for: another material type, `MeshPhysicalMaterial`, a
  texture map, its own vertex colours, wireframe;
- whatever `keepApart` says, such as paints the game recolours at run time.

A kept material keeps its instance, so the game's references to it (to flash a glow, recolour a
paint) still work. `bake` changes nothing and returns the new meshes. `bakeInPlace` swaps them
into the part.

```ts
import { bakeInPlace } from './render/bake'
import { toon } from './render/shade'

const turret = gltf.scene.clone()
bakeInPlace(turret, {
  keepApart: (m) => m.name.startsWith('hull'),
  onMaterial: (m) => toon(m),
  receiveShadow: true,
})
```

| Option | Default | What it does |
|---|---|---|
| `keepApart` | none | `(material) => boolean`: true keeps a plain material in its own draw. |
| `onMaterial` | none | `(material, from) => void`, called on each new baked material with the first source material of its finish. Source materials' shader hooks are not carried over: add the game's here. |
| `castShadow` | any baked source did | Every new mesh casts shadows. |
| `receiveShadow` | any baked source did | Every new mesh receives shadows. |
| `minMeshes` | 2 | `bakeInPlace` only: fewer bakeable meshes and the part is left alone (returns `false`). |

**What `bakeInPlace` keeps.** The part keeps its name and transform. Children bake leaves out stay
where they are: empties used as sockets, lights, skinned, instanced and morphing meshes, and
hidden meshes (a muzzle flash the game shows later). A baked mesh that has children becomes a
plain `Object3D` with the same name and transform, so its children keep their place. A part that
is itself a mesh keeps an empty geometry.

## How it works

- **Frame times come from inside the page.** The handle's recorder samples each rAF timestamp,
  so the numbers are the game's own frame pacing, not Playwright's. The spec reads them once,
  after the settle.
- **The CPU throttle is Chrome's.** `Emulation.setCPUThrottlingRate` slows the renderer's main
  thread; the GPU process runs at full speed. A throttled run says how a slower CPU paces the
  frame, not what a phone's GPU can fill.
- **A sample's self time is the gap to the next sample,** as DevTools counts it. The last sample
  runs to the profile's `endTime`. Times in a profile are microseconds; `perf top` prints
  milliseconds.
- **Baking reads, never writes, the source geometry.** Each piece is copied out through the
  attribute's getters (so quantized, normalized attributes come out as floats), moved into the
  space's frame, and merged with three's `mergeGeometries`. Clones that share geometry are safe.
  A mirrored mesh (negative scale) has each triangle's winding reversed, so it still faces out.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `measureFrames: window.__pf.stats() gave nothing` | The build does not install the handle, or installs it under another name. | Install it in every build, not only dev; or pass `handle`. |
| `page.waitForFunction: Timeout 45000ms exceeded` | The handle's `frames` never rose past `minFrames`: the game did not start, or `frame(now)` is not called. | Open the URL by hand in the preview; check `__pf.frames` climbs. |
| `Error: http://localhost:<port> is already used` | Something serves on the probe's port, and `perfConfig` never reuses a server. | Stop it, or run with `E2E_PORT=<n>`. |
| A part's draw count barely fell. | Most of its materials keep their own draws: textured, see-through, glowing, or a finish of their own. | Check each with `isPlainMaterial`. Give flat paints one roughness and metalness, so they share a finish. |
| A baked part lost a glow's flash. | The game found the glow material through the old mesh. | Find it by material name or instance, which bake keeps. |

## For agents

- **Run the probe inside the GPU lease**, one lease per run, never nested.
- **Never gate on a number the machine cannot hold.** Set a budget a little over what the build
  holds now, and write the goal beside it.
- **Profile before changing code.** Run `umm-dev perf top` on the phone profile and fix the top
  rows; say which in the decision log.
- **Bake after any material changes** a game makes at load (toon shading, roughness), since bake
  copies finishes as they are then.
