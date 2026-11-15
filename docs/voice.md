# Voice: takes, bins and the player

A game's voice comes in two halves, and the kit has both.

- **The tools** (`@ummgames/dev/voice`) design voices, read lines, sing jingles, check each take
  by its transcript and ship the takes into the game. They are **linked**: a game's own
  `tools/*.mjs` imports them from `node_modules`, and nothing in them ships in a build. What a
  game voices, and in which voice, stays in the game's own script. The ElevenLabs parts need a
  key; the cuts need `ffmpeg` and `ffprobe` on `PATH`.
- **The player** (`runtime/audio/voice.ts`) says the shipped lines in the page. It is
  **copied**: `umm-dev copy audio/voice.ts` stamps it into the game (to `src/audio/voice.ts`),
  and from then on the copy is the game's ([runtime.md](runtime.md)).

The two meet in one format: each speaker's pieces laid end to end in a **bin**, and a **cues**
list giving each line's bin, byte offset `o` and length `n`. `packBins` writes it; `VoicePlayer`
reads it.

## Quick start

A tool records a line until a take is clean, then ships every take into bins:

```js
// tools/voice.mjs
import { writeFileSync } from 'node:fs'
import {
  bestTake,
  call,
  cut,
  misses,
  packBins,
  SPEECH_MODEL,
  takeKey,
  transcribe,
  writeBins,
} from '@ummgames/dev/voice'

const voice = '<a voice id>'
const text = 'The clock stopped at nine forty.'
const key = takeKey(voice, SPEECH_MODEL, text)
const best = await bestTake(
  [101, 202, 303],
  async (seed) => {
    const file = `voice/takes/${key}-${seed}.mp3`
    writeFileSync(file, await call('POST', `/v1/text-to-speech/${voice}`, { text, model_id: SPEECH_MODEL, seed }))
    return { file, t: await transcribe(file) }
  },
  ({ t }) => misses(text, t.heard),
)
const { file, t } = best.made
const bytes = cut(file, t.words[0].start - 0.04, t.speechEnds + 0.18)
const { bins, cues } = packBins([{ bin: 'host.bin', key: `host|${text}`, bytes, secs: cut.seconds }])
writeBins('public/voice', bins, { clear: true })
writeFileSync('src/voice-cues.json', `${JSON.stringify(cues, null, 1)}\n`)
```

The page says it, once sound is on:

```ts
import CUES from './voice-cues.json'
import { VoiceBins, VoicePlayer } from './audio/voice'

const bins = new VoiceBins((bin) => `${import.meta.env.BASE_URL}voice/${bin}`)
void bins.load('host.bin') // needs no click: start it with the title
// on the first click or key:
const ctx = new AudioContext()
const voice = new VoicePlayer({ ctx, out: ctx.destination, bins })
const cue = CUES['host|The clock stopped at nine forty.']
if (cue) void voice.say(cue.bin, cue, { label: 'host: the clock' })
```

## The key

`ELEVENLABS_API_KEY` is read, in this order, from:
1. the environment;
2. `.env.local` at the game's root (where `elevenlabs onboard connect` puts it; keep it
   gitignored, and Vite exposes only `VITE_` names to a page);
3. on Windows, the user's saved variables (`HKCU\Environment`), so a key set after the shell
   started still works.

**The key is never printed.** An error names the route and the status, never the key.

## Tool exports

### Requests and transcripts

| Export | What it does |
|---|---|
| `call(method, route, body?, { root?, key? })` | One request to `https://api.elevenlabs.io` + `route`. An object body goes as JSON, a `FormData` as a form. A JSON reply is parsed; audio or a zip comes back as a `Buffer`. A 429 is retried after 2, 4, 8, 16, 32 and 64 s, then thrown; any other error status throws `METHOD route: status text`. |
| `apiKey({ root?, env?, platform? })` | The key, as above. `root` defaults to the game's root. |
| `transcribe(file, { language?, type?, fields? })` | Scribe's transcript of a take: `{ heard, speechEnds, words }`, each word with `start` and `end` in seconds. `file` is a path or the audio's bytes, such as a piece read from a bin. `language` defaults to `eng`, `type` to `audio/mpeg` and `name`, the file name sent, to `take.mp3`. `fields` are more form fields for the request, such as `{ tag_audio_events: 'false' }`. |
| `inPool(items, n, f)` | Runs `f` over `items`, at most `n` at once. Rejects on the first failure. |
| `DESIGN_MODEL`, `SPEECH_MODEL`, `SCRIBE_MODEL` | `eleven_ttv_v3`, `eleven_v3`, `scribe_v2`. |

