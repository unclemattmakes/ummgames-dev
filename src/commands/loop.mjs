// @ts-check
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadConfig } from '../config.mjs'
import { cutEdl } from '../media/cut.mjs'
import { LOOP_DEFAULTS, makeLoop } from '../media/loop.mjs'
import { guard, parse, readJson, rel, UsageError } from '../media/util.mjs'

export const describe = 'make a site loop: a silent 720p faststart mp4 and a poster (docs/media.md)'

const USAGE = `usage: umm-dev loop <video.mp4 | edl.json> [options]

The loop a games site shows on a card: a silent H.264 mp4 with its long edge capped (never
upscaled) and +faststart, and <stem>.poster.webp beside it, the clip's most detailed sampled
frame. Give it a cut or a store preview, or an edit list to cut first.

options:
  --out <dir>        output folder (default loop.out: ${LOOP_DEFAULTS.out})
  --name <stem>      output file stem (default the input's)
  --edge <px>        long edge cap (default ${LOOP_DEFAULTS.edge})
  --crf <n>          x264 CRF (default ${LOOP_DEFAULTS.crf})
  --poster <fmt>     webp or jpg (default ${LOOP_DEFAULTS.posterFormat})
  --poster-at <s>    take the poster at this time instead of sampling

umm-dev.config.mjs, section loop: out, edge, crf, posterFormat, posterQuality, samples, posterAt.`

/** @param {string[]} argv @param {{ cwd: string }} ctx */
export async function run(argv, ctx) {
  return guard(USAGE, async () => {
    const { values: o, positionals } = parse(argv, {
      help: { type: 'boolean', short: 'h' },
      out: { type: 'string' },
      name: { type: 'string' },
      edge: { type: 'string' },
      crf: { type: 'string' },
      poster: { type: 'string' },
      'poster-at': { type: 'string' },
    })
    if (o.help) {
      console.log(USAGE)
      return 0
    }
    if (positionals.length !== 1) throw new UsageError('name one video (.mp4) or edit list (.json)')
    const cfg = await loadConfig('loop', LOOP_DEFAULTS, ctx.cwd)
    const n = (/** @type {string | undefined} */ v, /** @type {string} */ flag) => {
      if (v == null) return undefined
      const x = Number(v)
      if (!Number.isFinite(x) || x < 0) throw new UsageError(`${flag} must be a number`)
      return x
    }
    if (o.poster != null && o.poster !== 'webp' && o.poster !== 'jpg')
      throw new UsageError('--poster must be webp or jpg')
    const opts = {
      ...cfg,
      out: o.out ? path.resolve(ctx.cwd, o.out) : cfg.out,
      edge: n(o.edge, '--edge') ?? cfg.edge,
      crf: n(o.crf, '--crf') ?? cfg.crf,
      posterFormat: /** @type {'webp' | 'jpg'} */ (o.poster ?? cfg.posterFormat),
      posterAt: n(o['poster-at'], '--poster-at') ?? cfg.posterAt,
      name: o.name,
    }
    let input = path.resolve(ctx.cwd, positionals[0])
    /** @type {string | null} */
    let tmp = null
    if (input.toLowerCase().endsWith('.json')) {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'umm-dev-loop-'))
      const edl = readJson(input)
      const cut = path.join(tmp, `${path.basename(input, '.json')}.mp4`)
      cutEdl({ ...edl, out: cut }, { root: cfg.root })
      input = cut
    }
    try {
      const r = makeLoop(input, opts)
      console.log(`wrote ${rel(cfg.root, r.mp4)} (${r.mb.toFixed(2)} MB)`)
      console.log(`wrote ${rel(cfg.root, r.poster)} (from ${r.posterAt.toFixed(2)} s)`)
    } finally {
      if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
    }
    return 0
  })
}
