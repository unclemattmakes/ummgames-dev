/**
 * Bend: a world drawn curved over a sim that stays flat. A horizon that falls away, a floor that
 * curls up like a half pipe, a road that turns in plan: each is one rule on a point's place in
 * the scene, applied on the way to the screen. The sim, the physics and the level data never
 * know.
 *
 * The game writes the rule three ways and this file does the rest:
 * - `glsl`: `vec3 bendWorld(vec3 p)`, a point in the scene to where it is drawn, with the
 *   uniforms it reads;
 * - `uniforms`: those uniforms' holders, which the game writes into each frame;
 * - `point(x, y, z, out)`: the same rule in JavaScript, for whatever is placed by hand: a HUD tag
 *   over a unit, a press on the ground, a culling test.
 *
 * `installBend(rule)` puts the rule into three's own `project_vertex` chunk, which every built-in
 * material runs, so every mesh, instanced mesh, skinned mesh, line and point cloud bends alike
 * and a material added next month bends without being told.
 *
 * Three choices in here cost a game time to find. They are why this is shared.
 *
 * **The rule never sees the model matrix.** The chunk has the point as the eye sees it, which
 * three has already worked out, and carries it back to the scene by undoing the view matrix (a
 * turn and a shift, so its inverse is one subtraction and one multiply). Asking for
 * `modelMatrix` instead looks the same and costs a frame: three uploads that matrix for every
 * draw whose program reads it, and it uploads the view matrix once a program anyway. In one
 * game that was 75 uploads and 0.3 ms a frame on a phone at a 4x CPU throttle. `installBend`
 * refuses a rule that names `modelMatrix`.
 *
 * **Uniforms reach every program through `ShaderLib`, not through a hook.** three builds a
 * built-in material's uniforms by cloning its `ShaderLib` entry, so a holder added to every entry
 * arrives in every program, whatever `onBeforeCompile` the material has. The other way, a
 * default `Material.prototype.onBeforeCompile`, is lost by any material that sets its own hook:
 * that material then reads zeros and draws flat, with no error. The clone copies numbers and
 * three's vectors, which would freeze them at the value they had that day, so `installBend`
 * checks each value: a typed array passes as it is (three hands it on by reference), an object
 * with a `clone()` (a `Vector4`, a texture) has that `clone` replaced by one that returns the
 * object itself, and a plain number is refused. Write into a value; never replace it.
 *
 * **What must not bend is switched off by a define, so it pays nothing.** A material with
 * `BEND_OFF` in its `defines` compiles without the rule: its program reads none of the rule's
 * uniforms. `keepStraight(root)` marks a whole part. The sky's own materials (a cube or
 * equirect background) are always straight. The shadow map is drawn straight by default
 * (`shadows: 'flat'`): shadows are worked out on the flat world and bent with what they fall on,
 * so a caster's shadow stays under it. `shadows: 'bent'` draws the shadow map bent and reads it
 * at the bent place instead, for a rule that turns the world in plan, where the sun should keep
 * its heading as the ground turns under it.
 *
 * Not bent: `THREE.Sprite` (its shader places its own corners; lift it with `rule.point`),
 * normals (lighting stays the flat world's), and culling (three culls by where a thing stands
 * before the bend; see the docs for what to do about it).
 *
 * Imports `three`, nothing else. The game must depend on `three`.
 */
import * as THREE from 'three'

/** A place: a `THREE.Vector3`, or any object with the three numbers. */
export interface BendPoint {
  x: number
  y: number
  z: number
}

/** A ray with a unit direction: a `THREE.Ray`, or any object with the two. */
export interface BendRay {
  origin: BendPoint
  direction: BendPoint
}

