// @ts-check
/**
 * A making-of page's numbers and code come from the game's source, not from prose that was true
 * the day it was written. Two markers in a page's HTML are replaced at build and in `vite dev`:
 *
 *   <span data-const="src/sim/tuning.ts#TUNING.hull" data-unit="m"></span>
 *   <pre data-snippet="src/sim/run.ts#stepRun"></pre>
 *
 * A number is read statically with the TypeScript compiler (see `Evaluator`): game modules pull in
 * renderers and physics, so nothing is executed. A snippet is cut by name, never by line numbers or
 * marker comments, which a refactor invalidates without a sound. A renamed constant, a moved file
 * or an expression the evaluator cannot read throws, naming the page, so a stale number fails the
 * build instead of shipping. See docs/making-of.md.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

/** @typedef {import('./index.d.ts').SourceOptions} SourceOptions */
/** @typedef {import('./index.d.ts').ConstantHit} ConstantHit */
/** @typedef {import('./index.d.ts').SnippetHit} SnippetHit */
/** @typedef {import('./index.d.ts').FormatOptions} FormatOptions */

/** The alias a game's bundler usually has: `@/x` is `src/x`. */
const DEFAULT_ALIAS = { '@/': 'src/' }

/** @param {string} s */
export const escapeHtml = (s) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

// Parsing and module resolution.

/** @type {Map<string, ts.SourceFile>} */
const sourceCache = new Map()

/** @param {string} abs */
const parse = (abs) => {
  let sf = sourceCache.get(abs)
  if (!sf) {
    sf = ts.createSourceFile(abs, readFileSync(abs, 'utf8'), ts.ScriptTarget.ES2022, true)
    sourceCache.set(abs, sf)
  }
  return sf
}

/** Forget parsed files. The plugin calls this when a source changes under `vite dev`. */
export const clearSourceCache = () => sourceCache.clear()

/**
 * Resolve an import specifier the way the game's bundler does.
 * @param {string} root @param {Readonly<Record<string, string>>} alias
 * @param {string} fromAbs @param {string} spec
 * @returns {string | null}
 */
const resolveImport = (root, alias, fromAbs, spec) => {
  let base = null
  for (const [prefix, dir] of Object.entries(alias)) {
    if (spec.startsWith(prefix)) base = path.join(root, dir, spec.slice(prefix.length))
  }
  if (base === null && spec.startsWith('.')) base = path.resolve(path.dirname(fromAbs), spec)
  if (base === null) return null
  const tries = [base, `${base}.ts`, path.join(base, 'index.ts'), base.replace(/\.js$/, '.ts')]
  return tries.find((c) => c.endsWith('.ts') && existsSync(c)) ?? null
}

/**
 * The declared names of a top-level statement.
 * @param {ts.Statement} stmt
 * @returns {string[]}
 */
const namesOf = (stmt) => {
  if (ts.isVariableStatement(stmt)) {
    return stmt.declarationList.declarations.flatMap((d) =>
      ts.isIdentifier(d.name) ? [d.name.text] : [],
    )
  }
  if (
    ts.isFunctionDeclaration(stmt) ||
    ts.isClassDeclaration(stmt) ||
    ts.isInterfaceDeclaration(stmt) ||
    ts.isTypeAliasDeclaration(stmt) ||
    ts.isEnumDeclaration(stmt)
  ) {
    return stmt.name ? [stmt.name.text] : []
  }
  return []
}

/** @param {ts.Node} node */
const where = (node) => {
  const sf = node.getSourceFile()
  const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
  return `${sf.fileName.replaceAll('\\', '/').replace(/^.*?\/(src\/)/, '$1')}:${line}`
}

// The evaluator: a small pure-expression subset of the AST. It throws on anything outside it.

/** A property whose initializer is outside the subset. It fails only when read, so one exotic field leaves the rest of an object quotable. */
class Unresolvable {
  /** @param {string} reason */
  constructor(reason) {
    this.reason = reason
  }
}

