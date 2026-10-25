/**
 * Types for `@ummgames/dev/media` and for a game's `capture`, `store` and `loop` sections of
 * umm-dev.config.mjs. docs/media.md documents each one. Page hooks (`ready`, `hide`, `prep`,
 * `state`) are serialised with their source and run in the page: they must not use anything
 * from the config file's scope.
 */

/** The game's debug handle (`window[capture.debugGlobal]`): its shape is the game's own. */
// biome-ignore lint/suspicious/noExplicitAny: each game's handle has its own shape
export type Debug = any

/** A size in pixels: `[width, height]`. */
export type Size = [width: number, height: number]

/** A shot in a shots file. Times are seconds of game time from tick 0. */
export interface Shot {
  /** The output folder: letters, digits, `.`, `_`, `@`, `-`; unique; not only dots. */
  name: string
  /** Extra URL flags; they win over `capture.query`. A `shotUrl` must merge them, or they are dropped. */
  query?: string
  /** Where recording starts (default 0); the frames before it run but are not kept. */
  from?: number
  /** Seconds to record, > 0. */
  dur: number
  /** Key presses `[atSec, KeyboardEvent.code, holdSec]`; the event's `key` is the code too. */
  keys?: [number, string, number][]
  /** `[atSec, JS]`: run on that exact frame, with `debug` in scope; an expression or statements. */
  run?: [number, string][]
  /** `[atSec, 'pointerdown' | 'pointermove' | 'pointerup', x, y]` in CSS px from the canvas's top left. */
  pointer?: [number, string, number, number][]
  /** Handed to `capture.hide` at tick 0; CSS selectors by default. */
  hide?: string[]
  /** JS run at tick 0, after `capture.prep`, with `debug` in scope; an expression or statements. */
  prep?: string
  /** JS expression checked on the last frame, with `debug` in scope; falsy or an error fails the shot. */
  expect?: string
  /** What the frame is for: printed when `expect` fails, and by `capture --list`. */
  why?: string
  /** Real frames per game frame for this shot (default `capture.skip`). */
  skip?: number
  /** The window in device pixels for this shot (default `capture.size`). */
  size?: Size
  /** Lossless PNG frames instead of JPEG (default false). */
  png?: boolean
  /** Any other field is kept, and reaches `capture.prep` and `capture.shotUrl` with the shot. */
  [field: string]: unknown
}

/**
 * The virtual clock as a page hook sees it: `window.__ummClock`, `ready`'s second argument. Only
 * these fields are stable; anything else on the object is internal and may change.
 */
export interface CaptureClock {
  /** `'boot'` until the clock holds, `'hold'` while it waits to record, `'run'` while recording. */
  readonly mode: 'boot' | 'hold' | 'run'
  /** Frames the game has been pumped since the page loaded. */
  readonly frames: number
  /** The frame recording counts from (tick 0); 0 until the clock holds. */
  readonly tick0: number
}

