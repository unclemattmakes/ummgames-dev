# Making-of sites

A making-of site is pages inside the game's own build, with toys that run the game's real modules,
and numbers and code quoted from the game's source. The kit holds the plumbing: the build plugin
and the source pass are linked (`@ummgames/dev/making-of`), the toy host, the controls and the base
stylesheet are copied (`runtime/making-of/`), and `umm-dev making-of shot` checks every page in a
real browser. The chapters, the toys and any stage that holds the game's world stay in the game.

## Quick start

1. **Copy the runtime files.** Keep them together; `toy-host.ts` imports `controls.ts` and
   `pages.ts` imports `toy-host.ts`:
   ```sh
   pnpm exec umm-dev copy making-of/toy-host.ts --to src/making-of/shared/toy-host.ts
   pnpm exec umm-dev copy making-of/controls.ts --to src/making-of/shared/controls.ts
   pnpm exec umm-dev copy making-of/canvas2d.ts --to src/making-of/shared/canvas2d.ts
   pnpm exec umm-dev copy making-of/pages.ts --to src/making-of/shared/pages.ts
   pnpm exec umm-dev copy making-of/site.css --to src/making-of/shared/site-base.css
   ```
2. **Write the game's stylesheet** at `src/making-of/shared/site.css`. The copy stays untouched, so
   `umm-dev drift` keeps reading `current`:
   ```css
   @import './site-base.css';

   :root {
     --bg: #150a12;
     --accent: #ffb02e;
     --font-display: "Barlow Condensed", Impact, sans-serif;
   }
   ```
3. **List the chapters** in `src/making-of/chapters.ts`. Import nothing there: the plugin loads it
   under plain node.
4. **Name the site once** in `tools/making-of/site.ts`, and add the plugin to `vite.config.ts`:
   ```ts
   import { createMakingOf } from '@ummgames/dev/making-of'
   import { CHAPTERS } from '../../src/making-of/chapters'

   export const site = createMakingOf({ site: 'My Game', chapters: CHAPTERS })
   ```
   ```ts
   import { site } from './tools/making-of/site'
   plugins: [site.plugin()]
   ```
5. **Write a page** at `making-of/<slug>/index.html`, with the slots the plugin fills:
   ```html
   <link rel="stylesheet" href="/src/making-of/shared/site.css" />
   <body data-chapter="flight">
     <!--mo:nav--><!--mo:header-->
     <article>
       <p>The ship tops out at <span data-const="src/sim/tuning.ts#TOP_SPEED" data-unit="m/s"></span>.</p>
       <pre data-snippet="src/sim/run.ts#stepRun"></pre>
       <div data-toy="void-rig"></div>
     </article>
     <!--mo:pagenav--><!--mo:footer-->
     <script type="module" src="/src/making-of/pages/chapter.ts"></script>
   </body>
   ```
6. **Bind the toys** once, and start them from the page's script:
   ```ts
   import { createPages } from '../shared/pages'
   import { CHAPTERS } from '../chapters'
   import { TOY_LOADERS } from '../toys/registry'

   export const { startChapter, startPlayground } = createPages({
     chapters: CHAPTERS,
     loaders: TOY_LOADERS,
   })
   ```

When it works, a build emits `making-of/<slug>/index.html` for each published chapter, a page with
a stale `data-const` fails the build naming the page, and the check below prints `0 pages with
problems`.

## `umm-dev making-of`

```
umm-dev making-of shot <url...> [--out <dir>] [--phone] [--wait <ms>]
umm-dev making-of shot --all <origin> [--out <dir>] [--phone] [--wait <ms>]
```

Loads each page in the machine's Chrome, scrolls to each `[data-toy]`, lets it run, shoots it, and
prints its readouts. Start the game's dev server or `vite preview` first. A toy with a WebGL world
needs the GPU, so run it under the lease:

```sh
pnpm exec umm-dev gpu run --name mo-shot -- umm-dev making-of shot --all http://localhost:5173
```

