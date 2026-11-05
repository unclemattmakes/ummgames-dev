// @ts-check
/**
 * `@ummgames/dev/making-of`: a game's making-of site, built from the game's own source. See
 * docs/making-of.md.
 *
 *   const site = createMakingOf({ site: 'My Game', chapters: CHAPTERS })
 *   plugins: [site.plugin()]
 */
export { createMakingOf, pageFile, pagesOnDisk, sectionId, TOC_MIN_SECTIONS } from './site.mjs'
export {
  ANY_MARKER,
  clearSourceCache,
  constRefsIn,
  cutSnippet,
  formatConstant,
  highlight,
  lookupConstant,
  resolveSources,
  snippetRefsIn,
} from './source-truth.mjs'