/** The `capture` section of umm-dev.config.mjs. */
export interface CaptureConfig {
  /** A running dev server's origin (default null: capture starts Vite at the game root). */
  url?: string | null
  /** The Vite config file for that server, from the game root (default null: Vite's own lookup). */
  vite?: string | null
  /** The dev-server port (default 5440); `CAPTURE_PORT` overrides it; unused with `url`. */
  port?: number
  /** The page's path, before the query (default `'/'`). */
  path?: string
  /** URL flags every shot gets (default `''`); a shot's own `query` wins, unless `shotUrl` is set and does not merge it (docs/media.md). */
  query?: string | Record<string, string>
  /** The name of the game's debug handle on `window`, handed to hooks as `debug` (default null). */
  debugGlobal?: string | null
  /** Page hook: the game is ready to shoot; `clock` is `window.__ummClock` (default null: always ready). */
  ready?: ((debug: Debug, clock: CaptureClock) => boolean) | string | null
  /** What ends boot: `ready` holds, or the game assigns `debugGlobal` (default `'ready'`). */
  hold?: 'ready' | 'assign'
  /** The earliest boot frame that can become tick 0, with `hold: 'ready'` (default 60). */
  bootFrames?: number
  /** Page hook hiding a shot's `hide` list at tick 0 (default null: each name is a CSS selector). */
  hide?: ((names: string[], debug: Debug) => void) | string | null
  /** Page hook run at tick 0 for every shot, before the shot's `prep`; its result is printed (default null). */
  prep?: ((shot: Shot, debug: Debug) => unknown) | string | null
  /** Page hook run on every recorded frame; its result goes to `states.jsonl` (default null). */
  state?: ((debug: Debug) => unknown) | string | null
  /** Node function returning a shot's path and query; `query` is `capture.query` alone, so merge `shot.query` (default null). */
  shotUrl?: ((shot: Shot, ctx: { query: string; path: string }) => string) | null
  /** Game frames per second (default 60). */
  fps?: number
  /** The `Math.random` seed; null leaves `Math.random` alone (default 1). */
  seed?: number | null
  /** Real frames per game frame while recording; higher is slower, never choppier (default 2). */
  skip?: number
  /** The window in device pixels, for a shot without `size` (default `[1920, 1080]`). */
  size?: Size
  /** Device pixel ratio; the window is `size / dpr` CSS px (default 1). */
  dpr?: number
  /** `canvas` copies the canvas at its backing size; `page` screenshots the window, DOM included (default `'canvas'`). */
  grab?: 'canvas' | 'page'
  /** The canvas's CSS selector, for grabs, pointer events and `keyTarget: 'canvas'` (default `'canvas'`). */
  canvas?: string
  /** Where key events are dispatched (default `'window'`). */
  keyTarget?: 'window' | 'document' | 'canvas'
  /** JPEG quality, 0 to 1 (default 0.92). */
  quality?: number
  /** x264 CRF of each shot's mp4 (default 16). */
  crf?: number
  /** The shots file, from the game root (default `'shots.json'`). */
  shots?: string
  /** The output folder, from the game root (default `'test-results/capture'`). */
  out?: string
  /** Font file for the contact sheets' labels (default null: fontconfig's default). */
  font?: string | null
  /** Chromium's launch; merged over `{ headless: true, channel: undefined, args: [] }`. */
  browser?: { headless?: boolean; channel?: string; args?: string[] }
  /** Seconds to wait for the game to become ready (default 180). */
  bootTimeout?: number
}

/** A shot in an edit list. */
export interface EdlShot {
  /** The captured clip's name, under the edit list's `clips`. */
  clip: string
  /** Game seconds into the clip. */
  in: number
  /** Seconds in the cut; the shot uses `dur * speed` s of the clip. */
  dur: number
  /** Seconds of cross-dissolve into this shot (default 0). */
  dissolve?: number
  /** Playback speed (default 1). */
  speed?: number
  /** Play the trimmed span backwards (default false). */
  reverse?: boolean
  /** An ffmpeg filter chain applied after the scale. */
  grade?: string
  /** `w:h:x:y` in clip px, applied before the scale, to reframe a clip. */
  crop?: string
  /** A clip at the same game time that plays first, then wipes to `clip`. */
  wipeFrom?: string
  /** The wipe ends this many seconds into the shot; required with `wipeFrom`. */
  wipeAt?: number
  /** The wipe's length in seconds (default 1). */
  wipe?: number
  /** The wipe's ffmpeg xfade transition (default `'wiperight'`). */
  transition?: string
  /** What the in-point must show; the store's review sheet prints it. */
  beat?: string
  /** A comment. */
  note?: string
}

