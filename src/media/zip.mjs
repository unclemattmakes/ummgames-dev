// @ts-check
/**
 * A plain zip writer, no dependencies: what the store's archive step packs a kit into. Files
 * that are already compressed (png, jpg, webp, mp4, ...) are stored; the rest are deflated. No
 * zip64: a file or archive past 4 GB, or more than 65535 entries, is refused.
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { MediaError } from './util.mjs'

const STORED = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.webm', '.zip'])
const MAX = 0xffffffff

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

/** @param {Buffer} buf */
export function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** A file's time as DOS date and time, local, to the even second. @param {Date} d */
function dosTime(d) {
  const year = Math.max(d.getFullYear(), 1980)
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

/**
 * Write `entries` to the zip `file`, one at a time so only one file is in memory.
 * @param {string} file
 * @param {{ name: string, file: string }[]} entries  `name` is the path inside the zip, with `/`
 * @returns {{ files: number, bytes: number }}
 */
export function writeZip(file, entries) {
  if (entries.length > 0xffff) throw new MediaError(`${entries.length} files is too many for a zip`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.part`
  const fd = fs.openSync(tmp, 'w')
  /** @type {Buffer[]} */
  const central = []
  let offset = 0
  try {
    for (const e of entries) {
      const data = fs.readFileSync(e.file)
      const stored = STORED.has(path.extname(e.file).toLowerCase())
      const body = stored ? data : zlib.deflateRawSync(data)
      if (data.length > MAX || offset + body.length > MAX)
        throw new MediaError(`${e.name} takes the zip past 4 GB: archive less at once`)
      const name = Buffer.from(e.name, 'utf8')
      const { time, date } = dosTime(fs.statSync(e.file).mtime)
      const crc = crc32(data)
      const local = Buffer.alloc(30)
      local.writeUInt32LE(0x04034b50, 0)
      local.writeUInt16LE(20, 4) // version needed
      local.writeUInt16LE(0x0800, 6) // utf-8 names
      local.writeUInt16LE(stored ? 0 : 8, 8)
      local.writeUInt16LE(time, 10)
      local.writeUInt16LE(date, 12)
      local.writeUInt32LE(crc, 14)
      local.writeUInt32LE(body.length, 18)
      local.writeUInt32LE(data.length, 22)
      local.writeUInt16LE(name.length, 26)
      local.writeUInt16LE(0, 28)
      fs.writeSync(fd, local)
      fs.writeSync(fd, name)
      fs.writeSync(fd, body)
      const cd = Buffer.alloc(46)
      cd.writeUInt32LE(0x02014b50, 0)
      cd.writeUInt16LE(20, 4) // version made by
      local.copy(cd, 6, 4, 30) // version needed .. name length are the same fields
      cd.writeUInt32LE(offset, 42)
      central.push(cd, name)
      offset += local.length + name.length + body.length
    }
    const cdBuf = Buffer.concat(central)
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(entries.length, 8)
    end.writeUInt16LE(entries.length, 10)
    end.writeUInt32LE(cdBuf.length, 12)
    end.writeUInt32LE(offset, 16)
    fs.writeSync(fd, cdBuf)
    fs.writeSync(fd, end)
  } catch (e) {
    fs.closeSync(fd)
    fs.rmSync(tmp, { force: true })
    throw e
  }
  fs.closeSync(fd)
  fs.renameSync(tmp, file)
  return { files: entries.length, bytes: fs.statSync(file).size }
}