| Option | Value | Default | What it does |
|---|---|---|---|
| `--all` | an origin | none | Every page under `making-of/` in this game, from that server. |
| `--out` | a folder | `test-results/making-of` | Where the shots go, as `<page>--<toy>.png`. |
| `--phone` | | off | A 375x812 phone at 2x, in place of 1280x800. |
| `--wait` | milliseconds | `2500` | How long each toy runs before its shot. |
| `-h`, `--help` | | | Print the usage. |

**A page has a problem** when a toy's stage has fewer than 4 distinct colours, a stage still shows
its poster, the page logs a console error or throws, or an element sits past the screen's right
edge. The edge is measured element by element, because `body { overflow-x: hidden }` hides page
overflow from `scrollWidth`. An element inside something that scrolls or clips is left alone.

| Exit code | When |
|---|---|
| 0 | Every page clean. |
| 1 | Some page has a problem. |
| 2 | A usage error. |

Needs `playwright` in the game's dev dependencies.

## `@ummgames/dev/making-of`

Needs `typescript` in the game's dev dependencies: the source pass parses with the compiler.

### `createMakingOf(options)`

**Returns:** `{ plugin(), transformPage(root, slug, html), builtChapters(), builtPages(root) }`.

`plugin()` is the Vite plugin. It lists the pages as build inputs, fills the slots, and runs the
source pass in `vite dev` and `vite build`. `transformPage` is that whole pass over one page, for
the game's own tests.

| Option | Type | Default | What it does |
|---|---|---|---|
| `site` | string | required | The game's name: the nav's brand, the footer, `og:site_name`. |
| `chapters` | `Chapter[]` | none | The chapters, in reading order. Absent: hand-written pages, which get `transforms` and the source pass and every page on disk is built. |
| `sitePages` | `string[]` | `['index', 'playground']` | Pages that are not chapters. |
| `isBuilt` | function | `status === 'published'` | Which chapters have a page. A preview build can add drafts here. |
| `nav` | string | a brand and three links | The nav's whole HTML. |
| `footer` | string | the name and two links | The footer's whole HTML. |
| `headerNote` | function | none | HTML at the end of a chapter's header, such as a draft flag. |
| `unit` | string | `'toy'` | What a card counts, singular. |
| `transforms` | `PageTransform[]` | `[]` | The game's own passes, in order, after the slots and before the source pass. |
| `source` | `SourceOptions` | `{}` | Passed to the source pass. |
| `entries` | object | `{ main: 'index.html' }` | The build's other inputs, by name, from the game root. |
| `buildPages` | boolean or function | `true` | Whether a build lists the pages as inputs. A function gets Vite's `{ command, mode }`, for a build that leaves them out. |

A `Chapter` is `{ slug, number, title, pitch, status, toys }`. All digits in `number` prints as
"Chapter 3"; anything else ("Prologue") prints as it is. `status` `published` is built, `planned` is
a card with no link and a "coming" tag, and any other word shows as a tag. A slug is permanent once
linked; a title is not.

A `PageTransform` is `(html, { root, slug, chapter }) => html`. It may write `data-const` markers:
the source pass runs after it.

**The slots:**

| Slot | Filled with |
|---|---|
| `<!--mo:nav-->` | The nav. |
| `<!--mo:header-->` | The chapter's header, and an "On this page" list at `TOC_MIN_SECTIONS` (4) plain `<h2>`s or more. |
| `<!--mo:cards-->` | A card per chapter. |
| `<!--mo:pagenav-->` | Links to the chapters before and after. |
| `<!--mo:footer-->` | The footer. |

Every plain `<h2>` in a chapter gets an id from its words (`sectionId`).

### The source pass

`data-const` and `data-snippet` work only on empty elements. The source carries no copy of the
value that could go stale and be mistaken for the truth.

```html
<span data-const="src/sim/tuning.ts#TUNING.hull" data-unit="m" data-digits="1"></span>
<span data-const="src/sim/waves.ts#defaultWaves.0.wavelength"></span>
<span data-const="src/sim/run.ts#SIM_DT" data-reciprocal data-unit="Hz"></span>
<span data-const="src/making-of/history.json#first.react"></span>
<pre data-snippet="src/sim/run.ts#stepRun" data-caption="One step"></pre>
<pre data-snippet="src/render/camera.ts#Camera.follow"></pre>
```