/** An edit list: what `umm-dev cut` reads. Keys starting `$` or `_` are comments. */
export interface Edl {
  /** The folder of captured clips, from the game root (default `'test-results/capture'`). */
  clips?: string
  /** The clips' game frames per second (default 60). */
  clipFps?: number
  /** The output frame, even on both sides (default `[1920, 1080]`). */
  size?: Size
  /** The output frame rate (default 60). */
  fps?: number
  /** The output file, ending `.mp4`, from the game root (default `'dist-video/cut.mp4'`). */
  out?: string
  /** The final x264 CRF, an integer from 0 to 51 (default 18). */
  crf?: number
  /** Fail when the output is bigger than this many MB. */
  maxMB?: number
  /** Trim the end to this many seconds (default: the shots' length); it cannot lengthen the cut. */
  length?: number
  /** A still shown for the first `hold` s; the first shot's `dissolve` blends from it. */
  cover?: { file: string; hold: number }
  /** The shots, in order. */
  shots: EdlShot[]
  /** Images over the cut: `x` and `y` in output px or an overlay expression; `fade` 0.5 and `opacity` 1 by default. */
  overlays?: {
    file: string
    at: number
    to: number
    w: number
    x: number | string
    y: number | string
    fade?: number
    opacity?: number
  }[]
  /** Centred text, needing `font`: `y` `'h*0.78-text_h/2'`, `size` 72, `color` white, `fade` 0.4 by default. */
  cards?: {
    text: string
    at: number
    to: number
    y?: string | number
    size?: number
    color?: string
    fade?: number
  }[]
  /** A `.ttf` or `.otf` for the cards, from the game root; none is bundled. */
  font?: string
  /** Seconds of fade from black (default 0). */
  fadeIn?: number
  /** Seconds of fade to black (default 0). */
  fadeOut?: number
  /** The audio track: source ranges spliced in order; `fadeOut` 3 and `gain` 1 by default. Omitted: silent, no track. */
  music?: { file: string; ranges: [number, number][]; fadeOut?: number; gain?: number }
}

/** A still in `store.stills`: one template rendered to one or more PNGs. */
export interface Still {
  /** The file stem, and the preset asset id unless `spec` is set. */
  name: string
  /** The preset asset id it is checked as (default `name`); false: not checked. */
  spec?: string | false
  /** An `.html` or `.svg` file, from the game root. */
  template: string
  /** The page's width in CSS px, and the main output's width. */
  w: number
  /** The page's height in CSS px, and the main output's height. */
  h: number
  /** Device scale of the render (default 2, or 1 with `clip`). */
  scale?: number
  /** More output sizes from the same render. */
  sizes?: Size[]
  /** Also keep the render at `scale` (default false). */
  keepRender?: boolean
  /** A key in `STORE.plates` to a capture shot, whose last frame it gets. */
  plates?: Record<string, string>
  /** A token to a file: `__TOKEN__` in the template becomes its data URL. */
  inline?: Record<string, string>
  /** Anything the template reads from `window.STORE`. */
  data?: Record<string, unknown>
  /** A CSS selector: write `<name>.png`, cropped to that element's box, unchecked. */
  clip?: string
  /** CSS px around the `clip` box (default 0). */
  pad?: number
  /** Keep transparency where nothing is drawn (default true). */
  transparent?: boolean
}

/** The `store` section of umm-dev.config.mjs. */
export interface StoreConfig {
  /** A preset in the kit's `presets/` by name, or a path to a `.json` (default `'crazygames'`). */
  preset?: string
  /** The kit's output folder, from the game root (default `'dist-store'`). */
  out?: string
  /** The kit's shots file, from the game root (default null: no capture step). */
  shots?: string | null
  /** Seconds between contact-sheet tiles of the kit's captures (default 0.5). */
  sheetEvery?: number
  /** The stills to render (default `[]`). */
  stills?: Still[]
  /** An edit list each, and the preset asset id it is checked as (default: its stem; false for none). */
  videos?: { edl: string; spec?: string | false }[]
  /** Node function run at preflight; each string it returns is a problem that stops the kit (default null). */
  preflight?:
    | ((ctx: {
        root: string
        store: StoreConfig
      }) => Promise<string[] | undefined> | string[] | undefined)
    | null
}

