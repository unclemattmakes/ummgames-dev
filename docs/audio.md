# Audio: loudness

`umm-dev loudness` meters audio files after ITU-R BS.1770-4: integrated loudness, true peak and
the loudest moment. It is how a game checks a mix, a music bed or a trailer's audio against a
target before it ships. It is **linked**: the command and the meter behind it run from
`node_modules`, and `@ummgames/dev/audio` exports the meter for a game's own tools. It needs
`ffmpeg` and `ffprobe` on `PATH`.

## Quick start

```sh
ffmpeg -v error -f lavfi -i "aevalsrc=0.1*sin(2*PI*1000*t)|0.1*sin(2*PI*1000*t):s=48000:d=10" tone.wav
pnpm exec umm-dev loudness tone.wav --target -20
```

A stereo 1 kHz sine at -20 dBFS reads -20 LUFS and -20 dBTP, and the command exits 0:

```
  LUFS   dBTP  M max  file
 -20.0  -20.0  -20.0  tone.wav
```

Under npm, run it with `npx umm-dev`.

## `umm-dev loudness`

```
umm-dev loudness <file...> [--target <LUFS>] [--tolerance <LU>] [--max-peak <dBTP>] [--json]
```

| Option | Value | Default | What it does |
|---|---|---|---|
| `--target` | LUFS | `loudness.target`, else none | The integrated loudness each file must be near. Web games sit about -16 to -14. With none, loudness is not checked. |
| `--tolerance` | LU | `loudness.tolerance`, else 1 | How far from the target counts as in range, either side. |
| `--max-peak` | dBTP | `loudness.maxPeak`, else none | The highest true peak allowed; -1 is the usual ceiling. With none, the peak is not checked. |
| `--json` | | off | Print one JSON array, a row per file, instead of the table. |
| `-h`, `--help` | | | Print the usage. |

A negative value works either way: `--target -16` or `--target=-16`.

| Column | What it is |
|---|---|
| **LUFS** | Integrated loudness. 400 ms blocks every 100 ms, K-weighted; blocks under -70 LUFS are dropped, then blocks more than 10 LU under the mean of the rest. Silence and quiet tails do not pull it down. |
| **dBTP** | True peak: each gap between samples interpolated at 4x (2x from 96 kHz, none from 192 kHz), so it catches the overs that a sample peak misses. |
| **M max** | Momentary max: the loudest 400 ms. |

A file out of range gets a line under it:

```
  LUFS   dBTP  M max  file
 -20.0  -20.0  -20.0  audio/tone-20.wav
                     out of range: integrated -20.0 LUFS is not -16 ±1
 -16.0  -16.0  -16.0  audio/tone-16.wav
                     out of range: true peak -16.0 dBTP is over -18
```

**Exit codes.**

| Code | When |
|---|---|
| 0 | Every file was measured and is in range (or nothing was checked). |
| 1 | Some file is out of range. Silence, and any file under 400 ms, is out of range of every target. |
| 2 | A usage error (no file, a flag that is not a number), or ffprobe or ffmpeg could not read a file. Nothing is printed for the files before it. |

### Examples

```sh
umm-dev loudness music/*.ogg                                       # meter only
umm-dev loudness trailer.wav --target -14 --tolerance 1 --max-peak -1
umm-dev loudness mix.wav --json
```

## `@ummgames/dev/audio`

The meter behind the command, for a tool that has samples already, or that meters a file from a
script. `measure` and `createMeter` have no dependencies; `meterFile` and `probe` run ffmpeg.

```js
import { createMeter, measure, meterFile } from '@ummgames/dev/audio'

const fromFile = await meterFile('music/day.ogg')            // decodes with ffmpeg
const fromBuffers = measure([left, right], 48000)            // one Float32Array per channel
const meter = createMeter({ sampleRate: 48000, channels: 2 }) // streaming
meter.push(interleavedChunk)
const result = meter.result()                                 // once; then make a new meter
```

| Export | What it does |
|---|---|
| `meterFile(file, bins?)` | Decode the file's first audio stream and meter it. `bins` names the `ffmpeg` and `ffprobe` executables. Rejects when either fails. |
| `probe(file, bins?)` | The first audio stream's `sampleRate` and `channels`, from ffprobe. Rejects with `<file>: no audio stream` when there is none. |
| `measure(chans, sampleRate)` | Meter whole buffers at once. |
| `createMeter({ sampleRate, channels })` | A streaming meter: `push(interleaved)` in chunks of any size, then `result()` once. |
| `kWeightingFilters(sampleRate)` | The two K-weighting biquads for a sample rate. |
| `lufs(meanSquare)` | LUFS from a mean square: `-0.691 + 10 log10(ms)`. |
| `TRUE_PEAK_TAPS` | Taps per phase of the true-peak interpolator (48). |

