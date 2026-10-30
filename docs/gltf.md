# glTF: optimize and decode

`umm-dev gltf optimize` shrinks a GLB in place: it merges duplicate data, welds vertices, prunes
what nothing uses, and compresses the geometry with meshopt. It is the step between a Blender
export and the file a game ships. `@ummgames/dev/gltf` exports the same pass for a game's own
tools, a glTF-Transform `NodeIO` with both meshopt codecs, and a decoder that turns a
KHR_meshopt_compression GLB into one glTF-Transform can read. It is **linked**: it runs from
`node_modules` and never ships in a game's build.

## Quick start

The glTF packages are optional peers of the kit, so a game that uses this adds them first:

```sh
pnpm add -D @gltf-transform/core@4.5.1 @gltf-transform/extensions@4.5.1 @gltf-transform/functions@4.5.1 meshoptimizer@1.3.0
pnpm exec umm-dev gltf optimize public/assets/level-1.glb
```

When it works, it prints a line per file and exits 0:

```
public/assets/level-1.glb: 21512 -> 2200 bytes (10%)
```

Under npm, run it with `npx umm-dev`.

## `umm-dev gltf optimize`

```
umm-dev gltf optimize <file...> [--level medium|high] [--no-keep-extras] [--dry-run]
```

Each file is a `.glb`. The passes run in this order: `dedup()`, `weld()`,
`prune({ keepExtras })`, `meshopt({ level })`.

| Option | Value | Default | What it does |
|---|---|---|---|
| `--level` | `medium` or `high` | `medium` | meshopt's compression level. `high` is smaller and slower to write. |
| `--no-keep-extras` | | keep them | Let prune remove nodes, meshes and materials that nothing uses, even when they carry `extras`. |
| `--dry-run` | | off | Print the sizes; write nothing. |
| `-h`, `--help` | | | Print the usage. |

**It never joins or flattens meshes.** Node `extras` often carry a game's tags (a collider, an
entity, an id), and the game finds those nodes by name. Every node survives as itself.

**It writes only when the result is smaller.** A file optimized once is already quantized, and
quantizing it again usually makes it larger. So a second run leaves it alone and says so:

```
public/assets/level-1.glb: 2200 -> 2376 bytes (108%) (not written: no smaller)
```

**Exit codes.**

| Code | When |
|---|---|
| 0 | Every file was optimized, or left alone because the result was no smaller. |
| 1 | Some file failed: missing, not a GLB, or the glTF packages are not installed. The other files still run. |
| 2 | A usage error: no subcommand, no file, an unknown option, a level that is not `medium` or `high`. |

### Examples

```sh
umm-dev gltf optimize public/assets/*.glb                 # every GLB in a folder
umm-dev gltf optimize art.glb --level high                # smaller, slower to write
umm-dev gltf optimize art.glb --dry-run                   # how much it would save
umm-dev gltf optimize art.glb --no-keep-extras            # let prune take tagged leftovers too
```

## `@ummgames/dev/gltf`

```js
import { createGltfIO, decodeMeshoptGlb, optimizeGlb } from '@ummgames/dev/gltf'

const { before, after, written } = await optimizeGlb('public/assets/level-1.glb', { level: 'high' })

const io = await createGltfIO()                                 // ALL_EXTENSIONS, both meshopt codecs
const doc = await io.readBinary(await decodeMeshoptGlb(bytes))  // bytes may be KHR_ or EXT_meshopt
```

| Export | What it does |
|---|---|
| `createGltfIO()` | A `NodeIO` with `ALL_EXTENSIONS` and the meshopt encoder and decoder registered. Resolves once both are ready. It reads EXT_meshopt_compression; pass KHR files through `decodeMeshoptGlb` first. |
| `decodeMeshoptGlb(glb)` | A GLB using KHR_ or EXT_meshopt_compression, as a plain GLB in a new `Buffer`. A GLB without meshopt comes back unchanged. |
| `optimizeGlb(file, opts?)` | The pass behind the command. Resolves to `{ before, after, written }`, sizes in bytes. Rejects when the file is not a GLB. |
| `GLTF_PACKAGES` | The four packages as `name@version`, the versions the kit is tested with. |
| `MESHOPT_EXTENSIONS` | `KHR_meshopt_compression` and `EXT_meshopt_compression`. |
| `OPTIMIZE_LEVELS` | `medium` and `high`. |