| Attribute | What it does |
|---|---|
| `data-const` | `<file>#<name.path>`: a top-level declaration, then into objects, arrays and function results. A `.json` file is a path into the data. |
| `data-digits` | Fixed decimals. Absent: six significant figures with the zeros trimmed. |
| `data-scale` | Multiply, such as `1000` for seconds to milliseconds. |
| `data-reciprocal` | Print 1/x, such as a step as a rate. |
| `data-unit` | Appended after a no-break space. `auto` prints the unit a `lookup` gave. |
| `data-snippet` | `<file>#<name>`, or `<file>#<Class>.<member>`, dedented. Cut by name; the leading doc comment is left out. |
| `data-caption` | A line before the file's path. |

**Numbers are read, never run.** The evaluator is a small interpreter over the compiler's syntax
tree: literals, arithmetic, conditionals, `Math`, object and array literals, spreads, `as`,
`satisfies`, `Object.freeze`, imports and re-exports, and calls to functions that are a single
`return`. Anything else throws, and a field outside the subset throws only when it is read.

| `SourceOptions` key | Default | What it does |
|---|---|---|
| `alias` | `{ '@/': 'src/' }` | Import prefixes the game's bundler maps to folders. |
| `repoBlob` | none | The repo's blob URL. Absent, a snippet's path is not a link, which is right for a private repo. |
| `lookup` | none | `(root, ref) => hit`, tried first for each `data-const`. A game with a generated constants sheet answers here, and returns nothing to fall through. A hit's `unit` serves `data-unit="auto"`, and its `note` joins the tooltip. |

**What it writes:** `<span class="mo-const">`, `<figure class="mo-snippet">`, and `mo-tok-kw`,
`mo-tok-str`, `mo-tok-num` and `mo-tok-com` spans. `site.css` styles them all.

| Export | What it does |
|---|---|
| `lookupConstant(root, ref, options?)` | The value and its file. Throws naming the reference. |
| `formatConstant(hit, options?)` | The text a number prints as. |
| `cutSnippet(root, ref)` | `{ file, name, startLine, endLine, text }`. |
| `highlight(text)` | The text, escaped, in token spans. |
| `resolveSources(root, html, page, options?)` | The whole pass over a page. Throws naming `page`. |
| `constRefsIn(html)`, `snippetRefsIn(html)` | The references in a page. |
| `ANY_MARKER` | A regex for any marker left behind. |
| `clearSourceCache()` | Forget parsed files. The plugin calls it when a source changes. |
| `pagesOnDisk(root)`, `pageFile(slug)` | Slugs on disk, and a slug's file. |

### Guarding a site in the game's tests

The site's premise is that its toys run the game's own modules, and its numbers come from the
source. Fail the game's own check when that stops being true:

```ts
import { createImportGraph } from '@ummgames/dev/testing'
import { ANY_MARKER, pageFile, pagesOnDisk } from '@ummgames/dev/making-of'
import { site } from '../../tools/making-of/site'

const graph = createImportGraph({ root: REPO })
for (const { file, chain } of graph.walkImports(toyFile)) {
  expect(graph.rel(file), chain.map(graph.rel).join(' > ')).not.toBe('src/main.ts')
}
for (const slug of pagesOnDisk(REPO)) {
  const html = fs.readFileSync(path.join(REPO, pageFile(slug)), 'utf8')
  expect(site.transformPage(REPO, slug, html)).not.toMatch(ANY_MARKER)
}
```

## `createImportGraph(options)`

From `@ummgames/dev/testing`: a static import walker over one game's sources. Every `from '...'`
and side-effect `import '...'` counts, comments included, which errs on the safe side. Dynamic
`import()` is not followed. Bare specifiers are packages and stop the walk.

| Option | Default | What it does |
|---|---|---|
| `root` | required | The game root. |
| `alias` | `{ '@/': 'src/' }` | Import prefixes the game's bundler maps to folders. |