/** A top-level function the evaluator can call. */
class Fn {
  /** @param {ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression} decl @param {string} file */
  constructor(decl, file) {
    this.decl = decl
    this.file = file
  }
}

/** @type {Record<string, number>} */
const MATH_CONSTS = {
  PI: Math.PI,
  E: Math.E,
  SQRT2: Math.SQRT2,
  LN2: Math.LN2,
  LN10: Math.LN10,
}
/** @type {Record<string, (...a: number[]) => number>} */
const MATH_FNS = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  atan2: Math.atan2,
  exp: Math.exp,
  log: Math.log,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  hypot: Math.hypot,
}

class Evaluator {
  /** @type {Map<string, unknown>} */
  declCache = new Map()
  /** @type {Set<string>} */
  inProgress = new Set()

  /** @param {string} root @param {Readonly<Record<string, string>>} alias */
  constructor(root, alias) {
    this.root = root
    this.alias = alias
  }

  /**
   * The value bound to a top-level name in a file, following imports.
   * @param {string} file @param {string} name
   * @returns {unknown}
   */
  topLevel(file, name) {
    const key = `${file}#${name}`
    if (this.declCache.has(key)) return this.declCache.get(key)
    if (this.inProgress.has(key)) throw new Error(`circular reference to ${name} in ${file}`)
    this.inProgress.add(key)
    try {
      const v = this.resolveTopLevel(file, name)
      this.declCache.set(key, v)
      return v
    } finally {
      this.inProgress.delete(key)
    }
  }

  /** @param {string} file @param {string} spec */
  follow(file, spec) {
    return resolveImport(this.root, this.alias, file, spec)
  }

