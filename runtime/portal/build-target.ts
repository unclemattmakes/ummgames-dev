/**
 * Which build this is. The portal build (`vite build --mode portal`) is the one a web game portal
 * such as CrazyGames serves: assets load relative to the page, and whatever the game gates on
 * `PORTAL` (an editor, a dev palette, links to the game's own site, a service on another host)
 * is left out. A compile-time constant, so the bundler drops what it guards.
 *
 * Vite replaces `import.meta.env.MODE` at build time. The declaration below has the same shape
 * as `vite/client`'s, so it merges with it in a game that loads those types.
 */
declare global {
  interface ImportMetaEnv {
    MODE: string
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv
  }
}

/** The Vite mode of the portal build. */
export const PORTAL_MODE = 'portal'

export const PORTAL: boolean = import.meta.env.MODE === 'portal'