### Checking a take

| Export | What it does |
|---|---|
| `wordsOf(text)` | A line as one string of capitals and digits, to compare the text asked for with the text heard. A lone digit is its word, `N'` is AND, a dot before `.com`, `.net`, `.org`, `.tv`, `.io`, `.gg`, `.app` or `.dev` is DOT, and other punctuation goes. A game that says a name its own way changes the text before this. |
| `wordList(text, alike?)` | The same words as a list. An apostrophe joins its word (`we'll` is `WELL`); any other mark splits. `alike` maps a word as heard to the word it stands for, such as `{ GREY: 'GRAY' }`. |
| `misses(want, heard, { alike? })` | How many words a take got wrong: the word-level edit distance between the two `wordList`s. 0 is a clean take. A game with its own spoken forms (a time said as words) changes both texts the same way first. |
| `takeKey(...parts)` | 16 hex digits of the SHA-256 of `parts` as JSON. Pass everything that changes a take (voice, model, settings, words said, seed): a recast or reworded line gets a new key, so its old take shows as stale. |
| `bestTake(seeds, take, judge)` | Makes a take with each seed in turn (`take(seed)`, returning anything), scores it (`judge(made, seed)`, its misses), and stops at the first 0. Returns `{ seed, made, miss, tried }`: the fewest misses, the earliest seed on a tie, and every take tried. Throws on an empty `seeds`. Run lines side by side with `inPool`. |

### Cutting and shipping

| Export | What it does |
|---|---|
| `cut(src, from, to, filters?, options?)` | Cuts `from` to `to` seconds of a take to a mono mp3 piece, faded in over 0.006 s and out over 0.012 s, and returns its bytes. `filters` are ffmpeg audio filters run after the fades, such as a speaker's board, `silenceremove` or `loudnorm`. `cut.seconds` is then the piece's length. Options: `rate` (22050), `bitrate` (`32k`), `ffmpeg`, `ffprobe`. |
| `packBins(pieces, { bin? })` | Packs pieces `{ bin, key, bytes, ...rest }` one bin a speaker, in the order given. Returns `{ bins, cues }`: each bin's bytes, and for each `key` the cue `{ bin, o, n, ...rest }`. Anything else on a piece (its length in ticks, where its words end as `end`) stays on its cue. With `bin: false` a cue leaves its bin out, for cues that name each speaker's bin once elsewhere. A key given twice throws. |
| `writeBins(dir, bins, { clear? })` | Writes the bins into `dir`, made if missing, and returns the files. With `clear`, every other `.bin` in `dir` goes first, so a speaker cut from the cast leaves no stale bin. |
| `soundEnds(file, { db?, window? })` | Seconds to where a take's sound ends: the end of the last 0.05 s window over -60 dBFS (RMS, the louder channel). 0 for silence. |
| `shipSung(src, dest, { bitrate?, trim? })` | Ships a sung take: encodes it to `dest` at `96k` and returns `{ file, seconds }`, `seconds` being where its sound ends, for the game to time the take by. With `trim: true` the file is cut there too. |

## The player: `runtime/audio/voice.ts`

```sh
pnpm exec umm-dev copy audio/voice.ts   # to src/audio/voice.ts
```

**Exports:** `VoiceBins`, `VoicePlayer`, `voicePlan(pieces, options?)`, `voiceDue(track, from, to)`,
the constants `VOICE_LATE` (0.5), `VOICE_CUT` (0.06), `VOICE_SPLICE` (0.03) and `VOICE_KEEP` (40),
and the types `VoicePiece`, `VoiceOutcome`, `VoicePart`, `VoiceContext`, `VoiceLine`,
`VoiceSchedule`, `VoicePlayerOptions`, `VoiceSayOptions`. It imports nothing.

