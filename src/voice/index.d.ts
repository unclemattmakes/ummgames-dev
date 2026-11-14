/**
 * `@ummgames/dev/voice`: the shared parts of a game's voice tools. ElevenLabs requests with the
 * key read in one place, Scribe transcripts, comparing what a take said with what it was asked to
 * say, and ffmpeg cuts for spoken and sung takes. See docs/voice.md.
 */

/** `https://api.elevenlabs.io`. */
export declare const API: string
/** Designs a voice from a description: `eleven_ttv_v3`. */
export declare const DESIGN_MODEL: string
/** Reads a line in a saved voice, delivery tags and all: `eleven_v3`. */
export declare const SPEECH_MODEL: string
/** Transcribes a take with word times: `scribe_v2`. */
export declare const SCRIBE_MODEL: string
/** The longest wait between retries of a 429, in seconds: 64. */
export declare const MAX_WAIT_S: number

/**
 * `ELEVENLABS_API_KEY`, from `env` (default `process.env`), then `.env.local` at `root` (default
 * the game's root), then, when `platform` is `win32`, the user's saved variables. Throws when none
 * has it. The key is never printed.
 */
export declare function apiKey(options?: {
  root?: string
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}): string

/** What `call` resolves to: the API's parsed JSON, whose shape is the route's, or a Buffer. */
// biome-ignore lint/suspicious/noExplicitAny: each route's JSON has its own shape
export type Reply = any

/**
 * One ElevenLabs request to `API + route`. An object body is sent as JSON, a FormData as a form.
 * A JSON reply is parsed; any other reply (audio, a zip) comes back as a Buffer. A 429 is retried
 * after 2 s, doubling up to MAX_WAIT_S; any other error status throws with the reply's text.
 * `key` skips `apiKey`; `root` is passed to it.
 */
export declare function call(
  method: string,
  route: string,
  body?: unknown,
  options?: { root?: string; key?: string },
): Promise<Reply>

/** A word Scribe heard, with its start and end in seconds. */
export interface HeardWord {
  text: string
  start: number
  end: number
}

/**
 * What Scribe hears in an mp3 take: its text, its words with times, and when the last word ends.
 * `language` defaults to `eng`.
 */
export declare function transcribe(
  file: string,
  options?: { root?: string; key?: string; language?: string },
): Promise<{ heard: string; speechEnds: number; words: HeardWord[] }>

/**
 * A line's words as capitals and digits, to compare a take's text with what a transcript heard:
 * a lone digit is its word, `N'` is AND, a dot before a domain ending (`.com`, `.tv` and a few
 * more) is DOT, and anything else that is not a letter or digit goes.
 */
export declare function wordsOf(text: string): string

/** Runs `f` over `items`, at most `n` at once. Rejects on the first failure. */
export declare function inPool<T>(
  items: T[],
  n: number,
  f: (item: T) => Promise<unknown>,
): Promise<void>

/** Seconds of fade at each end of a piece `cut` makes: 0.006 in, 0.012 out. */
export declare const FADE_IN_S: number
export declare const FADE_OUT_S: number
/** The shortest piece `cut` makes: 0.05 s. */
export declare const MIN_PIECE_S: number
/** Where `soundEnds` hears silence: windows of 0.05 s under -60 dBFS. */
export declare const SOUND_END_DB: number
export declare const SOUND_END_WINDOW_S: number

export interface CutOptions {
  /** Default `ffmpeg` on PATH. */
  ffmpeg?: string
  /** Default `ffprobe` on PATH. */
  ffprobe?: string
  /** Sample rate of the piece. Default 22050. */
  rate?: number
  /** Default `32k`. */
  bitrate?: string
}

/**
 * Cuts `from` to `to` seconds of `src` to a mono mp3 piece, faded at both ends, and returns its
 * bytes. `filters` are ffmpeg audio filters run after the fades. After each call, `cut.seconds`
 * is the piece's length.
 */
export declare const cut: {
  (src: string, from: number, to: number, filters?: string[], options?: CutOptions): Buffer
  /** The length of the last piece made, in seconds. */
  seconds: number
}

/**
 * Seconds to where `file`'s sound ends: the end of the last `window`-second window (default
 * 0.05) whose RMS, on the louder channel, is over `db` dBFS (default -60). 0 for silence.
 */
export declare function soundEnds(
  file: string,
  options?: { ffmpeg?: string; db?: number; window?: number },
): number

/**
 * Ships a sung take: encodes `src` to `dest` as an mp3 at `bitrate` (default `96k`) and returns
 * `seconds`, its length to where its sound ends. With `trim` (default false) the file is also cut
 * there.
 */
export declare function shipSung(
  src: string,
  dest: string,
  options?: { ffmpeg?: string; bitrate?: string; trim?: boolean; db?: number; window?: number },
): { file: string; seconds: number }
