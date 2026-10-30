/**
 * `@ummgames/dev/gltf` against GLBs built here in code: two identical meshes, data nothing uses,
 * and nodes whose extras a game reads.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { meshopt } from '@gltf-transform/functions'
import { MeshoptEncoder } from 'meshoptimizer'
import { afterAll, describe, expect, it } from 'vitest'
import { importPackages, loadGltfDeps } from '../../src/gltf/deps.mjs'
import { parseGlb } from '../../src/gltf/glb.mjs'
import { createGltfIO, decodeMeshoptGlb, optimizeGlb } from '../../src/gltf/index.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const BIN = path.join(ROOT, 'bin/umm-dev.mjs')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'umm-gltf-'))
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }))

/** A flat grid of unindexed triangles: every inner vertex repeats, so weld has work to do. */
function gridPositions(n = 12) {
  const out = []
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const quad = [
        [i, j],
        [i + 1, j],
        [i + 1, j + 1],
        [i, j],
        [i + 1, j + 1],
        [i, j + 1],
      ]
      for (const [x, z] of quad)
        out.push(/** @type {number} */ (x) / n, 0, /** @type {number} */ (z) / n)
    }
  return new Float32Array(out)
}

/** Two identical crates, an unused mesh and accessor, and an empty spawn marker. */
function makeDocument() {
  const doc = new Document()
  const buffer = doc.createBuffer()
  const material = doc.createMaterial('paint').setBaseColorFactor([1, 0.5, 0.2, 1])
  const mesh = (/** @type {string} */ name) => {
    const position = doc
      .createAccessor()
      .setType('VEC3')
      .setArray(gridPositions())
      .setBuffer(buffer)
    const prim = doc.createPrimitive().setAttribute('POSITION', position).setMaterial(material)
    return doc.createMesh(name).addPrimitive(prim)
  }
  const scene = doc.createScene('level')
  scene.addChild(
    doc.createNode('crate-a').setMesh(mesh('crate')).setExtras({ tag: 'collider', id: 1 }),
  )
  scene.addChild(
    doc
      .createNode('crate-b')
      .setMesh(mesh('crate'))
      .setTranslation([2, 0, 0])
      .setExtras({ tag: 'collider', id: 2 }),
  )
  scene.addChild(doc.createNode('spawn').setExtras({ entity: 'spawn' }))
  mesh('unused') // in no scene
  doc.createAccessor('stray').setType('SCALAR').setArray(new Float32Array(500)).setBuffer(buffer)
  return doc
}

/** @param {string} name @param {Uint8Array} bytes */
function writeTmp(name, bytes) {
  const file = path.join(TMP, name)
  fs.writeFileSync(file, bytes)
  return file
}

/** The GLB with every EXT_meshopt_compression in its JSON chunk renamed to KHR_ (same length). */
function asKhr(/** @type {Uint8Array} */ glb) {
  const out = Buffer.from(glb)
  const len = out.readUInt32LE(12)
  const json = out.subarray(20, 20 + len).toString('utf8')
  Buffer.from(json.replaceAll('EXT_meshopt_compression', 'KHR_meshopt_compression'), 'utf8').copy(
    out,
    20,
  )
  return out
}

/** @param {import('@gltf-transform/core').Document} doc */
const accessors = (doc) =>
  doc
    .getRoot()
    .listAccessors()
    .map((a) => ({
      type: a.getType(),
      componentType: a.getComponentType(),
      normalized: a.getNormalized(),
      array: Array.from(/** @type {ArrayLike<number>} */ (a.getArray())),
    }))