/** One rule, written three ways. Keep the three in step: nothing checks the GLSL against `point`. */
export interface BendRule {
  /**
   * GLSL at global scope: the rule's uniform declarations, and
   * `vec3 bendWorld(vec3 p)`, which takes a point in the scene and returns where it is drawn.
   * It may not name `modelMatrix`. It is compiled into fragment shaders too (nothing calls it
   * there), so it may not read an attribute. With every uniform at zero it should return `p`:
   * that is what a material draws if its program was never handed the uniforms.
   */
  glsl: string
  /**
   * The rule's uniforms by name. Each value is a typed array (for a `vec2`, `vec3`, `vec4` or
   * matrix), one of three's vectors, colours or matrices, or a texture. Never a number: pack
   * floats into a `vec4`. Spread these into a hand-written `ShaderMaterial`'s own uniforms.
   */
  uniforms: Record<string, { value: unknown }>
  /** The same rule in JavaScript: writes where the scene's (x, y, z) is drawn into `out`. */
  point<T extends BendPoint>(x: number, y: number, z: number, out: T): T
}

export interface BendOptions {
  /**
   * `'flat'` (the default): the shadow map is drawn straight and read straight. `'bent'`: it is
   * drawn bent, and every material reads shadows and reflections at the bent place.
   */
  shadows?: 'flat' | 'bent'
}

export interface GroundHitOptions {
  /** How far along the ray to look, in the ray's units. Default 140. */
  reach?: number
  /** The stride of the first search. Shorter finds thinner ridges. Default 2.5. */
  step?: number
  /** The flat ground's height in the sim. Default 0. */
  ground?: number
  /** Written and returned in place of a new object. */
  out?: { x: number; z: number }
}

/** The define that keeps a material straight: `material.defines = { [BEND_OFF]: '' }`. */
export const BEND_OFF = 'BEND_OFF'

/**
 * The rule's GLSL behind an include guard, for a hand-written vertex shader that knows its
 * points in the scene and calls `bendWorld(p)` itself. Safe beside `#include <common>`, which
 * carries the same text once the rule is installed.
 */
export function bendGlsl(rule: BendRule): string {
  return `#ifndef BEND_RULE\n#define BEND_RULE\n${rule.glsl}\n#endif\n`
}

/** What `common` gains: the rule, and the same rule on a point as the eye sees it. */
function pars(rule: BendRule): string {
  return /* glsl */ `
#ifndef BEND_OFF
#define USE_BEND
${bendGlsl(rule)}
vec4 bendView( vec4 mv ) {
	// Back to the scene. The view matrix is a turn and a shift: undo the shift, then the turn
	// (a vector times a matrix is the matrix's transpose times the vector).
	vec3 at = ( mv.xyz - viewMatrix[ 3 ].xyz ) * mat3( viewMatrix );
	// Only the move is carried to the eye, so a point the rule leaves alone is not touched at all.
	mv.xyz += mat3( viewMatrix ) * ( bendWorld( at ) - at );
	return mv;
}
#endif
`
}

/** In `project_vertex`. `USE_BEND` is only set by `common`, so a shader without it draws straight. */
const PROJECT = /* glsl */ `mvPosition = modelViewMatrix * mvPosition;

#ifdef USE_BEND

	mvPosition = bendView( mvPosition );

#endif`

/** In `worldpos_vertex`, for bent shadows: the place it was drawn, back in the scene. */
const WORLDPOS = /* glsl */ `#ifdef USE_BEND

		worldPosition = vec4( ( mvPosition.xyz - viewMatrix[ 3 ].xyz ) * mat3( viewMatrix ), 1.0 );

	#else

		worldPosition = modelMatrix * worldPosition;

	#endif`

/** Ahead of a `ShaderLib` shader that never bends. */
const STRAIGHT = `#ifndef ${BEND_OFF}\n#define ${BEND_OFF}\n#endif\n`

/** The backgrounds three draws itself. */
const SKY = ['backgroundCube', 'cube', 'equirect']
/** What the shadow map is drawn with (`distanceRGBA` is the older name). */
const SHADOW_MAP = ['depth', 'distance', 'distanceRGBA']

type Undo = () => void
type Chunks = Record<string, string | undefined>
interface LibEntry {
  uniforms: Record<string, { value: unknown }>
  vertexShader: string
  fragmentShader: string
}

let installed: { rule: BendRule; shadows: 'flat' | 'bent'; undo: Undo[] } | null = null

