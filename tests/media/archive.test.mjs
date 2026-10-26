import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { afterAll, describe, expect, it, vi } from 'vitest'
import * as storeCmd from '../../src/commands/store.mjs'
import { archiveKit, captureDate, STORE_DEFAULTS } from '../../src/media/store.mjs'
import { crc32, writeZip } from '../../src/media/zip.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'umm-dev-archive-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

/** Read a zip back from its central directory: name to contents, checking each CRC. */
function readZip(/** @type {string} */ file) {
  const b = fs.readFileSync(file)
  const end = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const count = b.readUInt16LE(end + 10)
  let p = b.readUInt32LE(end + 16)
  /** @type {Record<string, Buffer>} */
  const out = {}
  for (let i = 0; i < count; i++) {
    expect(b.readUInt32LE(p)).toBe(0x02014b50)
    const method = b.readUInt16LE(p + 10)
    const crc = b.readUInt32LE(p + 16)
    const size = b.readUInt32LE(p + 20)
    const nameLen = b.readUInt16LE(p + 28)
    const at = b.readUInt32LE(p + 42)
    const name = b.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    const body = b.subarray(
      at + 30 + b.readUInt16LE(at + 26),
      at + 30 + b.readUInt16LE(at + 26) + size,
    )
    const data = method === 8 ? zlib.inflateRawSync(body) : body
    expect(crc32(data)).toBe(crc)
    out[name] = data
    p += 46 + nameLen
  }
  return out
}

/** A game with a made kit: two outputs, a review sheet and one capture. */
function makeGame(/** @type {string} */ name, /** @type {string | null} */ capturedAt) {
  const root = path.join(tmp, name)
  const kit = path.join(root, 'dist-store')
  fs.mkdirSync(path.join(kit, 'review'), { recursive: true })
  fs.mkdirSync(path.join(kit, 'capture', 'intro'), { recursive: true })
  fs.writeFileSync(path.join(kit, 'cover-800x800.png'), Buffer.alloc(2000, 7))
  fs.writeFileSync(path.join(kit, 'notes.txt'), 'hello '.repeat(200))
  fs.writeFileSync(path.join(kit, 'review', 'preview-beats.jpg'), Buffer.from([1, 2, 3]))
  fs.writeFileSync(path.join(kit, 'capture', 'intro', 'f00000.jpg'), Buffer.from([9]))
  if (capturedAt !== null)
    fs.writeFileSync(
      path.join(kit, 'capture', 'intro', 'meta.json'),
      JSON.stringify(capturedAt ? { capturedAt } : {}),
    )
  return { ...STORE_DEFAULTS, root }
}

describe('writeZip', () => {
  it('round-trips stored and deflated files, with utf-8 names', () => {
    const a = path.join(tmp, 'a.png')
    const b = path.join(tmp, 'b.txt')
    fs.writeFileSync(a, Buffer.from([0, 1, 2, 255]))
    fs.writeFileSync(b, 'zip me '.repeat(100))
    const zip = path.join(tmp, 'out', 'x.zip')
    expect(
      writeZip(zip, [
        { name: 'a.png', file: a },
        { name: 'dir/ü.txt', file: b },
      ]).files,
    ).toBe(2)
    const got = readZip(zip)
    expect(got['a.png']).toEqual(Buffer.from([0, 1, 2, 255]))
    expect(got['dir/ü.txt'].toString()).toBe('zip me '.repeat(100))
    expect(fs.existsSync(`${zip}.part`)).toBe(false)
  })

  it('crc32 matches the standard check value', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
  })
})

describe('the archive step', () => {
  it('zips the kit but not its captures, named by the capture date', () => {
    const store = makeGame('dated', '2026-03-04T10:00:00')
    expect(captureDate(store)?.getDate()).toBe(4)
    const r = archiveKit(store)
    expect(r?.date).toBe('2026-03-04')
    expect(path.relative(store.root, /** @type {string} */ (r?.file))).toBe(
      path.join('store-archive', 'dist-store-2026-03-04.zip'),
    )
    expect(Object.keys(readZip(/** @type {string} */ (r?.file))).sort()).toEqual([
      'cover-800x800.png',
      'notes.txt',
      'review/preview-beats.jpg',
    ])
    expect(archiveKit(store)?.file).toMatch(/dist-store-2026-03-04-2\.zip$/)
  })

  it('falls back to the meta.json time for captures without capturedAt', () => {
    const store = makeGame('old', '')
    const meta = path.join(store.root, 'dist-store', 'capture', 'intro', 'meta.json')
    const when = new Date(2025, 0, 2, 12)
    fs.utimesSync(meta, when, when)
    expect(archiveKit(store)?.date).toBe('2025-01-02')
  })

  it('archives nothing from an empty kit, and refuses archiveDir = out', () => {
    const store = { ...STORE_DEFAULTS, root: path.join(tmp, 'empty') }
    expect(archiveKit(store)).toBeNull()
    expect(() => archiveKit({ ...store, archiveDir: store.out })).toThrow(/must not be store.out/)
  })

  it('runs alone with --steps archive', async () => {
    const store = makeGame('cmd', '2026-05-06T08:00:00')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      expect(await storeCmd.run(['--steps', 'archive'], { cwd: store.root })).toBe(0)
      expect(log.mock.calls.flat().join('\n')).toContain('dist-store-2026-05-06.zip: 3 files')
    } finally {
      log.mockRestore()
    }
  })
})