describe('optimizeGlb', () => {
  it('shrinks the file, merges the identical meshes and keeps every node with its extras', async () => {
    const io = await createGltfIO()
    const bytes = await io.writeBinary(makeDocument())
    const file = writeTmp('level.glb', bytes)
    const { before, after, written } = await optimizeGlb(file)
    expect(before).toBe(bytes.length)
    expect(written).toBe(true)
    expect(after).toBe(fs.statSync(file).size)
    expect(after).toBeLessThan(before / 2)

    const doc = await io.read(file)
    const root = doc.getRoot()
    expect(root.listMeshes()).toHaveLength(1)
    const nodes = Object.fromEntries(root.listNodes().map((n) => [n.getName(), n.getExtras()]))
    expect(nodes).toEqual({
      'crate-a': { tag: 'collider', id: 1 },
      'crate-b': { tag: 'collider', id: 2 },
      spawn: { entity: 'spawn' },
    })
    expect(root.listAccessors().some((a) => a.getName() === 'stray')).toBe(false)
    expect(root.listExtensionsUsed().map((e) => e.extensionName)).toContain(
      'EXT_meshopt_compression',
    )
  })

  it('lets prune take the empty marker with keepExtras false', async () => {
    const io = await createGltfIO()
    const file = writeTmp('no-extras.glb', await io.writeBinary(makeDocument()))
    await optimizeGlb(file, { keepExtras: false, level: 'high' })
    const names = (await io.read(file))
      .getRoot()
      .listNodes()
      .map((n) => n.getName())
    expect(names.sort()).toEqual(['crate-a', 'crate-b'])
  })

  it('writes nothing on a dry run', async () => {
    const io = await createGltfIO()
    const bytes = await io.writeBinary(makeDocument())
    const file = writeTmp('dry.glb', bytes)
    const { before, after, written } = await optimizeGlb(file, { dryRun: true })
    expect([before, written]).toEqual([bytes.length, false])
    expect(after).toBeLessThan(before)
    expect(fs.readFileSync(file).equals(Buffer.from(bytes))).toBe(true)
  })

  it('leaves a file alone when the result is no smaller, as on a second run', async () => {
    const io = await createGltfIO()
    const file = writeTmp('twice.glb', await io.writeBinary(makeDocument()))
    await optimizeGlb(file)
    const once = fs.readFileSync(file)
    const second = await optimizeGlb(file)
    expect(second.written).toBe(false)
    expect(second.after).toBeGreaterThanOrEqual(second.before)
    expect(fs.readFileSync(file).equals(once)).toBe(true)
  })

  it('reads a KHR_meshopt_compression input', async () => {
    const io = await createGltfIO()
    const doc = makeDocument()
    await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
    const file = writeTmp('khr.glb', asKhr(await io.writeBinary(doc)))
    expect(parseGlb(fs.readFileSync(file)).json.extensionsUsed).toContain('KHR_meshopt_compression')
    const { after, written } = await optimizeGlb(file)
    expect(written).toBe(true)
    expect(after).toBe(fs.statSync(file).size)
    expect(parseGlb(fs.readFileSync(file)).json.extensionsUsed).toContain('EXT_meshopt_compression')
    const names = (await io.read(file))
      .getRoot()
      .listNodes()
      .map((n) => n.getName())
    expect(names.sort()).toEqual(['crate-a', 'crate-b', 'spawn'])
  })

  it('rejects a file that is not a GLB, and a level it does not know', async () => {
    const file = writeTmp('text.glb', Buffer.from('not a glb at all'))
    await expect(optimizeGlb(file)).rejects.toThrow(/not a GLB/)
    // @ts-expect-error a level that does not exist
    await expect(optimizeGlb(file, { level: 'low' })).rejects.toThrow(/medium or high/)
  })
})

