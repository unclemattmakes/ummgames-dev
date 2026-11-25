/**
 * Bake: fewer draw calls for a model that arrives as one mesh per material, as a glTF exported
 * from Blender does. Every mesh is one draw call, so a part with a dozen paints costs a dozen.
 *
 * `bake(objects, space, options?)` merges the meshes under `objects` into `space`'s frame and
 * folds each plain material into vertex colour. A part becomes one draw per plain finish (the
 * same roughness, metalness, flat shading, side and fog), plus one per material that must stay
 * its own:
 * - glows: an emissive colour above black at an intensity above 0, which a game flashes;
 * - see-through ones: `transparent`, or an `alphaTest`;
 * - anything a vertex colour cannot stand in for: another material type, a
 *   `MeshPhysicalMaterial`, a texture map, vertex colours of its own, wireframe;
 * - whatever `options.keepApart` names, such as paints a game recolours at run time.
 *
 * A kept material keeps its instance, so a game that holds a reference to it (to flash or
 * recolour it) still reaches the draw. The baked material is a new `MeshStandardMaterial` with
 * `vertexColors`; `options.onMaterial` gets each one, to add the game's own shader hook (toon
 * shading, say), since the source materials' hooks are not carried over.
 *
 * Left out, and left where they are: skinned, instanced and morphing meshes, and hidden ones (a
 * muzzle flash the game shows later). Source geometry is read, never changed or disposed, so
 * clones that share it are safe. Mirrored meshes (a negative scale) have their triangles turned
 * back over, so they still face out.
 *
 * Imports `three` and its BufferGeometryUtils, nothing else. The game must depend on `three`.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export interface BakeOptions {
  /**
   * True for a plain material that keeps its own draw anyway: a paint the game recolours, say
   * `(m) => m.name.startsWith('hull')`. Only asked about materials bake would otherwise fold.
   */
  keepApart?: (material: THREE.MeshStandardMaterial) => boolean
  /**
   * Called once per new baked material, before it is used, with the first source material of
   * its finish. For the game's shader hook: `onMaterial: (m) => toon(m)`.
   */
  onMaterial?: (material: THREE.MeshStandardMaterial, from: THREE.MeshStandardMaterial) => void
  /** Every new mesh casts shadows. Default: true when any baked source mesh did. */
  castShadow?: boolean
  /** Every new mesh receives shadows. Default: true when any baked source mesh did. */
  receiveShadow?: boolean
}

export interface BakeInPlaceOptions extends BakeOptions {
  /** Fewer bakeable meshes than this and the part is left alone. Default 2. */
  minMeshes?: number
}

const MAPS = [
  'map',
  'lightMap',
  'aoMap',
  'emissiveMap',
  'bumpMap',
  'normalMap',
  'displacementMap',
  'roughnessMap',
  'metalnessMap',
  'alphaMap',
  'envMap',
] as const

/** A material a vertex colour can stand in for: a flat, opaque, unlit-free standard paint. */
export function isPlainMaterial(m: THREE.Material): m is THREE.MeshStandardMaterial {
  const s = m as THREE.MeshStandardMaterial
  if (!s.isMeshStandardMaterial || (m as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial)
    return false
  if (s.transparent || s.alphaTest > 0 || s.vertexColors || s.wireframe) return false
  if (s.emissiveIntensity > 0 && s.emissive.getHex() !== 0) return false
  for (const k of MAPS) if (s[k]) return false
  return true
}

/** A mesh bake can merge: a plain triangle mesh, not skinned, instanced or morphing. */
export function isBakeable(o: THREE.Object3D): o is THREE.Mesh {
  const mesh = o as THREE.Mesh
  if (!mesh.isMesh) return false
  if ((o as THREE.SkinnedMesh).isSkinnedMesh || (o as THREE.InstancedMesh).isInstancedMesh)
    return false
  if (Object.keys(mesh.geometry.morphAttributes).length > 0) return false
  return mesh.geometry.attributes.position !== undefined
}

/** The visible, bakeable meshes under `roots`, each once, parents before children. */
function sources(roots: readonly THREE.Object3D[]): THREE.Mesh[] {
  const out = new Set<THREE.Mesh>()
  for (const root of roots)
    root.traverseVisible((o) => {
      if (isBakeable(o)) out.add(o)
    })
  return [...out]
}

/** The finish a plain material bakes to: materials that share one share a draw. */
function finishKey(m: THREE.MeshStandardMaterial): string {
  return [m.roughness, m.metalness, m.flatShading, m.side, m.fog, m.envMapIntensity].join('|')
}

type Reader = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, i: number) => number
const READ: readonly Reader[] = [
  (a, i) => a.getX(i),
  (a, i) => a.getY(i),
  (a, i) => a.getZ(i),
  (a, i) => a.getW(i),
]

