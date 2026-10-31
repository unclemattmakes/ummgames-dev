// Random row ids: what a board entry, a share link and a delete name.
//
// SERVER-SAFE and page-safe: `crypto.getRandomValues` only. No imports.

export const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/**
 * A fresh id of `length` characters, uniform over `alphabet`. A random byte at or over the
 * largest multiple of the alphabet's size is rerolled, so `% size` is unbiased (for base62, a
 * byte of 248 or more). Ten base62 characters are about 59.5 bits: a collision is a retry, not
 * a design problem.
 */
export const newId = (length: number, alphabet: string = BASE62): string => {
  const size = alphabet.length
  if (size < 2 || size > 256) throw new RangeError('newId: an alphabet of 2 to 256 characters')
  const ceiling = 256 - (256 % size)
  let out = ''
  const buf = new Uint8Array(length * 2)
  while (out.length < length) {
    crypto.getRandomValues(buf)
    for (const b of buf) if (b < ceiling && out.length < length) out += alphabet[b % size]
  }
  return out
}

/** The shape an id of `length` base62 characters has: check every id a request names. */
export const idShape = (length: number): RegExp => new RegExp(`^[0-9A-Za-z]{${length}}$`)