| Member | What it does |
|---|---|
| `walkImports(entry, options?)` | Breadth-first, each file once, as `{ file, chain }`. The entry comes first. |
| `importsOf(file, options?)` | The specifiers in a file. |
| `resolveSpecifier(from, spec)` | A specifier as a file, or `null` for a package. |
| `reachable(entry, under?)` | The TypeScript modules under `under` (default `src`) a file reaches: a test's width. |
| `rel(abs)` | A forward-slashed path from the root. |

`valueOnly: true` leaves out whole `import type` statements, which a compiler erases.

## `runtime/making-of/`

| File | Imports | What it is |
|---|---|---|
| `toy-host.ts` | `controls` | Mounts toys, disposes them, runs the page's one frame loop. |
| `controls.ts` | nothing | The controls under a stage. |
| `canvas2d.ts` | nothing | A 2D canvas that fills a stage. |
| `pages.ts` | `toy-host` | What a page's script calls. |
| `site.css` | nothing | The base stylesheet. |

### `toy-host.ts`

**Exports:** `mountToysOnPage(defs, line?)`, `createLiveSet(max)`, `createToyClock(stepSeconds,
maxSteps?)`, `MAX_LIVE_3D` (3), `MAX_TOY_STEPS` (12), and the types `Toy`, `ToyContext`, `ToyDef`,
`MountToy`.

A toy is a module that exports a `ToyDef`:

```ts
import { createToyClock, type ToyDef } from '../shared/toy-host'
import { createCanvas2D } from '../shared/canvas2d'
import { SIM_DT } from '@/sim/run'

export const toy: ToyDef = {
  id: 'void-rig',
  title: 'The rig',
  about: 'What the demo is, under the stage on a chapter page.',
  caption: 'What to try, under the stage on the playground.',
  kind: '2d',
  mount({ stage, controls, reducedMotion }) {
    const c = createCanvas2D(stage)
    const clock = createToyClock(SIM_DT)
    controls.slider({ label: 'Speed', min: 0, max: 9, step: 1, value: 3, onInput: () => {} })
    return {
      frame: (dt) => clock.step(dt, (fixed) => step(fixed)),
      resize: (w, h) => c.resize(w, h),
      dispose: () => c.dispose(),
    }
  },
}
```

**The host owns everything that is not the toy.** A toy mounts when it comes within a viewport of
the screen and is disposed when it goes further. `frame` runs only while it is on screen. `kind:
'3d'` holds a WebGL context and counts against `MAX_LIVE_3D`: browsers cap contexts near 16 and
silently kill the oldest, and a game's world is heavy, so the least recently seen is evicted.

`createToyClock(stepSeconds)` is the game's fixed step for a toy, so its physics never becomes a
`dt`-per-frame imitation. `step(frameSeconds, onTick)` calls `onTick(dt, tick)` for each whole step
and returns the interpolation alpha. After `maxSteps` in a frame it drops the backlog. Pass the
game's own step, and its own cap if it has one.

`mountToysOnPage`'s `line` picks the line under the stage: `'about'` (default) or `'caption'`.

### `controls.ts`

**Exports:** `createControls(host)` and the type `Controls`. The host builds one for each toy, as
`ctx.controls`.

| Member | What it adds |
|---|---|
| `slider({ label, min, max, step, value, format?, onInput })` | A range with a readout. Returns `{ set }`. |
| `toggle({ label, value, onChange })` | A checkbox. Returns `{ set }`. |
| `segmented({ options, value, onChange })` | A row of choices. `set(null)` lights none. |
| `button(label, onClick)` | A button. |
| `buttons({ options, value, onClick })` | A wrapping block that stays side by side on a phone. The last pressed stays lit. |
| `select({ label, options, value, onChange })` | A drop-down, for a choice too long for a phone. Returns `{ set }`. |
| `tabs({ options, value })` | A segmented row and a `Controls` per option, one shown at a time. |
| `search(placeholder, onInput, value?)` | A search box. |
| `readouts()` | A row of `label: value` pairs. `update(rows)` takes the current ones; a row may carry `tone: 'good'` or `'bad'`. |

### `canvas2d.ts`