| Member | What it does |
|---|---|
| `new VoiceBins(url, fetcher?, onError?)` | Where the bins are: `url(bin)` is each bin's address. `fetcher` defaults to `fetch`. `onError(bin, reason)` hears a bin that will not load, such as to warn in the console; without it the failure is silent. |
| `bins.load(bin)` | The bin's bytes, fetched once and shared; `null` when it will not load. Needs no click, so start it as the title comes up. |
| `bins.has(bin)` | Whether the bin has arrived. |
| `new VoicePlayer(options)` | A player on `options.ctx`, into `options.out`. Options below. |
| `voice.say(bin, pieces, options?)` | Says one piece, or several spliced as one line. Resolves with the outcome: `said`, `late`, `cut` or `failed`. Never rejects. |
| `voice.decode(bin, piece)` | A piece decoded, from the cache when it is there. For a game that schedules sound of its own from the same takes. |
| `voice.hush(fade?)` | Fades every line, overlaps too, over `fade` seconds (default `cut`). A line still decoding, overlap or not, then never starts: it resolves `cut`. |
| `voice.until()` | When the line on the floor ends, on the context's clock; 0 when nothing holds it. |
| `voice.sounding` | Lines still sounding, overlaps too. |
| `voice.forget()` | Drops every decoded piece, such as after the board changes. |
| `voice.log` | Every outcome, in order, as `<outcome>:<label>`, for a game's checks and debug panel. |
| `voicePlan(pieces, { rate?, splice?, offset? })` | Pure: when each piece of a line starts and how far into it, and when the line ends. |
| `voiceDue(track, from, to)` | Pure: the events `[tick, ...]` a clock passed from `from` (not reached) to `to` (reached), each with how many ticks late. |

**`VoicePlayerOptions`.**

| Option | Default | What it does |
|---|---|---|
| `ctx` | | The audio context, or anything with its `currentTime`, `createGain`, `createBufferSource`, `createBuffer` and `decodeAudioData`. |
| `out` | | Where lines go unless `say` names another node. |
| `bins` | | The `VoiceBins` to read from. |
| `keep` | 40 | Decoded pieces kept; the one used longest ago goes first. |
| `cut` | 0.06 | Seconds a line fades over when a newer one takes the floor. |
| `late` | 0.5 | Seconds late a line may start; later and it is dropped. |
| `splice` | 0.03 | Seconds between one spliced piece's words and the next piece. |
| `board` | none | `(ctx, buffer, bin) => buffer`, run once on each decoded piece before it is kept: a bit crusher baked into the samples. |
| `schedule` | spliced, through one gain | `(ctx, buffers, pieces, when, offset, into, data) => { gains, sources, ends }`: a game's own layout of a line, such as a bleep between pieces. `data` is what `say` was given as `data`. The player still keeps the floor, the cache and the late rule, and fades the gains it returns. The line holds the floor until `ends`, so return the end of its last sound, a trailing burst included. |

**`VoiceSayOptions`.**

