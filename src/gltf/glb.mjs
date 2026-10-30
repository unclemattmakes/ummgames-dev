// @ts-check
/**
 * GLB container reading and writing, and the meshopt decoder that turns a compressed GLB into a
 * plain one. glTF-Transform 4.5 reads EXT_meshopt_compression (given a decoder) but not
 * KHR_meshopt_compression, so a KHR file is decoded here first. See docs/gltf.md.
 */
import { loadMeshoptDecoder } from './deps.mjs'

const MAGIC = 0x46546c67 // 'glTF'
const CHUNK_JSON = 0x4e4f534a // 'JSON'
const CHUNK_BIN = 0x004e4942 // 'BIN\0'

/** The two names of the meshopt extension. KHR is the ratified one; EXT came first. */
/** @type {readonly string[]} */
export const MESHOPT_EXTENSIONS = ['KHR_meshopt_compression', 'EXT_meshopt_compression']

/**
 * @typedef {Record<string, any>} GltfJson
 * @typedef {{ json: GltfJson, bin: Buffer | null }} Glb
 */

/** @param {Uint8Array} bytes */
const asBuffer = (bytes) =>
  Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)

/** @param {number} n */
const pad4 = (n) => (n + 3) & ~3

/**
 * Split a GLB into its JSON and its BIN chunk.
 * @param {Uint8Array} bytes
 * @returns {Glb}
 */
export function parseGlb(bytes) {
  const buf = asBuffer(bytes)
  if (buf.length < 12 || buf.readUInt32LE(0) !== MAGIC) throw new Error('not a GLB: no glTF magic')
  const version = buf.readUInt32LE(4)
  if (version !== 2) throw new Error(`not a glTF 2 GLB: version ${version}`)
  const end = Math.min(buf.readUInt32LE(8), buf.length)
  let off = 12
  /** @type {GltfJson | null} */
  let json = null
  /** @type {Buffer | null} */
  let bin = null
  while (off + 8 <= end) {
    const len = buf.readUInt32LE(off)
    const type = buf.readUInt32LE(off + 4)
    if (off + 8 + len > end) throw new Error('GLB chunk runs past the end of the file')
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === CHUNK_JSON && !json) json = JSON.parse(data.toString('utf8'))
    else if (type === CHUNK_BIN && !bin) bin = data
    off += 8 + len
  }
  if (!json) throw new Error('GLB has no JSON chunk')
  return { json, bin }
}

/**
 * Build a GLB from its JSON and an optional BIN chunk.
 * @param {GltfJson} json
 * @param {Uint8Array | null} bin
 * @returns {Buffer}
 */
export function buildGlb(json, bin) {
  const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8')
  const jsonLen = pad4(jsonBuf.length)
  const binLen = bin ? pad4(bin.length) : 0
  const total = 12 + 8 + jsonLen + (bin ? 8 + binLen : 0)
  const out = Buffer.alloc(total, 0)
  out.writeUInt32LE(MAGIC, 0)
  out.writeUInt32LE(2, 4)
  out.writeUInt32LE(total, 8)
  out.writeUInt32LE(jsonLen, 12)
  out.writeUInt32LE(CHUNK_JSON, 16)
  jsonBuf.copy(out, 20)
  out.fill(0x20, 20 + jsonBuf.length, 20 + jsonLen)
  if (bin) {
    const b = 20 + jsonLen
    out.writeUInt32LE(binLen, b)
    out.writeUInt32LE(CHUNK_BIN, b + 4)
    asBuffer(bin).copy(out, b + 8)
  }
  return out
}

/**
 * Which meshopt extensions a glTF's JSON lists as used.
 * @param {GltfJson} json
 * @returns {string[]}
 */
export function meshoptUsed(json) {
  const used = Array.isArray(json.extensionsUsed) ? json.extensionsUsed : []
  return MESHOPT_EXTENSIONS.filter((n) => used.includes(n))
}

/**
 * The bytes a buffer index holds, when it is the GLB's own BIN chunk.
 * @param {GltfJson} json
 * @param {Buffer | null} bin
 * @param {number} index
 * @param {string} what
 */
function binFor(json, bin, index, what) {
  const buffer = json.buffers?.[index]
  if (index !== 0 || !bin || !buffer || buffer.uri !== undefined)
    throw new Error(
      `${what} reads buffer ${index}, which is not the GLB's BIN chunk. Only self-contained GLBs are supported.`,
    )
  return bin
}

/**
 * Turn a GLB that uses KHR_ or EXT_meshopt_compression into a plain one. Every compressed
 * bufferView is decoded into a fresh BIN chunk, every other view is copied across, the fallback
 * buffers go away, and both extension names leave `extensionsUsed` and `extensionsRequired`.
 * A GLB without meshopt comes back unchanged. Quantized attributes stay quantized
 * (KHR_mesh_quantization), as meshopt stored them.
 * @param {Uint8Array} glb
 * @returns {Promise<Buffer>}
 */
export async function decodeMeshoptGlb(glb) {
  const input = asBuffer(glb)
  const { json, bin } = parseGlb(input)
  const names = meshoptUsed(json)
  if (!names.length) return input
  const decoder = await loadMeshoptDecoder()

  /** @type {Buffer[]} */
  const parts = []
  let size = 0
  const views = (json.bufferViews ?? []).map(
    (/** @type {GltfJson} */ bv, /** @type {number} */ i) => {
      const ext = bv.extensions?.KHR_meshopt_compression ?? bv.extensions?.EXT_meshopt_compression
      /** @type {Uint8Array} */
      let bytes
      if (ext) {
        const source = binFor(json, bin, ext.buffer ?? 0, `bufferView ${i} (meshopt)`)
        const start = ext.byteOffset ?? 0
        bytes = new Uint8Array(ext.count * ext.byteStride)
        decoder.decodeGltfBuffer(
          bytes,
          ext.count,
          ext.byteStride,
          new Uint8Array(source.subarray(start, start + ext.byteLength)),
          ext.mode,
          ext.filter ?? 'NONE',
        )
      } else {
        const source = binFor(json, bin, bv.buffer ?? 0, `bufferView ${i}`)
        const start = bv.byteOffset ?? 0
        bytes = source.subarray(start, start + bv.byteLength)
      }
      const offset = size
      parts.push(Buffer.from(bytes))
      size += bytes.length
      const padded = pad4(size)
      if (padded > size) {
        parts.push(Buffer.alloc(padded - size))
        size = padded
      }
      /** @type {GltfJson} */
      const out = { ...bv, buffer: 0, byteOffset: offset, byteLength: bytes.length }
      if (bv.extensions) {
        const rest = { ...bv.extensions }
        for (const n of MESHOPT_EXTENSIONS) delete rest[n]
        if (Object.keys(rest).length) out.extensions = rest
        else delete out.extensions
      }
      return out
    },
  )

  if (views.length) {
    const first = { ...(json.buffers?.[0] ?? {}) }
    delete first.uri
    delete first.extensions
    json.bufferViews = views
    json.buffers = [{ ...first, byteLength: size }]
  } else {
    delete json.bufferViews
    delete json.buffers
  }
  /** @param {string} key */
  const strip = (key) => {
    if (!Array.isArray(json[key])) return
    json[key] = json[key].filter((/** @type {string} */ n) => !MESHOPT_EXTENSIONS.includes(n))
    if (!json[key].length) delete json[key]
  }
  strip('extensionsUsed')
  strip('extensionsRequired')
  return buildGlb(json, views.length ? Buffer.concat(parts) : null)
}
