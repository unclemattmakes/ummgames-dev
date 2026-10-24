// @ts-check
/**
 * `@ummgames/dev/vite`: the build plugins every game shares. Each is configured by its options
 * and reads nothing from the game itself. See docs/build.md and docs/portal.md.
 */
export {
  HEADERS_FILE,
  HSTS,
  hashedAsset,
  headers,
  headersFile,
  IMMUTABLE_CACHE,
  PERMISSIONS_POLICY,
  securityHeaders,
  unhashedUnderAssets,
} from './headers.mjs'
export {
  APPLE_TOUCH_ICON,
  APPLE_TOUCH_SIZE,
  appIcon,
  appleTouchIconPng,
  parseIconSvg,
  pathPoints,
  rasterize,
  rasterizeCard,
  SHARE_CARD,
  SHARE_CARD_SIZE,
  shareCardPng,
} from './icon.mjs'
export {
  collectLicences,
  fallbackName,
  LICENCES_MODULE,
  licences,
  licencesHtml,
} from './licences.mjs'
export { NOT_FOUND_FILE, notFoundHtml, notFoundPage } from './not-found.mjs'
export { encodePng } from './png.mjs'
export {
  CRAZYGAMES_LIMITS,
  CRAZYGAMES_ORIGINS,
  CRAZYGAMES_SDK_URL,
  orphanChunks,
  overLimits,
  PORTAL_MODE,
  portalAssets,
  portalPrune,
  portalSdk,
  portalSiteOnly,
  stripSiteOnly,
} from './portal.mjs'