/**
 * Triangles `[start, start + count)` of `g` (in index order), as a new non-indexed geometry in the
 * frame `m` maps to, with only the named attributes. Quantized attributes come out as floats.
 */
function extract(
  g: THREE.BufferGeometry,
  m: THREE.Matrix4,
  start: number,
  count: number,
  names: readonly string[],
): THREE.BufferGeometry {
  const index = g.index
  const n = count - (count % 3)
  const flip = m.determinant() < 0
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(m)
  const v = new THREE.Vector3()
  const out = new THREE.BufferGeometry()
  for (const name of names) {
    const a = g.attributes[name]
    if (!a) continue
    const size = a.itemSize
    const arr = new Float32Array(n * size)
    for (let k = 0; k < n; k++) {
      // Turn a mirrored triangle back over: its second and third corners swap.
      const corner = k % 3
      const kk = flip && corner > 0 ? k - corner + (3 - corner) : k
      const src = index ? index.getX(start + kk) : start + kk
      for (let c = 0; c < size; c++) arr[k * size + c] = (READ[c] as Reader)(a, src)
    }
    if (name === 'position' || name === 'normal' || name === 'tangent') {
      for (let k = 0; k < n; k++) {
        v.fromArray(arr, k * size)
        if (name === 'position') v.applyMatrix4(m)
        else if (name === 'normal') v.applyMatrix3(normalMatrix).normalize()
        else v.transformDirection(m)
        v.toArray(arr, k * size)
        // A tangent's w is its handedness, which a mirror reverses.
        if (name === 'tangent' && flip && size === 4) arr[k * size + 3] = -(arr[k * size + 3] ?? 1)
      }
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size))
  }
  if (!out.attributes.normal) out.computeVertexNormals()
  return out
}

/** Each material of `mesh` with the triangle range it draws, clipped to the draw range. */
function pieces(mesh: THREE.Mesh): { material: THREE.Material; start: number; count: number }[] {
  const g = mesh.geometry
  const total = g.index ? g.index.count : (g.attributes.position?.count ?? 0)
  const lo = Math.max(0, g.drawRange.start)
  const hi = Math.min(total, g.drawRange.start + g.drawRange.count)
  const clip = (start: number, count: number) => {
    const s = Math.max(start, lo)
    return { start: s, count: Math.max(0, Math.min(start + count, hi) - s) }
  }
  if (!Array.isArray(mesh.material)) return [{ material: mesh.material, ...clip(0, total) }]
  const mats = mesh.material
  if (g.groups.length === 0) {
    const first = mats[0]
    return first ? [{ material: first, ...clip(0, total) }] : []
  }
  const out: { material: THREE.Material; start: number; count: number }[] = []
  for (const group of g.groups) {
    const material = mats[group.materialIndex ?? 0]
    if (material) out.push({ material, ...clip(group.start, group.count) })
  }
  return out
}

/** The attributes a kept material's geometry carries: what every piece of it has. */
function sharedNames(list: readonly THREE.BufferGeometry[]): string[] {
  const first = list[0]
  if (!first) return []
  return Object.keys(first.attributes).filter((name) =>
    list.every((g) => g.attributes[name]?.itemSize === first.attributes[name]?.itemSize),
  )
}

function keepOnly(g: THREE.BufferGeometry, names: readonly string[]): THREE.BufferGeometry {
  for (const name of Object.keys(g.attributes)) if (!names.includes(name)) g.deleteAttribute(name)
  return g
}

/** One mesh per geometry list, or one per geometry if they will not merge. */
function meshesOf(list: THREE.BufferGeometry[], material: THREE.Material): THREE.Mesh[] {
  const merged =
    list.length === 1 ? list[0] : (mergeGeometries(list) as THREE.BufferGeometry | null)
  if (merged) return [new THREE.Mesh(merged, material)]
  return list.map((g) => new THREE.Mesh(g, material))
}

const KEPT_NAMES = ['position', 'normal', 'uv', 'uv1', 'uv2', 'uv3', 'color', 'tangent']

