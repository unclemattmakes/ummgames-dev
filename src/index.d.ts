import type { GpuConfig, WorktreeConfig } from './agent/config.js'
import type { LoudnessConfig } from './audio/index.js'
import type { GuardConfig } from './guard/config.js'
import type { CaptureConfig, LoopConfig, StoreConfig } from './media/index.js'
import type { RuntimeConfig } from './runtime/config.js'

export type {
  CaptureConfig,
  GpuConfig,
  GuardConfig,
  LoopConfig,
  LoudnessConfig,
  RuntimeConfig,
  StoreConfig,
  WorktreeConfig,
}

/**
 * A game's `umm-dev.config.mjs`. Every section is optional, and each command reads only its own,
 * merged one level deep over its defaults. Each section's keys and defaults are in the "Config"
 * table on its area's page in docs/.
 */
export interface UmmDevConfig {
  /** `umm-dev capture`, and the capture step of `umm-dev store`. docs/media.md */
  capture?: CaptureConfig
  /** `umm-dev store`. docs/media.md */
  store?: StoreConfig
  /** `umm-dev loop`. docs/media.md */
  loop?: LoopConfig
  /** `umm-dev gpu`. The lease folder is not configurable here: see docs/agent.md */
  gpu?: GpuConfig
  /** `umm-dev worktree`. docs/agent.md */
  worktree?: WorktreeConfig
  /** `umm-dev guard` and the hooks it installs. docs/guard.md */
  guard?: GuardConfig
  /** `umm-dev copy`. docs/runtime.md */
  runtime?: RuntimeConfig
  /** `umm-dev loudness`. docs/audio.md */
  loudness?: LoudnessConfig
}

/**
 * Types a game's config. With `// @ts-check` in `umm-dev.config.mjs`, an unknown section or key is
 * an error. A game that keeps settings of its own in the same file reads them with
 * `loadConfigFile()`, and types them itself.
 */
export declare function defineConfig(config: UmmDevConfig): UmmDevConfig

/** The game root: the nearest folder at or above `cwd` that holds a package.json. */
export declare function findGameRoot(cwd?: string): string

/** The whole config object of the game at or above `cwd`, or `{}` when it has none. */
export declare function loadConfigFile(
  cwd?: string,
): Promise<{ root: string; file: string | null; config: Record<string, unknown> }>

/**
 * One section of the game's config, merged one level deep over `defaults`. For tools of the
 * game's own that follow the kit's pattern.
 */
export declare function loadConfig<D extends Record<string, unknown>>(
  section: string,
  defaults: D,
  cwd?: string,
): Promise<D & { root: string }>
