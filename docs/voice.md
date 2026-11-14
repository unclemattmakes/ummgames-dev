# Voice: ElevenLabs takes and cuts

`@ummgames/dev/voice` is the shared half of a game's voice tools: the scripts that design voices,
read lines, sing jingles and ship the takes into the game. It is **linked**: a game's own
`tools/*.mjs` imports it from `node_modules`, and nothing in it ships in a build. What each game
voices, and in which voice, stays in the game's own script. The ElevenLabs parts need a key; the
cuts need `ffmpeg` and `ffprobe` on `PATH`.

## Quick start

```js
// tools/spot-voice.mjs
import { call, cut, inPool, SPEECH_MODEL, transcribe, wordsOf } from '@ummgames/dev/voice'
import { writeFileSync } from 'node:fs'

const voiceId = '<a voice saved on the account>'
const text = 'Now with twenty percent more air!'
const bytes = await call('POST', `/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
  text,
  model_id: SPEECH_MODEL,
  seed: 101,
})
writeFileSync('voice/take.mp3', bytes)
const take = await transcribe('voice/take.mp3')
if (wordsOf(take.heard) !== wordsOf(text)) console.log(`DIFF: "${take.heard}"`)
const piece = cut('voice/take.mp3', take.words[0].start - 0.03, take.speechEnds + 0.2)
console.log(`${piece.length} bytes, ${cut.seconds} s`)
```

## The key

`ELEVENLABS_API_KEY` is read, in this order, from:
1. the environment;
2. `.env.local` at the game's root (where `elevenlabs onboard connect` puts it; keep it
   gitignored, and Vite exposes only `VITE_` names to a page);
3. on Windows, the user's saved variables (`HKCU\Environment`), so a key set after the shell
   started still works.

**The key is never printed.** An error names the route and the status, never the key.

## Exports

| Export | What it does |
|---|---|
| `call(method, route, body?, { root?, key? })` | One request to `https://api.elevenlabs.io` + `route`. An object body goes as JSON, a `FormData` as a form. A JSON reply is parsed; audio or a zip comes back as a `Buffer`. A 429 is retried after 2, 4, 8, 16, 32 and 64 s, then thrown; any other error status throws `METHOD route: status text`. |
| `apiKey({ root?, env?, platform? })` | The key, as above. `root` defaults to the game's root. |
| `transcribe(file, { language? })` | Scribe's transcript of an mp3: `{ heard, speechEnds, words }`, each word with `start` and `end` in seconds. `language` defaults to `eng`. |
| `wordsOf(text)` | A line as capitals and digits, to compare the text asked for with the text heard. A lone digit is its word, `N'` is AND, a dot before `.com`, `.net`, `.org`, `.tv`, `.io`, `.gg`, `.app` or `.dev` is DOT, and other punctuation goes. A game that says a name its own way changes the text before this. |
| `inPool(items, n, f)` | Runs `f` over `items`, at most `n` at once. Rejects on the first failure. |
| `cut(src, from, to, filters?, options?)` | Cuts `from` to `to` seconds of a take to a mono mp3 piece, faded in over 0.006 s and out over 0.012 s, and returns its bytes. `filters` are ffmpeg audio filters run after the fades, such as `silenceremove` and `atempo`. `cut.seconds` is then the piece's length. Options: `rate` (22050), `bitrate` (`32k`), `ffmpeg`, `ffprobe`. |
| `soundEnds(file, { db?, window? })` | Seconds to where a take's sound ends: the end of the last 0.05 s window over -60 dBFS (RMS, the louder channel). 0 for silence. |
| `shipSung(src, dest, { bitrate?, trim? })` | Ships a sung take: encodes it to `dest` at `96k` and returns `{ file, seconds }`, `seconds` being where its sound ends, for the game to time the take by. With `trim: true` the file is cut there too. |
| `DESIGN_MODEL`, `SPEECH_MODEL`, `SCRIBE_MODEL` | `eleven_ttv_v3`, `eleven_v3`, `scribe_v2`. |

## How it works

- **One request path.** Every take goes through `call`, so the key is read in one place and a
  busy API slows a batch down instead of failing it.
- **Cuts run at once.** Each `cut` works in its own temporary folder, so takes can be cut inside
  `inPool`. `cut.seconds` belongs to the last call, so read it before the next one starts.
- **A sung take's end** is found in windows, not samples, so a lone click in the decoder's last
  frame is not counted as sound.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `No ELEVENLABS_API_KEY in the environment, .env.local or the user variables.` | Set the key in one of the three places. On Windows a variable set after the shell started is read from the registry. |
| `POST /v1/...: 401 ...` | The key is wrong or revoked. |
| `POST /v1/...: 429 ...` | The API stayed busy for two minutes. Run fewer at once in `inPool`. |
| `ffmpeg could not read <file>` | The file is missing or not audio, or `ffmpeg` is not on `PATH`. |

## For agents

- Import from `@ummgames/dev/voice`; never copy these helpers into a game's tools.
- A path is resolved against the working directory. Pass an absolute path from a script that
  may run from elsewhere.
- Never print, log or commit the key. A transcript that differs from the text asked for is a
  fluffed take: retake it with another seed, do not ship it.
