// @ts-check
/**
 * Hydrate a fresh git worktree from the main checkout, and remove one without deleting what its
 * links point at.
 *
 * A fresh `git worktree add` lacks everything untracked: node_modules, .env, local asset trees.
 * Without them tests SKIP and the summary still reads green, so hydration ends with a count of
 * entries here against the main checkout, never a presence check.
 *
 * THE TRAP removal guards against: `git worktree remove --force` and `rm -rf` FOLLOW a junction
 * (and some tools follow a symlink) and delete the TARGET's contents. A hydrated worktree links
 * into the main checkout, so a naive removal empties the main checkout and breaks every
 * worktree at once. `removeWorktree` unlinks every link first (the link only, never its target),
 * checks none is left and that every outside target still has its entries, and only then
 * deletes the folder.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { resolveCommand, WIN } from './proc.mjs'

/**
 * @typedef {object} WorktreeConfig
 * @property {string} dir            where worktrees live, from the main checkout ('.claude/worktrees')
 * @property {string | false} install  run when node_modules is missing
 * @property {string[]} link         directories to junction (Windows) or symlink from main
 * @property {string[]} copy         files or directories to copy from main (links followed)
 * @property {string[]} allowEmpty   link/copy paths that may be empty in main
 * @property {string} envFile        the env file envKeys and envDefaults write ('.env')
 * @property {string | null} envExample  copied to envFile when neither tree has one
 * @property {string[]} envKeys      keys carried from main's envFile when missing here
 * @property {Record<string, string>} envDefaults  written when the key is missing
 */

/** @type {WorktreeConfig} */
export const WORKTREE_DEFAULTS = {
  dir: '.claude/worktrees',
  install: 'pnpm install --frozen-lockfile',
  link: [],
  copy: [],
  allowEmpty: [],
  envFile: '.env',
  envExample: null,
  envKeys: [],
  envDefaults: {},
}

/**
 * @param {string[]} args
 * @param {string} cwd
 */
function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  }).trim()
}

const same = WIN
  ? (/** @type {string} */ a, /** @type {string} */ b) =>
      path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
  : (/** @type {string} */ a, /** @type {string} */ b) => path.resolve(a) === path.resolve(b)

/**
 * Is `child` inside `parent` (or equal)?
 * @param {string} child
 * @param {string} parent
 */
export function inside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * The MAIN checkout, from git, whichever worktree `cwd` is in.
 * @param {string} cwd
 */
export function mainCheckout(cwd) {
  const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd)
  return path.dirname(path.resolve(common))
}

/** @param {string} p */
function entryCount(p) {
  try {
    const st = fs.statSync(p)
    return st.isDirectory() ? fs.readdirSync(p).length : 1
  } catch {
    return -1
  }
}

/**
 * Every link (symlink or junction, or any reparse point on Windows) under `dir`, WITHOUT
 * descending into any of them.
 * @param {string} dir
 * @param {(rel: string) => boolean} [skip]  top-level names to leave out
 */
export function findLinks(dir, skip = () => false) {
  /** @type {string[]} */
  const out = []
  const stack = [dir]
  while (stack.length > 0) {
    const d = /** @type {string} */ (stack.pop())
    let entries
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const full = path.join(d, e.name)
      if (d === dir && skip(e.name)) continue
      if (e.isSymbolicLink()) out.push(full)
      else if (e.isDirectory()) stack.push(full)
    }
  }
  return out
}

/** @param {string} link */
function linkTarget(link) {
  try {
    return path.resolve(path.dirname(link), fs.readlinkSync(link))
  } catch {
    return null
  }
}

/**
 * Remove the link itself, never what it points at.
 * @param {string} link
 */
function unlink(link) {
  try {
    fs.unlinkSync(link)
  } catch (e) {
    const code = /** @type {NodeJS.ErrnoException} */ (e).code
    if (code === 'EPERM' || code === 'EISDIR') fs.rmdirSync(link)
    else throw e
  }
}

/**
 * @param {string} worktree
 * @param {WorktreeConfig & { main?: string, skipInstall?: boolean }} cfg
 * @param {(line: string) => void} say
 * @returns {number} exit code
 */
