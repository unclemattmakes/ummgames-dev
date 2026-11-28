# World bend: a curved world over a flat sim

A game's sim runs on a flat plane, and the picture bends on the way to the screen: a horizon
that falls away and hides spawns, a floor that curls up like a half pipe, a road that turns in
plan. `runtime/render/bend.ts` is the part every such game writes the same way. The game writes
its **rule** (where a point in the scene is drawn), and the module puts it into three.js once,
hands its uniforms to every program, keeps what must stay straight straight, and gives the rule
back in JavaScript for whatever is placed by hand.

| Piece | Kind | What it does |
|---|---|---|
| `runtime/render/bend.ts` | copied | Installs a game's bend rule into three's vertex chunk; uniforms, opt-out, shadows, pointer picking |

It imports `three`, which the game must depend on. Reach for it when a second thing in the game
needs to know about the bend: a shader of its own, a HUD tag, a press on the ground.

## Quick start

1. Copy the file:

   ```sh
   pnpm exec umm-dev copy render/bend.ts
   ```

2. Write the rule, once in GLSL and once in JavaScript, reading the same array:

   ```ts
   import { type BendRule, installBend } from './render/bend'

   /** Metres of fall per metre squared, and the radius of the flat disc round the origin. */
   const DOME = new Float32Array([0.005, 12, 0, 0])

   export const dome: BendRule = {
     glsl: /* glsl */ `
       uniform vec4 bendDome;
       vec3 bendWorld(vec3 p) {
         float d = max(0.0, length(p.xz) - bendDome.y);
         p.y -= bendDome.x * d * d;
         return p;
       }`,
     uniforms: { bendDome: { value: DOME } },
     point(x, y, z, out) {
       const d = Math.max(0, Math.hypot(x, z) - DOME[1]!)
       out.x = x
       out.y = y - DOME[0]! * d * d
       out.z = z
       return out
     },
   }

   installBend(dome) // once, before the first frame
   ```

3. Use the rule where the game places things by hand:

   ```ts
   import { groundHit, keepStraight } from './render/bend'

   keepStraight(cockpit)                                // never bent, and pays nothing
   dome.point(unit.x, 2, unit.z, tag).project(camera)   // a HUD tag over a unit (tag: Vector3)
   const press = groundHit(dome, raycaster.ray)         // { x, z } in the sim, or null
   DOME[0] = inMenu ? 0 : 0.005                         // write into the array: every program sees it
   ```

When it works, every mesh, instanced mesh, skinned mesh, line and point cloud in the scene
bends, with no change to any material.

## The rule: `BendRule`

| Field | What it is |
|---|---|
| `glsl` | GLSL at global scope: the rule's uniform declarations and `vec3 bendWorld(vec3 p)`, which takes a point in the scene and returns where it is drawn. |
| `uniforms` | The rule's uniforms by name, as `{ value }` holders the game keeps and writes into. |
| `point(x, y, z, out)` | The same rule in JavaScript. Writes into `out` (a `Vector3` or any `{ x, y, z }`) and returns it. |

**Rules for a rule:**

- **Never name `modelMatrix`.** `bendWorld` is handed the point in the scene already.
  `installBend` throws if the GLSL names it ("How it works" says what it costs).
- **Every value is shared, never a number.** A typed array (for a `vec2`, `vec3`, `vec4` or a
  matrix), one of three's vectors, colours or matrices, or a texture. Pack floats into a `vec4`.
  `installBend` throws on a number, a plain array, `null`, a typed array of one number, or a
  render target's texture.
- **Write into a value; never replace it.** `DOME[0] = 0`, `span.value.set(...)`, new pixels in
  the same texture. A new object put in `holder.value` reaches no program built before.
- **A value's `clone()` returns the value itself** once the rule is installed. That is how it
  gets through three's uniform cloning. Do not `clone()` a rule's vector to get a scratch copy.
- **All zeros should mean flat.** A program that was never handed the uniforms reads zeros.
- **It sees only the point.** In the shadow pass `cameraPosition` and `viewMatrix` are the
  light's. Anything the rule is measured from (a centre, an aim) is a uniform the game writes.
