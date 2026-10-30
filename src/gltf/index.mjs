// @ts-check
/**
 * `@ummgames/dev/gltf`: glTF-Transform with meshopt, the shrink pass behind `umm-dev gltf
 * optimize`, and a decoder for KHR_meshopt_compression GLBs. The glTF packages are optional
 * peers, imported only when a function here runs. See docs/gltf.md.
 */
import fs from 'node:fs'
import { loadGltfDeps } from './deps.mjs'
import { decodeMeshoptGlb, parseGlb } from './glb.mjs'

export { GLTF_PACKAGES } from './deps.mjs'
export { decodeMeshoptGlb, MESHOPT_EXTENSIONS } from './glb.mjs'

/** @type {readonly string[]} */
export const OPTIMIZE_LEVELS = ['medium', 'high']

/**
 * A NodeIO that reads and writes every extension glTF-Transform knows, with the meshopt encoder
 * and decoder registered and ready.
 * @returns {Promise<import('@gltf-transform/core').NodeIO>}
 */
export async function createGltfIO() {
  return ioFrom(await loadGltfDeps())
}

/** @param {import('./deps.mjs').GltfDeps} deps */
function ioFrom({ core, extensions, meshopt }) {
  return new core.NodeIO().registerExtensions(extensions.ALL_EXTENSIONS).registerDependencies({
    'meshopt.encoder': meshopt.MeshoptEncoder,
    'meshopt.decoder': meshopt.MeshoptDecoder,
  })
}

/**
 * Shrink a GLB in place: dedup, weld, prune, then meshopt compression with quantization. Never
 * joins or flattens meshes, so every node keeps its name and its extras. Reads a
 * KHR_meshopt_compression input by decoding it first; writes EXT_meshopt_compression. Writes
 * only when the result is smaller: a file optimized once grows if quantized again.
 * @param {string} file a .glb path
 * @param {{ level?: 'medium' | 'high', keepExtras?: boolean, dryRun?: boolean }} [opts]
 * @returns {Promise<{ before: number, after: number, written: boolean }>}
 */
export async function optimizeGlb(file, opts = {}) {
  const { level = 'medium', keepExtras = true, dryRun = false } = opts
  if (!OPTIMIZE_LEVELS.includes(level))
    throw new Error(`level must be ${OPTIMIZE_LEVELS.join(' or ')}, not ${JSON.stringify(level)}`)
  const deps = await loadGltfDeps()
  const input = fs.readFileSync(file)
  const { json } = parseGlb(input)
  const khr = (json.extensionsUsed ?? []).includes('KHR_meshopt_compression')
  const plain = khr ? await decodeMeshoptGlb(input) : input
  const io = ioFrom(deps)
  const { dedup, meshopt, prune, weld } = deps.functions
  const { MeshoptEncoder } = deps.meshopt
  const doc = await io.readBinary(new Uint8Array(plain))
  // Each transform logs what it removed at info level; a size line per file is enough.
  doc.setLogger(new deps.core.Logger(deps.core.Logger.Verbosity.WARN))
  await doc.transform(
    dedup(),
    weld(),
    prune({ keepExtras }),
    meshopt({ encoder: MeshoptEncoder, level }),
  )
  const out = await io.writeBinary(doc)
  const written = !dryRun && out.length < input.length
  if (written) fs.writeFileSync(file, out)
  return { before: input.length, after: out.length, written }
}