/** The `loop` section of umm-dev.config.mjs. */
export interface LoopConfig {
  /** The output folder, from the game root (default `'dist-site'`). */
  out?: string
  /** The long-edge cap in px, never upscaling (default 720). */
  edge?: number
  /** x264 CRF (default 30). */
  crf?: number
  /** The poster's format (default `'webp'`). */
  posterFormat?: 'webp' | 'jpg'
  /** Poster quality, 0 to 100 (default 80). */
  posterQuality?: number
  /** Fractions of the clip tried for the poster (default `[0.15, 0.4, 0.65]`). */
  samples?: number[]
  /** Seconds into the clip for the poster (default null: sample). */
  posterAt?: number | null
}

/** The media sections of a game's umm-dev.config.mjs. */
export interface GameMediaConfig {
  /** Settings for `umm-dev capture`, and the store's capture step. */
  capture?: CaptureConfig
  /** Settings for `umm-dev store`. */
  store?: StoreConfig
  /** Settings for `umm-dev loop`. */
  loop?: LoopConfig
}

/** One asset of a preset, and the checks it must pass. */
export interface AssetSpec {
  /** Which checks apply. */
  kind: 'image' | 'video'
  /** Exact pixels. */
  size?: Size
  /** At least these pixels. */
  minSize?: Size
  /** Image only: `png`, `jpg` or `webp`. */
  formats?: string[]
  /** Video only: duration in seconds, inclusive, to 0.02 s. */
  seconds?: [min: number, max: number]
  /** Video only: false means no audio track at all; true means one is needed. */
  audio?: boolean
  /** Largest file size, in MB of 10^6 bytes. */
  maxMB?: number
  /** Video only: codec names as ffprobe gives them (`h264`, `vp9`, `av1`). */
  codecs?: string[]
  /** Video only: frames per second, to 0.01. */
  fps?: number
  /** Not made: `MISSING`, which fails the kit; otherwise `skipped`. */
  required?: boolean
}

/** A storefront's asset rules as data: `presets/<store>.json`, or a game's own file. */
export interface Preset {
  /** The storefront's name. */
  name: string
  /** Where the rules come from. */
  sources?: string[]
  /** When someone last read them. */
  checked?: string
  /** Asset id to its checks. */
  assets: Record<string, AssetSpec>
  /** What a person must check by eye; printed after the check. */
  rules?: string[]
}

/** What ffprobe says about a file. */
export interface Probe {
  /** The file probed. */
  file: string
  /** Its size in bytes. */
  bytes: number
  /** ffprobe's format_name, such as `mov,mp4,m4a,3gp,3g2,mj2` or `png_pipe`. */
  format: string
  /** Seconds, or null for a still. */
  duration: number | null
  /** The first video stream, or null when there is none. */
  video: {
    codec: string
    width: number
    height: number
    pixFmt: string
    fps: number | null
    frames: number | null
  } | null
  /** The audio streams. */
  audio: { codec: string }[]
}

/** The `capture` section's defaults. */
export declare const CAPTURE_DEFAULTS: Required<CaptureConfig>
/** An edit list's defaults for the fields that have one. */
export declare const EDL_DEFAULTS: {
  clips: string
  clipFps: number
  size: Size
  fps: number
  out: string
  crf: number
}
/** The `loop` section's defaults. */
export declare const LOOP_DEFAULTS: Required<LoopConfig>
/** The `store` section's defaults. */
export declare const STORE_DEFAULTS: Required<StoreConfig>

