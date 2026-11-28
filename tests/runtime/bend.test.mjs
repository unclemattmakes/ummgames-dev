/**
 * runtime/render/bend.ts, run in node: the patch is text and plain objects, so it needs no WebGL
 * (tests/runtime/bend.slow.test.mjs compiles and draws it in a browser). The file is TypeScript,
 * which Vitest transforms; the path is built at run time so this repo's own typecheck leaves it
 * to runtime/tsconfig.json.
 */
import * as THREE from 'three'
import { afterEach, describe, expect, it } from 'vitest'

/** @param {string} rel @returns {Promise<any>} */
const load = (rel) =>
  import(/* @vite-ignore */ new URL(`../../runtime/${rel}`, import.meta.url).href)

const { BEND_OFF, bendGlsl, groundHit, installBend, keepStraight, removeBend } =
  await load('render/bend.ts')

/** @typedef {{ x: number, y: number, z: number }} Point */

/**
 * A dome: the ground falls by the square of the distance past a flat disc round the origin.
 * @param {number} k metres of fall per metre squared @param {number} flat the disc's radius
 */
function dome(k = 0.0052, flat = 12) {
  const value = new Float32Array([k, flat, 0, 0])
  return {
    value,
    glsl: `uniform vec4 bendDome;
vec3 bendWorld(vec3 p) {
  float d = max(0.0, length(p.xz) - bendDome.y);
  p.y -= bendDome.x * d * d;
  return p;
}`,
    uniforms: { bendDome: { value } },
    /** @template {Point} T @param {number} x @param {number} y @param {number} z @param {T} out @returns {T} */
    point(x, y, z, out) {
      const d = Math.max(0, Math.hypot(x, z) - /** @type {number} */ (value[1]))
      out.x = x
      out.y = y - /** @type {number} */ (value[0]) * d * d
      out.z = z
      return out
    },
  }
}

/** A half pipe: the floor rises by the square of the distance east or west of x = 0. */
function pipe(k = 0.02) {
  const value = new Float32Array([k, 0])
  return {
    glsl: 'uniform vec2 bendPipe;\nvec3 bendWorld(vec3 p) { p.y += bendPipe.x * p.x * p.x; return p; }',
    uniforms: { bendPipe: { value } },
    /** @template {Point} T @param {number} x @param {number} y @param {number} z @param {T} out @returns {T} */
    point(x, y, z, out) {
      out.x = x
      out.y = y + /** @type {number} */ (value[0]) * x * x
      out.z = z
      return out
    },
  }
}

/** Everything `installBend` may touch, to compare before and after. */
function snapshot() {
  /** @type {Record<string, unknown>} */
  const lib = {}
  for (const [key, entry] of Object.entries(THREE.ShaderLib))
    lib[key] = [Object.keys(entry.uniforms), entry.vertexShader, entry.fragmentShader]
  const c = /** @type {Record<string, string>} */ (/** @type {unknown} */ (THREE.ShaderChunk))
  return JSON.stringify([c.common, c.project_vertex, c.worldpos_vertex, lib])
}

const chunk = (/** @type {string} */ name) =>
  /** @type {Record<string, string>} */ (/** @type {unknown} */ (THREE.ShaderChunk))[name] ?? ''
const lib = (/** @type {string} */ name) =>
  /** @type {{ uniforms: Record<string, { value: unknown }>, vertexShader: string, fragmentShader: string }} */ (
    THREE.ShaderLib[name]
  )

const CLEAN = snapshot()
afterEach(() => removeBend())