export function hydrate(worktree, cfg, say) {
  const wt = path.resolve(worktree)
  if (!fs.existsSync(path.join(wt, '.git'))) {
    say(`REFUSING: ${wt} is not a git checkout.`)
    return 64
  }
  const main = path.resolve(cfg.main ?? mainCheckout(wt))
  if (same(main, wt)) {
    say(`REFUSING: ${wt} is the main checkout, not a worktree.`)
    return 64
  }
  say(`Hydrating ${wt}`)
  say(`     from ${main}`)
  let bad = 0

  // node_modules first: a link into node_modules needs its parent.
  if (fs.existsSync(path.join(wt, 'node_modules', '.modules.yaml'))) {
    say('  = node_modules already installed')
  } else if (!cfg.install) {
    say('  = no install step configured')
  } else if (cfg.skipInstall) {
    say('  ! node_modules missing and --skip-install given')
    bad++
  } else {
    say(`  + ${cfg.install} ...`)
    const [cmd, ...args] = cfg.install.split(/\s+/).filter(Boolean)
    const r = resolveCommand(/** @type {string} */ (cmd), args)
    const res = spawnSync(r.file, r.args, {
      cwd: wt,
      stdio: 'inherit',
      windowsVerbatimArguments: r.verbatim,
    })
    if (res.status !== 0) {
      say(`  ! ${cfg.install} failed (exit ${res.status ?? res.error?.message})`)
      bad++
    } else say('  + node_modules installed')
  }

  for (const rel of cfg.link) {
    const link = path.join(wt, rel)
    const target = path.join(main, rel)
    if (!fs.existsSync(target)) {
      say(`  ! ${rel}: missing in the main checkout`)
      bad++
      continue
    }
    if (fs.existsSync(link) || isLink(link)) {
      say(`  = ${rel} already present`)
      continue
    }
    fs.mkdirSync(path.dirname(link), { recursive: true })
    // A junction needs no privilege on Windows and is what a directory link must be there.
    fs.symlinkSync(target, link, WIN ? 'junction' : 'dir')
    say(`  + ${rel} -> ${target}`)
  }

  for (const rel of cfg.copy) {
    const dst = path.join(wt, rel)
    const src = path.join(main, rel)
    if (isLink(dst)) {
      unlink(dst)
      say(`  - ${rel} link removed (replaced by a copy)`)
    }
    if (fs.existsSync(dst)) {
      say(`  = ${rel} already present (left alone)`)
      continue
    }
    if (!fs.existsSync(src)) {
      if (rel !== cfg.envFile) {
        say(`  ! ${rel}: missing in the main checkout`)
        bad++
      }
      continue
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    // Copied byte for byte, links followed: a dev server refuses to serve a file whose real path
    // is outside its root, which is why some trees must be copies and not links.
    fs.cpSync(src, dst, { recursive: true, dereference: true })
    say(`  + ${rel} copied`)
  }

  bad += env(wt, main, cfg, say)

  say('')
  say('Counting entries against the main checkout (a link to a wrong target reads as EMPTY):')
  for (const rel of [...cfg.link, ...cfg.copy]) {
    if (rel === cfg.envFile) continue
    const here = entryCount(path.join(wt, rel))
    const there = entryCount(path.join(main, rel))
    const linked = cfg.link.includes(rel)
    const empty = cfg.allowEmpty.includes(rel)
    const ok = linked
      ? here === there && (there > 0 || empty)
      : here >= there && (there > 0 || empty)
    if (!ok) bad++
    say(
      `  ${rel.padEnd(28)} ${String(Math.max(here, 0)).padStart(5)} here vs ${String(Math.max(there, 0)).padStart(5)} in main  ${ok ? 'ok' : 'NOT HYDRATED'}`,
    )
  }

  const outward = findLinks(wt, (n) => n === 'node_modules' || n === '.git').filter((l) => {
    const t = linkTarget(l)
    return t !== null && !inside(t, wt)
  })
  if (outward.length > 0) {
    say(`  ${outward.length} link(s) point out of this worktree:`)
    for (const l of outward) say(`      ${path.relative(wt, l)}`)
    say(
      '    Remove this worktree ONLY with `umm-dev worktree remove`, never `git worktree remove`.',
    )
  } else say('  links: none point out of this worktree (outside node_modules)')

  say('')
  if (bad > 0) {
    say(`HYDRATION FAILED (${bad} checks). Do not trust a test count from this tree.`)
    return 1
  }
  say('Hydration OK.')
  return 0
}

/** @param {string} p */
function isLink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink()
  } catch {
    return false
  }
}

const KEY = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=/

/**
 * The env file: example fallback, defaults, and keys carried from main. Never prints a value.
 * Written without a BOM: a BOM on the first key makes it unreadable.
 * @param {string} wt
 * @param {string} main
 * @param {WorktreeConfig} cfg
 * @param {(line: string) => void} say
 */