/** A shots array's problems, as messages; empty when it is valid. */
export declare function validateShots(shots: unknown): string[]
/** Read and validate a shots file; throws with every problem. */
export declare function loadShots(file: string): Shot[]
/** Merge query strings or objects into one query string; the first value of a key wins. */
export declare function mergeQuery(
  ...parts: (string | Record<string, string> | null | undefined)[]
): string
/** A shot's page URL, path and query without the origin: `cfg.shotUrl`'s result when set. */
export declare function shotUrl(
  shot: Shot,
  cfg: Pick<CaptureConfig, 'query' | 'path' | 'shotUrl'>,
): string
/** A shot's keys, pointer events and `run` lines as `[frame, type, ...args]`, in game frames from tick 0. */
export declare function shotEvents(shot: Shot, fps: number): [number, string, ...unknown[]][]
/** Capture shots; resolves to one result per shot, `ok` false on an unmet `expect` or a missing frame. */
export declare function captureShots(run: {
  cfg: Required<CaptureConfig> & { root: string }
  shots: Shot[]
  out: string
  sheet?: { every: number; crop: string | null } | null
  igpu?: boolean
  tag?: string
  log?: (line: string) => void
}): Promise<{ name: string; dir: string; frames: number; ok: boolean; problems: string[] }[]>
/** The virtual clock's init script for a page, as source text. */
export declare function clockScript(cfg: Record<string, unknown>): string
/** Are two capture folders the same footage? Compares frames and, when both have one, `states.jsonl`. */
export declare function compareCaptures(a: string, b: string): { same: boolean; lines: string[] }

/** An edit list's problems, as messages; empty when it is valid. */
export declare function validateEdl(edl: unknown, opts?: { font?: string | null }): string[]
/** The cut's length in seconds: cover hold plus shot durations less dissolves, or `length`. */
export declare function cutLength(edl: Edl): number
/** Every ffmpeg command of a cut, built without touching the disk; the edit list must be valid. */
export declare function planCut(
  edl: Edl,
  ctx: {
    root: string
    draft?: boolean
    font?: string | null
    resolveClip: (
      clip: string,
      clipsDir: string,
      clipFps: number,
    ) => { args: string[]; retime: string }
  },
): {
  commands: { label: string; args: string[] }[]
  out: string
  segDir: string
  length: number
  size: Size
  fps: number
}
/** Cut an edit list to one mp4, or print the commands; throws on an invalid list or an output over `maxMB`. */
export declare function cutEdl(
  edl: Edl,
  opts: {
    root: string
    draft?: boolean
    print?: boolean
    font?: string | null
    log?: (l: string) => void
  },
): { out: string; length: number; mb: number | null; printed: boolean }

/** Make a site loop and its poster from an mp4; throws when the input has no video. */
export declare function makeLoop(
  input: string,
  cfg: Required<LoopConfig> & { root: string; name?: string },
): { mp4: string; poster: string; posterAt: number; mb: number }

/** A preset by name (`crazygames`) or by path from `root`; throws when it is missing or invalid. */
export declare function loadPreset(nameOrPath: string, root?: string): Preset
/** One probed file's failures against one asset spec; empty when it passes. */
export declare function checkAsset(probe: Probe, spec: AssetSpec): string[]
/** The store's check lines for probed files by asset id; `ok` false on a FAIL or a required MISSING. */
export declare function checkKit(
  preset: Preset,
  made: Record<string, Probe | null>,
): { ok: boolean; lines: string[] }
/** ffprobe a file; throws when it is missing or unreadable. */
export declare function probe(file: string): Probe

/** Run store steps in order; resolves `ok` false on a FAIL or a required MISSING, throws on a stop. */
export declare function runStore(o: {
  store: Required<StoreConfig> & { root: string }
  capture: Required<CaptureConfig> & { root: string }
  steps: ('preflight' | 'capture' | 'stills' | 'cut' | 'review' | 'check')[]
  only?: string[] | null
  igpu?: boolean
  draft?: boolean
  log?: (l: string) => void
}): Promise<{ ok: boolean; report: string[] }>
