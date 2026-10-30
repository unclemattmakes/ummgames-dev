/**
 * `@ummgames/dev/gltf`: glTF-Transform with meshopt, the shrink pass behind
 * `umm-dev gltf optimize`, and a decoder for KHR_meshopt_compression GLBs. See docs/gltf.md.
 *
 * The glTF packages are optional peers. A game that uses this entry point adds them:
 *
 *   pnpm add -D @gltf-transform/core@4.5.1 @gltf-transform/extensions@4.5.1 @gltf-transform/functions@4.5.1 meshoptimizer@1.3.0
 *
 * They are imported only when a function here runs. A missing one rejects with an error that
 * names it and gives that line.
 */
import type { NodeIO } from '@gltf-transform/core'

/** Every package this entry point uses, as `name@version`: the versions the kit is tested with. */
export const GLTF_PACKAGES: readonly string[]

/** `KHR_meshopt_compression` and `EXT_meshopt_compression`. */
export const MESHOPT_EXTENSIONS: readonly string[]

/** The meshopt levels `optimizeGlb` takes: `'medium'` and `'high'`. */
export const OPTIMIZE_LEVELS: readonly string[]

/**
 * A NodeIO with every extension glTF-Transform knows (`ALL_EXTENSIONS`) and the meshopt encoder
 * and decoder registered. Resolves once both are ready. It reads EXT_meshopt_compression; for
 * KHR_meshopt_compression, pass the bytes through `decodeMeshoptGlb` first.
 */
export function createGltfIO(): Promise<NodeIO>

/**
 * A GLB that uses KHR_ or EXT_meshopt_compression, as a plain GLB that glTF-Transform reads
 * without a decoder. Every compressed bufferView is decoded into a fresh BIN chunk, every other
 * view is copied, the fallback buffers go away, and both extension names leave
 * `extensionsUsed` and `extensionsRequired`. A GLB without meshopt comes back unchanged.
 *
 * Quantized attributes stay quantized, so the result may still need KHR_mesh_quantization.
 * Only self-contained GLBs: a view in an external or data-URI buffer rejects.
 */
export function decodeMeshoptGlb(glb: Uint8Array): Promise<Buffer>

export interface OptimizeGlbOptions {
  /** meshopt's compression level. Default `'medium'`. `'high'` is smaller and slower to write. */
  level?: 'medium' | 'high'
  /**
   * Keep nodes, meshes and materials that nothing references but that carry `extras`, such as an
   * empty node that marks a spawn point. Default `true`.
   */
  keepExtras?: boolean
  /** Measure the result but leave the file as it was. Default `false`. */
  dryRun?: boolean
}

export interface OptimizeGlbResult {
  /** The file's size before, bytes. */
  before: number
  /** The optimized size, bytes, whether or not it was written. */
  after: number
  /**
   * Whether the file was rewritten: only when `after` is smaller than `before`, and never on a
   * dry run. A file optimized once usually grows if optimized again, so it is left alone.
   */
  written: boolean
}

/**
 * Shrink a GLB in place: `dedup()`, `weld()`, `prune({ keepExtras })`, then
 * `meshopt({ level })`, which quantizes and writes EXT_meshopt_compression. It never joins or
 * flattens meshes, so every node keeps its name, its place and its extras. A
 * KHR_meshopt_compression input is decoded first. The file is rewritten only when the result is
 * smaller. Rejects when the file is not a GLB.
 */
export function optimizeGlb(file: string, opts?: OptimizeGlbOptions): Promise<OptimizeGlbResult>
