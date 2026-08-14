// @lanhu-context/core — public API surface.
// Pure logic only: no terminal (consola/citty) or protocol (MCP) dependencies.

// API client
export {
  BASE_URL,
  DDS_BASE_URL,
  DEFAULT_HTTP_TIMEOUT,
  type DesignSourceClient,
  LanhuClient,
  type LanhuClientOptions
} from './api/client';
// Errors & severity model
export {
  ERROR_REGISTRY,
  isLanhuError,
  LanhuError,
  type LanhuErrorCode,
  type LanhuErrorOptions,
  type LanhuErrorSpec,
  type LanhuSeverity,
  type LanhuWarning,
  makeWarning,
  toLanhuError
} from './errors';
// Filesystem delivery
export {
  type AssetDownloadItem,
  type AssetItemStatus,
  DEFAULT_DOWNLOAD_CONCURRENCY,
  type DownloadAssetsOptions,
  type DownloadAssetsResult,
  type DownloadAssetsSummary,
  downloadAssets
} from './fs/asset-download';
export {
  type DeliveryFiles,
  type FileDeliveryInput,
  type FileDeliveryResult,
  type FileInfo,
  type FileWriteStatus,
  sanitizeDesignDirName,
  writeDesignFiles,
  writeFileIdempotent
} from './fs/file-delivery';
export {
  DEFAULT_OUT_DIR_NAME,
  type OutDirSource,
  type ResolvedOutDir,
  resolveOutDir
} from './fs/out-dir';
export {
  type ComposeContextInput,
  type ComposeContextOptions,
  type ComposeContextResult,
  type ContentItem,
  composeContext
} from './pipeline/compose';
export {
  enUS,
  getPrompts,
  type PromptLang,
  type PromptPack,
  zhCN
} from './pipeline/prompts/index';
// Pipeline stages + composite
export {
  buildAssetsMapping,
  extractTokenEntries,
  extractTokens,
  fetchMeta,
  fetchPreview,
  fetchSchema,
  type RenderHtmlOptions,
  type RenderHtmlResult,
  renderHtml
} from './pipeline/stages';
// Retry policy
export { isRetryableError, type WithRetryOptions, withRetry } from './retry';
// Transforms
export {
  camelToKebab,
  cleanStyles,
  formatCssValue,
  getFlexClasses,
  mergeMargin,
  mergePadding,
  roundNum
} from './transform/css-helpers';
export {
  type ConvertHtmlToTailwindOptions,
  convertHtmlToTailwind
} from './transform/css-to-tailwind';
export {
  type DesignTokenBorder,
  type DesignTokenEntry,
  type DesignTokenFill,
  type DesignTokenFrame,
  type DesignTokenShadow,
  extractDesignTokenEntries,
  extractDesignTokens,
  formatDesignTokensCss
} from './transform/design-tokens';
export {
  pickLatestVersionId,
  pickPreviewUrl,
  pickProjectName
} from './transform/lanhu-response';
export { stripOssProcess } from './transform/oss-url';
export {
  convertLanhuToHtml,
  localizeImageUrls
} from './transform/schema-to-html';
// Types
export type {
  BorderObj,
  DesignMeta,
  DesignVersionsSummary,
  DownloadImageRequest,
  FillObj,
  LanhuApiResponse,
  LanhuDesignRequest,
  LanhuUrlParams,
  SchemaNode,
  ShadowObj
} from './types/index';
// URL parsing
export { parseLanhuUrl } from './url/parse';
