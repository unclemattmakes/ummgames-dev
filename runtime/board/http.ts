// Reading requests and writing answers, as a board server does both.
//
// SERVER-SAFE and PAGE-SAFE: web platform only (`ReadableStream`, `Request`, `Response`,
// `TextDecoder`), which a Worker, node 22 and a browser all have. No imports.

// Bodies.

/**
 * Collect a byte stream, refusing it WHILE reading once it passes `cap` bytes: the stream is
 * cancelled and null comes back. Reading first to measure is what a cap exists to prevent (a
 * 64 KB deflate bomb is about 66 MB of zeros).
 *
 * The cancel's own rejection is swallowed: the source may throw from its `cancel`, or the
 * connection may be gone, and the refusal is the answer either way. A read error is not
 * swallowed; it is the caller's to classify.
 *
 * Memory is bounded by what arrived, never by `cap`.
 */
export const drainCapped = async (
  stream: ReadableStream<Uint8Array>,
  cap: number,
): Promise<Uint8Array | null> => {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > cap) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.byteLength
  }
  return out
}

/**
 * The request body as text, or null past `cap` BYTES. A `Content-Length` that admits to being
 * over the cap is refused before a byte is read; one that is absent or lies is caught by
 * `drainCapped` while reading. A request with no body is the empty string.
 */
export const readCapped = async (request: Request, cap: number): Promise<string | null> => {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > cap) return null
  if (!request.body) return ''
  const bytes = await drainCapped(request.body, cap)
  return bytes === null ? null : new TextDecoder().decode(bytes)
}

/** `text` parsed as a JSON object (not an array, not null), or null. */
export const parseJsonObject = (text: string): Record<string, unknown> | null => {
  try {
    const v: unknown = JSON.parse(text)
    return v !== null && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * A positive integer query parameter, at most `max`: `?limit=N`. Anything else (absent, not an
 * integer, 0 or less) is `fallback`; over `max` is `max`.
 */
export const intParam = (url: URL, name: string, max: number, fallback: number): number => {
  const raw = url.searchParams.get(name)
  if (raw === null) return fallback
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback
}

// Answers.

/**
 * A JSON answer that no cache keeps and no browser sniffs. A caller whose answer IS cacheable
 * passes its own `cache-control`: the spread comes last, so it wins.
 */
export const json = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
      ...headers,
    },
  })

/**
 * How a board says no. `code` is a short machine word (`rate`, `size`, `admin`, `gone`, ...)
 * and `reason` a sentence for a person. A game whose client already parses another shape
 * passes its own `Refuse` to `defineBoard`; it may change the status as well as the body.
 */
export type Refuse = (
  status: number,
  code: string,
  reason: string,
  headers?: Record<string, string>,
) => Response

/** The default refusal: `{ error, reason }` at `status`. */
export const refuse: Refuse = (status, code, reason, headers) =>
  json(status, { error: code, reason }, headers)

// Origins (CORS), for a board on another origin than its game. A same-origin board needs none.

export type OriginVerdict =
  | { readonly ok: true; readonly headers: Record<string, string> }
  | { readonly ok: false }

export interface OriginOptions {
  /** `access-control-allow-methods`. Default `'GET, POST, OPTIONS'`. */
  readonly methods?: string
  /** `access-control-allow-headers`. Default `'content-type'`. */
  readonly headers?: string
}

/**
 * May this request's browser origin talk to the board? `pattern` is a regular expression,
 * matched against the WHOLE `Origin` header (it is anchored here whatever it says).
 *
 * - No `Origin` header: not a cross-origin browser call (curl, a script). Admitted, with no
 *   CORS headers; CORS never stopped a script.
 * - An origin the pattern admits: CORS headers for it, and `Vary: Origin`.
 * - Any other origin, or no or a broken pattern: refused (fail closed). Refusing outright, not
 *   only withholding the header, matters for POST: a `text/plain` POST is a simple request a
 *   foreign page can send without a preflight, and the browser would hide only the answer.
 *
 * `authorization` is not in the default allowed headers, so no browser page can call a
 * bearer-token admin route, even from an admitted origin.
 */
export const originVerdict = (
  request: Request,
  pattern: string | undefined,
  options: OriginOptions = {},
): OriginVerdict => {
  const origin = request.headers.get('origin')
  if (origin === null) return { ok: true, headers: {} }
  if (!pattern) return { ok: false }
  let re: RegExp
  try {
    re = new RegExp(`^(?:${pattern})$`)
  } catch {
    return { ok: false }
  }
  if (!re.test(origin)) return { ok: false }
  return {
    ok: true,
    headers: {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': options.methods ?? 'GET, POST, OPTIONS',
      'access-control-allow-headers': options.headers ?? 'content-type',
      'access-control-max-age': '600',
      vary: 'Origin',
    },
  }
}

/** `res` with `headers` added. A Response's own headers may be immutable, so this copies it. */
export const withHeaders = (res: Response, headers: Record<string, string>): Response => {
  if (Object.keys(headers).length === 0) return res
  const out = new Response(res.body, res)
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v)
  return out
}