**Exports:** `createCanvas2D(stage)` and the type `Canvas2D`: `{ canvas, ctx, width, height,
resize(w, h), dispose() }`. `width` and `height` are CSS pixels, and the transform is set so a toy
draws in them. The pixel ratio is capped at 2. A 2D toy holds no WebGL context.

### `pages.ts`

**Exports:** `createPages({ chapters, loaders, hasPage? })`, `loadToys(loaders, ids)`, and the types
`ToyChapter`, `ToyLoader`, `PagesOptions`.

`createPages` returns `{ startChapter(slug), startPlayground() }`. `loaders` maps each toy's id to a
dynamic import, so a chapter pays for its own toys. The playground fills `#playground` with every
toy under its chapter. `hasPage` says whether a chapter has a page to link to; default all do.

### `site.css`

A magazine spread on a dark ground: the nav, headers, cards, prose, callouts, the toy frame, the
controls, the playground and the hero, portrait-first below 720px. Colours come from the tokens, or
derive from them with `color-mix`, so a game's palette reaches everything.

| Token | What it colours |
|---|---|
| `--bg`, `--bg-alt`, `--bg-elevated`, `--demo-bg` | The grounds. |
| `--fg`, `--fg-muted`, `--fg-subtle` | Text. |
| `--accent`, `--accent-dim`, `--accent-ink`, `--accent-bright` | The hot accent, its tint, text on it, and its hover. |
| `--accent-secondary` | Links. |
| `--pale`, `--border` | Quiet text and rules. |
| `--code-bg`, `--code-fg`, `--code-keyword`, `--code-string`, `--code-number`, `--code-comment` | Listings. |
| `--good`, `--bad` | Readout tones. |
| `--font-body`, `--font-mono`, `--font-display` | Faces. The game's page loads them. |
| `--content`, `--wide` | Column widths. |

Put a full-bleed toy on a landing page with `class="hero-toy"` on the `[data-toy]` element.

## How it works

- **Pages are inputs of the game's build.** Toys import the game, so the bundler shares chunks
  between the two. Nothing under `/making-of/` reaches the game's own page: the plugin touches only
  paths under it.
- **The pass runs at build and in `vite dev`,** in `transformIndexHtml` with `order: 'pre'`, so what
  it writes is ordinary HTML to Vite.
- **The chapter list is plain data.** The plugin reads it under node, so it must import nothing that
  needs a bundler.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `making-of/flight: data-const "src/x.ts#Y" does not resolve: no top-level declaration named Y` | The constant was renamed or moved. | Fix the page, and its prose if the story moved. |
| `cannot evaluate NewExpression at src/x.ts:12` | The value is outside the evaluator's subset. | Quote a plainer value, or give the game a `lookup`. |
| `function at src/x.ts:3 is not a single \`return <expr>\`` | The path runs through a function with statements. | Quote what it reads instead. |
| `Cannot find package 'typescript'` | The game has no `typescript`. | Add it to the dev dependencies, pinned. |
| Numbers read as plain text and code has no colours | The stylesheet has no `.mo-const` or `.mo-tok-*` rules. | Start the game's stylesheet with `@import './site-base.css'`. |
| `<toy>: never mounted` | The toy's `mount` threw, or the page never reached it. | Read the console lines in the same report. |
| `<toy>: drew nothing` on a 3D toy | No GPU, or the context was lost. | Run under `umm-dev gpu run`, with the machine's Chrome installed. |
| A toy's WebGL context is lost on a long page | More live contexts than the browser allows. | Declare `kind: '3d'` on every toy that holds one. |

## For agents

- **Never type a number or a listing the source holds.** Use `data-const` and `data-snippet`.
- **A toy imports the game and never re-creates it.** Guard that with `createImportGraph`.
- **A stale reference is the guard working.** Fix the page, not the marker.
- **Keep the copies untouched.** The game's palette and rules go in its own stylesheet, and its
  clock's step goes in as an argument. A game-only helper belongs in its own file beside the
  copies, so `umm-dev drift` keeps reading `current`.
- **Run the shot under the GPU lease,** one lease per run, and read the screenshots as well as the
  report: the report sees a blank toy, not an ugly one.
