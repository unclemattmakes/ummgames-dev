// @ts-check
/**
 * `umm-dev loudness <file...> [--target <LUFS>] [--tolerance <LU>] [--max-peak <dBTP>] [--json]`
 *
 * Meters each file after BS.1770 (integrated LUFS, true peak, momentary max) and, given a
 * target, exits 1 when any file is outside it. Needs ffmpeg and ffprobe on PATH. See
 * docs/audio.md.
 */
import { parseArgs } from 'node:util'
import { meterFile } from '../audio/decode.mjs'
import { loadConfig } from '../config.mjs'

export const describe = 'meter audio files: integrated LUFS, true peak, momentary max'

const HELP = `usage: umm-dev loudness <file...> [--target <LUFS>] [--tolerance <LU>] [--max-peak <dBTP>] [--json]

  --target <LUFS>    integrated loudness each file must be near; none: not checked
                     (web games: about -16 to -14)
  --tolerance <LU>   how far from the target is in range, either side (default 1)
  --max-peak <dBTP>  the highest true peak allowed (say -1); none: not checked
  --json             one JSON array, a row per file (-inf as null)
  defaults come from the game's umm-dev.config.mjs: loudness: { target, tolerance, maxPeak }

Needs ffmpeg and ffprobe on PATH. Silence, and a file under 400 ms, read -inf LUFS.

exit: 0 measured and in range; 1 a file out of range; 2 usage, or ffmpeg could not read a file`

const NUMERIC = new Set(['--target', '--tolerance', '--max-peak'])

/**
 * `--target -16` as `--target=-16`: parseArgs reads a value starting with a dash as an option.
 * @param {string[]} argv
 */
function joinNumbers(argv) {
  /** @type {string[]} */
  const out = []
  for (let i = 0; i < argv.length; i++) {
    const a = /** @type {string} */ (argv[i])
    const next = argv[i + 1]
    if (NUMERIC.has(a) && next !== undefined) {
      out.push(`${a}=${next}`)
      i++
    } else out.push(a)
  }
  return out
}

/** @param {number} v */
const fmt = (v) => (Number.isFinite(v) ? v.toFixed(1).padStart(6) : '  -inf')

/**
 * @param {string[]} argv
 * @param {{ cwd: string }} ctx
 */
export async function run(argv, ctx) {
  /** @type {{ values: Record<string, string | boolean | undefined>, positionals: string[] }} */
  let args
  try {
    args = parseArgs({
      args: joinNumbers(argv),
      allowPositionals: true,
      options: {
        target: { type: 'string' },
        tolerance: { type: 'string' },
        'max-peak': { type: 'string' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    })
  } catch (e) {
    console.error(`umm-dev loudness: ${e instanceof Error ? e.message : e}\n\n${HELP}`)
    return 2
  }
  const { values, positionals } = args
  if (values.help) {
    console.log(HELP)
    return 0
  }
  if (positionals.length === 0) {
    console.error(`umm-dev loudness: name at least one file\n\n${HELP}`)
    return 2
  }
  const cfg = await loadConfig(
    'loudness',
    /** @type {{ target: number | null, tolerance: number, maxPeak: number | null }} */ ({
      target: null,
      tolerance: 1,
      maxPeak: null,
    }),
    ctx.cwd,
  )
  /** @param {unknown} v @param {number | null} d */
  const num = (v, d) => (v === undefined ? d : Number(v))
  const target = num(values.target, cfg.target)
  const tolerance = num(values.tolerance, cfg.tolerance) ?? 1
  const maxPeak = num(values['max-peak'], cfg.maxPeak)
  for (const [name, v] of [
    ['--target', target],
    ['--tolerance', tolerance],
    ['--max-peak', maxPeak],
  ])
    if (v !== null && !Number.isFinite(v)) {
      console.error(`umm-dev loudness: ${name} needs a number`)
      return 2
    }

  const rows = []
  let failed = false
  for (const file of positionals) {
    try {
      const m = await meterFile(file)
      /** @type {string[]} */
      const problems = []
      if (target !== null && !(Math.abs(m.integrated - target) <= tolerance))
        problems.push(`integrated ${fmt(m.integrated).trim()} LUFS is not ${target} ±${tolerance}`)
      if (maxPeak !== null && m.truePeak > maxPeak)
        problems.push(`true peak ${fmt(m.truePeak).trim()} dBTP is over ${maxPeak}`)
      if (problems.length) failed = true
      rows.push({ file, ...m, ok: problems.length === 0, problems })
    } catch (e) {
      console.error(`umm-dev loudness: ${e instanceof Error ? e.message : e}`)
      return 2
    }
  }

  if (values.json) {
    /** @param {unknown} v */
    const finite = (v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v)
    console.log(
      JSON.stringify(
        rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, finite(v)]))),
        null,
        2,
      ),
    )
  } else {
    console.log('  LUFS   dBTP  M max  file')
    for (const r of rows) {
      console.log(`${fmt(r.integrated)} ${fmt(r.truePeak)} ${fmt(r.momentaryMax)}  ${r.file}`)
      for (const p of r.problems) console.log(`                     out of range: ${p}`)
    }
  }
  return failed ? 1 : 0
}
