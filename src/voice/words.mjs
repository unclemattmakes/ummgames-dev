// @ts-check
/** Comparing what a take was asked to say with what a transcript heard, and running takes a few at a time. */

const DIGITS = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE']

/**
 * A line's words as one string of capitals and digits, so the text asked for and the text heard
 * compare equal when they say the same thing. A lone digit is its word ("round 2" is "round
 * two"), `N'` is AND ("rock n' roll"), and a dot before a domain ending is the word DOT, since a
 * transcript may spell a said "site dot com" as "site.com". Everything else that is not a letter
 * or a digit goes. A game with names of its own to say a set way changes the text before this.
 * @param {string} text
 */
export const wordsOf = (text) => wordList(text).join('')

/**
 * Runs `f` over `items`, at most `n` at once, in order of starting. Rejects on the first failure;
 * items already started still run.
 * @template T
 * @param {T[]} items
 * @param {number} n
 * @param {(item: T) => Promise<unknown>} f
 */
export async function inPool(items, n, f) {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.max(1, n) }, async () => {
      while (next < items.length) await f(items[next++])
    }),
  )
}

/**
 * A line's words as a list, by the same rules as `wordsOf`: capitals and digits, a lone digit as
 * its word, `N'` as AND, a dot before a domain ending as DOT. An apostrophe joins its word
 * ("we'll" is WELL); any other mark between letters splits them. `alike` maps a word as heard to
 * the word it stands for, for a transcript's own spellings of the same sound (`{ GREY:
 * 'GRAY' }`).
 * @param {string} text
 * @param {Readonly<Record<string, string>>} [alike]
 */
export function wordList(text, alike = {}) {
  return text
    .toUpperCase()
    .replace(/\.(COM|NET|ORG|TV|IO|GG|APP|DEV)\b/g, ' DOT $1')
    .replace(/\b\d\b/g, (d) => DIGITS[Number(d)])
    .replace(/\bN'/g, 'AND')
    .replace(/['’]/g, '')
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    .map((w) => alike[w] ?? w)
}

/**
 * How many words a take got wrong: the word-level edit distance between the line asked for and
 * the transcript, each read by `wordList`. 0 is a clean take. A game with its own spoken forms
 * (a time said as words, a name spelled for the voice) changes both texts the same way first.
 * @param {string} want
 * @param {string} heard
 * @param {{ alike?: Readonly<Record<string, string>> }} [options]
 */
export function misses(want, heard, { alike = {} } = {}) {
  const a = wordList(want, alike)
  const b = wordList(heard, alike)
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++)
      row[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    prev = row
  }
  return prev[b.length] ?? 0
}
