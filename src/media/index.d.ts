/**
 * Types for the media chain and for a game's `capture`, `store` and `loop` sections of
 * umm-dev.config.mjs. Page hooks (`ready`, `hide`, `prep`, `state`) are serialised with their
 * source and run in the page: they must not use anything from the config file's scope.
 */

/** The game's debug handle (`capture.debugGlobal`): its shape is the game's own. */
// biome-ignore lint/suspicious/noExplicitAny: each game's handle has its own shape
export type Debug = any

export type Size = [width: number, height: number]

/** A shot in a shots file. Times are seconds of game time from tick 0. */
export interface Shot {
  name: string
  /** Extra URL flags; they win over `capture.query`. */
  query?: string
  from?: number
  dur: number
  /** [atSec, KeyboardEvent.code, holdSec] */
  keys?: [number, string, number][]
  /** [atSec, JS]: run on that exact frame, with `debug` in scope. */
  run?: [number, string][]
  /** [atSec, 'pointerdown' | 'pointermove' | 'pointerup', x, y] in CSS px on the canvas. */
  pointer?: [number, string, number, number][]
  /** Handed to `capture.hide`; CSS selectors by default. */
  hide?: string[]
  /** JS expression run at tick 0, with `debug` in scope. */
  prep?: string
  /** JS expression checked on the last frame, with `debug` in scope. False fails the run. */
  expect?: string
  /** What the frame is for, printed when `expect` fails. */
  why?: string
  skip?: number
  size?: Size
  png?: boolean
  /** Anything else is handed to the hooks with the shot. */
  [field: string]: unknown
}

export interface CaptureConfig {
  url?: string | null
  vite?: string | null
  port?: number
  path?: string
  query?: string | Record<string, string>
  debugGlobal?: string | null
  ready?: ((debug: Debug, clock: unknown) => boolean) | string | null
  hold?: 'ready' | 'assign'
  bootFrames?: number
  hide?: ((names: string[], debug: Debug) => void) | string | null
  prep?: ((shot: Shot, debug: Debug) => unknown) | string | null
  state?: ((debug: Debug) => unknown) | string | null
  shotUrl?: ((shot: Shot, ctx: { query: string; path: string }) => string) | null
  fps?: number
  seed?: number | null
  skip?: number
  size?: Size
  dpr?: number
  grab?: 'canvas' | 'page'
  canvas?: string
  keyTarget?: 'window' | 'document' | 'canvas'
  quality?: number
  crf?: number
  shots?: string
  out?: string
  font?: string | null
  browser?: { headless?: boolean; channel?: string; args?: string[] }
  bootTimeout?: number
}

export interface EdlShot {
  clip: string
  in: number
  dur: number
  dissolve?: number
  speed?: number
  reverse?: boolean
  grade?: string
  crop?: string
  wipeFrom?: string
  wipeAt?: number
  wipe?: number
  transition?: string
  beat?: string
  note?: string
}

export interface Edl {
  clips?: string
  clipFps?: number
  size?: Size
  fps?: number
  out?: string
  crf?: number
  maxMB?: number
  length?: number
  cover?: { file: string; hold: number }
  shots: EdlShot[]
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
  cards?: {
    text: string
    at: number
    to: number
    y?: string | number
    size?: number
    color?: string
    fade?: number
  }[]
  font?: string
  fadeIn?: number
  fadeOut?: number
  music?: { file: string; ranges: [number, number][]; fadeOut?: number; gain?: number }
}

export interface Still {
  name: string
  spec?: string | false
  template: string
  w: number
  h: number
  scale?: number
  sizes?: Size[]
  keepRender?: boolean
  plates?: Record<string, string>
  inline?: Record<string, string>
  data?: Record<string, unknown>
  clip?: string
  pad?: number
  transparent?: boolean
}

export interface StoreConfig {
  preset?: string
  out?: string
  shots?: string | null
  sheetEvery?: number
  stills?: Still[]
  videos?: { edl: string; spec?: string | false }[]
  preflight?:
    | ((ctx: {
        root: string
        store: StoreConfig
      }) => Promise<string[] | undefined> | string[] | undefined)
    | null
}

export interface LoopConfig {
  out?: string
  edge?: number
  crf?: number
  posterFormat?: 'webp' | 'jpg'
  posterQuality?: number
  samples?: number[]
  posterAt?: number | null
}

/** The media sections of a game's umm-dev.config.mjs. */
export interface GameMediaConfig {
  capture?: CaptureConfig
  store?: StoreConfig
  loop?: LoopConfig
}

export interface AssetSpec {
  kind: 'image' | 'video'
  size?: Size
  minSize?: Size
  formats?: string[]
  seconds?: [min: number, max: number]
  audio?: boolean
  maxMB?: number
  codecs?: string[]
  fps?: number
  required?: boolean
}

export interface Preset {
  name: string
  sources?: string[]
  checked?: string
  assets: Record<string, AssetSpec>
  rules?: string[]
}

export interface Probe {
  file: string
  bytes: number
  format: string
  duration: number | null
  video: {
    codec: string
    width: number
    height: number
    pixFmt: string
    fps: number | null
    frames: number | null
  } | null
  audio: { codec: string }[]
}

export declare const CAPTURE_DEFAULTS: Required<CaptureConfig>
export declare const EDL_DEFAULTS: {
  clips: string
  clipFps: number
  size: Size
  fps: number
  out: string
  crf: number
}
export declare const LOOP_DEFAULTS: Required<LoopConfig>
export declare const STORE_DEFAULTS: Required<StoreConfig>

export declare function validateShots(shots: unknown): string[]
export declare function loadShots(file: string): Shot[]
export declare function mergeQuery(
  ...parts: (string | Record<string, string> | null | undefined)[]
): string
export declare function shotUrl(
  shot: Shot,
  cfg: Pick<CaptureConfig, 'query' | 'path' | 'shotUrl'>,
): string
export declare function shotEvents(shot: Shot, fps: number): [number, string, ...unknown[]][]
export declare function captureShots(run: {
  cfg: Required<CaptureConfig> & { root: string }
  shots: Shot[]
  out: string
  sheet?: { every: number; crop: string | null } | null
  igpu?: boolean
  tag?: string
  log?: (line: string) => void
}): Promise<{ name: string; dir: string; frames: number; ok: boolean; problems: string[] }[]>
export declare function clockScript(cfg: Record<string, unknown>): string
export declare function compareCaptures(a: string, b: string): { same: boolean; lines: string[] }

export declare function validateEdl(edl: unknown, opts?: { font?: string | null }): string[]
export declare function cutLength(edl: Edl): number
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

export declare function makeLoop(
  input: string,
  cfg: Required<LoopConfig> & { root: string; name?: string },
): { mp4: string; poster: string; posterAt: number; mb: number }

export declare function loadPreset(nameOrPath: string, root?: string): Preset
export declare function checkAsset(probe: Probe, spec: AssetSpec): string[]
export declare function checkKit(
  preset: Preset,
  made: Record<string, Probe | null>,
): { ok: boolean; lines: string[] }
export declare function probe(file: string): Probe

export declare function runStore(o: {
  store: Required<StoreConfig> & { root: string }
  capture: Required<CaptureConfig> & { root: string }
  steps: ('preflight' | 'capture' | 'stills' | 'cut' | 'review' | 'check')[]
  only?: string[] | null
  igpu?: boolean
  draft?: boolean
  log?: (l: string) => void
}): Promise<{ ok: boolean; report: string[] }>