- **Keep the two in step.** Nothing compares the GLSL with `point`. A test in the game that
  draws a box and reads where it landed is the proof (the kit's own slow test does this).
- **One uniform name per page.** A name three already uses (`opacity`, `map`) throws.

## `installBend(rule, options?)`

Patches three's shared shader chunks and adds the rule's uniforms to every `ShaderLib` entry.
Call it once, before the first frame: a program compiled earlier keeps the shader it has.

| Option | Default | What it does |
|---|---|---|
| `shadows` | `'flat'` | `'flat'`: the shadow map is drawn straight and read straight, so shadows are worked out on the flat world and bent with what they fall on. `'bent'`: the shadow map is drawn bent, and every material reads shadows and reflections at the bent place. |

**Which `shadows`.** Take `'flat'` for a rule that lifts or lowers the ground: a caster's shadow
stays under it, the light's frustum still fits the flat world, and the shadow pass compiles
without the rule. Take `'bent'` for a rule that turns the world in plan, where the sun should
keep its heading while the ground turns under it. With `'flat'`, every `MeshDepthMaterial` and
`MeshDistanceMaterial` is straight, including one the game draws with its own camera.

**One rule a page.** The chunks are shared by every renderer on the page. A second call with the
same rule and options does nothing. Any other throws.

`removeBend()` takes it all back out: the chunks, the `ShaderLib` entries and the values'
`clone`. It is for a test or a dev reload. Programs already compiled keep their shader.

## `keepStraight(root, skip?)` and `BEND_OFF`

A material with `BEND_OFF` in its `defines` compiles without the rule. Its program reads none of
the rule's uniforms and not the view matrix, so it costs what it cost before the bend.

```ts
keepStraight(vehicle)                                   // every material under it
keepStraight(vehicle, (o) => o.userData.bends === true) // but not this branch
sky.material.defines = { [BEND_OFF]: '' }               // one material, at creation
```

`keepStraight` marks every material under `root` and returns true when it marked any. A
material already marked is left alone, so calling it again after a part gains a child
recompiles nothing. `skip` names a branch to pass over, such as a part that is also shown out
in the world. Marking a material that has already been drawn recompiles it once.

Use it for whatever stands where the rule does nothing (a vehicle at the middle of a flat disc,
a cockpit) and for whatever must not move (a sky dome, a backdrop card). three's own
backgrounds (a cube or equirect `scene.background`) are always straight.

## `groundHit(rule, ray, options?)`

Where a ray meets the bent ground, as the sim's `{ x, z }`, or `null`. For a rule that moves
points up and down only (a dome, a half pipe, dunes). A rule that moves points in plan needs its
own way back, since the ground under a press is then no longer under it in the sim.

| Option | Default | What it does |
|---|---|---|
| `reach` | `140` | How far along the ray to look, in the ray's units. |
| `step` | `2.5` | The stride of the first search. Shorter finds thinner ridges. |
| `ground` | `0` | The flat ground's height in the sim. |
| `out` | a new object | Written and returned instead. |

`ray` is a `THREE.Ray` or any `{ origin, direction }` with a unit direction. It steps out to the
first point under the ground, then halves 14 times. A ray that looks down but clears a falling
horizon gives the ridge it passes nearest, so a press on something just coming over the
horizon still lands there. A ray that starts under the ground, or looks level or up and meets
nothing, gives `null`.

## Hand-written shaders

Three cases, by how the shader finds its vertex:

| The vertex shader | What it needs |
|---|---|
| Includes `<common>` and `<project_vertex>` | The rule's uniforms: `uniforms: { ...rule.uniforms, uTime }`. Nothing else. |
| Works out its own point in the scene | `${bendGlsl(rule)}` at the top, the uniforms, and `bendWorld(p)` before `viewMatrix`. |
| Writes its own `project_vertex` lines from the model's frame | `<common>`, the uniforms, and `mvPosition = bendView( mvPosition );` after the `modelViewMatrix` line, inside `#ifdef USE_BEND`. |

```ts
new THREE.ShaderMaterial({
  uniforms: { ...dome.uniforms, uTime: { value: 0 } },
  vertexShader: /* glsl */ `
    ${bendGlsl(dome)}
    attribute vec3 offset;
    void main() {
      vec3 p = offset + position;   // already in the scene
      gl_Position = projectionMatrix * viewMatrix * vec4(bendWorld(p), 1.0);
    }`,
  fragmentShader,
})
```

| GLSL, after `installBend` | Where | What it is |
|---|---|---|
| `vec3 bendWorld(vec3 p)` | `<common>`, or `bendGlsl(rule)` | The rule: a point in the scene to where it is drawn. |
| `vec4 bendView(vec4 mv)` | `<common>` | The rule on a point as the eye sees it (`modelViewMatrix * position`). |
| `USE_BEND` | `<common>` | Defined unless the material has `BEND_OFF`. |

`bendGlsl(rule)` is the rule's GLSL behind an include guard, so it is safe beside `<common>`.

## What does not bend

| Thing | Why | What to do |
|---|---|---|
| `THREE.Sprite` | Its shader places its own corners and never runs the chunk. | Set its position from `rule.point` each frame. |
| Normals and lighting | The rule moves points, not normals. | Nothing: a gentle bend lit as the flat world reads right. |
| Culling | three culls by where a thing stands before the bend. | Below. |
| `THREE.Raycaster` against meshes | It tests the flat world. | `groundHit` for the ground; for a mesh, bend the ray's target or pick in the sim. |
| DOM and canvas HUD | It is not in the scene. | `rule.point(...)`, then `project(camera)`. |

**Culling.** A thing just outside the frame on the flat world can be inside it once bent, and
three has already dropped it: things pop at the frame's edges. Which fix depends on the rule:

- **The rule only lowers or raises.** Cull with a frustum that sees further the way the bend
  moves things (taller for a falling horizon), or set `frustumCulled = false` on the few large
  things near the edge.
- **The rule moves things in plan.** Test each bounding sphere where it will be drawn: move its
  centre with `rule.point` and grow its radius a little, since the rule moves a thing's parts
  unevenly.

## Config

None. The module is runtime code the game copies; it reads nothing from `umm-dev.config.mjs`.

## How it works

- **One chunk.** Every built-in material's vertex shader includes `project_vertex`, which turns
  the model's point into the eye's (`mvPosition`). The patch adds one line after it:
  `mvPosition = bendView( mvPosition );`. Instancing, batching, skinning and morphing have all
  happened by then, so they bend with no code of their own.
- **The view matrix, not the model matrix.** The rule needs the point in the scene. `bendView`
  gets it from the eye's point by undoing the view matrix, which is a turn and a shift:
  `( mv.xyz - viewMatrix[ 3 ].xyz ) * mat3( viewMatrix )`. It then adds only the rule's move,
  turned back to the eye, so a point the rule leaves alone is not changed by a single bit.
  **Reading `modelMatrix` instead costs a frame.** three sends `viewMatrix` once when a program
  comes into use, and `modelMatrix` for every draw, but only to a program that reads it.
  `modelMatrix * position` in the chunk makes every program read it. In one game that was 75
  more uploads and 0.3 ms a frame on a phone at a 4x CPU throttle
  ([perf.md](perf.md) has the probe that showed it).
- **Uniforms ride `ShaderLib`.** three builds a built-in material's uniforms by cloning its
  `ShaderLib` entry (`UniformsUtils.clone`) each time it compiles one. The holders added to
  every entry so arrive in every program, whatever `onBeforeCompile` a material has. The clone
  passes a typed array on by reference, copies a number, and calls `clone()` on three's vectors
  and textures, which is why a rule's values are checked and their `clone` replaced.
  **Why not a default `Material.prototype.onBeforeCompile`:** any material that sets its own hook
  replaces it, reads zeros and draws flat, with no error. Every such material then has to call a
  helper, and the one that forgets is found by eye.
- **`USE_BEND` comes from `common`.** The rule and `bendView` are appended to the `common`
  chunk, inside `#ifndef BEND_OFF`, with `#define USE_BEND`. The line in `project_vertex` is
  inside `#ifdef USE_BEND`. A shader that includes `project_vertex` without `common` (three's own
  equirect-to-cube pass does) so compiles and draws straight.
- **`common` is in fragment shaders too.** The rule's GLSL is compiled there and never called.
  It must not read an attribute. This is also why a rule that names `modelMatrix` would not
  compile: fragment shaders have none.
- **Straight `ShaderLib` entries** (`backgroundCube`, `cube`, `equirect`, and with flat shadows
  `depth` and `distance`) get `#define BEND_OFF` ahead of their source.
- **Bent shadows** patch one more chunk, `worldpos_vertex`: the world position three uses for
  shadow and reflection lookups becomes the bent point, recovered from `mvPosition` the same
  way. That chunk then reads no `modelMatrix` either.
- **Precision.** The point handed to the rule is rebuilt from single-precision floats, so it is
  good to about a ten-millionth of its distance from the origin: half a millimetre at four
  kilometres. Only the rule's input carries that error. The unbent position is three's own.
- **What a bend costs.** Each bent program reads the view matrix and the rule's uniforms, which
  three checks at every switch of program or material. A `BEND_OFF` program reads neither.

## Adopting it over a game's own bend

Three shapes of bend have been written by hand in games. Each maps onto the module like this.
None needs its look changed: the rule's GLSL and its numbers stay the game's.

**Taking the file.** A game that already has `src/render/bend.ts` of its own moves its rule to
another file first (`src/render/world.ts`, say), then copies the kit's file to the default path.
Run `umm-dev copy render/bend.ts --dry-run` first: over a file that is not a copy it refuses.

### A dome round a fixed centre

The ground falls by the square of the distance past a flat disc; one `vec4` holds strength and
radius. This is the Quick start's rule.

- **Goes:** the chunk patch, the eye-space function, the loop over `ShaderLib`, the zero-strength
  uniform for the shadow pass (`shadows: 'flat'` is the default and needs none), the game's own
  define and the function that marks materials with it (`BEND_OFF`, `keepStraight(root, skip)`),
  the ray march for the pointer (`groundHit`).
- **Stays:** the strength setter (it writes `DOME[0]`), the horizon's dip for the sky, the
  culling camera. They are the rule's own geometry.
- **Changes to check by eye:** `keepStraight` also marks `ShaderMaterial`s. A `ShadowMaterial` now
  bends, since the camera draws it.

### A half pipe across x, with dunes

The floor rises by the square of the distance east or west of the camera's focus, plus two sine
waves; three float uniforms; a default `Material.prototype.onBeforeCompile` hands them out.

- **Pack the three floats into one `Float32Array(4)`** (bend, focus x, dune height) and have the
  view write slots. A float uniform cannot be shared.
- **The rule** is the chunk's own arithmetic on `p` instead of on `modelMatrix * mvPosition`.
- **Goes:** the prototype hook, and every `bendUniforms(shader)` call in a material with its own
  hook. Hand-written `ShaderMaterial`s spread `...rule.uniforms` instead of naming each one.
  The plane intersection and its correction steps become `groundHit`.
- **Shadows change, for the better:** with the hand patch the shadow map is drawn bent (the
  depth material runs the chunk) and read at the flat place (`worldpos_vertex` is untouched), so
  a shadow slides off its caster as the floor rises. `'flat'` draws and reads it the same way.
  Look at the shadows at the edge of the floor after adopting.
- **Saves** the `modelMatrix` upload on every draw.

### A road turned in plan, from a texture

Every point's x and z are mapped onto a curved centreline read from a float texture, with
calmer paths for the land and the far ridges; a texture, several `Vector4`s and a float.

- **Shares the install, the uniforms and the shadows.** The texture and the `Vector4`s are
  shared as they are. The one float moves into a vector. `shadows: 'bent'` replaces the game's
  own `worldpos_vertex` patch. The path laying, the JavaScript map and the way back for the lens
  stay the game's: `rule.point` wraps the map it already has.
- **Goes:** the prototype hook and every call a hooked material makes to it, the
  `#include <bend_pars>` prepended to each vertex shader, the on/off branch round
  `modelViewMatrix` (a rule that returns `p` moves nothing), both reads of `modelMatrix`.
- **A second map for some materials** (things laid in plan, not along the road) becomes a
  define the rule tests: `#ifdef BEND_PLAN` inside `bendWorld`, and
  `material.defines.BEND_PLAN = ''` in place of swapping the chunk text per material.
- **Culling stays the game's**, written on `rule.point`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `bend: the rule names modelMatrix. …` | The rule's GLSL reads the model matrix. | Use `p`: it is the point in the scene. Measure from a uniform the game writes. |
| `bend: uniform <name> holds a number, which three copies into each program, …` | A float uniform. three copies numbers when it builds a program. | Pack it into a `Float32Array(4)` and declare a `vec4`. |
| `bend: uniform <name> is a typed array of one number. …` | A `Float32Array(1)` for a `float`. three sends a float once, then compares the array with itself. | The same: a `vec2` or a `vec4`. |
| `bend: three's <name> chunk has changed (three r<n>): …` | A newer three reworded the chunk the patch looks for. | Report it upstream with the three version. Nothing was patched. |
| `bend: a rule is already installed, …` | A second rule, or the same rule with other options. | One rule a page. `removeBend()` first in a test or a reload. |
| `bend: three's <key> material already has a uniform called <name>` | The rule's uniform has a name three uses. | Rename it; prefix it `bend`. |
| One material draws flat. | It is a `ShaderMaterial` whose uniforms lack the rule's, so it reads zeros. Or its vertex shader includes `project_vertex` without `common`. Or it has `BEND_OFF`. | Spread `...rule.uniforms` into its uniforms; include `<common>`. |
| Everything draws flat. | `installBend` ran after the first frame, or the rule's strength is zero. | Install before any render. Log the uniform's array. |
| The bend froze at its first value. | The game replaced `holder.value` with a new object. | Write into the first one. |
| A shader fails with `'bendWorld' : redefinition`. | The rule's GLSL was pasted beside `<common>` without the guard. | Use `bendGlsl(rule)`. |
| A shader fails with `'mvPosition' : undeclared identifier` in `worldpos_vertex`. | `shadows: 'bent'`, and a hand-written shader includes `worldpos_vertex` without `project_vertex` before it. | Include `project_vertex` first, or give the material `BEND_OFF`. |
| Things pop in and out at the frame's edges. | three culls by the flat world. | "What does not bend", Culling. |
| Shadows slide off their casters far from the middle. | The shadow map is drawn one way and read the other: a hand patch left behind, or a custom depth material. | Remove the old patch. Pick one `shadows` mode. |
| A HUD tag floats off its unit far from the middle. | The tag is projected from the flat place. | `rule.point` first, then `project(camera)`. |
| A sprite stays on the flat ground. | `THREE.Sprite` never runs the chunk. | Set its position from `rule.point`. |
| A vector the game cloned changes with the rule's. | A rule value's `clone()` returns itself. | `new THREE.Vector4().copy(v)` for a scratch copy. |

## For agents

- **Search for an existing bend before writing one.** Grep the game for `project_vertex` and
  `onBeforeCompile`. A game that patches the chunk by hand adopts this module; it does not get
  a second patch.
- **Never read `modelMatrix` in a rule,** and never add it to the chunk in a copy. A test in
  the kit holds this; the reason is in "How it works".
- **Call `installBend` at module load of the view,** before any renderer draws.
- **Change the rule in three places together:** the GLSL, `point`, and the game's test that
  compares them.
- **A perf claim about the bend needs an interleaved A/B** on the throttled phone, not one run:
  the difference is a fraction of a millisecond.
- **After editing the copy, run `umm-dev drift`** and say what it reports.
