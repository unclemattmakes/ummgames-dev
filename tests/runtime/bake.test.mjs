/**
 * runtime/render/bake.ts, run in node: three's geometry and materials need no WebGL. The file is
 * TypeScript, which Vitest transforms; the path is built at run time so this repo's own
 * typecheck leaves it to runtime/tsconfig.json.
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

/** @param {string} rel @returns {Promise<any>} */
const load = (rel) =>
  import(/* @vite-ignore */ new URL(`../../runtime/${rel}`, import.meta.url).href)

const { bake, bakeInPlace, isPlainMaterial } = await load('render/bake.ts')

/** @param {number} color @param {Record<string, unknown>} [extra] */
const paint = (color, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.1, ...extra })

/** One triangle in the XY plane, facing +Z. */
function tri() {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
  g.computeVertexNormals()
  return g
}

/** @param {THREE.Material | THREE.Material[]} m @param {[number, number, number]} [at] */
function mesh(m, at = [0, 0, 0], g = tri()) {
  const out = new THREE.Mesh(g, m)
  out.position.set(...at)
  return out
}

/** @param {THREE.Mesh[]} meshes */
const draws = (meshes) => meshes.length

describe('render/bake', () => {
  it('folds plain paints of one finish into one vertex-coloured draw, in the space frame', () => {
    const space = new THREE.Group()
    space.position.set(10, 0, 0)
    const red = mesh(paint(0xff0000), [11, 0, 0])
    const blue = mesh(paint(0x0000ff), [12, 0, 0])
    const out = bake([red, blue], space)
    expect(draws(out)).toBe(1)
    const g = out[0].geometry
    expect(out[0].material.vertexColors).toBe(true)
    expect(out[0].material.roughness).toBe(0.5)
    expect(g.attributes.position.count).toBe(6)
    expect(g.attributes.position.getX(0)).toBeCloseTo(1)
    expect(g.attributes.position.getX(3)).toBeCloseTo(2)
    expect([g.attributes.color.getX(0), g.attributes.color.getZ(0)]).toEqual([1, 0])
    expect([g.attributes.color.getX(3), g.attributes.color.getZ(3)]).toEqual([0, 1])
    expect(Object.keys(g.attributes).sort()).toEqual(['color', 'normal', 'position'])
    expect(space.children).toHaveLength(0)
  })

  it('keeps glows, see-through, textured and named materials apart, as the same instances', () => {
    const glow = paint(0xffffff, { emissive: 0xff0000, emissiveIntensity: 2 })
    const glass = paint(0xffffff, { transparent: true, opacity: 0.5 })
    const decal = paint(0xffffff, { map: new THREE.Texture() })
    const hull = paint(0x808080, { name: 'hull-main' })
    const basic = new THREE.MeshBasicMaterial()
    const parts = [glow, glass, decal, hull, basic, paint(0x111111), paint(0x222222)].map((m) =>
      mesh(m),
    )
    expect(isPlainMaterial(hull)).toBe(true)
    expect(isPlainMaterial(glow) || isPlainMaterial(glass) || isPlainMaterial(decal)).toBe(false)
    /** @type {[THREE.MeshStandardMaterial, THREE.MeshStandardMaterial][]} */
    const made = []
    const out = bake(parts, new THREE.Group(), {
      keepApart: (/** @type {THREE.Material} */ m) => m.name.startsWith('hull'),
      onMaterial: (
        /** @type {THREE.MeshStandardMaterial} */ m,
        /** @type {THREE.MeshStandardMaterial} */ from,
      ) => made.push([m, from]),
    })
    expect(draws(out)).toBe(6)
    const mats = out.map((/** @type {THREE.Mesh} */ m) => m.material)
    for (const kept of [glow, glass, decal, hull, basic]) expect(mats).toContain(kept)
    expect(made).toHaveLength(1)
    expect(mats).toContain(made[0]?.[0])
    expect(out.find((/** @type {THREE.Mesh} */ m) => m.material === hull)?.name).toBe('hull-main')
  })

  it('gives each finish its own draw', () => {
    const out = bake(
      [mesh(paint(0xff0000)), mesh(paint(0xff0000, { roughness: 0.9 }))],
      new THREE.Group(),
    )
    expect(draws(out)).toBe(2)
  })

  it('splits a multi-material mesh by its groups', () => {
    const g = new THREE.BufferGeometry()
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1], 3),
    )
    g.addGroup(0, 3, 0)
    g.addGroup(3, 3, 1)
    const glow = paint(0, { emissive: 0xffffff })
    const out = bake([mesh([paint(0xff0000), glow], [0, 0, 0], g)], new THREE.Group())
    expect(draws(out)).toBe(2)
    const lit = out.find((/** @type {THREE.Mesh} */ m) => m.material === glow)
    expect(lit?.geometry.attributes.position.getZ(0)).toBe(1)
  })

  it('turns a mirrored triangle back over, so it still faces out', () => {
    const m = mesh(paint(0xff0000))
    m.scale.set(-1, 1, 1)
    const g = bake([m, mesh(paint(0xff0000), [5, 0, 0])], new THREE.Group())[0].geometry
    const p = g.attributes.position
    const a = new THREE.Vector3().fromBufferAttribute(p, 0)
    const b = new THREE.Vector3().fromBufferAttribute(p, 1)
    const c = new THREE.Vector3().fromBufferAttribute(p, 2)
    const face = b.sub(a).cross(c.sub(a)).normalize()
    const normal = new THREE.Vector3().fromBufferAttribute(g.attributes.normal, 0)
    expect(face.dot(normal)).toBeCloseTo(1)
  })

  it('reads quantized attributes as floats', () => {
    const g = new THREE.BufferGeometry()
    const q = new Int16Array([0, 0, 0, 32767, 0, 0, 0, 32767, 0])
    g.setAttribute('position', new THREE.BufferAttribute(q, 3, true))
    const out = bake([mesh(paint(1), [0, 0, 0], g)], new THREE.Group())
    expect(out[0].geometry.attributes.position.getX(1)).toBeCloseTo(1)
  })

  it('bakes a part in place, leaving sockets, hidden meshes and shared geometry alone', () => {
    const part = new THREE.Group()
    part.name = 'turret'
    const shared = tri()
    const before = Array.from(shared.attributes.position.array)
    const body = mesh(paint(0xff0000), [0, 0, 0], shared)
    body.name = 'body'
    const barrel = mesh(paint(0x00ff00), [0, 1, 0], shared)
    const socket = new THREE.Object3D()
    socket.name = 'muzzle'
    barrel.add(socket)
    const flash = mesh(paint(0xffffff))
    flash.visible = false
    part.add(body, barrel, flash)

    expect(bakeInPlace(part)).toBe(true)
    expect(part.name).toBe('turret')
    expect(part.children).toContain(flash)
    expect(part.getObjectByName('body')).toBeUndefined()
    const stand = part.getObjectByName('muzzle')?.parent
    expect(stand?.type).toBe('Object3D')
    expect(stand?.position.y).toBe(1)
    expect(stand?.parent).toBe(part)
    /** @type {any[]} */
    const baked = part.children.filter((/** @type {any} */ c) => c.isMesh && c !== flash)
    expect(baked).toHaveLength(1)
    expect(baked[0].geometry.attributes.position.count).toBe(6)
    expect(Array.from(shared.attributes.position.array)).toEqual(before)

    const lone = new THREE.Group()
    lone.add(mesh(paint(1)))
    expect(bakeInPlace(lone)).toBe(false)
    expect(lone.children[0]?.type).toBe('Mesh')
  })

  it('takes shadows from the sources unless told', () => {
    const a = mesh(paint(1))
    a.castShadow = true
    expect(bake([a, mesh(paint(2))], new THREE.Group())[0]).toMatchObject({
      castShadow: true,
      receiveShadow: false,
    })
    expect(
      bake([a], new THREE.Group(), { castShadow: false, receiveShadow: true })[0],
    ).toMatchObject({ castShadow: false, receiveShadow: true })
  })
})
