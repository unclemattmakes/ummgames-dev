// @ts-check
/**
 * ElevenLabs requests for a game's voice tools: the key, one request with backoff, and Scribe
 * transcripts. Every take a tool makes goes through `call`, so the key is read in one place.
 *
 * The key is `ELEVENLABS_API_KEY`, from the environment, then `.env.local` at the game's root
 * (where `elevenlabs onboard connect` puts it), then, on Windows, the user's saved variables, so a
 * key set after the shell started still works. It is never printed or logged.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { findGameRoot } from '../config.mjs'

export const API = 'https://api.elevenlabs.io'
/** Designs a voice from a description. */
export const DESIGN_MODEL = 'eleven_ttv_v3'
/** Reads a line in a saved voice; it takes delivery tags such as `[shouting]`. */
export const SPEECH_MODEL = 'eleven_v3'
/** Transcribes a take, with each word's start and end. */
export const SCRIBE_MODEL = 'scribe_v2'
/** A 429 is retried after 2, 4, 8, 16, 32 and 64 seconds, then thrown. */
export const MAX_WAIT_S = 64

const NAME = 'ELEVENLABS_API_KEY'

/**
 * @param {{ root?: string, env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform }} [options]
 * @returns {string}
 */
export function apiKey({ root, env = process.env, platform = process.platform } = {}) {
  if (env[NAME]?.trim()) return /** @type {string} */ (env[NAME]).trim()
  // Vite exposes only VITE_ names to a page, so a key here stays out of the build.
  const local = path.join(root ?? findGameRoot(), '.env.local')
  if (fs.existsSync(local)) {
    const m = fs.readFileSync(local, 'utf8').match(/^ELEVENLABS_API_KEY\s*=\s*["']?([^"'\s]+)/m)
    if (m) return m[1]
  }
  if (platform === 'win32') {
    try {
      const out = execFileSync('reg', ['query', 'HKCU\\Environment', '/v', NAME], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      const m = out.match(/ELEVENLABS_API_KEY\s+REG_\w+\s+(\S+)/)
      if (m) return m[1].trim()
    } catch {}
  }
  throw new Error(`No ${NAME} in the environment, .env.local or the user variables.`)
}

/**
 * One ElevenLabs request. A plain object body is sent as JSON, a FormData as a form. A JSON
 * reply is parsed; anything else (audio, a zip) comes back as a Buffer. A 429 waits and retries,
 * doubling from 2 s up to MAX_WAIT_S, so a batch of hundreds of takes does not die of a busy API.
 * Any other error status throws with the status and the reply's text.
 * @param {string} method
 * @param {string} route the path after the host, such as `/v1/user/subscription`
 * @param {unknown} [body]
 * @param {{ root?: string, key?: string }} [options]
 * @returns {Promise<any>}
 */
export async function call(method, route, body, { root, key } = {}) {
  const form = body instanceof FormData
  const xi = key ?? apiKey({ root })
  const send = () =>
    fetch(API + route, {
      method,
      headers: {
        'xi-api-key': xi,
        ...(body && !form ? { 'content-type': 'application/json' } : {}),
      },
      body: form ? body : body ? JSON.stringify(body) : undefined,
    })
  let res = await send()
  for (let wait = 2; res.status === 429 && wait <= MAX_WAIT_S; wait *= 2) {
    await new Promise((done) => setTimeout(done, wait * 1000))
    res = await send()
  }
  if (!res.ok) throw new Error(`${method} ${route}: ${res.status} ${await res.text()}`)
  return res.headers.get('content-type')?.includes('json')
    ? res.json()
    : Buffer.from(await res.arrayBuffer())
}

/**
 * What Scribe hears in a take, and when its last word ends, in seconds. `file` is a path,
 * resolved against the working directory, or the audio's bytes (a piece read from a bin).
 * `fields` are more form fields for the request, such as `{ tag_audio_events: 'false' }`; `type`
 * is the audio's media type, `audio/mpeg` unless given.
 * @param {string | Uint8Array} file
 * @param {{ root?: string, key?: string, language?: string, type?: string, fields?: Record<string, string> }} [options]
 * @returns {Promise<{ heard: string, speechEnds: number, words: { text: string, start: number, end: number }[] }>}
 */
export async function transcribe(
  file,
  { language = 'eng', type = 'audio/mpeg', fields = {}, ...options } = {},
) {
  const form = new FormData()
  form.append('model_id', SCRIBE_MODEL)
  form.append('language_code', language)
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  const bytes = typeof file === 'string' ? fs.readFileSync(path.resolve(file)) : file
  form.append(
    'file',
    new Blob([/** @type {Uint8Array<ArrayBuffer>} */ (bytes)], { type }),
    'take.mp3',
  )
  const r = await call('POST', '/v1/speech-to-text', form, options)
  /** @type {{ text: string, type: string, start: number, end: number }[]} */
  const spoken = r.words.filter((/** @type {{ type: string }} */ w) => w.type === 'word')
  return {
    heard: r.text.trim(),
    speechEnds: spoken.at(-1)?.end ?? 0,
    words: spoken.map((w) => ({ text: w.text, start: w.start, end: w.end })),
  }
}