/**
 * Makes a uniform's value one that three's clone hands on as it is, or throws: a value the clone
 * would copy is frozen in every program at what it held when that program was built.
 */
function share(name: string, holder: { value: unknown }, undo: Undo[]): void {
  const v = holder.value
  if (ArrayBuffer.isView(v)) {
    if ((v as unknown as ArrayLike<number>).length === 1)
      throw new Error(
        `bend: uniform ${name} is a typed array of one number. three uploads a float once and then compares the array with itself, so later writes would never be sent: pack it into a vec2 or a vec4`,
      )
    return
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v))
    throw new Error(
      `bend: uniform ${name} holds ${Array.isArray(v) ? 'a plain array' : v === null ? 'null' : `a ${typeof v}`}, which three copies into each program, so later writes would reach none of them. Use a Float32Array (a vec2, vec3 or vec4), one of three's vectors, or a texture`,
    )
  const o = v as { clone?: unknown; isRenderTargetTexture?: boolean }
  if (o.isRenderTargetTexture)
    throw new Error(
      `bend: uniform ${name} is a render target's texture, which three will not share`,
    )
  if (typeof o.clone !== 'function') return
  const own = Object.hasOwn(o, 'clone')
  const before = o.clone
  o.clone = () => o
  undo.push(() => {
    if (own) o.clone = before
    else delete o.clone
  })
}

/** Swaps one stretch of a chunk, or throws when three no longer has it. */
function swap(chunks: Chunks, name: string, from: string, to: string, undo: Undo[]): void {
  const before = chunks[name]
  if (before === undefined || !before.includes(from))
    throw new Error(
      `bend: three's ${name} chunk has changed (three r${THREE.REVISION}): "${from}" is not in it, so nothing was patched`,
    )
  chunks[name] = before.replace(from, () => to)
  undo.push(() => {
    chunks[name] = before
  })
}

/**
 * Puts the rule into three's shared chunks and hands its uniforms to every built-in material.
 * Call once, before the first frame: a program compiled earlier keeps the shader it has. A page
 * bends by one rule, since the chunks are shared by every renderer on it: a second call with the
 * same rule and options does nothing, and any other throws.
 */