Every result is a `Loudness`: `integrated`, `momentaryMax`, `shortTermMax` (the loudest 3 s),
`truePeak`, `samplePeak`, `seconds`, `sampleRate` and `channels`. LUFS and dB values are
`-Infinity` for silence.

## Config: `loudness`

In the game's `umm-dev.config.mjs`. The command line overrides each key.

```js
import { defineConfig } from '@ummgames/dev'

export default defineConfig({ loudness: { target: -16, tolerance: 1, maxPeak: -1 } })
```

| Key | Type | Default | What it does |
|---|---|---|---|
| `target` | number, or `null` | `null` | The integrated LUFS each file must be near. `null` checks nothing. |
| `tolerance` | number | 1 | LU either side of `target` that count as in range. |
| `maxPeak` | number, or `null` | `null` | The highest true peak allowed, dBTP. `null` checks nothing. |

The values must be numbers, not strings. A configured target cannot be cleared from the command
line; give another `--target` instead.

## File formats

**Input.** Any file ffmpeg can decode: wav, ogg, mp3, m4a, a video's soundtrack. Only the first
audio stream is metered, at its own sample rate and channel count.

**`--json` output.** One array, a row per file, in the order given:

```json
[
  {
    "file": "tone.wav",
    "integrated": -19.993203182819908,
    "momentaryMax": -19.993200092926944,
    "shortTermMax": -19.993200092927115,
    "truePeak": -19.999469871546843,
    "samplePeak": -19.999469871546843,
    "seconds": 10,
    "sampleRate": 48000,
    "channels": 2,
    "ok": true,
    "problems": []
  }
]
```

`-Infinity` is `null` there. `problems` holds the same text as the table's `out of range` lines.

## How it works

- **Decoding.** `ffprobe` reads the file's sample rate and channel count, and `ffmpeg` decodes it
  to 32-bit float at that rate. Nothing is resampled or remixed, so the true peak is the file's
  own. The samples stream through the meter, so memory stays flat however long the file is.
- **K-weighting.** The standard's two filters, a high shelf and then a highpass, designed for the
  file's sample rate. At 48 kHz they match the standard's coefficient table.
- **Channels.** Up to three channels each weigh 1. From four, the order is taken as L R C LFE Ls
  Rs: the LFE weighs 0, the surrounds 1.41, and any channel past the sixth 1. A mono file is one
  channel, so a 0 dBFS 1 kHz sine reads -3.01 LUFS, as the standard says. The same sine in both
  channels of a stereo file reads 0.
- **Checks.** The tests check the meter against signals with known answers (a 1 kHz sine at
  -20 dBFS, silence, a quarter-rate sine whose samples all miss its crest). The slow test checks
  it against ffmpeg's own `ebur128` filter on pink noise: within 0.1 LU and 0.2 dB.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `umm-dev loudness: spawn ffprobe ENOENT` | ffmpeg is not installed, or not on `PATH`. | Install ffmpeg (it brings ffprobe) and put it on `PATH`. |
| `umm-dev loudness: Command failed: ffprobe ... <file>: No such file or directory` | The path is wrong. | Check the path; quote it if it has spaces. |
| `umm-dev loudness: <file>: no audio stream` | The file has no audio. | Meter a file with sound. |
| `-inf` in every LUFS column of a short file. | It is under 400 ms, so it has no block to measure. | Meter short sounds without a target, and read the dBTP column. |
| `umm-dev loudness: --target needs a number`, with no `--target` given. | `loudness.target` in the config is a string. | Write it as a number: `target: -16`. |
| A file reads 3 dB quieter than expected. | It is mono, or a mono source upmixed at -3 dB. | Expected: BS.1770 sums channels. Meter the file as it ships. |

## For agents

- **Read the exit code.** 1 means a file is out of range; 2 means nothing was
  judged.
- **Use `--json` to read values.** It gives full precision and `null` for silence.
- **Keep the targets in `umm-dev.config.mjs`,** so every run checks the same thing. Do not
  change a target to make a file pass; report the file.
- **Never edit `node_modules/@ummgames/dev`.** Report a meter bug upstream.