  /** @param {string} file @param {string} name @returns {unknown} */
  resolveTopLevel(file, name) {
    const sf = parse(file)
    for (const stmt of sf.statements) {
      if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === name) return new Fn(stmt, file)
      if (ts.isVariableStatement(stmt)) {
        for (const d of stmt.declarationList.declarations) {
          if (!ts.isIdentifier(d.name) || d.name.text !== name) continue
          if (!d.initializer) throw new Error(`${name} in ${file} has no initializer`)
          const init = d.initializer
          if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return new Fn(init, file)
          return this.ev(init, new Map(), file)
        }
      }
      // import { name } and import { other as name } from '...'
      if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
        const named = stmt.importClause?.namedBindings
        if (named && ts.isNamedImports(named)) {
          for (const el of named.elements) {
            if (el.name.text !== name) continue
            const target = this.follow(file, stmt.moduleSpecifier.text)
            if (!target)
              throw new Error(`cannot follow import of ${name} from '${stmt.moduleSpecifier.text}'`)
            return this.topLevel(target, (el.propertyName ?? el.name).text)
          }
        }
      }
      // export { name } from '...'
      if (
        ts.isExportDeclaration(stmt) &&
        stmt.moduleSpecifier &&
        ts.isStringLiteral(stmt.moduleSpecifier) &&
        stmt.exportClause &&
        ts.isNamedExports(stmt.exportClause)
      ) {
        for (const el of stmt.exportClause.elements) {
          if (el.name.text !== name) continue
          const target = this.follow(file, stmt.moduleSpecifier.text)
          if (!target) throw new Error(`cannot follow re-export of ${name}`)
          return this.topLevel(target, (el.propertyName ?? el.name).text)
        }
      }
    }
    throw new Error(`no top-level declaration named ${name}`)
  }

  /** @param {Fn} fn @param {unknown[]} args @returns {unknown} */
  call(fn, args) {
    /** @type {Map<string, unknown>} */
    const env = new Map()
    fn.decl.parameters.forEach((p, i) => {
      if (!ts.isIdentifier(p.name)) throw new Error(`destructured parameter at ${where(p)}`)
      const arg = args[i]
      env.set(
        p.name.text,
        arg === undefined && p.initializer ? this.ev(p.initializer, env, fn.file) : arg,
      )
    })
    const body = fn.decl.body
    if (!body) throw new Error(`function without a body at ${where(fn.decl)}`)
    if (!ts.isBlock(body)) return this.ev(body, env, fn.file)
    const ret = body.statements.filter(ts.isReturnStatement)
    const others = body.statements.filter((s) => !ts.isReturnStatement(s))
    const only = ret[0]?.expression
    if (ret.length !== 1 || others.length > 0 || !only) {
      throw new Error(`function at ${where(fn.decl)} is not a single \`return <expr>\``)
    }
    return this.ev(only, env, fn.file)
  }

  /** @param {unknown} obj @param {string} key @param {ts.Node | null} at @returns {unknown} */
  member(obj, key, at) {
    if (obj instanceof Unresolvable) throw new Error(obj.reason)
    if (Array.isArray(obj) && key === 'length') return obj.length
    if (obj === null || typeof obj !== 'object' || !(key in obj)) {
      throw new Error(`no property "${key}"${at ? ` at ${where(at)}` : ''}`)
    }
    const v = /** @type {Record<string, unknown>} */ (obj)[key]
    if (v instanceof Unresolvable) throw new Error(`"${key}": ${v.reason}`)
    return v
  }

  /**
   * @param {ts.Expression} e @param {ReadonlyMap<string, unknown>} env @param {string} file
   * @returns {unknown}
   */
  ev(e, env, file) {
    if (ts.isNumericLiteral(e)) return Number(e.text)
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text
    if (e.kind === ts.SyntaxKind.TrueKeyword) return true
    if (e.kind === ts.SyntaxKind.FalseKeyword) return false
    if (e.kind === ts.SyntaxKind.NullKeyword) return null
    if (
      ts.isParenthesizedExpression(e) ||
      ts.isAsExpression(e) ||
      ts.isSatisfiesExpression(e) ||
      ts.isNonNullExpression(e) ||
      ts.isTypeAssertionExpression(e)
    ) {
      return this.ev(e.expression, env, file)
    }
    if (ts.isPrefixUnaryExpression(e)) {
      const v = this.ev(e.operand, env, file)
      if (e.operator === ts.SyntaxKind.MinusToken) return -(/** @type {number} */ (v))
      if (e.operator === ts.SyntaxKind.PlusToken) return +(/** @type {number} */ (v))
      if (e.operator === ts.SyntaxKind.ExclamationToken) return !v
    }
    if (ts.isBinaryExpression(e)) {
      const a = /** @type {number} */ (this.ev(e.left, env, file))
      const b = /** @type {number} */ (this.ev(e.right, env, file))
      switch (e.operatorToken.kind) {
        case ts.SyntaxKind.PlusToken:
          return a + b
        case ts.SyntaxKind.MinusToken:
          return a - b
        case ts.SyntaxKind.AsteriskToken:
          return a * b
        case ts.SyntaxKind.SlashToken:
          return a / b
        case ts.SyntaxKind.PercentToken:
          return a % b
        case ts.SyntaxKind.AsteriskAsteriskToken:
          return a ** b
      }
    }
    if (ts.isConditionalExpression(e)) {
      return this.ev(e.condition, env, file)
        ? this.ev(e.whenTrue, env, file)
        : this.ev(e.whenFalse, env, file)
    }
    if (ts.isIdentifier(e)) {
      if (env.has(e.text)) return env.get(e.text)
      if (e.text === 'undefined') return undefined
      if (e.text === 'Infinity') return Number.POSITIVE_INFINITY
      return this.topLevel(file, e.text)
    }
    if (ts.isObjectLiteralExpression(e)) {
      /** @type {Record<string, unknown>} */
      const out = {}
      for (const p of e.properties) {
        if (ts.isSpreadAssignment(p)) {
          const v = this.ev(p.expression, env, file)
          if (v instanceof Unresolvable) throw new Error(v.reason)
          Object.assign(out, v)
          continue
        }
        if (ts.isShorthandPropertyAssignment(p)) {
          out[p.name.text] = this.lazy(p.name, env, file)
          continue
        }
        if (ts.isPropertyAssignment(p)) {
          const n = p.name
          const key =
            ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n) ? n.text : null
          if (key === null) throw new Error(`computed key at ${where(p)}`)
          out[key] = this.lazy(p.initializer, env, file)
          continue
        }
        // Methods and accessors: present, but not quotable.
        if (p.name && ts.isIdentifier(p.name)) {
          out[p.name.text] = new Unresolvable(`${p.name.text} is a method at ${where(p)}`)
        }
      }
      return out
    }
    if (ts.isArrayLiteralExpression(e)) {
      /** @type {unknown[]} */
      const out = []
      for (const el of e.elements) {
        if (ts.isSpreadElement(el)) {
          out.push(.../** @type {unknown[]} */ (this.ev(el.expression, env, file)))
        } else out.push(this.lazy(el, env, file))
      }
      return out
    }
    if (ts.isPropertyAccessExpression(e)) {
      if (ts.isIdentifier(e.expression) && e.expression.text === 'Math' && !env.has('Math')) {
        const c = MATH_CONSTS[e.name.text]
        if (c !== undefined) return c
      }
      return this.member(this.ev(e.expression, env, file), e.name.text, e)
    }
    if (ts.isElementAccessExpression(e)) {
      const key = this.ev(e.argumentExpression, env, file)
      return this.member(this.ev(e.expression, env, file), String(key), e)
    }
    if (ts.isCallExpression(e)) {
      const c = e.expression
      const args = () => e.arguments.map((a) => this.ev(a, env, file))
      if (ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.expression)) {
        const ns = c.expression.text
        const fnName = c.name.text
        const mathFn = MATH_FNS[fnName]
        if (ns === 'Math' && mathFn) return mathFn(.../** @type {number[]} */ (args()))
        if (ns === 'Object' && fnName === 'freeze') return args()[0]
      }
      const callee = this.ev(c, env, file)
      if (callee instanceof Fn) return this.call(callee, args())
      throw new Error(`call to a non-function at ${where(e)}`)
    }
    throw new Error(`cannot evaluate ${ts.SyntaxKind[e.kind]} at ${where(e)}`)
  }

  /**
   * Evaluate, but park a failure as an Unresolvable instead of throwing.
   * @param {ts.Expression} e @param {ReadonlyMap<string, unknown>} env @param {string} file
   * @returns {unknown}
   */
  lazy(e, env, file) {
    try {
      return this.ev(e, env, file)
    } catch (err) {
      return new Unresolvable(/** @type {Error} */ (err).message)
    }
  }

  /**
   * Walk `a.b.0.c` from a top-level value. A function on the way is called with no arguments.
   * @param {string} file @param {string} dotted
   * @returns {unknown}
   */
  walk(file, dotted) {
    const [head, ...rest] = dotted.split('.')
    if (!head) throw new Error('empty name')
    let v = this.topLevel(file, head)
    if (v instanceof Fn) v = this.call(v, [])
    for (const part of rest) {
      v = this.member(v, part, null)
      if (v instanceof Fn) v = this.call(v, [])
    }
    return v
  }
}