| Option | Default | What it does |
|---|---|---|
| `label` | `<bin>:<o>` | How the line is written in `log`. |
| `late` | 0 | Seconds the line is already late when asked, such as ticks past its cue over the tick rate. Over `late` (the player's), it is dropped without loading. |
| `sync` | off | Start into the take by how late it is, so a line keeps time with a clock the whole audience shares. Off, a late line starts from its first word. |
| `overlap` | off | Talk over the floor: it neither fades the line there nor is faded by a newer one. `hush` still stops it. |
| `into` | `out` | Where this line goes, such as a speaker's chain or pan. |
| `rate` | 1 | Playback rate, for the default layout. |
| `delay` | 0 | Seconds after it is ready that the line starts. |
| `data` | none | Anything, handed to a game's own `schedule`, such as the line it lays out. |
| `onStart` | none | `({ when, ends })`, called as the line starts: when it starts and ends on the context's clock. For a game that times the next thing by this line. |

A piece in the cues is `{ o, n, end? }`. `end` is the second its words end, where a spliced next
piece comes in; without it the next piece comes in at the end of this one.

## How it works

- **One request path.** Every take goes through `call`, so the key is read in one place and a
  busy API slows a batch down instead of failing it.
- **Cuts run at once.** Each `cut` works in its own temporary folder, so takes can be cut inside
  `inPool`. `cut.seconds` belongs to the last call, so read it before the next one starts.
- **A sung take's end** is found in windows, not samples, so a lone click in the decoder's last
  frame is not counted as sound.
- **A take is judged by ear, then by words.** `bestTake` stops at the first take whose
  transcript matches; a fluffed take keeps going through the seeds and the closest one is kept,
  so the tool can list it for a listen or a retake.
- **The floor.** Each `say` that is not an overlap takes a turn. When its pieces are decoded it
  checks the turn: a newer line has taken it, so this one is `cut` and never sounds. Otherwise
  it checks how late it now is (the `late` it was asked with, plus the time it took to decode),
  drops itself as `late` past the limit, and only then fades the line on the floor and starts.
  So an old line keeps talking until the new one is ready, and a slow decode never plays a
  stale line. A line holds the floor until its `ends`, not until its last source stops, so a
  sound laid after the words is faded with the line.
- **Decoding.** A bin is fetched once. A piece is decoded from a copy of its bytes (decoding
  detaches what it is given), the first time a line says it, then kept in a cache of `keep`; a
  failed decode leaves the cache.
- **A missing bin** fails only its own lines; the rest of the game goes on.

## Adopting the player in a game

A game whose voice player was copied from another game's moves to the kit's in four steps:

1. `pnpm update @ummgames/dev`, then `pnpm exec umm-dev copy audio/voice.ts --dry-run`, then
   without `--dry-run`.
2. Ship cues the player reads: each line's cue `{ o, n }` with its bin named, by `packBins` in
   the tool's `ship`, or by keeping the game's own cues shape and passing `cue.bin` (or the
   speaker's bin) to `say`. The bytes in the bins do not change.
3. Replace the game's bin fetch, decode cache, fade and turn with `VoiceBins` and
   `VoicePlayer`. What stays the game's is what it decides: which line is due (`voiceDue` for a
   tick clock), its speaker's chain (`into`), its board (`board`), its rest between lines, and any
   layout of its own (`schedule`).
4. Keep the game's checks on `voice.log`: the outcomes are the same words a copied player used
   (`said`, `late`, `cut`, `failed`), with the game's own label after the colon.

**What maps where.**

| A game that has | Uses |
|---|---|
| Bins of whole lines, a new line fading the old, a late line dropped | `say(bin, cue, { late, sync: true })` from its frame loop, `hush()` on a new scene. |
| Lines spliced from pieces (a line with blanks filled at run time) | `say(bin, [piece, piece, ...])`, with `end` on each piece. A rest between lines, a held line or a mega moment that cuts in stays in the game, in front of `say`; `hush()` is the cut. |
| Reactions that talk over each other | `overlap: true`. |
| A board on decoded samples, a ring or a pan per speaker | `board` for the samples, `into` for the chain. |
| Bleeps where a censored word was | Its own `schedule`, which lays out the stretches and bursts and returns their gains. |

## Troubleshooting

| Symptom | Fix |
|---|---|
| `No ELEVENLABS_API_KEY in the environment, .env.local or the user variables.` | Set the key in one of the three places. On Windows a variable set after the shell started is read from the registry. |
| `POST /v1/...: 401 ...` | The key is wrong or revoked. |
| `POST /v1/...: 429 ...` | The API stayed busy for two minutes. Run fewer at once in `inPool`. |
| `ffmpeg could not read <file>` | The file is missing or not audio, or `ffmpeg` is not on `PATH`. |
| Every line logs `failed:` | The bin did not load: check `url(bin)` against where the game serves `public/voice/`, and that `ship` ran. |
| Every line logs `late:` | The `late` passed in is in ticks, not seconds, or the bins load after the lines are due: call `bins.load` with the title. |
| Lines log `cut:` in a burst | Lines are asked for faster than they decode. Expected when a scene skips ahead; otherwise ask only the line that is due. |
| Nothing sounds, and nothing is logged | `say` was never called: the context is made only after a click or a key. |

## For agents

- Import the tools from `@ummgames/dev/voice`; never copy these helpers into a game's tools.
- Take the player with `umm-dev copy audio/voice.ts`; never copy it from another game.
- A path is resolved against the working directory. Pass an absolute path from a script that
  may run from elsewhere.
- Never print, log or commit the key. A transcript that differs from the text asked for is a
  fluffed take: retake it with another seed, do not ship it.
- `record` and `retake` in a game's tool are paid requests. `plan`, `check` and `ship` are not.
