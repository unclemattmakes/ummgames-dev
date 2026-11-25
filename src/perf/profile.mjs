// @ts-check
/**
 * A V8 CPU profile (`.cpuprofile`, what Chrome's `Profiler.stop` returns and DevTools saves),
 * summed by function: where the main thread spent its time. `umm-dev perf top` prints it.
 *
 * A profile is a call tree (`nodes`, each with a `callFrame`) and a list of samples (`samples`,
 * a node id each) taken `timeDeltas` microseconds apart. A sample's self time is the gap to the
 * next sample, as DevTools counts it; the last runs to `endTime`.
 */

/**
 * @typedef {{
 *   functionName: string,
 *   url: string,
 *   lineNumber: number,
 *   columnNumber?: number,
 * }} CallFrame
 * @typedef {{ id: number, callFrame: CallFrame }} ProfileNode
 * @typedef {{
 *   nodes: ProfileNode[],
 *   startTime: number,
 *   endTime: number,
 *   samples?: number[],
 *   timeDeltas?: number[],
 * }} CpuProfile
 * @typedef {{ key: string, functionName: string, url: string, line: number, ms: number, share: number }} SelfTimeRow
 */

/**
 * Where a frame is, for the key: the last two path segments of its URL and its 1-based line.
 * Chrome's own entries, `(program)`, `(idle)` and `(garbage collector)`, have no URL.
 * @param {CallFrame} f
 */
function place(f) {
  if (!f.url) return ''
  const file = f.url.split('?')[0]?.split('/').slice(-2).join('/') ?? ''
  return `${file}:${f.lineNumber + 1}`
}

/**
 * Self time by function, most first. Functions with the same name, file and line are one row.
 * @param {CpuProfile} profile
 * @returns {{ rows: SelfTimeRow[], totalMs: number }}
 */
export function selfTime(profile) {
  if (!profile || !Array.isArray(profile.nodes))
    throw new Error('not a CPU profile: it has no nodes')
  const samples = profile.samples ?? []
  const deltas = profile.timeDeltas ?? []
  /** @type {Map<number, ProfileNode>} */
  const byId = new Map(profile.nodes.map((n) => [n.id, n]))
  /** @type {Map<string, SelfTimeRow>} */
  const rows = new Map()
  let at = profile.startTime
  /** @type {number[]} */
  const stamps = []
  for (let i = 0; i < samples.length; i++) {
    at += deltas[i] ?? 0
    stamps.push(at)
  }
  let total = 0
  for (let i = 0; i < samples.length; i++) {
    const node = byId.get(/** @type {number} */ (samples[i]))
    if (!node) continue
    const next = i + 1 < stamps.length ? /** @type {number} */ (stamps[i + 1]) : profile.endTime
    const us = Math.max(0, next - /** @type {number} */ (stamps[i]))
    const f = node.callFrame
    const name = f.functionName || '(anonymous)'
    const where = place(f)
    const key = where ? `${name} ${where}` : name
    const row = rows.get(key) ?? {
      key,
      functionName: name,
      url: f.url,
      line: f.url ? f.lineNumber + 1 : 0,
      ms: 0,
      share: 0,
    }
    row.ms += us / 1000
    rows.set(key, row)
    total += us / 1000
  }
  const out = [...rows.values()].sort((a, b) => b.ms - a.ms)
  for (const r of out) r.share = total > 0 ? r.ms / total : 0
  return { rows: out, totalMs: total }
}

/**
 * The top `n` rows as text, one per line: share, milliseconds, function and place.
 * @param {{ rows: SelfTimeRow[], totalMs: number }} summed
 * @param {number} [n]
 */
export function formatTop(summed, n = 20) {
  const lines = summed.rows
    .slice(0, n)
    .map(
      (r) =>
        `${(100 * r.share).toFixed(1).padStart(5)}%  ${r.ms.toFixed(1).padStart(8)} ms  ${r.key}`,
    )
  lines.push(`${'100.0'.padStart(5)}%  ${summed.totalMs.toFixed(1).padStart(8)} ms  total`)
  return lines.join('\n')
}
