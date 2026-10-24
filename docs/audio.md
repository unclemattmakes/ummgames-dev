# Audio: loudness

`umm-dev loudness` meters audio files after ITU-R BS.1770-4. It is how a game checks a mix, a
music bed or a trailer's audio against a target before it ships.

```sh
umm-dev loudness music/*.ogg
umm-dev loudness trailer.wav --target -14 --tolerance 1 --max-peak -1
umm-dev loudness mix.wav --json
```

```
  LUFS   dBTP  M max  file
 -15.2   -1.4  -11.9  music/day.ogg
 -19.8   -6.0  -16.0  music/night.ogg
                     out of range: integrated -19.8 LUFS is not -16 ±1
```

| Column | What it is |
|---|---|
| **LUFS** | Integrated loudness. 400 ms blocks every 100 ms, K-weighted; blocks under -70 LUFS are dropped, then blocks more than 10 LU under the mean of the rest. Silence and quiet tails do not pull it down. |
| **dBTP** | True peak: each gap between samples interpolated at 4x (2x at 96 kHz and up), so it catches the overs that a sample peak misses. |
| **M max** | Momentary max: the loudest 400 ms. |

`--json` adds `shortTermMax` (the loudest 3 s), `samplePeak`, `seconds`, `sampleRate`, `channels`
and the problems found. `-inf` is `null` there.

| Option | Effect |
|---|---|
| `--target <LUFS>` | The integrated loudness each file must be near. Web games sit about -16 to -14. |
| `--tolerance <LU>` | How far from the target counts as in range. Default 1. |
| `--max-peak <dBTP>` | The highest true peak allowed; -1 is the usual ceiling. |
| `--json` | One JSON array, a row per file. |

The defaults can live in the game's `umm-dev.config.mjs`; the command line overrides them:

```js
export default defineConfig({ loudness: { target: -16, tolerance: 1, maxPeak: -1 } })
```

**Exit codes:** 0 when every file was measured and is in range; 1 when a file is out of range
(silence is out of range of any target); 2 on a usage error, or when ffmpeg cannot read a file.

## How it measures

- **Decoding.** `ffprobe` reads the file's sample rate and channel count, and `ffmpeg` decodes it
  to 32-bit float at that rate. Nothing is resampled or remixed, so the true peak is the
  file's own. The samples stream through the meter, so memory stays flat however long the
  file is.
- **K-weighting.** The standard's two filters, a high shelf and then a highpass, designed for the
  file's sample rate. At 48 kHz they match the standard's coefficient table.
- **Channels.** Each channel weighs 1, except the surrounds (1.41) and the LFE (0), in the order
  L R C LFE Ls Rs. A mono file is one channel, so a 0 dBFS 1 kHz sine reads -3.01 LUFS, as the
  standard says. The same sine in both channels of a stereo file reads 0.
- **Checks.** The tests check the meter against signals with known answers (a 1 kHz sine at
  -20 dBFS, silence, a quarter-rate sine whose samples all miss its crest). The slow test checks
  it against ffmpeg's own `ebur128` filter on pink noise: within 0.1 LU and 0.2 dB.

Needs `ffmpeg` and `ffprobe` on `PATH`. The meter itself is `src/audio/meter.mjs`
(`createMeter`, `measure`), with no dependencies, for a tool that has samples already.