**`optimizeGlb` options.**

| Option | Type | Default | What it does |
|---|---|---|---|
| `level` | `'medium'` or `'high'` | `'medium'` | meshopt's compression level. |
| `keepExtras` | boolean | `true` | Keep unused nodes, meshes and materials that carry `extras`, such as an empty node that marks a spawn point. |
| `dryRun` | boolean | `false` | Measure the result but leave the file as it was. |

`written` is `true` only when the file was rewritten: never on a dry run, and never when `after`
is not smaller than `before`.

**The glTF packages are imported only when a function runs.** `umm-dev` itself starts without
them, and so does a game that imports `@ummgames/dev/gltf` but never calls it. A call without
them rejects with an error naming each missing package and the install line from Quick start.

## Config

`umm-dev gltf` reads no section of `umm-dev.config.mjs`. Every option is on the command line.

## File formats

**Input.** A binary glTF 2 file (`.glb`), self-contained: its buffer is the GLB's BIN chunk. A
`.gltf` with a separate `.bin` is not read; convert it to a GLB first. Geometry may already be
compressed with KHR_ or EXT_meshopt_compression.

**Output.** A GLB with quantized attributes (KHR_mesh_quantization) and EXT_meshopt_compression.
Both are required extensions, so the loader needs a meshopt decoder: three.js has one in
`three/examples/jsm/libs/meshopt_decoder.module.js`, set with `GLTFLoader.setMeshoptDecoder`.

**A decoded GLB** (from `decodeMeshoptGlb`) has one buffer, the BIN chunk, with every view
uncompressed and 4-byte aligned. Neither meshopt name is left in `extensionsUsed` or
`extensionsRequired`. Quantized attributes stay quantized, so it may still need
KHR_mesh_quantization, which glTF-Transform reads with `ALL_EXTENSIONS`.

## How it works

- **Why decode by hand.** glTF-Transform 4.5 reads EXT_meshopt_compression, given a decoder, but
  not KHR_meshopt_compression, the ratified name. KHR also allows newer encodings and filters, which
  meshoptimizer's decoder reads. `decodeMeshoptGlb` works on the container instead: it parses the GLB,
  decodes each compressed bufferView with meshoptimizer's `decodeGltfBuffer`, copies every other
  view, and builds a new BIN chunk. The fallback buffers, which hold no data, are dropped.
- **optimize** decodes a KHR input that way, reads it with `createGltfIO()`, runs the four passes,
  and writes with EXT_meshopt_compression. glTF-Transform's info logs (what prune removed) are
  quieted to warnings.
- **Optional peers.** The four packages are `peerDependencies` marked optional, so a game that
  never uses glTF installs none of them. The kit imports them with a dynamic `import()` inside
  each function, from the game's `node_modules`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `@ummgames/dev/gltf needs meshoptimizer, which is not installed.` | The game lacks one or more of the glTF packages. | Run the `pnpm add -D` line the error prints. |
| `umm-dev gltf: <file>: not a GLB: no glTF magic` | The file is a `.gltf` (JSON), or not glTF at all. | Export a GLB, or convert it: `gltf-transform copy in.gltf out.glb` (from `@gltf-transform/cli`). |
| `bufferView 3 reads buffer 1, which is not the GLB's BIN chunk.` | The GLB points at an external or data-URI buffer. | Re-export as one self-contained GLB. |
| `(not written: no smaller)` on every run | The file is already optimized. | Nothing: optimize the fresh export, not the shipped file. |
| The game loads the GLB with no geometry, or throws about EXT_meshopt_compression. | The loader has no meshopt decoder. | Set one: `loader.setMeshoptDecoder(MeshoptDecoder)` in three.js. |
| A tagged empty node is gone. | It ran with `--no-keep-extras`. | Run without it: extras keep a node by default. |

## For agents

- **Optimize the fresh export, not the shipped file.** Run it as the last step of the export
  script, then commit the result. A second run leaves the file alone.
- **Read the size line.** A file that did not shrink says why. Exit 1 means a file failed and the
  others still ran.
- **Never join or flatten meshes to save more.** The game finds nodes by name and reads their
  extras.
- **Use `createGltfIO()` in a game's own glTF scripts,** and `decodeMeshoptGlb` before reading a
  KHR_meshopt_compression file, instead of a local copy of either.
- **Never edit `node_modules/@ummgames/dev`.** Report a bug upstream.
