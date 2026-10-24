// @ts-check
/**
 * A minimal PNG encoder: 8-bit, non-interlaced, filter 0 on every row. Enough for the flat
 * pictures `appIcon` draws; Node's zlib does the compression, so there is no dependency.
 */
import zlib from 'node:zlib'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** @type {Uint32Array | null} */
let table = null

/** @param {Uint8Array} bytes */
function crc32(bytes) {
  if (!table) {
    table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (const b of bytes) c = /** @type {number} */ (table[(c ^ b) & 0xff]) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/**
 * @param {string} type
 * @param {Buffer} payload
 */
function chunk(type, payload) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(payload.length, 0)
  head.write(type, 4, 'ascii')
  const tail = Buffer.alloc(4)
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), payload])), 0)
  return Buffer.concat([head, payload, tail])
}

/** Channels per pixel to PNG colour type: grey, grey and alpha, RGB, RGBA. */
const COLOUR_TYPE = /** @type {Record<number, number>} */ ({ 1: 0, 2: 4, 3: 2, 4: 6 })

/**
 * @param {{ width: number, height: number, channels: 1 | 2 | 3 | 4, data: Uint8Array }} img
 * @param {{ level?: number }} [options] zlib's level; the default is zlib's own.
 * @returns {Buffer}
 */
export function encodePng(img, { level = zlib.constants.Z_DEFAULT_COMPRESSION } = {}) {
  const { width, height, channels, data } = img
  const colourType = COLOUR_TYPE[channels]
  if (colourType === undefined) throw new Error(`encodePng: bad channel count ${channels}`)
  if (data.length < width * height * channels) {
    throw new Error(`encodePng: ${data.length} bytes for ${width}x${height}x${channels}`)
  }
  const stride = width * channels
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = colourType
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