// Numbers.

/** @param {string} ref @param {string} attrName */
const splitRef = (ref, attrName) => {
  const hash = ref.indexOf('#')
  const file = hash > 0 ? ref.slice(0, hash) : ''
  const name = hash > 0 ? ref.slice(hash + 1) : ''
  if (!file || !name) throw new Error(`${attrName} "${ref}" must be <file>#<name>`)
  return { file, name }
}

/**
 * Resolve `src/x.ts#NAME.path`, or a path into a JSON file. Throws a message naming the reference.
 * @param {string} root @param {string} ref @param {SourceOptions} [options]
 * @returns {ConstantHit}
 */
export const lookupConstant = (root, ref, options = {}) => {
  const own = options.lookup?.(root, ref)
  if (own) return own
  const { file, name } = splitRef(ref, 'data-const')
  const abs = path.join(root, file)
  if (!existsSync(abs)) throw new Error(`data-const "${ref}": ${file} does not exist`)
  /** @type {unknown} */
  let value
  try {
    value = abs.endsWith('.json')
      ? name
          .split('.')
          .reduce(
            (v, key) => /** @type {Record<string, unknown>} */ (v)[key],
            JSON.parse(readFileSync(abs, 'utf8')),
          )
      : new Evaluator(root, options.alias ?? DEFAULT_ALIAS).walk(abs, name)
  } catch (e) {
    throw new Error(`data-const "${ref}" does not resolve: ${/** @type {Error} */ (e).message}`)
  }
  if (typeof value !== 'number' && typeof value !== 'string' && typeof value !== 'boolean') {
    throw new Error(`data-const "${ref}" is not a number, string or boolean`)
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error(`data-const "${ref}" is not finite`)
  }
  return { ref, file, value }
}

