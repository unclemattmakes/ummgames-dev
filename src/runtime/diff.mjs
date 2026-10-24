// @ts-check
/**
 * A small line diff for `umm-dev drift --diff`: longest common subsequence over the lines that
 * differ (the common head and tail are trimmed first), printed as a unified diff. Runtime files
 * are a few hundred lines, so the quadratic table is a few hundred kilobytes at worst.
 */

/**
 * @param {string} a
 * @param {string} b
 * @param {{ from?: string, to?: string, context?: number }} [opts]
 * @returns {string} the unified diff, or `''` when the texts match
 */
export function unifiedDiff(a, b, { from = 'a', to = 'b', context = 3 } = {}) {
  const x = splitLines(a)
  const y = splitLines(b)
  const ops = diffLines(x, y)
  if (ops.every((o) => o.op === ' ')) return ''
  const out = [`--- ${from}`, `+++ ${to}`]
  // Group the edit script into hunks with `context` unchanged lines around each change.
  let i = 0
  while (i < ops.length) {
    while (i < ops.length && /** @type {DiffOp} */ (ops[i]).op === ' ') i++
    if (i >= ops.length) break
    const start = Math.max(0, i - context)
    let end = i
    for (;;) {
      while (end < ops.length && /** @type {DiffOp} */ (ops[end]).op !== ' ') end++
      let run = 0
      while (end + run < ops.length && /** @type {DiffOp} */ (ops[end + run]).op === ' ') run++
      if (end + run >= ops.length || run > context * 2) {
        end = Math.min(ops.length, end + context)
        break
      }
      end += run
    }
    const hunk = ops.slice(start, end)
    const first = /** @type {DiffOp} */ (hunk[0])
    const aCount = hunk.filter((o) => o.op !== '+').length
    const bCount = hunk.filter((o) => o.op !== '-').length
    out.push(
      `@@ -${aCount ? first.ai + 1 : first.ai},${aCount} +${bCount ? first.bi + 1 : first.bi},${bCount} @@`,
    )
    for (const o of hunk) out.push(`${o.op}${o.text}`)
    i = end
  }
  return `${out.join('\n')}\n`
}

/** @typedef {{ op: ' ' | '-' | '+', text: string, ai: number, bi: number }} DiffOp */

/** @param {string} s */
function splitLines(s) {
  const lines = s.replace(/\r\n/g, '\n').split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

/**
 * @param {string[]} x
 * @param {string[]} y
 * @returns {DiffOp[]}
 */
export function diffLines(x, y) {
  let head = 0
  while (head < x.length && head < y.length && x[head] === y[head]) head++
  let tail = 0
  while (
    tail < x.length - head &&
    tail < y.length - head &&
    x[x.length - 1 - tail] === y[y.length - 1 - tail]
  )
    tail++
  const xs = x.slice(head, x.length - tail)
  const ys = y.slice(head, y.length - tail)
  const n = xs.length
  const m = ys.length
  // lcs[i * (m + 1) + j]: LCS length of xs[i..] and ys[j..].
  const lcs = new Uint32Array((n + 1) * (m + 1))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i * (m + 1) + j] =
        xs[i] === ys[j]
          ? /** @type {number} */ (lcs[(i + 1) * (m + 1) + j + 1]) + 1
          : Math.max(
              /** @type {number} */ (lcs[(i + 1) * (m + 1) + j]),
              /** @type {number} */ (lcs[i * (m + 1) + j + 1]),
            )
  /** @type {DiffOp[]} */
  const ops = []
  for (let k = 0; k < head; k++)
    ops.push({ op: ' ', text: /** @type {string} */ (x[k]), ai: k, bi: k })
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && xs[i] === ys[j]) {
      ops.push({ op: ' ', text: /** @type {string} */ (xs[i]), ai: head + i, bi: head + j })
      i++
      j++
    } else if (
      i < n &&
      (j >= m ||
        /** @type {number} */ (lcs[(i + 1) * (m + 1) + j]) >=
          /** @type {number} */ (lcs[i * (m + 1) + j + 1]))
    ) {
      ops.push({ op: '-', text: /** @type {string} */ (xs[i]), ai: head + i, bi: head + j })
      i++
    } else {
      ops.push({ op: '+', text: /** @type {string} */ (ys[j]), ai: head + i, bi: head + j })
      j++
    }
  }
  for (let k = 0; k < tail; k++) {
    const ai = x.length - tail + k
    const bi = y.length - tail + k
    ops.push({ op: ' ', text: /** @type {string} */ (x[ai]), ai, bi })
  }
  return ops
}