function env(wt, main, cfg, say) {
  const defaults = Object.entries(cfg.envDefaults)
  if (!cfg.envExample && cfg.envKeys.length === 0 && defaults.length === 0) return 0
  const file = path.join(wt, cfg.envFile)
  if (!fs.existsSync(file) && cfg.envExample) {
    const ex = path.join(wt, cfg.envExample)
    if (fs.existsSync(ex)) {
      fs.copyFileSync(ex, file)
      say(`  + ${cfg.envFile} created from ${cfg.envExample}`)
    }
  }
  let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  const have = new Set(
    text
      .split(/\r?\n/)
      .map((l) => KEY.exec(l)?.[1])
      .filter(Boolean),
  )
  /** @type {string[]} */
  const added = []
  /** @param {string} line @param {string} key */
  const add = (line, key) => {
    if (text.length > 0 && !text.endsWith('\n')) text += '\n'
    text += `${line}\n`
    have.add(key)
    added.push(key)
  }
  const mainFile = path.join(main, cfg.envFile)
  const mainLines = fs.existsSync(mainFile) ? fs.readFileSync(mainFile, 'utf8').split(/\r?\n/) : []
  let missing = 0
  for (const key of cfg.envKeys) {
    if (have.has(key)) continue
    const line = mainLines.find((l) => KEY.exec(l)?.[1] === key)
    if (line) add(line, key)
    else {
      say(`  ! ${key} is in neither ${cfg.envFile}: tools that need it will stop and say so`)
      missing++
    }
  }
  for (const [key, value] of defaults) if (!have.has(key)) add(`${key}=${value}`, key)
  if (added.length > 0) {
    fs.writeFileSync(file, text)
    say(`  + ${cfg.envFile} gained: ${added.join(', ')}`)
  } else say(`  = ${cfg.envFile} already has every configured key`)
  return missing
}

/**
 * @param {string[]} names    folder names under cfg.dir, or paths
 * @param {{ cwd: string, dir: string, dryRun?: boolean, force?: boolean }} o
 * @param {(line: string) => void} say
 * @returns {number} exit code
 */
export function removeWorktrees(names, o, say) {
  const main = mainCheckout(o.cwd)
  const registered = git(['worktree', 'list', '--porcelain'], main)
    .split('\n')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => path.resolve(l.slice('worktree '.length).trim()))
  let failed = 0
  for (const name of names) {
    const p = path.isAbsolute(name) ? path.resolve(name) : path.resolve(main, o.dir, name)
    const r = removeOne(p, name, main, registered, o, say)
    if (r !== 0) failed++
  }
  try {
    git(['worktree', 'prune'], main)
  } catch {}
  return failed > 0 ? 1 : 0
}

/**
 * @param {string} p
 * @param {string} name
 * @param {string} main
 * @param {string[]} registered
 * @param {{ cwd: string, dryRun?: boolean, force?: boolean }} o
 * @param {(line: string) => void} say
 */
function removeOne(p, name, main, registered, o, say) {
  if (same(p, main)) {
    say(`REFUSING: ${p} is the main checkout.`)
    return 1
  }
  if (!registered.some((r) => same(r, p))) {
    say(`REFUSING: ${p} is not a worktree git knows about.`)
    return 1
  }
  if (!fs.existsSync(p)) {
    say(`${name}: folder already gone; pruning only.`)
    return 0
  }
  if (inside(o.cwd, p)) {
    say(`REFUSING ${name}: the current directory is inside it. Run this from the main checkout.`)
    return 1
  }
  let branch = ''
  try {
    branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], p)
  } catch {}
  const dirty = git(['status', '--porcelain'], p).split('\n').filter(Boolean)
  if (dirty.length > 0 && !o.force) {
    say(
      `REFUSING ${name}: ${dirty.length} uncommitted change(s). Commit them, or pass --force to discard.`,
    )
    return 1
  }

  const links = findLinks(p)
  // Targets OUTSIDE the worktree are the ones a naive delete would destroy: count their entries
  // now to prove afterwards that they survived.
  /** @type {{ link: string, target: string, before: number }[]} */
  const outside = []
  for (const l of links) {
    const t = linkTarget(l)
    if (t && !inside(t, p)) outside.push({ link: l, target: t, before: entryCount(t) })
  }
  say(`${name}: ${links.length} link(s), ${outside.length} pointing outside the worktree`)
  for (const x of outside)
    say(`   ${path.relative(p, x.link)} -> ${x.target} (${x.before} entries)`)
  if (o.dryRun) return 0

  for (const l of links) unlink(l)
  const left = findLinks(p).length
  if (left !== 0) {
    say(`   ABORT: ${left} link(s) remain, nothing deleted`)
    return 1
  }
  let shrank = 0
  for (const x of outside) {
    const after = entryCount(x.target)
    if (after !== x.before) {
      say(`   ABORT: target ${x.target} went ${x.before} -> ${after} entries`)
      shrank++
    }
  }
  if (shrank > 0) return 1

  // A harness-made worktree is often locked, and prune skips locked entries.
  try {
    git(['worktree', 'unlock', p], main)
  } catch {}
  try {
    fs.rmSync(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
    say(`   deleted ${p}`)
  } catch (e) {
    say(
      `   delete failed (a dev server or editor still holding a file?): ${e instanceof Error ? e.message : e}`,
    )
    return 1
  }
  for (const x of outside) say(`   target survived: ${x.target} (${entryCount(x.target)} entries)`)
  if (branch && branch !== 'HEAD')
    say(`   branch '${branch}' kept; delete it if merged: git branch -d ${branch}`)
  return 0
}
