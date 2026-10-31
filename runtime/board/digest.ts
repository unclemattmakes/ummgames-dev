// SHA-256 through `crypto.subtle`, and the two identifiers a board stores from it: a device's
// owner-key hash, and a sender's salted address hash.
//
// STORED IDENTIFIERS. `ownerHash` and `senderHash` are written into tables and compared
// against later. Change a byte of how either is made and every stored hash is orphaned: a
// block stops matching its device, and a rate row its sender. tests/board pins known vectors.
//
// SERVER-SAFE and page-safe: `crypto.subtle` and `TextEncoder` are in a Worker, node 22 and a
// browser (a page over plain HTTP has no `subtle`; a caller that runs there checks). No imports.

/** The SHA-256 digest of a string (as UTF-8) or of bytes. */
export const sha256Bytes = async (data: string | Uint8Array): Promise<Uint8Array> => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))
}

/** Bytes as lower-case hex, two digits each. */
export const hexOfBytes = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

/** The SHA-256 of a string or bytes, lower-case hex (64 characters). */
export const sha256Hex = async (data: string | Uint8Array): Promise<string> =>
  hexOfBytes(await sha256Bytes(data))

/**
 * Equal, in a time that does not depend on where two digests first differ: every byte is
 * compared. Compare digests of secrets, never the secrets, so the lengths match too.
 */
export const sameDigest = (a: Uint8Array, b: Uint8Array): boolean => {
  let diff = a.length ^ b.length
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] ?? 0)
  return diff === 0
}

// Owner keys.

/**
 * A device's owner key: random, made and kept by the client, at least 128 bits of base64url.
 * It proves "this run is mine" for a delete. The server stores only its hash.
 */
export const OWNER_KEY_SHAPE = /^[A-Za-z0-9_-]{22,128}$/

/** How a table holds a device: `ownerHash` of its key. */
export const OWNER_HASH_SHAPE = /^[0-9a-f]{64}$/

/** Whether `v` is an owner hash: what an `owner` block names. */
export const isOwnerHash = (v: string): boolean => OWNER_HASH_SHAPE.test(v)

/** The hash a table keeps for an owner key. STORED: see the top of this file. */
export const ownerHash = (key: string): Promise<string> => sha256Hex(key)

// Senders.

/**
 * What a rate limit counts an address as: an IPv4 address whole, an IPv6 address by its first
 * 64 bits, the network one client is normally handed (RFC 6177), so rotating through it is one
 * sender. Spellings of one address agree (`::` expanded, case and leading zeros dropped).
 * Anything that does not parse as IPv6 passes through whole.
 */
export const rateKey = (address: string): string => {
  if (!address.includes(':')) return address
  const halves = address.toLowerCase().split('::')
  if (halves.length > 2) return address
  const groupsOf = (part: string | undefined) => (part ? part.split(':') : [])
  const left = groupsOf(halves[0])
  const right = groupsOf(halves[1])
  // An embedded IPv4 tail (`::ffff:1.2.3.4`) fills two groups.
  const width = right.reduce((n, g) => n + (g.includes('.') ? 2 : 1), 0)
  const groups =
    halves.length === 2 ? [...left, ...Array(Math.max(0, 8 - left.length - width)).fill('0')] : left
  const network = groups.slice(0, 4)
  while (network.length < 4) network.push(right.shift() ?? '0')
  if (!network.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return address
  return `${network.map((g) => Number.parseInt(g, 16).toString(16)).join(':')}::/64`
}

/** The header a sender's address is read from. Cloudflare sets it, and a client cannot. */
export const ADDRESS_HEADER = 'cf-connecting-ip'

/**
 * The salted hash a sender is counted by: SHA-256 of `<salt>:<rateKey(address)>`. The salt is
 * a secret, so a table of these cannot be reversed by hashing every address. The address comes
 * from `header` only; never fall back to `x-forwarded-for`, which any client can write, or a
 * script can rotate its "address" per request and never be limited. STORED: see the top.
 */
export const senderHash = (request: Request, salt: string, header = ADDRESS_HEADER) =>
  sha256Hex(`${salt}:${rateKey(request.headers.get(header) ?? 'unknown')}`)
