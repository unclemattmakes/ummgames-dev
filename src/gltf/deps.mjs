// @ts-check
/**
 * The glTF packages are optional peers: a game that never touches glTF installs none of them. So
 * nothing here imports them at load time; each function asks for them when it runs, and a missing
 * one becomes an error that names what to add.
 */

/** Every package `@ummgames/dev/gltf` uses, with the version the kit is tested against. */
export const GLTF_PACKAGES = /** @type {const} */ ([
  '@gltf-transform/core@4.5.1',
  '@gltf-transform/extensions@4.5.1',
  '@gltf-transform/functions@4.5.1',
  'meshoptimizer@1.3.0',
])

/** @param {string} spec `name@version` */
const nameOf = (spec) => spec.slice(0, spec.lastIndexOf('@'))

/**
 * @typedef {(name: string) => Promise<any>} Importer
 * @typedef {{
 *   core: typeof import('@gltf-transform/core'),
 *   extensions: typeof import('@gltf-transform/extensions'),
 *   functions: typeof import('@gltf-transform/functions'),
 *   meshopt: typeof import('meshoptimizer'),
 * }} GltfDeps
 */

/** @type {Importer} */
const nodeImport = (name) => import(/* @vite-ignore */ name)

/**
 * Import packages by name. Every one that is not installed is named in a single error, with the
 * line that installs them all.
 * @param {string[]} names
 * @param {Importer} load
 * @returns {Promise<any[]>}
 */
export async function importPackages(names, load = nodeImport) {
  const settled = await Promise.allSettled(names.map((n) => load(n)))
  /** @type {string[]} */
  const missing = []
  for (const [i, r] of settled.entries()) {
    if (r.status === 'fulfilled') continue
    const code = /** @type {{ code?: unknown }} */ (r.reason)?.code
    if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND')
      missing.push(/** @type {string} */ (names[i]))
    else throw r.reason
  }
  if (missing.length) {
    throw new Error(
      `@ummgames/dev/gltf needs ${missing.join(', ')}, which ${missing.length === 1 ? 'is' : 'are'} not installed. ` +
        `Add them to the game: pnpm add -D ${GLTF_PACKAGES.join(' ')}`,
    )
  }
  return settled.map((r) => /** @type {PromiseFulfilledResult<any>} */ (r).value)
}

/** @type {Promise<GltfDeps> | null} */
let cached = null

/**
 * All four packages, with the meshopt encoder and decoder ready.
 * @param {Importer} [load] for tests; the default imports from the game's node_modules
 * @returns {Promise<GltfDeps>}
 */
export function loadGltfDeps(load) {
  if (load) return importDeps(load)
  cached ??= importDeps(nodeImport).catch((e) => {
    cached = null
    throw e
  })
  return cached
}

/** @param {Importer} load @returns {Promise<GltfDeps>} */
async function importDeps(load) {
  const [core, extensions, functions, meshopt] = await importPackages(
    GLTF_PACKAGES.map(nameOf),
    load,
  )
  await meshopt.MeshoptEncoder.ready
  await meshopt.MeshoptDecoder.ready
  return { core, extensions, functions, meshopt }
}

/**
 * Only meshoptimizer's decoder, ready: all `decodeMeshoptGlb` needs.
 * @param {Importer} [load]
 * @returns {Promise<typeof import('meshoptimizer').MeshoptDecoder>}
 */
export async function loadMeshoptDecoder(load = nodeImport) {
  const [meshopt] = await importPackages(['meshoptimizer'], load)
  await meshopt.MeshoptDecoder.ready
  return meshopt.MeshoptDecoder
}