function bakeSources(
  meshes: readonly THREE.Mesh[],
  space: THREE.Object3D,
  options: BakeOptions,
): THREE.Mesh[] {
  space.updateWorldMatrix(true, true)
  const inv = space.matrixWorld.clone().invert()
  const plain = new Map<
    string,
    { from: THREE.MeshStandardMaterial; parts: THREE.BufferGeometry[] }
  >()
  const kept = new Map<THREE.Material, THREE.BufferGeometry[]>()
  const order = new Map<THREE.Material | string, number>()
  let cast = false
  let receive = false
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false)
    cast ||= mesh.castShadow
    receive ||= mesh.receiveShadow
    const m = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld)
    for (const { material, start, count } of pieces(mesh)) {
      if (count < 3) continue
      const fold = isPlainMaterial(material) && !options.keepApart?.(material)
      const key: THREE.Material | string = fold ? finishKey(material) : material
      order.set(key, Math.max(order.get(key) ?? mesh.renderOrder, mesh.renderOrder))
      if (!fold) {
        const list = kept.get(material) ?? []
        list.push(extract(mesh.geometry, m, start, count, KEPT_NAMES))
        kept.set(material, list)
        continue
      }
      const std = material as THREE.MeshStandardMaterial
      const g = extract(mesh.geometry, m, start, count, ['position', 'normal'])
      const n = g.attributes.position?.count ?? 0
      const col = new Float32Array(n * 3)
      for (let k = 0; k < n; k++) {
        col[k * 3] = std.color.r
        col[k * 3 + 1] = std.color.g
        col[k * 3 + 2] = std.color.b
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3))
      const entry = plain.get(key as string) ?? { from: std, parts: [] }
      entry.parts.push(g)
      plain.set(key as string, entry)
    }
  }
  const out: THREE.Mesh[] = []
  for (const [key, { from, parts }] of plain) {
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: from.roughness,
      metalness: from.metalness,
      flatShading: from.flatShading,
      side: from.side,
      fog: from.fog,
      envMapIntensity: from.envMapIntensity,
    })
    mat.name = 'baked'
    options.onMaterial?.(mat, from)
    for (const mesh of meshesOf(parts, mat)) {
      mesh.renderOrder = order.get(key) ?? 0
      out.push(mesh)
    }
  }
  for (const [material, list] of kept) {
    const names = sharedNames(list)
    for (const mesh of meshesOf(
      list.map((g) => keepOnly(g, names)),
      material,
    )) {
      mesh.name = material.name
      mesh.renderOrder = order.get(material) ?? 0
      out.push(mesh)
    }
  }
  for (const mesh of out) {
    mesh.castShadow = options.castShadow ?? cast
    mesh.receiveShadow = options.receiveShadow ?? receive
  }
  return out
}

/**
 * Merges the visible meshes under `objects` into new meshes in `space`'s frame and returns them.
 * Nothing is changed: the caller adds the result to `space` and takes the sources out.
 */
export function bake(
  objects: readonly THREE.Object3D[],
  space: THREE.Object3D,
  options: BakeOptions = {},
): THREE.Mesh[] {
  return bakeSources(sources(objects), space, options)
}

/**
 * Bakes a part in place. Its meshes become a few new children in its own frame; the part keeps
 * its name and transform, and everything bake left out stays where it was (empties used as
 * sockets, lights, skinned or hidden meshes). A baked mesh with children becomes a plain
 * `Object3D` with the same name and transform, so its children keep their place. A baked part
 * that is itself a mesh keeps an empty geometry. Returns false when the part had too few
 * bakeable meshes to be worth it, and was left alone.
 */
export function bakeInPlace(part: THREE.Object3D, options: BakeInPlaceOptions = {}): boolean {
  const meshes = sources([part])
  if (meshes.length < (options.minMeshes ?? 2)) return false
  const merged = bakeSources(meshes, part, options)
  // Children before parents, so a parent's children are settled before it is.
  for (const mesh of [...meshes].reverse()) {
    if (mesh === part) {
      mesh.geometry = new THREE.BufferGeometry()
      continue
    }
    const parent = mesh.parent
    if (!parent) continue
    if (mesh.children.length === 0) {
      parent.remove(mesh)
      continue
    }
    const stand = new THREE.Object3D()
    stand.name = mesh.name
    stand.position.copy(mesh.position)
    stand.quaternion.copy(mesh.quaternion)
    stand.scale.copy(mesh.scale)
    stand.matrixAutoUpdate = mesh.matrixAutoUpdate
    stand.matrix.copy(mesh.matrix)
    stand.matrixWorld.copy(mesh.matrixWorld)
    stand.layers.mask = mesh.layers.mask
    stand.userData = mesh.userData
    for (const child of [...mesh.children]) stand.add(child)
    parent.children[parent.children.indexOf(mesh)] = stand
    stand.parent = parent
    mesh.parent = null
  }
  for (const mesh of merged) part.add(mesh)
  return true
}
