// @ts-check
/**
 * runtime/render/bend.ts in a real browser: the patched chunks compile for every built-in
 * material, a box is drawn where the rule's JavaScript twin says, a write to the uniform reaches
 * a program already built, and the programs read what the docs say they read. The TypeScript is
 * stripped with the compiler this repo already has; three is served from node_modules.
 */
import fs from 'node:fs'
import ts from 'typescript'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launchChromium } from '../../src/media/util.mjs'

const BEND = ts.transpileModule(
  fs.readFileSync(new URL('../../runtime/render/bend.ts', import.meta.url), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
).outputText
const THREE_BUILD = new URL('../../node_modules/three/build/', import.meta.url)
const ORIGIN = 'http://bend.test'
const PAGE = `<!doctype html><script type="importmap">{"imports":{"three":"/three.module.js"}}</script>
<body><script type="module">
import * as THREE from 'three'
import * as bend from '/bend.js'
window.__t = { THREE, bend }
</script></body>`

/** @type {import('playwright').Browser} */
let browser
/** @type {import('playwright').Page} */
let page
/** @type {string[]} */
const pageErrors = []

beforeAll(async () => {
  const pw = await import('playwright')
  browser = await launchChromium(pw, { headless: true }, () => {})
  page = await browser.newPage()
  page.on('pageerror', (e) => pageErrors.push(String(e)))
  await page.route(`${ORIGIN}/**`, (route) => {
    const name = new URL(route.request().url()).pathname.slice(1)
    if (name === '') return route.fulfill({ contentType: 'text/html', body: PAGE })
    if (name === 'bend.js') return route.fulfill({ contentType: 'text/javascript', body: BEND })
    if (/^three\.[a-z.]+\.js$/.test(name))
      return route.fulfill({
        contentType: 'text/javascript',
        body: fs.readFileSync(new URL(name, THREE_BUILD), 'utf8'),
      })
    return route.fulfill({ status: 404, body: '' })
  })
  await page.goto(`${ORIGIN}/`)
  await page.waitForFunction(() => /** @type {any} */ (window).__t)
})

afterAll(async () => {
  await browser?.close()
})

/**
 * One scene under one shadow mode, drawn in the page. Returns what the test reads.
 * @param {'flat' | 'bent'} shadows
 */
function draw(shadows) {
  return page.evaluate((shadows) => {
    const { THREE, bend } = /** @type {any} */ (window).__t
    const SIZE = 256
    // The dome of the unit tests, steep enough to move a box tens of pixels.
    const value = new Float32Array([0.1, 2, 0, 0])
    const rule = {
      glsl: `uniform vec4 bendDome;
vec3 bendWorld(vec3 p) {
  float d = max(0.0, length(p.xz) - bendDome.y);
  p.y -= bendDome.x * d * d;
  return p;
}`,
      uniforms: { bendDome: { value } },
      point(
        /** @type {number} */ x,
        /** @type {number} */ y,
        /** @type {number} */ z,
        /** @type {any} */ out,
      ) {
        const d = Math.max(0, Math.hypot(x, z) - value[1])
        out.x = x
        out.y = y - value[0] * d * d
        out.z = z
        return out
      },
    }
    bend.removeBend() // a run that threw part way leaves its rule in
    bend.installBend(rule, { shadows })

    const canvas = document.createElement('canvas')
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false })
    renderer.setPixelRatio(1)
    renderer.setSize(SIZE, SIZE, false)
    renderer.shadowMap.enabled = true
    /** @type {string[]} */
    const errors = []
    renderer.debug.onShaderError = (
      /** @type {WebGL2RenderingContext} */ gl,
      /** @type {WebGLProgram} */ program,
      /** @type {WebGLShader} */ vs,
      /** @type {WebGLShader} */ fs,
    ) =>
      errors.push(
        [gl.getProgramInfoLog(program), gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs)].join(
          ' | ',
        ),
      )

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
    camera.position.set(4, 7, 11)
    camera.lookAt(1, 0, 0)
    camera.rotateZ(0.2)
    camera.updateMatrixWorld()
    const scene = new THREE.Scene()
    const box = new THREE.BoxGeometry(0.4, 0.4, 0.4)

    // Red: bent, through a material with a compile hook of its own.
    const red = new THREE.MeshBasicMaterial({ color: 0xff0000 })
    red.onBeforeCompile = () => {}
    const redAt = [6, 0, 1]
    const redMesh = new THREE.Mesh(box, red)
    redMesh.position.set(6, 0, 1)
    // Green: as far out, kept straight.
    const green = new THREE.MeshBasicMaterial({ color: 0x00ff00 })
    const greenAt = [0, 0, 5]
    const greenMesh = new THREE.Mesh(box, green)
    greenMesh.position.set(0, 0, 5)
    bend.keepStraight(greenMesh)
    // Blue: bent, placed by its instance matrix under a parent that is itself moved.
    const blue = new THREE.MeshBasicMaterial({ color: 0x0000ff })
    const blueAt = [2, 0, -6]
    const blueMesh = new THREE.InstancedMesh(box, blue, 1)
    blueMesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(1, 0, -4))
    const mover = new THREE.Group()
    mover.position.set(1, 0, -2)
    mover.add(blueMesh)
    scene.add(redMesh, greenMesh, mover)

    const gl = renderer.getContext()
    const px = new Uint8Array(SIZE * SIZE * 4)
    /** The middle of the pixels of one pure colour, from the bottom left. */
    const blob = (/** @type {number} */ channel) => {
      gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, px)
      let n = 0
      let sx = 0
      let sy = 0
      for (let i = 0; i < SIZE * SIZE; i++) {
        let pure = true
        for (let c = 0; c < 3; c++) if (px[i * 4 + c] > 128 !== (c === channel)) pure = false
        if (!pure) continue
        n++
        sx += (i % SIZE) + 0.5
        sy += Math.floor(i / SIZE) + 0.5
      }
      return n ? [sx / n, sy / n, n] : null
    }
    /** Where a scene point lands on the canvas, bent by the twin or not. */
    const want = (/** @type {number[]} */ at, /** @type {boolean} */ bent) => {
      const p = new THREE.Vector3(at[0], at[1], at[2])
      if (bent) rule.point(p.x, p.y, p.z, p)
      p.project(camera)
      return [(p.x * 0.5 + 0.5) * SIZE, (p.y * 0.5 + 0.5) * SIZE]
    }
    const uniformsOf = (/** @type {any} */ material) =>
      Object.keys(renderer.properties.get(material).currentProgram.getUniforms().map)

    renderer.render(scene, camera)
    const first = {
      red: [blob(0), want(redAt, true), want(redAt, false)],
      green: [blob(1), want(greenAt, false), want(greenAt, true)],
      blue: [blob(2), want(blueAt, true), want(blueAt, false)],
    }
    const reads = { red: uniformsOf(red), green: uniformsOf(green), blue: uniformsOf(blue) }

    // Twice the bend, written into the same array: no material is touched.
    value[0] = 0.2
    renderer.render(scene, camera)
    const second = { red: [blob(0), want(redAt, true)], green: [blob(1), want(greenAt, false)] }
    value[0] = 0.1

    // Every built-in material, lit and shadowed three ways, over both kinds of background.
    const lit = new THREE.Scene()
    const sun = new THREE.DirectionalLight(0xffffff, 2)
    sun.position.set(3, 8, 4)
    sun.castShadow = true
    const lamp = new THREE.PointLight(0xffffff, 20)
    lamp.position.set(-2, 4, 2)
    lamp.castShadow = true
    const spot = new THREE.SpotLight(0xffffff, 20)
    spot.position.set(0, 6, -3)
    spot.castShadow = true
    lit.add(sun, lamp, spot, new THREE.AmbientLight(0xffffff, 0.3))
    const hook = new THREE.MeshStandardMaterial()
    hook.onBeforeCompile = (/** @type {any} */ shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        'outgoingLight *= 0.5;\n#include <opaque_fragment>',
      )
    }
    const viaChunk = new THREE.ShaderMaterial({
      uniforms: { ...rule.uniforms },
      vertexShader: `#include <common>
void main() {
  vec3 transformed = position;
  #include <project_vertex>
}`,
      fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }',
    })
    const byHand = new THREE.ShaderMaterial({
      uniforms: { ...rule.uniforms },
      vertexShader: `${bend.bendGlsl(rule)}
#include <common>
void main() {
  vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * viewMatrix * vec4(bendWorld(p), 1.0);
}`,
      fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }',
    })
    const standard = new THREE.MeshStandardMaterial()
    const materials = [
      new THREE.MeshBasicMaterial(),
      new THREE.MeshLambertMaterial(),
      new THREE.MeshPhongMaterial(),
      standard,
      new THREE.MeshPhysicalMaterial({ clearcoat: 1 }),
      new THREE.MeshToonMaterial(),
      new THREE.MeshMatcapMaterial(),
      new THREE.MeshNormalMaterial(),
      new THREE.MeshDepthMaterial(),
      new THREE.ShadowMaterial(),
      hook,
      viaChunk,
      byHand,
    ]
    materials.forEach((m, i) => {
      const mesh = new THREE.Mesh(box, m)
      mesh.position.set((i % 5) * 1.5 - 3, 0.5, Math.floor(i / 5) * 1.5 - 1)
      mesh.castShadow = mesh.receiveShadow = true
      lit.add(mesh)
    })
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial())
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    const line = [
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(2, 1, 1),
      new THREE.Vector3(4, 2, 0),
    ]
    const dashed = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(line),
      new THREE.LineDashedMaterial(),
    )
    dashed.computeLineDistances()
    lit.add(
      floor,
      new THREE.Points(box, new THREE.PointsMaterial({ size: 0.2 })),
      new THREE.Line(new THREE.BufferGeometry().setFromPoints(line), new THREE.LineBasicMaterial()),
      dashed,
      new THREE.Sprite(new THREE.SpriteMaterial()),
      new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial(), 2),
    )
    const tile = document.createElement('canvas')
    tile.width = tile.height = 2
    const cube = new THREE.CubeTexture([tile, tile, tile, tile, tile, tile])
    cube.needsUpdate = true
    lit.background = cube
    renderer.render(lit, camera)
    const round = new THREE.DataTexture(new Uint8Array(8 * 4 * 4).fill(128), 8, 4)
    round.mapping = THREE.EquirectangularReflectionMapping
    round.needsUpdate = true
    lit.background = round
    renderer.render(lit, camera)

    /** The uniforms each compiled program reads, by the material type that built it. */
    /** @type {Record<string, string[][]>} */
    const programs = {}
    for (const p of renderer.info.programs) {
      const name = /** @type {any} */ (p).type
      const list = programs[name] ?? []
      programs[name] = list
      list.push(Object.keys(/** @type {any} */ (p).getUniforms().map))
    }
    const out = {
      errors,
      glError: gl.getError(),
      first,
      second,
      reads,
      programs,
      standard: uniformsOf(standard),
    }
    bend.removeBend()
    renderer.dispose()
    renderer.forceContextLoss()
    return out
  }, shadows)
}