describe('decodeMeshoptGlb', () => {
  /** A meshopt-compressed GLB, and the accessors glTF-Transform's own decoder reads from it. */
  async function compressed() {
    const io = await createGltfIO()
    const doc = makeDocument()
    await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }))
    const ext = await io.writeBinary(doc)
    return { ext, expected: accessors(await io.readBinary(ext)) }
  }
  const plainIO = () => new NodeIO().registerExtensions(ALL_EXTENSIONS)

  it('turns EXT_ and KHR_meshopt GLBs into plain ones with the same accessor data', async () => {
    const { ext, expected } = await compressed()
    expect(expected.length).toBeGreaterThan(0)
    // Without a decoder, the compressed file does not read: the check below can fail.
    await expect(plainIO().readBinary(ext)).rejects.toThrow()

    for (const input of [ext, asKhr(ext)]) {
      const plain = await decodeMeshoptGlb(input)
      const { json } = parseGlb(plain)
      expect(json.extensionsUsed ?? []).not.toContain('EXT_meshopt_compression')
      expect(json.extensionsUsed ?? []).not.toContain('KHR_meshopt_compression')
      expect(json.extensionsRequired ?? []).not.toContain('EXT_meshopt_compression')
      expect(json.buffers).toHaveLength(1)
      expect(accessors(await plainIO().readBinary(new Uint8Array(plain)))).toEqual(expected)
    }
  })

  it('returns a GLB without meshopt unchanged', async () => {
    const bytes = await plainIO().writeBinary(makeDocument())
    expect(Buffer.from(await decodeMeshoptGlb(bytes)).equals(Buffer.from(bytes))).toBe(true)
  })
})

describe('missing packages', () => {
  /** @param {string[]} absent */
  const loader = (absent) => async (/** @type {string} */ name) => {
    if (absent.includes(name))
      throw Object.assign(new Error(`Cannot find package '${name}'`), {
        code: 'ERR_MODULE_NOT_FOUND',
      })
    return import(/* @vite-ignore */ name)
  }

  it('names every missing package and the line that installs them', async () => {
    await expect(
      importPackages(['meshoptimizer', '@gltf-transform/core'], loader(['meshoptimizer'])),
    ).rejects.toThrow(
      /needs meshoptimizer, which is not installed.*pnpm add -D .*meshoptimizer@1\.3\.0/,
    )
    await expect(
      loadGltfDeps(loader(['@gltf-transform/core', '@gltf-transform/functions'])),
    ).rejects.toThrow(/needs @gltf-transform\/core, @gltf-transform\/functions, which are/)
  })

  it('passes any other import error through', async () => {
    const broken = async () => {
      throw new SyntaxError('bad module')
    }
    await expect(importPackages(['meshoptimizer'], broken)).rejects.toThrow('bad module')
  })
})

describe('umm-dev gltf', () => {
  /** @param {string[]} args */
  const cli = (args) =>
    spawnSync(process.execPath, [BIN, 'gltf', ...args], { encoding: 'utf8', timeout: 60_000 })

  it('prints its usage for --help and exits 0', () => {
    for (const args of [['--help'], ['optimize', '-h']]) {
      const res = cli(args)
      expect(res.status, args.join(' ')).toBe(0)
      expect(res.stdout).toContain('usage: umm-dev gltf optimize')
    }
  })

  it('exits 2 on a usage error', () => {
    for (const args of [
      [],
      ['shrink', 'a.glb'],
      ['optimize'],
      ['optimize', 'a.glb', '--level', 'low'],
      ['optimize', '--nope'],
    ]) {
      const res = cli(args)
      expect(res.status, args.join(' ')).toBe(2)
      expect(res.stderr, args.join(' ')).toContain('umm-dev gltf')
    }
  })

  it('prints a size line per file, and exits 1 when one fails', async () => {
    const io = await createGltfIO()
    const good = writeTmp('cli.glb', await io.writeBinary(makeDocument()))
    const res = cli(['optimize', good, path.join(TMP, 'missing.glb'), '--level', 'high'])
    expect(res.status).toBe(1)
    expect(res.stdout).toMatch(/cli\.glb: \d+ -> \d+ bytes \(\d+%\)\n/)
    expect(res.stderr).toContain('missing.glb')

    expect(res.stdout).not.toContain('prune:')

    const again = cli(['optimize', good])
    expect(again.status).toBe(0)
    expect(again.stdout).toContain('(not written: no smaller)')
    const dry = cli(['optimize', good, '--dry-run'])
    expect(dry.status).toBe(0)
    expect(dry.stdout).toContain('(dry run, not written)')
  })
})