/**
 * `digits` is a fixed decimal count; absent, six significant figures with the zeros trimmed.
 * @param {ConstantHit} hit @param {FormatOptions} [o]
 */
export const formatConstant = (hit, o = {}) => {
  let text
  if (typeof hit.value === 'number') {
    let v = hit.value
    if (o.reciprocal) v = 1 / v
    if (o.scale != null) v *= Number(o.scale)
    text = o.digits == null ? String(Number(v.toPrecision(6))) : v.toFixed(Number(o.digits))
  } else text = String(hit.value)
  const unit = o.unit === 'auto' ? hit.unit : o.unit
  return unit ? `${text} ${unit}` : text
}

/** @param {string} attrs @param {string} name */
const attr = (attrs, name) => new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1] ?? null
/** @param {string} attrs @param {string} name */
const flag = (attrs, name) => new RegExp(`\\b${name}\\b`).test(attrs)

// Empty elements only: the build fills them, so the source carries no copy of the value that could
// go stale and be mistaken for the truth.
const CONST_TAG = /<span\b([^>]*\bdata-const="[^"]+"[^>]*)>\s*<\/span>/g
const SNIPPET_TAG = /<pre\b([^>]*\bdata-snippet="[^"]+"[^>]*)>\s*<\/pre>/g
/** Any marker at all, filled or not: what a "nothing left behind" check looks for. */
export const ANY_MARKER = /data-const=|data-snippet=/

/** @param {string} html */
export const constRefsIn = (html) =>
  [...html.matchAll(CONST_TAG)].map((m) => attr(m[1] ?? '', 'data-const') ?? '')
/** @param {string} html */
export const snippetRefsIn = (html) =>
  [...html.matchAll(SNIPPET_TAG)].map((m) => attr(m[1] ?? '', 'data-snippet') ?? '')

// Code.

/**
 * `src/sim/run.ts#stepRun`, or `file#Class.method` for one member of a class, dedented. Cut by
 * name; the leading doc comment is left out.
 * @param {string} root @param {string} ref
 * @returns {SnippetHit}
 */