describe('render/bend: the patch', () => {
  it("puts the rule into three's vertex chunk without asking for the model matrix", () => {
    const rule = dome()
    installBend(rule)
    expect(chunk('project_vertex')).toContain('mvPosition = bendView( mvPosition );')
    // The finding this module carries: a chunk that reads modelMatrix has three upload it per draw.
    expect(chunk('project_vertex')).not.toMatch(/\bmodelMatrix\b/)
    expect(chunk('common')).toContain(rule.glsl)
    expect(chunk('common')).toContain('vec4 bendView( vec4 mv )')
    expect(chunk('common').split('#ifndef BEND_OFF')[1]).not.toMatch(/\bmodelMatrix\b/)
    // three's own text is still there, ahead of ours.
    expect(chunk('common').startsWith(JSON.parse(CLEAN)[0])).toBe(true)
    expect(chunk('project_vertex')).toContain('gl_Position = projectionMatrix * mvPosition;')
  })

  it('bends only where common was included, so a shader without it still compiles', () => {
    installBend(dome())
    // three's equirect-to-cube pass includes project_vertex and not common: it must see no call.
    const [guard, call] = chunk('project_vertex').split('mvPosition = bendView')
    expect(call).toBeDefined()
    expect(guard).toMatch(/#ifdef USE_BEND\s*$/)
    expect(chunk('common')).toMatch(/#ifndef BEND_OFF\n#define USE_BEND/)
  })

  it('takes it all back out', () => {
    const v = new THREE.Vector4(1, 2, 3, 4)
    installBend({ ...dome(), uniforms: { bendDome: { value: v } } }, { shadows: 'bent' })
    expect(snapshot()).not.toBe(CLEAN)
    expect(v.clone()).toBe(v)
    removeBend()
    expect(snapshot()).toBe(CLEAN)
    expect(v.clone()).not.toBe(v)
    expect(Object.hasOwn(v, 'clone')).toBe(false)
    removeBend() // nothing installed: nothing to do
  })

  it('is one rule a page: the same call again does nothing, another rule throws', () => {
    const rule = dome()
    installBend(rule)
    const once = snapshot()
    installBend(rule)
    installBend(rule, { shadows: 'flat' })
    expect(snapshot()).toBe(once)
    expect(() => installBend(dome())).toThrow(/already installed/)
    expect(() => installBend(rule, { shadows: 'bent' })).toThrow(/already installed/)
    expect(snapshot()).toBe(once)
  })

  it('refuses a rule that names the model matrix, or has no bendWorld', () => {
    const rule = dome()
    expect(() =>
      installBend({
        ...rule,
        glsl: `${rule.glsl}\nvec3 origin() { return modelMatrix[3].xyz; }`,
      }),
    ).toThrow(/modelMatrix/)
    expect(() => installBend({ ...rule, glsl: 'uniform vec4 bendDome;' })).toThrow(/bendWorld/)
    expect(snapshot()).toBe(CLEAN)
  })
})

describe('render/bend: the uniforms', () => {
  it('reach every built-in program by reference, whatever hook a material has', () => {
    const rule = dome()
    installBend(rule)
    for (const key of Object.keys(THREE.ShaderLib)) {
      // What three does when it builds a program. A clone that copied the array would freeze the
      // bend at whatever it was that day.
      const cloned = THREE.UniformsUtils.clone(lib(key).uniforms)
      expect(cloned.bendDome?.value, key).toBe(rule.value)
    }
    rule.value[0] = 0.5
    const later = THREE.UniformsUtils.clone(lib('standard').uniforms).bendDome?.value
    expect(/** @type {Float32Array} */ (later)[0]).toBe(0.5)
  })

  it("share three's vectors and textures, which the clone would otherwise copy", () => {
    const span = new THREE.Vector4(0, 1, 2, 3)
    const map = new THREE.DataTexture(new Float32Array(16), 2, 2, THREE.RGBAFormat, THREE.FloatType)
    const plain = { x: 1, y: 2 }
    installBend({
      ...dome(),
      uniforms: { bendSpan: { value: span }, bendMap: { value: map }, bendAim: { value: plain } },
    })
    const cloned = THREE.UniformsUtils.clone(lib('lambert').uniforms)
    expect(cloned.bendSpan?.value).toBe(span)
    expect(cloned.bendMap?.value).toBe(map)
    expect(cloned.bendAim?.value).toBe(plain)
    // A ShaderMaterial cloned by the game keeps sharing them too.
    const hand = new THREE.ShaderMaterial({ uniforms: { bendSpan: { value: span } } })
    expect(hand.clone().uniforms.bendSpan?.value).toBe(span)
  })

  it('refuse a value three would copy or never send again', () => {
    const rule = dome()
    const bad = (/** @type {unknown} */ value) => () =>
      installBend({ ...rule, uniforms: { bendDome: { value } } })
    expect(bad(0.5)).toThrow(/a number, which three copies/)
    expect(bad([1, 2, 3, 4])).toThrow(/a plain array/)
    expect(bad(null)).toThrow(/null/)
    expect(bad(new Float32Array(1))).toThrow(/one number/)
    expect(bad(new THREE.WebGLRenderTarget(2, 2).texture)).toThrow(/render target/)
    // A refusal half way leaves three as it was, and the first value's clone its own.
    const first = new THREE.Vector3()
    expect(() =>
      installBend({ ...rule, uniforms: { a: { value: first }, b: { value: 1 } } }),
    ).toThrow()
    expect(first.clone()).not.toBe(first)
    expect(snapshot()).toBe(CLEAN)
  })

  it('refuse a name three already uses', () => {
    expect(() =>
      installBend({ ...dome(), uniforms: { opacity: { value: new Float32Array(4) } } }),
    ).toThrow(/already has a uniform called opacity/)
    expect(snapshot()).toBe(CLEAN)
  })
})

describe('render/bend: what never bends', () => {
  const OFF = '#ifndef BEND_OFF\n#define BEND_OFF\n#endif\n'

  it('draws the shadow map straight by default, and reads it straight', () => {
    installBend(dome())
    for (const key of ['depth', 'distance']) {
      expect(lib(key).vertexShader.startsWith(OFF), key).toBe(true)
      expect(lib(key).fragmentShader.startsWith(OFF), key).toBe(true)
    }
    expect(chunk('worldpos_vertex')).toBe(JSON.parse(CLEAN)[2])
    // What takes a shadow is drawn by the camera: it bends.
    expect(lib('shadow').vertexShader.startsWith(OFF)).toBe(false)
    expect(lib('standard').vertexShader.startsWith(OFF)).toBe(false)
  })

  it('with bent shadows, draws the shadow map bent and reads it at the bent place', () => {
    installBend(dome(), { shadows: 'bent' })
    for (const key of ['depth', 'distance'])
      expect(lib(key).vertexShader.startsWith(OFF)).toBe(false)
    const world = chunk('worldpos_vertex')
    expect(world).toContain('#ifdef USE_BEND')
    expect(world).toContain('( mvPosition.xyz - viewMatrix[ 3 ].xyz ) * mat3( viewMatrix )')
    // The model matrix is read only by a material that is kept straight.
    expect(world.split('#else')[0]).not.toMatch(/\bmodelMatrix\b/)
    expect(world.split('#else')[1]).toContain('worldPosition = modelMatrix * worldPosition;')
  })

  it("keeps three's own backgrounds straight either way", () => {
    for (const shadows of ['flat', 'bent']) {
      installBend(dome(), { shadows })
      for (const key of ['backgroundCube', 'cube', 'equirect'])
        expect(lib(key).vertexShader.startsWith(OFF), `${shadows} ${key}`).toBe(true)
      removeBend()
    }
  })

  it('marks every material under a part once, keeps its other defines, and passes over a branch', () => {
    const root = new THREE.Group()
    const hull = new THREE.MeshStandardMaterial()
    const glow = new THREE.MeshBasicMaterial()
    const flame = new THREE.ShaderMaterial()
    const ghost = new THREE.MeshBasicMaterial()
    const box = new THREE.BoxGeometry()
    const holo = new THREE.Group()
    holo.userData.bends = true
    holo.add(new THREE.Mesh(box, ghost))
    const turret = new THREE.Group()
    turret.add(new THREE.Mesh(box, [hull, glow]), new THREE.Mesh(box, flame))
    root.add(new THREE.Mesh(box, hull), turret, holo)
    const skip = (/** @type {THREE.Object3D} */ o) => o.userData.bends === true
    expect(keepStraight(root, skip)).toBe(true)
    expect(BEND_OFF).toBe('BEND_OFF')
    expect(hull.defines?.BEND_OFF).toBe('')
    expect(hull.defines?.STANDARD).toBe('')
    expect(glow.defines?.BEND_OFF).toBe('')
    expect(flame.defines?.BEND_OFF).toBe('')
    expect(ghost.defines?.BEND_OFF).toBeUndefined()
    // Nothing new: nothing is recompiled.
    const version = hull.version
    expect(keepStraight(root, skip)).toBe(false)
    expect(hull.version).toBe(version)
    // Without the skip, the branch is marked too.
    expect(keepStraight(root)).toBe(true)
    expect(ghost.defines?.BEND_OFF).toBe('')
  })
})

describe('render/bend: the same rule in JavaScript', () => {
  it('moves a point to the eye as the chunk does, for any camera', () => {
    // bendView in JavaScript, line for line. The chunk has the point as the eye sees it and must
    // land where the view matrix would put the bent point.
    const rule = dome(0.01, 5)
    const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 500)
    camera.position.set(31, 6.5, -14)
    camera.lookAt(4, 1, 9)
    camera.rotateZ(0.3)
    camera.updateMatrixWorld()
    const view = camera.matrixWorldInverse
    const turn = new THREE.Matrix3().setFromMatrix4(view)
    const shift = new THREE.Vector3().setFromMatrixColumn(view, 3)
    for (const [x, y, z] of [
      [0, 0, 0],
      [3, 2, -4],
      [40, 0, 12],
      [-22, 5, -31],
    ]) {
      const p = new THREE.Vector3(x, y, z)
      const mv = p.clone().applyMatrix4(view)
      // vec3 at = ( mv.xyz - viewMatrix[ 3 ].xyz ) * mat3( viewMatrix );
      const at = mv.clone().sub(shift).applyMatrix3(turn.clone().transpose())
      expect(at.distanceTo(p)).toBeLessThan(1e-9)
      // mv.xyz += mat3( viewMatrix ) * ( bendWorld( at ) - at );
      const bent = rule.point(at.x, at.y, at.z, new THREE.Vector3())
      const eye = mv.clone().add(bent.clone().sub(at).applyMatrix3(turn))
      const want = rule.point(x, y, z, new THREE.Vector3()).applyMatrix4(view)
      expect(eye.distanceTo(want)).toBeLessThan(1e-9)
    }
  })

  it('finds the bent ground under a ray, where the flat plane would be metres off', () => {
    const rule = dome()
    const eye = new THREE.Vector3(2, 5.5, -6.5)
    for (const [x, z] of [
      [0, 3],
      [-6, 20],
      [9, 24],
      [-14, 19],
    ]) {
      const on = rule.point(x, 0, z, new THREE.Vector3())
      const ray = new THREE.Ray(eye.clone(), on.clone().sub(eye).normalize())
      const hit = groundHit(rule, ray)
      expect(hit?.x).toBeCloseTo(x, 2)
      expect(hit?.z).toBeCloseTo(z, 2)
    }
    // The flat plane, for the last ray: well short of where the ground has fallen to.
    const on = rule.point(9, 0, 24, new THREE.Vector3())
    const dir = on.clone().sub(eye).normalize()
    const flatZ = eye.z + dir.z * (-eye.y / dir.y)
    expect(Math.abs(flatZ - 24)).toBeGreaterThan(1)
  })

  it('gives the ridge to a ray that clears the horizon looking down, and nothing to one looking up', () => {
    const rule = dome()
    const eye = new THREE.Vector3(0, 5.5, -6.5)
    const ridge = groundHit(rule, new THREE.Ray(eye, new THREE.Vector3(0, -0.03, 1).normalize()))
    // The ridge is out past the flat disc and well short of where the flat ground would be met.
    expect(ridge?.z).toBeGreaterThan(12)
    expect(ridge?.z).toBeLessThan(80)
    expect(
      groundHit(rule, new THREE.Ray(eye, new THREE.Vector3(0, 0.05, 1).normalize())),
    ).toBeNull()
    // Under the ground to begin with.
    expect(
      groundHit(rule, new THREE.Ray(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, -1, 0))),
    ).toBeNull()
  })

  it('meets a floor that rises, even looking up, and takes its ground height, reach and out', () => {
    const rule = pipe(0.02)
    const eye = { x: 0, y: 2, z: 0 }
    // Level and a little up, heading east: the half pipe comes up to meet it.
    const len = Math.hypot(1, 0.1)
    const hit = groundHit(rule, { origin: eye, direction: { x: 1 / len, y: 0.1 / len, z: 0 } })
    expect(hit).not.toBeNull()
    const x = /** @type {{ x: number, z: number }} */ (hit).x
    // On the surface: the ray's height there is the floor's.
    expect(2 + 0.1 * x).toBeCloseTo(0.02 * x * x, 2)
    expect(
      groundHit(rule, { origin: eye, direction: { x: 1 / len, y: 0.1 / len, z: 0 } }, { reach: 5 }),
    ).toBeNull()
    // A sim whose ground stands at 1: straight down from 2 metres meets it at once, in `out`.
    const out = { x: 9, z: 9 }
    const down = { origin: { x: 3, y: 2, z: 4 }, direction: { x: 0, y: -1, z: 0 } }
    expect(groundHit(rule, down, { ground: 1, out })).toBe(out)
    expect(out).toEqual({ x: 3, z: 4 })
    expect(groundHit(rule, down, { ground: 1.9 })).toBeNull() // 1.9 + 0.18 lift: over the eye
  })

  it('guards the rule against being included twice in a hand-written shader', () => {
    const rule = dome()
    const text = bendGlsl(rule)
    expect(text).toMatch(/^#ifndef BEND_RULE\n#define BEND_RULE\n/)
    expect(text).toContain(rule.glsl)
    installBend(rule)
    expect(chunk('common')).toContain(text)
  })
})
