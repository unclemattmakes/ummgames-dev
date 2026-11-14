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
export const wordsOf = (text) =>
  text
    .toUpperCase()
    .replace(/\.(COM|NET|ORG|TV|IO|GG|APP|DEV)\b/g, 'DOT$1')
    .replace(/\b\d\b/g, (d) => DIGITS[Number(d)])
    .replace(/\bN'/g, 'AND')
    .replace(/[^A-Z0-9]+/g, '')

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
