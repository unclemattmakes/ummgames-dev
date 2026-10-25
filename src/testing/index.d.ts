/**
 * The headers Cloudflare Pages would send for `pathname` from `dist/_headers`: every rule whose
 * pattern matches, in order, names lower-cased (splats only; placeholders are not read). `{}`
 * when the build has no `_headers`.
 */
export declare function headersFor(dist: string, pathname: string): Record<string, string>
