/**
 * Public exports для WebGL2 рендерера карты PZ.
 *
 * Внешние потребители (React-компоненты, hooks, тесты) импортируют отсюда,
 * а не из под-папок. Это позволяет рефакторить внутренние модули без
 * ломания callers.
 */

export { PzMapRenderer } from './pz-map-renderer';
export { WebGL2NotSupportedError } from './gpu/gl-context';
export type { CellLoaderStats } from './loaders/cell-loader';
export type { CellTextureInfo } from './gpu/cell-texture-manager';
export type {
    AtlasManifest,
    CellPagesManifest,
    CellsManifest,
    GlCapabilities,
    LodInfo,
    ProgressSnapshot,
    PzMapRendererOptions,
    RendererState,
    SpritesManifest,
    ViewportInfo,
} from './types';
