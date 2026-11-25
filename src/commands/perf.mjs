// @ts-check
/**
 * `umm-dev perf top <profile.cpuprofile> [n] [--json]`
 *
 * Sums a CPU profile's self time by function and prints the top ones. See docs/perf.md.
 */
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { formatTop, selfTime } from '../perf/profile.mjs'

export const describe = 'read perf captures: a CPU profile summed by function'

const HELP = `usage: umm-dev perf top <profile.cpuprofile> [n] [--json]

  top       sum a .cpuprofile's self time by function and print the top n (default 20):
            share of the profile, milliseconds, function, file and line. Chrome's own
            entries, (program), (idle) and (garbage collector), have no file
    --json  every row as JSON: { totalMs, rows: [{ key, functionName, url, line, ms, share }] }

  A profile comes from Chrome's Profiler.stop (cpuProfile() in @ummgames/dev/testing writes
  one) or from DevTools' Performance panel, saved as .cpuprofile.

exit: 0 printed; 1 the file is missing or not a CPU profile; 64 usage`

/**
 * @param {string[]} argv
 * @param {{ cwd: string }} ctx
 */
export async function run(argv, ctx) {
  /** @type {{ values: Record<string, string | boolean | undefined>, positionals: string[] }} */
  let args
  try {
    args = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
    })
  } catch (e) {
    console.error(`umm-dev perf: ${/** @type {Error} */ (e).message}\n\n${HELP}`)
    return 64
  }
  if (args.values.help) {
    console.log(HELP)
    return 0
  }
  const [sub, file, count, ...extra] = args.positionals
  if (sub !== 'top' || !file || extra.length > 0) {
    console.error(HELP)
    return 64
  }
  const n = count === undefined ? 20 : Number(count)
  if (!Number.isInteger(n) || n < 1) {
    console.error(`umm-dev perf top: n must be a whole number from 1, not ${count}`)
    return 64
  }
  const at = path.resolve(ctx.cwd, file)
  /** @type {{ rows: import('../perf/profile.mjs').SelfTimeRow[], totalMs: number }} */
  let summed
  try {
    summed = selfTime(JSON.parse(fs.readFileSync(at, 'utf8')))
  } catch (e) {
    console.error(`umm-dev perf top: ${file}: ${/** @type {Error} */ (e).message}`)
    return 1
  }
  if (args.values.json) console.log(JSON.stringify(summed, null, 2))
  else console.log(formatTop(summed, n))
  return 0
}