export function installBend(rule: BendRule, options: BendOptions = {}): void {
  const shadows = options.shadows ?? 'flat'
  if (installed) {
    if (installed.rule === rule && installed.shadows === shadows) return
    throw new Error(
      "bend: a rule is already installed, and three's shader chunks are shared by the whole page. removeBend() first",
    )
  }
  if (!/\bvec3\s+bendWorld\s*\(/.test(rule.glsl))
    throw new Error('bend: the rule\'s glsl must define "vec3 bendWorld(vec3 p)"')
  if (/\bmodelMatrix\b/.test(rule.glsl))
    throw new Error(
      'bend: the rule names modelMatrix. three uploads that matrix for every draw whose program reads it; bendWorld is handed the point in the scene already, so the rule has no use for it',
    )
  const undo: Undo[] = []
  try {
    for (const [name, holder] of Object.entries(rule.uniforms)) share(name, holder, undo)

    const chunks = THREE.ShaderChunk as unknown as Chunks
    const common = chunks.common
    if (common === undefined) throw new Error("bend: three's common chunk is missing")
    chunks.common = `${common}\n${pars(rule)}`
    undo.push(() => {
      chunks.common = common
    })
    swap(chunks, 'project_vertex', 'mvPosition = modelViewMatrix * mvPosition;', PROJECT, undo)
    if (shadows === 'bent')
      swap(
        chunks,
        'worldpos_vertex',
        'worldPosition = modelMatrix * worldPosition;',
        WORLDPOS,
        undo,
      )

    const lib = THREE.ShaderLib as unknown as Record<string, LibEntry | undefined>
    const straight = shadows === 'flat' ? [...SKY, ...SHADOW_MAP] : SKY
    for (const [key, entry] of Object.entries(lib)) {
      if (!entry?.uniforms) continue
      for (const [name, holder] of Object.entries(rule.uniforms)) {
        if (name in entry.uniforms)
          throw new Error(`bend: three's ${key} material already has a uniform called ${name}`)
        entry.uniforms[name] = holder
        undo.push(() => {
          delete entry.uniforms[name]
        })
      }
      if (!straight.includes(key)) continue
      const { vertexShader, fragmentShader } = entry
      entry.vertexShader = STRAIGHT + vertexShader
      entry.fragmentShader = STRAIGHT + fragmentShader
      undo.push(() => {
        entry.vertexShader = vertexShader
        entry.fragmentShader = fragmentShader
      })
    }
  } catch (e) {
    for (const u of undo.reverse()) u()
    throw e
  }
  installed = { rule, shadows, undo }
}

/**
 * Takes the rule back out of three: the chunks, the `ShaderLib` entries and the values' `clone`
 * are as they were. For a test, or a dev reload. Programs already compiled keep their shader.
 */
export function removeBend(): void {
  if (!installed) return
  for (const u of installed.undo.reverse()) u()
  installed = null
}

/**
 * Marks every material under `root` as never bent, by the `BEND_OFF` define: a vehicle at the
 * middle of the rule's flat part, a cockpit, a sky dome. Their programs then compile without the
 * rule and read none of its uniforms, which is most of what a bend costs a phone's CPU (three
 * checks every uniform a program reads at each switch of program or material). `skip` names a
 * branch to pass over, such as a part that is also shown out in the world. Safe to call again
 * (after a part gains a child): a material already marked is left alone, so nothing recompiles.
 * True when it marked any. A hand-written shader that calls `bendWorld` itself is marked too,
 * and must test the define itself.
 */
export function keepStraight(
  root: THREE.Object3D,
  skip?: (branch: THREE.Object3D) => boolean,
): boolean {
  if (skip?.(root)) return false
  let any = false
  const mat = (root as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
  if (mat) {
    for (const m of Array.isArray(mat) ? mat : [mat]) {
      if (m.defines?.[BEND_OFF] !== undefined) continue
      m.defines = { ...m.defines, [BEND_OFF]: '' }
      m.needsUpdate = true
      any = true
    }
  }
  for (const c of root.children) if (keepStraight(c, skip)) any = true
  return any
}

const P: BendPoint = { x: 0, y: 0, z: 0 }

/**
 * Where a ray meets the bent ground, as the sim's x and z: a press on the screen to a place in
 * the flat world. For a rule that moves points up and down only (a dome, a half pipe, dunes):
 * the ground under a point is then `rule.point(x, ground, z)`. A rule that moves points in plan
 * needs its own way back.
 *
 * It finds the first point along the ray that is under the ground, by stepping out and then
 * halving. A ray that looks down but clears a falling horizon takes the ridge it passes
 * nearest, so a press on something just coming over the horizon still lands there. A ray that
 * starts under the ground, or looks level or up and meets nothing, gives null.
 */
export function groundHit(
  rule: BendRule,
  ray: BendRay,
  options: GroundHitOptions = {},
): { x: number; z: number } | null {
  const reach = options.reach ?? 140
  const step = options.step ?? 2.5
  const ground = options.ground ?? 0
  const o = ray.origin
  const d = ray.direction
  /** How far the ray's point at `t` stands over the bent ground under it. */
  const above = (t: number): number => {
    const x = o.x + d.x * t
    const z = o.z + d.z * t
    return o.y + d.y * t - rule.point(x, ground, z, P).y
  }
  if (above(0) <= 0) return null
  let lo = 0
  let hi = -1
  let near = 0
  let least = Number.POSITIVE_INFINITY
  for (let t = step; t <= reach; t += step) {
    const h = above(t)
    if (h <= 0) {
      hi = t
      break
    }
    if (h < least) {
      least = h
      near = t
    }
    lo = t
  }
  if (hi < 0) {
    if (d.y >= 0) return null
    hi = near
  } else {
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2
      if (above(mid) <= 0) hi = mid
      else lo = mid
    }
  }
  const out = options.out ?? { x: 0, z: 0 }
  out.x = o.x + d.x * hi
  out.z = o.z + d.z * hi
  return out
}