/** @param {(number[] | null)[]} pair the blob found, and where it should be */
const off = ([got, want]) =>
  got && want
    ? Math.hypot(
        /** @type {number} */ (got[0]) - /** @type {number} */ (want[0]),
        /** @type {number} */ (got[1]) - /** @type {number} */ (want[1]),
      )
    : Number.POSITIVE_INFINITY
/** @param {number[]} a @param {number[]} b */
const apart = (a, b) =>
  Math.hypot(
    /** @type {number} */ (a[0]) - /** @type {number} */ (b[0]),
    /** @type {number} */ (a[1]) - /** @type {number} */ (b[1]),
  )

describe('render/bend in Chromium', () => {
  it('compiles into every built-in material and draws where the twin says', async () => {
    const r = await draw('flat')
    expect(pageErrors).toEqual([])
    expect(r.errors).toEqual([])
    expect(r.glError).toBe(0)

    // The test can see a bend: bent and straight are tens of pixels apart for the red box.
    const [, redBent, redFlat] = r.first.red
    expect(
      apart(/** @type {number[]} */ (redBent), /** @type {number[]} */ (redFlat)),
    ).toBeGreaterThan(20)
    expect(off(r.first.red)).toBeLessThan(1.5)
    expect(off(r.first.blue)).toBeLessThan(1.5)
    // Kept straight: where the flat world has it, and nowhere near where the bend would put it.
    expect(off(r.first.green)).toBeLessThan(1.5)
    const [, greenFlat, greenBent] = r.first.green
    expect(
      apart(/** @type {number[]} */ (greenFlat), /** @type {number[]} */ (greenBent)),
    ).toBeGreaterThan(10)

    // A write into the array reaches the program already built; the straight box does not move.
    expect(off(r.second.red)).toBeLessThan(1.5)
    expect(
      apart(/** @type {number[]} */ (r.second.red[1]), /** @type {number[]} */ (redBent)),
    ).toBeGreaterThan(20)
    expect(off(r.second.green)).toBeLessThan(1.5)

    // What a program reads is what three uploads. The rule's uniform, and no model matrix.
    expect(r.reads.red).toContain('bendDome')
    expect(r.reads.red).toContain('viewMatrix')
    expect(r.reads.red).not.toContain('modelMatrix')
    expect(r.reads.blue).toContain('bendDome')
    expect(r.reads.blue).not.toContain('modelMatrix')
    // A straight material reads neither the rule nor the view matrix.
    expect(r.reads.green).not.toContain('bendDome')
    expect(r.reads.green).not.toContain('viewMatrix')

    // Flat shadows: the shadow map's programs are straight, and nothing else is.
    const depth = [
      ...(r.programs.MeshDepthMaterial ?? []),
      ...(r.programs.MeshDistanceMaterial ?? []),
    ]
    expect(depth.length).toBeGreaterThan(1)
    for (const reads of depth) expect(reads).not.toContain('bendDome')
    for (const type of [
      'MeshLambertMaterial',
      'MeshToonMaterial',
      'PointsMaterial',
      'LineDashedMaterial',
      'ShadowMaterial',
    ])
      for (const reads of r.programs[type] ?? [[]]) expect(reads, type).toContain('bendDome')
    expect(r.standard).toContain('bendDome')
  }, 60_000)

  it('with bent shadows, bends the shadow map and reads no model matrix for the lookup', async () => {
    const r = await draw('bent')
    expect(pageErrors).toEqual([])
    expect(r.errors).toEqual([])
    expect(r.glError).toBe(0)
    expect(off(r.first.red)).toBeLessThan(1.5)
    expect(off(r.first.green)).toBeLessThan(1.5)
    const depth = [
      ...(r.programs.MeshDepthMaterial ?? []),
      ...(r.programs.MeshDistanceMaterial ?? []),
    ]
    expect(depth.length).toBeGreaterThan(1)
    for (const reads of depth) expect(reads).toContain('bendDome')
    // A lit, shadowed standard material: three's own worldpos chunk would read the model matrix.
    expect(r.standard).toContain('bendDome')
    expect(r.standard).toContain('directionalShadowMatrix')
    expect(r.standard).not.toContain('modelMatrix')
  }, 60_000)
})