export const cutSnippet = (root, ref) => {
  const { file, name } = splitRef(ref, 'data-snippet')
  const abs = path.join(root, file)
  if (!existsSync(abs)) throw new Error(`data-snippet "${ref}": ${file} does not exist`)
  const sf = parse(abs)
  const [top = '', member] = name.split('.')
  const stmt = sf.statements.find((s) => namesOf(s).includes(top))
  if (!stmt) {
    throw new Error(`data-snippet "${ref}": no top-level declaration named ${top} in ${file}`)
  }
  const node =
    member && ts.isClassDeclaration(stmt)
      ? stmt.members.find((m) => m.name && ts.isIdentifier(m.name) && m.name.text === member)
      : stmt
  if (!node) throw new Error(`data-snippet "${ref}": no member named ${member} in ${top}`)
  const start = node.getStart(sf, false)
  const end = node.getEnd()
  /** @param {number} pos */
  const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1
  return {
    file,
    name,
    startLine: lineOf(start),
    endLine: lineOf(end),
    text: sf.text
      .slice(start, end)
      .replaceAll('\r\n', '\n')
      .replace(member ? /^ {2}/gm : /^(?!)/, ''),
  }
}

/**
 * Token-kind highlighting with the compiler's own scanner: the text, escaped, in `mo-tok-*` spans.
 * @param {string} text
 */
export const highlight = (text) => {
  const scanner = ts.createScanner(ts.ScriptTarget.ES2022, false, ts.LanguageVariant.Standard, text)
  let out = ''
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    const piece = escapeHtml(scanner.getTokenText())
    let cls = null
    if (kind >= ts.SyntaxKind.FirstKeyword && kind <= ts.SyntaxKind.LastKeyword) cls = 'kw'
    else if (
      kind === ts.SyntaxKind.StringLiteral ||
      kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
      kind === ts.SyntaxKind.TemplateHead ||
      kind === ts.SyntaxKind.TemplateMiddle ||
      kind === ts.SyntaxKind.TemplateTail
    )
      cls = 'str'
    else if (kind === ts.SyntaxKind.NumericLiteral) cls = 'num'
    else if (
      kind === ts.SyntaxKind.SingleLineCommentTrivia ||
      kind === ts.SyntaxKind.MultiLineCommentTrivia
    )
      cls = 'com'
    out += cls ? `<span class="mo-tok-${cls}">${piece}</span>` : piece
  }
  return out
}

// The HTML pass.

/**
 * Replace every `data-const` span and `data-snippet` pre in a page. Throws on one that does not
 * resolve, naming `page`.
 * @param {string} root @param {string} html @param {string} page @param {SourceOptions} [options]
 */
export const resolveSources = (root, html, page, options = {}) => {
  /** @param {() => string} fn */
  const wrap = (fn) => {
    try {
      return fn()
    } catch (e) {
      throw new Error(`${page}: ${/** @type {Error} */ (e).message}`)
    }
  }
  return html
    .replace(CONST_TAG, (_m, /** @type {string} */ attrs) =>
      wrap(() => {
        const ref = attr(attrs, 'data-const') ?? ''
        const hit = lookupConstant(root, ref, options)
        const text = formatConstant(hit, {
          digits: attr(attrs, 'data-digits'),
          scale: attr(attrs, 'data-scale'),
          reciprocal: flag(attrs, 'data-reciprocal'),
          unit: attr(attrs, 'data-unit'),
        })
        const tip = hit.note ? `${ref} · ${hit.note}` : ref
        return `<span class="mo-const" title="${escapeHtml(tip)}">${escapeHtml(text)}</span>`
      }),
    )
    .replace(SNIPPET_TAG, (_m, /** @type {string} */ attrs) =>
      wrap(() => {
        const hit = cutSnippet(root, attr(attrs, 'data-snippet') ?? '')
        const caption = attr(attrs, 'data-caption')
        const place = `<code>${escapeHtml(hit.file)}:${hit.startLine}</code>`
        const link = options.repoBlob
          ? `<a href="${options.repoBlob}/${hit.file}#L${hit.startLine}-L${hit.endLine}">${place}</a>`
          : place
        return (
          `<figure class="mo-snippet"><pre><code>${highlight(hit.text)}</code></pre>` +
          `<figcaption>${caption ? `${escapeHtml(caption)} · ` : ''}${link}</figcaption></figure>`
        )
      }),
    )
}
