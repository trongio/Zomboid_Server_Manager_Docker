/**
 * PzMapRenderer — корневой объект рендерера карты.
 *
 * State machine: idle → fetching-manifests → preloading-atlas → preloading-cells
 *                → finalizing → ready → disposed/error/cancelled.
 *
 * Phase 1 (текущая): только manifest + atlas preload + debug viewer одной
 * atlas page. Без cells, без rendering карты.
 *
 * Phase 2-6 расширят: cell preload, vertex shader instance gen, Leaflet layer.
 */

import debugVertSrc from './shaders/debug-atlas.vert.glsl?raw';
import debugFragSrc from './shaders/debug-atlas.frag.glsl?raw';
import mainVertSrc from './shaders/pz-map.vert.glsl?raw';
import mainFragSrc from './shaders/pz-map.frag.glsl?raw';

import { createGlContext, WebGL2NotSupportedError } from './gpu/gl-context';
import {
    compileShaderProgram,
    destroyShaderProgram,
    type CompiledShaderProgram,
} from './gpu/shader-program';
import { CellTextureManager } from './gpu/cell-texture-manager';
import {
    buildSpriteInfoTexture,
    type SpriteInfoTexture,
} from './gpu/sprite-info-texture';
import { AtlasLoader, type LodTexture } from './loaders/atlas-loader';
import { CellLoader, buildSpriteNameToId, type CellLoaderStats } from './loaders/cell-loader';
import { SaveCellLoader, type SaveCellLoaderStats } from './loaders/save-cell-loader';
import { SaveWatcher } from './loaders/save-watcher';
import { StreamingManager } from './loaders/streaming-manager';
import { computeRectCover } from './utils/rect-cover';
import { loadAllManifests, type AllManifests } from './loaders/manifest-loader';
import { cellBoundsInPixels, makeOrthoMatrix } from './utils/coords';
import { ProgressAggregator } from './utils/progress';
import { WorkerPool } from './workers/worker-pool';
import type {
    GlCapabilities,
    PzMapRendererOptions,
    RendererState,
    SaveOverlayMode,
} from './types';

/**
 * Дебаг-режим для Phase 3: 'atlas' = просмотр atlas pages, 'cell' = рендер
 * одной cell во весь canvas (sprite-perfect view для верификации шейдеров).
 */
export type DebugMode = 'atlas' | 'cell';

/** Текущая фаза для debug HUD. */
interface DebugViewState {
    mode: DebugMode;
    // 'atlas' params:
    lod: number;
    page: number;
    brightness: number;
    // 'cell' params:
    cellX: number;
    cellY: number;
    isometric: boolean;
    sqr: number;
    pps: number;
    /** Показывать этажи 0..maxFloor. Slider 0..3. */
    maxFloor: number;
    /** Высота одного этажа в native px. PZ B42 стандарт ≈ 96 (= 1.5×sqr),
     *  но точное значение проверяется визуально — slider в UI. */
    floorHeightPx: number;
    /** Pan offset в native pixels. Прибавляется к cell center при
     *  построении ortho. Mouse drag в pz-map-view.tsx инкрементирует. */
    panX: number;
    panY: number;
    /** Skip cells: при cellStride=N рендерим только cells где
     *  (cx-min) % stride == 0 && (cy-min) % stride == 0. CPU side. */
    cellStride: number;
    /** Skip sprites внутри cell: vertex shader делает collapse если
     *  sx % stride != 0 или sy % stride != 0. Оставшиеся sprites
     *  scaled × stride чтобы closure gaps. */
    squareStride: number;
    /** 0 = normal, 1 = magenta solid, 2 = UV gradient. */
    fragDebug: number;
}

export class PzMapRenderer {
    private readonly opts: PzMapRendererOptions;
    private gl: WebGL2RenderingContext | null = null;
    private capabilities: GlCapabilities | null = null;
    private manifests: AllManifests | null = null;
    private atlasLoader: AtlasLoader | null = null;
    private atlasTextures: Map<number, LodTexture> | null = null;
    private debugProgram: CompiledShaderProgram | null = null;
    private mainProgram: CompiledShaderProgram | null = null;
    private debugVao: WebGLVertexArrayObject | null = null;
    private cellTextureMgr: CellTextureManager | null = null;
    private spriteInfoTex: SpriteInfoTexture | null = null;
    private workerPool: WorkerPool | null = null;
    /** Phase 4.4: streaming manager — alive throughout session, не
     *  disposed после init (workers нужны for on-demand parse). */
    private streamingMgr: StreamingManager | null = null;
    /** Last view signature чтобы триггерить streaming.update только при
     *  значимом view change (а не каждый frame). */
    private lastStreamingViewSig = '';
    /** Manifest existing cells set — reused в визибилити вычислениях. */
    private existingCellsSet: Set<string> | null = null;
    private cellStats: CellLoaderStats | null = null;
    /** Сохраняется после init для последующего flushLayer() при увеличении maxFloor. */
    private cellLoader: CellLoader | null = null;
    private baseLayerCellStride = 0;
    private baseLoadedMaxLayer = 0;

    // === Save-game overlay state ===
    private saveCellTextureMgr: CellTextureManager | null = null;
    private saveCellLoader: SaveCellLoader | null = null;
    private saveWatcher: SaveWatcher | null = null;
    private saveOverlayMode: SaveOverlayMode = 'overlay';
    private saveStats: SaveCellLoaderStats | null = null;
    private saveLastUpdateAt: number | null = null;
    private saveLayerCellStride = 0;
    private saveRequestedMaxLayer = 0;
    private saveLayerLoadInFlight = false;

    private state: RendererState = 'idle';
    private readonly progress: ProgressAggregator;
    private rafHandle: number | null = null;
    private debugView: DebugViewState = {
        mode: 'atlas',
        lod: 0,
        page: 0,
        brightness: 1.0,
        cellX: 0,
        cellY: 0,
        isometric: true,
        sqr: 16,
        pps: 1.0,
        maxFloor: 0,
        floorHeightPx: 192,
        panX: 0,
        panY: 0,
        cellStride: 1,
        squareStride: 1,
        fragDebug: 0,
    };

    constructor(opts: PzMapRendererOptions) {
        this.opts = opts;
        this.progress = new ProgressAggregator(
            [
                { name: 'manifests', weight: 0.05, label: 'admin.pz_map.phase.manifests' },
                { name: 'atlas', weight: 0.40, label: 'admin.pz_map.phase.atlas' },
                { name: 'cells', weight: 0.50, label: 'admin.pz_map.phase.cells' },
                { name: 'finalize', weight: 0.05, label: 'admin.pz_map.phase.finalize' },
            ],
            (snapshot) => this.opts.onProgress?.(snapshot),
            100,
        );
    }

    /** Текущее состояние state machine. */
    getState(): RendererState {
        return this.state;
    }

    /** Доступ к загруженным манифестам (для debug UI). */
    getManifests(): AllManifests | null {
        return this.manifests;
    }

    /** Сколько pages в атласе (для UI слайдера). */
    getPageCount(): number {
        return this.manifests?.atlas.atlas_count ?? 0;
    }

    /** Сколько LOD уровней (для UI слайдера). */
    getLodCount(): number {
        return this.manifests?.atlas.lods.length ?? 0;
    }

    /** Статистика загруженных cells (для debug HUD). */
    getCellStats(): CellLoaderStats | null {
        return this.cellStats;
    }

    /** Информация про cell texture (для debug HUD). */
    getCellTextureInfo() {
        return this.cellTextureMgr?.getInfo() ?? null;
    }

    /** Стата save-overlay загрузки (для debug HUD). */
    getSaveStats(): { stats: SaveCellLoaderStats | null; lastUpdateAt: number | null; mode: SaveOverlayMode } {
        return {
            stats: this.saveStats,
            lastUpdateAt: this.saveLastUpdateAt,
            mode: this.saveOverlayMode,
        };
    }

    /** Переключить режим save-overlay (off / overlay / highlight). */
    setSaveOverlayMode(mode: SaveOverlayMode): void {
        this.saveOverlayMode = mode;
    }

    /**
     * Запросить загрузку save-cells до заданного этажа включительно.
     * Default = 0 (только ground). При повышении подгружаются layer 1..N
     * lazy для всех cells где manifest показывает данные.
     */
    ensureSaveLayersUpTo(maxLayer: number): void {
        const clamped = Math.max(0, Math.min(3, maxLayer));
        if (clamped <= this.saveRequestedMaxLayer) return;
        this.saveRequestedMaxLayer = clamped;
        void this.loadMissingSaveLayers();
    }

    private async loadMissingSaveLayers(): Promise<void> {
        if (this.saveLayerLoadInFlight) return;
        const loader = this.saveCellLoader;
        if (!loader || !this.saveCellTextureMgr) return;
        this.saveLayerLoadInFlight = true;
        try {
            const currentMaxLoaded = loader.getStats().loadedMaxLayer;
            for (let l = currentMaxLoaded + 1; l <= this.saveRequestedMaxLayer; l++) {
                await loader.loadLayer(l);
                this.saveStats = loader.getStats();
            }
        } catch (err) {
            console.warn('[renderer] save layer load failed:', err);
        } finally {
            this.saveLayerLoadInFlight = false;
        }
    }


    /**
     * Запустить полный init pipeline. Завершается переходом в 'ready'
     * (вызывает opts.onReady) или в 'error' (вызывает opts.onError).
     */
    async init(): Promise<void> {
        const { canvas, signal } = this.opts;
        try {
            this.setState('fetching-manifests');
            this.progress.enterPhase('manifests');

            // 1. GL context.
            const ctx = createGlContext(canvas);
            this.gl = ctx.gl;
            this.capabilities = ctx.capabilities;

            // 2. Manifests parallel fetch.
            this.manifests = await loadAllManifests({
                atlasBaseUrl: this.opts.atlasBaseUrl,
                cellsBaseUrl: this.opts.cellsBaseUrl,
                chunksBaseUrl: '/pz-cell-data',
                signal,
            });
            this.progress.setPhaseProgress('manifests', 1);

            // 3. Atlas preload.
            this.setState('preloading-atlas');
            this.progress.enterPhase('atlas');

            let totalBytes = this.manifests.atlas.total_bytes;
            // total_bytes из manifest — суммарный размер всех LOD WebP.
            // Если 0 — fallback к оценке.
            if (!totalBytes || totalBytes < 1024) {
                totalBytes = this.manifests.atlas.atlas_count
                    * this.manifests.atlas.lods.reduce(
                        (sum, l) => sum + l.size * l.size * 4,
                        0,
                    );
            }
            let bytesLoaded = 0;
            let pagesLoaded = 0;
            // Phase 4.3b.4: progress показывается по initial LOD только.
            const initialLod = 0;
            const initialPages = this.manifests.atlas.atlas_count;

            this.atlasLoader = new AtlasLoader({
                gl: this.gl,
                capabilities: this.capabilities,
                manifest: this.manifests.atlas,
                atlasBaseUrl: this.opts.atlasBaseUrl,
                signal,
                onPageLoaded: (_pageId, lod) => {
                    if (lod === initialLod) {
                        pagesLoaded++;
                        this.progress.setPhaseProgress(
                            'atlas',
                            pagesLoaded / initialPages,
                        );
                    }
                },
                onBytes: (bytes) => {
                    bytesLoaded += bytes;
                },
            });
            // Грузим только active LOD (default 0). Остальные — в фоне после ready.
            this.atlasTextures = await this.atlasLoader.loadInitialLod(initialLod);
            this.progress.setPhaseProgress('atlas', 1);
            void bytesLoaded; // используется для будущих ETA метрик

            // Background load остальных LODs — не блокирует init.
            const atlasLoaderRef = this.atlasLoader;
            void atlasLoaderRef
                .loadOthersInBackground(initialLod)
                .catch((err) => {
                    if ((err as Error).name === 'AbortError') return;
                    console.warn('[renderer] background LOD load:', err);
                });

            // 4. Cells preload (Phase 2).
            this.setState('preloading-cells');
            this.progress.enterPhase('cells');

            // Compute cell bounds для CellTextureManager.
            const cellCoords = this.manifests.cells.cells;
            let minCx = Infinity;
            let minCy = Infinity;
            let maxCx = -Infinity;
            let maxCy = -Infinity;
            for (const [cx, cy] of cellCoords) {
                if (cx < minCx) minCx = cx;
                if (cy < minCy) minCy = cy;
                if (cx > maxCx) maxCx = cx;
                if (cy > maxCy) maxCy = cy;
            }
            if (cellCoords.length === 0) {
                minCx = 0;
                minCy = 0;
                maxCx = 0;
                maxCy = 0;
            }

            const indexGridWidth = Math.max(1, maxCx - minCx + 1);
            const indexGridHeight = Math.max(1, maxCy - minCy + 1);
            // cellAtlas size: 16384×16384 R32UI (= 268M texels = 1 GB VRAM).
            // Ground-only mode не помещается в 8192h (cell (1,58) одна =
            // 167k texels, total ~150-240M). Возвращаем 16384h для запаса.
            // VRAM экономится через keepMaxLayer=1 в parse time (меньше
            // entries) но atlas storage same.
            const maxTex = this.capabilities.maxTextureSize;
            const ATLAS_WIDTH = Math.min(16384, maxTex);
            const ATLAS_HEIGHT = Math.min(16384, maxTex);

            // Phase 5.9: rect_cover + preflight parse. Сначала parsim все
            // cells через workers с deferAppend=true, packed buffers
            // буферизируются в JS. Затем считаем точные размеры per region
            // (через packed.length sum) и создаём atlases. Финально
            // appendим buffered packs.
            const regionRects = computeRectCover(this.manifests.cells.cells);
            console.info(
                `[renderer] computed ${regionRects.length} region rects:`,
                regionRects,
            );

            // Worker pool + sprite name → id mapping (нужны ДО preflight).
            this.workerPool = new WorkerPool();
            const spriteNameToId = buildSpriteNameToId(this.manifests.sprites);
            this.workerPool.initSpriteIndex(spriteNameToId);

            // Preflight loader: parse all cells, buffer packs (no atlas yet).
            const preflightLoader = new CellLoader({
                pool: this.workerPool,
                textureMgr: null,
                cellsManifest: this.manifests.cells,
                cellsBaseUrl: this.opts.cellsBaseUrl,
                atlasVersion: this.manifests.atlas.version,
                signal,
                deferAppend: true,
                onCellProgress: (loaded, total) => {
                    this.progress.setPhaseProgress('cells', loaded / total);
                },
            });

            const preflightStats = await preflightLoader.loadAll();
            console.info(
                `[renderer] preflight done: ${preflightStats.parsedCells} cells, ${preflightLoader.deferredPacks.size} packs`,
            );

            // Compute exact texels per region (sum of packed.length).
            // Включаем upper layers (1..3) которые лежат в pendingLayerPacks —
            // даже если они uploaded позже через flushLayer(), atlas всё равно
            // должен иметь физическое место под них.
            const regionTexels = new Array(regionRects.length).fill(0);
            const inRect = (rx: number, ry: number, rw: number, rh: number, cx: number, cy: number): boolean =>
                cx >= rx && cx < rx + rw && cy >= ry && cy < ry + rh;
            for (const pack of preflightLoader.deferredPacks.values()) {
                for (let i = 0; i < regionRects.length; i++) {
                    const [rx, ry, rw, rh] = regionRects[i]!;
                    if (inRect(rx, ry, rw, rh, pack.cellX, pack.cellY)) {
                        regionTexels[i] += pack.packed.length;
                        break;
                    }
                }
            }
            for (const slot of preflightLoader.pendingLayerPacks.values()) {
                for (let i = 0; i < regionRects.length; i++) {
                    const [rx, ry, rw, rh] = regionRects[i]!;
                    if (inRect(rx, ry, rw, rh, slot.cellX, slot.cellY)) {
                        regionTexels[i] += slot.packed.length;
                        break;
                    }
                }
            }

            // Atlas heights точные + 5% safety + alignment 64.
            const SAFETY = 1.05;
            const ALIGN = 64;
            const atlasHeights = regionTexels.map((texels, i) => {
                const required = Math.ceil(texels * SAFETY);
                const minH = Math.max(64, Math.ceil(required / ATLAS_WIDTH));
                const aligned = Math.ceil(minH / ALIGN) * ALIGN;
                console.info(
                    `[renderer] region ${i}: ${texels} actual texels → atlas ${ATLAS_WIDTH}×${aligned} `
                    + `(${((ATLAS_WIDTH * aligned * 4) / 1024 / 1024).toFixed(0)} MB)`,
                );
                return Math.min(aligned, ATLAS_HEIGHT);
            });

            // indexGridHeight × 4 — виртуальное пространство для PZ layers
            // (0..3). Upload каждого layer N идёт в slot (cellX, cellY + N * stride).
            // Layer 0 загружается через flushDeferred, layers 1..3 — через
            // flushLayer() по требованию слайдера maxFloor.
            const baseLayerCellStride = indexGridHeight;
            this.baseLayerCellStride = baseLayerCellStride;
            const indexGridHeightExpanded = indexGridHeight * 4;
            const regionRectsExpanded = regionRects.map(([rx, ry, rw, rh]) =>
                [rx, ry, rw, rh * 4] as readonly [number, number, number, number],
            );

            this.cellTextureMgr = new CellTextureManager({
                gl: this.gl,
                atlasWidth: ATLAS_WIDTH,
                atlasHeight: ATLAS_HEIGHT,
                indexGridWidth,
                indexGridHeight: indexGridHeightExpanded,
                originCellX: minCx,
                originCellY: minCy,
                atlasHeights,
                regionRects: regionRectsExpanded,
            });

            // Flush deferred packs (layer 0) → atlas.
            preflightLoader.flushDeferred(this.cellTextureMgr);

            // Reuse stats (preflight уже parsed everything).
            const cellLoader = preflightLoader;
            this.cellLoader = cellLoader;

            // firstReadyPromise resolves сразу — atlas заполнен.
            let firstReadyResolve!: () => void;
            const firstReadyPromise = new Promise<void>((r) => {
                firstReadyResolve = r;
            });

            // Bulk loadAll completed via preflight. workerPool dispose
            // immediately.
            const workerPoolRef = this.workerPool;
            const cellLoadPromise = Promise.resolve(preflightStats)
                .then((stats) => {
                    this.cellStats = stats;
                    this.progress.setPhaseProgress('cells', 1);
                    workerPoolRef.dispose();
                    if (this.workerPool === workerPoolRef) {
                        this.workerPool = null;
                    }
                })
                .catch((err) => {
                    if ((err as Error).name === 'AbortError') return;
                    console.error('[renderer] cell loader failed:', err);
                });
            void cellLoadPromise;
            void cellLoadPromise.then(() => firstReadyResolve());

            this.setState('finalizing');
            this.progress.enterPhase('finalize');

            // Sprite info texture (RGBA32F lookup для всех sprites × LOD).
            this.spriteInfoTex = buildSpriteInfoTexture({
                gl: this.gl,
                sprites: this.manifests.sprites,
                spriteNameToId,
                nLods: this.manifests.atlas.lods.length,
                maxTextureSize: this.capabilities.maxTextureSize,
            });

            // Debug shader (atlas viewer).
            this.debugProgram = compileShaderProgram(
                this.gl,
                debugVertSrc,
                debugFragSrc,
                ['uAtlasArray', 'uLayer', 'uBrightness'],
            );

            // Main shader (cell renderer).
            this.mainProgram = compileShaderProgram(
                this.gl,
                mainVertSrc,
                mainFragSrc,
                [
                    'uViewProj',
                    'uCellOriginSq',
                    'uCellOffsetInAtlas',
                    'uSqr',
                    'uIsometric',
                    'uLod',
                    'uNLods',
                    'uCellAtlas',
                    'uCellAtlasWidth',
                    'uSpriteInfo',
                    'uSpriteInfoWidth',
                    'uAtlasArray',
                    'uDebugMode',
                    'uNativeSqr',
                    'uAtlasNativeSize',
                    'uLodAtlasSize',
                    'uMaxFloor',
                    'uFloorHeightPx',
                    'uMaxWorldDepth',
                    'uSquareStride',
                    'uIsSavePass',
                    'uHighlightChanges',
                    'uForceLayer',
                ],
            );

            // Empty VAO — оба shader используют gl_VertexID без attribs.
            this.debugVao = this.gl.createVertexArray();
            if (!this.debugVao) throw new Error('[renderer] createVertexArray failed');

            // Phase 4.3b.3: ждём первый batch cells перед ready. Это даёт
            // пользователю первую картинку через ~200ms (вместо 30 sec).
            await firstReadyPromise;

            this.progress.setPhaseProgress('finalize', 1);
            this.setState('ready');
            this.startRenderLoop();
            this.opts.onReady?.();

            // Запускаем save-overlay асинхронно — не блокирует ready.
            if (this.opts.enableSaveOverlay !== false) {
                void this.initSaveOverlay().catch((err) => {
                    console.warn('[renderer] save-overlay init failed:', err);
                });
            }
        } catch (err) {
            if ((err as Error).name === 'AbortError') {
                this.setState('cancelled');
                return;
            }
            const message
                = err instanceof WebGL2NotSupportedError
                    ? 'WebGL2 не поддерживается'
                    : err instanceof Error
                        ? err.message
                        : String(err);
            this.progress.setError(message);
            this.setState('error');
            this.opts.onError?.(err instanceof Error ? err : new Error(message));
        }
    }

    /**
     * Phase 1 render loop — рисует одну atlas page на canvas (debug).
     * Phase 4 заменит на полноценный карт-рендер.
     */
    private startRenderLoop(): void {
        const loop = (): void => {
            if (this.state !== 'ready') return;
            if (this.debugView.mode === 'atlas') {
                this.drawAtlasDebugFrame();
            } else {
                this.drawCellDebugFrame();
            }
            this.rafHandle = requestAnimationFrame(loop);
        };
        this.rafHandle = requestAnimationFrame(loop);
    }

    private drawAtlasDebugFrame(): void {
        if (
            !this.gl
            || !this.atlasTextures
            || !this.debugProgram
            || !this.debugVao
        ) {
            return;
        }
        const gl = this.gl;
        this.resizeCanvas();
        const { width: w, height: h } = this.opts.canvas;
        gl.viewport(0, 0, w, h);
        gl.clearColor(0.1, 0.1, 0.12, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.disable(gl.DEPTH_TEST);

        const lodTex = this.atlasTextures.get(this.debugView.lod);
        if (!lodTex) return;

        gl.useProgram(this.debugProgram.program);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, lodTex.texture);
        gl.uniform1i(this.debugProgram.uniforms.uAtlasArray!, 0);
        gl.uniform1f(this.debugProgram.uniforms.uLayer!, this.debugView.page);
        gl.uniform1f(
            this.debugProgram.uniforms.uBrightness!,
            this.debugView.brightness,
        );
        gl.bindVertexArray(this.debugVao);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);
    }

    /**
     * Phase 4.1: рендерит все cells в viewport. Camera = центр cellX/cellY
     * + pan. Iterate по cellRange, для каждой непустой cell проверяем
     * её bounding box в pixel space против viewport AABB — если overlap,
     * выпускаем drawArraysInstanced с per-cell uniforms.
     *
     * Single GL program + bound textures (cellAtlas, spriteInfo,
     * atlasArray) переиспользуются. Per-cell мы меняем только
     * uCellOriginSq + uCellOffsetInAtlas + entriesCount.
     */
    private drawCellDebugFrame(): void {
        if (
            !this.gl
            || !this.atlasTextures
            || !this.cellTextureMgr
            || !this.spriteInfoTex
            || !this.mainProgram
            || !this.debugVao
            || !this.manifests
        ) {
            return;
        }
        const gl = this.gl;
        this.resizeCanvas();
        const { width: w, height: h } = this.opts.canvas;
        gl.viewport(0, 0, w, h);
        gl.clearColor(0.07, 0.07, 0.10, 1.0);
        gl.clearDepth(1.0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);

        const {
            cellX,
            cellY,
            isometric,
            sqr,
            pps,
            lod,
            maxFloor,
            floorHeightPx,
            panX,
            panY,
            cellStride,
            squareStride,
        } = this.debugView;

        // Phase 4.3b.4: fall back на LOD 0 если запрошенный ещё не догружен
        // в фоне (atlas pages для него не все приехали). LOD 0 загружен
        // полностью при init — всегда safe.
        let effectiveLod = lod;
        if (this.atlasLoader && this.manifests) {
            const expectedPages = this.manifests.atlas.atlas_count;
            if (this.atlasLoader.loadedPageCount(lod) < expectedPages) {
                effectiveLod = 0;
            }
        }
        const lodTex = this.atlasTextures.get(effectiveLod);
        if (!lodTex) return;

        // Camera center = центр выбранной cell + pan offset.
        const cellSizeInSquares = 256;
        const midSx = cellX * cellSizeInSquares + cellSizeInSquares / 2;
        const midSy = cellY * cellSizeInSquares + cellSizeInSquares / 2;
        let camCenterX: number;
        let camCenterY: number;
        if (isometric) {
            camCenterX = (midSx - midSy) * sqr;
            camCenterY = (midSx + midSy) * (sqr * 0.5) + sqr * 0.5;
        } else {
            camCenterX = midSx * sqr;
            camCenterY = midSy * sqr;
        }
        const camX = camCenterX + panX;
        const camY = camCenterY + panY;

        const orthoHalfW = w / (2 * pps);
        const orthoHalfH = h / (2 * pps);
        const viewLeft = camX - orthoHalfW;
        const viewRight = camX + orthoHalfW;
        const viewTop = camY - orthoHalfH;
        const viewBottom = camY + orthoHalfH;

        const view = makeOrthoMatrix(
            viewLeft,
            viewRight,
            viewBottom, // bottom (Y down convention)
            viewTop, // top
        );

        // ---------- Setup shared uniforms (once per frame) ----------
        gl.useProgram(this.mainProgram.program);
        const u = this.mainProgram.uniforms;
        gl.uniformMatrix4fv(u.uViewProj!, false, view);
        gl.uniform1f(u.uSqr!, sqr);
        gl.uniform1f(u.uNativeSqr!, 64);
        // Save overlay uniforms — base pass всегда с isSavePass=0.
        gl.uniform1i(u.uIsSavePass!, 0);
        gl.uniform1i(u.uHighlightChanges!, 0);
        // -1 = use decoded layer from entry (всегда 0 для compact format).
        // Save pass overridит для upper floors.
        gl.uniform1i(u.uForceLayer!, -1);
        gl.uniform1i(u.uIsometric!, isometric ? 1 : 0);
        gl.uniform1i(u.uLod!, lod);
        gl.uniform1i(u.uNLods!, this.manifests.atlas.lods.length);
        gl.uniform1i(u.uDebugMode!, this.debugView.fragDebug);
        gl.uniform1f(u.uAtlasNativeSize!, this.manifests.sprites.atlas_size);
        // Phase 6.1: current LOD atlas page size для UV inset.
        const lodInfo = this.manifests.atlas.lods.find((l) => l.id === effectiveLod)
            ?? this.manifests.atlas.lods[0]!;
        gl.uniform1f(u.uLodAtlasSize!, lodInfo.size);
        gl.uniform1i(u.uMaxFloor!, maxFloor);
        gl.uniform1f(u.uFloorHeightPx!, floorHeightPx);
        // effectiveStride = sprite scale + stride-bucket selector.
        // CPU решает какой instance count передавать (через strideOffsets);
        // shader только использует stride для масштаба sprite.
        const effectiveStride = Math.max(1, squareStride);
        gl.uniform1i(u.uSquareStride!, effectiveStride);
        // strideBucketIdx K такой что 2^K = effectiveStride.
        // K=0: все entries. K=6: только stride-64-aligned.
        const strideBucketIdx = Math.max(
            0,
            Math.min(6, Math.round(Math.log2(effectiveStride))),
        );

        // Phase 4.5: atlas slot size держится по ЗАПРОШЕННОМУ К (из tuning,
        // не bumped). Это стабильное, меняется только при реальном zoom-change.
        // Phase 5 bump только режет render subset (instance count) — не trogem
        // atlas. Hysteresis применяется в setCurrentK.
        // Streaming disabled — bulk loadAll режим.

        // Global depth normalizer: max world sx+sy across весь loaded map.
        // Buffer +cellSize×2 чтобы layer/stack punches не вылезли за [-1..1].
        const range = this.getCellRange();
        const maxWorldSum = range
            ? (range.maxX + range.maxY + 2) * cellSizeInSquares + 512
            : cellSizeInSquares * 2;
        gl.uniform1f(u.uMaxWorldDepth!, maxWorldSum);

        // ---------- Bind textures (once per frame) ----------
        const cellInfo = this.cellTextureMgr.getInfo();
        gl.activeTexture(gl.TEXTURE0);
        // Binding делается per cell в Phase 3 loop (с группировкой
        // по atlasLayer). Здесь только uniform0 unit + width.
        gl.uniform1i(u.uCellAtlas!, 0);
        gl.uniform1i(u.uCellAtlasWidth!, cellInfo.atlasWidth);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.spriteInfoTex.texture);
        gl.uniform1i(u.uSpriteInfo!, 1);
        gl.uniform1i(u.uSpriteInfoWidth!, this.spriteInfoTex.width);

        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, lodTex.texture);
        gl.uniform1i(u.uAtlasArray!, 2);

        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(
            gl.SRC_ALPHA,
            gl.ONE_MINUS_SRC_ALPHA,
            gl.ONE,
            gl.ONE_MINUS_SRC_ALPHA,
        );

        gl.bindVertexArray(this.debugVao);

        // ---------- Per-cell loop ----------
        // Padding для overshooting sprites (деревья высотой ≈500 px native,
        // floor offset ≈192 × 3 = 576 px). Plus margin for safety.
        const padding = (700 + 600) * (sqr / 64);

        if (!range) {
            gl.bindVertexArray(null);
            return;
        }

        // === Phase 1: visibility test → собираем visible cells ===
        // Phase 5.5: при K>0 cells stored at anchor coords (cellX % N == 0).
        // Super-cell spans N×N base cells in world space. Iterate с step N.
        const streamingK = this.streamingMgr?.getCurrentK() ?? 0;
        const superN = 1 << streamingK;
        const cellSpanSquares = cellSizeInSquares * superN;
        type VisibleCell = {
            cx: number;
            cy: number;
            offset: number;
            entriesCount: number;
            atlasLayer: number;
            strideOffsets?: Uint32Array;
        };
        const visibleCells: VisibleCell[] = [];
        // Align iteration к anchor: первая anchor cell = floor(minX/N)*N.
        const iterStartCx = Math.floor(range.minX / superN) * superN;
        const iterStartCy = Math.floor(range.minY / superN) * superN;
        // pzmap2dzi-style: base рисует ВСЁ всегда. Save рисуется поверх через
        // alpha + z-bias. Никаких skip — base даёт blends и full ground везде.
        for (let cy = iterStartCy; cy <= range.maxY; cy += superN) {
            for (let cx = iterStartCx; cx <= range.maxX; cx += superN) {
                const info = this.cellTextureMgr.getCellInfo(cx, cy);
                if (!info || info.length === 0) continue;

                const cellOriginSx = cx * cellSizeInSquares;
                const cellOriginSy = cy * cellSizeInSquares;
                const cellEndSx = cellOriginSx + cellSpanSquares;
                const cellEndSy = cellOriginSy + cellSpanSquares;
                let minX: number;
                let maxX: number;
                let minY: number;
                let maxY: number;
                if (isometric) {
                    const h2 = sqr * 0.5;
                    const c1x = (cellOriginSx - cellOriginSy) * sqr;
                    const c2x = (cellEndSx - cellOriginSy) * sqr;
                    const c3x = (cellOriginSx - cellEndSy) * sqr;
                    const c4x = (cellEndSx - cellEndSy) * sqr;
                    const c1y = (cellOriginSx + cellOriginSy) * h2;
                    const c2y = (cellEndSx + cellOriginSy) * h2;
                    const c3y = (cellOriginSx + cellEndSy) * h2;
                    const c4y = (cellEndSx + cellEndSy) * h2;
                    minX = Math.min(c1x, c2x, c3x, c4x);
                    maxX = Math.max(c1x, c2x, c3x, c4x);
                    minY = Math.min(c1y, c2y, c3y, c4y);
                    maxY = Math.max(c1y, c2y, c3y, c4y);
                } else {
                    minX = cellOriginSx * sqr;
                    maxX = cellEndSx * sqr;
                    minY = cellOriginSy * sqr;
                    maxY = cellEndSy * sqr;
                }
                minX -= padding;
                minY -= padding;
                maxX += padding;
                maxY += padding;
                if (maxX < viewLeft || minX > viewRight) continue;
                if (maxY < viewTop || minY > viewBottom) continue;

                visibleCells.push({
                    cx,
                    cy,
                    offset: info.offset,
                    // Compact 1-texel format (Phase 5.6): length = entries directly.
                    entriesCount: info.length,
                    atlasLayer: info.atlasLayer,
                    strideOffsets: info.strideOffsets,
                });
            }
        }

        // === Phase 2: Phase 5 auto-tune — bump K если instances > target ===
        // ВАЖНО: при streamingK > 0 (super-cell mode) рендер К forced =
        // streamingK. Super-pack хранит entries с encoded sx (= origSx/N),
        // shader делает sx * uSquareStride. Несовпадение К → wrong positions.
        const INSTANCE_TARGET = 2_000_000;
        let renderK = streamingK > 0 ? streamingK : strideBucketIdx;
        if (streamingK === 0) {
            const sumAtK = (k: number): number => {
                let s = 0;
                for (const cell of visibleCells) {
                    const raw = cell.strideOffsets
                        ? cell.strideOffsets[k]!
                        : cell.entriesCount;
                    s += Math.min(raw, cell.entriesCount);
                }
                return s;
            };
            while (renderK < 6 && sumAtK(renderK) > INSTANCE_TARGET) {
                renderK++;
            }
        }
        // Update shader uniform: stride = 2^renderK.
        const adjustedStride = 1 << renderK;
        gl.uniform1i(u.uSquareStride!, adjustedStride);

        // === Phase 3: draw visible cells на финальном renderK ===
        // Iterate PZ layers 0..maxFloor чтобы upper-floor sprites сдвигались
        // вверх через uFloorHeightPx × layer в vertex shader.
        visibleCells.sort((a, b) => a.atlasLayer - b.atlasLayer);
        let drawn = 0;
        let totalInstances = 0;
        let boundLayer = -1;
        gl.activeTexture(gl.TEXTURE0);
        const baseStride = this.baseLayerCellStride;
        for (let pzLayer = 0; pzLayer <= maxFloor && pzLayer <= 3; pzLayer++) {
            gl.uniform1i(u.uForceLayer!, pzLayer);
            for (const cell of visibleCells) {
                let info = pzLayer === 0
                    ? { offset: cell.offset, length: cell.entriesCount, atlasLayer: cell.atlasLayer, strideOffsets: cell.strideOffsets }
                    : this.cellTextureMgr.getCellInfo(cell.cx, cell.cy + pzLayer * baseStride);
                if (!info || info.length === 0) continue;

                const cellOriginSx = cell.cx * cellSizeInSquares;
                const cellOriginSy = cell.cy * cellSizeInSquares;
                const rawCount = info.strideOffsets
                    ? info.strideOffsets[renderK]!
                    : info.length;
                const instanceCount = Math.min(rawCount, info.length);
                if (instanceCount === 0) continue;
                if (info.atlasLayer !== boundLayer) {
                    const tex = this.cellTextureMgr.getAtlasTextureForLayer(info.atlasLayer);
                    if (tex) {
                        gl.bindTexture(gl.TEXTURE_2D, tex);
                        boundLayer = info.atlasLayer;
                    }
                }
                gl.uniform2f(u.uCellOriginSq!, cellOriginSx, cellOriginSy);
                gl.uniform1ui(u.uCellOffsetInAtlas!, info.offset);
                gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instanceCount);
                drawn++;
                totalInstances += instanceCount;
            }
        }
        gl.uniform1i(u.uForceLayer!, -1);

        // === Save-overlay pass ===
        // depthFunc(LEQUAL) уже включён выше — save sprites побеждают base
        // при равной глубине. Same shader, same atlas array texture binding.
        if (this.saveOverlayMode !== 'off' && this.saveCellTextureMgr) {
            this.drawSaveOverlayPass(
                viewLeft,
                viewRight,
                viewTop,
                viewBottom,
                sqr,
                isometric,
                renderK,
            );
        }

        gl.bindVertexArray(null);
        this.lastDrawnCellsCount = drawn;
        this.lastDrawnInstanceCount = totalInstances;
        this.lastRenderK = renderK;

        // Streaming disabled (был в Phase 4.4) — bulk loadAll режим.
    }

    /** Number of cells drawn в последнем frame (для HUD/debug). */
    private lastDrawnCellsCount = 0;
    private lastDrawnInstanceCount = 0;
    private lastRenderK = 0;
    getLastDrawnCellsCount(): number {
        return this.lastDrawnCellsCount;
    }
    getLastDrawnInstanceCount(): number {
        return this.lastDrawnInstanceCount;
    }
    /** Phase 5: actual K used при render (may be bumped from requested). */
    getLastRenderK(): number {
        return this.lastRenderK;
    }

    private resizeCanvas(): void {
        const { canvas } = this.opts;
        const w = canvas.clientWidth || canvas.width || 800;
        const h = canvas.clientHeight || canvas.height || 600;
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }
    }

    /**
     * Управление debug viewer (Phase 1-3). Phase 4+ заменит реальным
     * Leaflet рендером карты.
     */
    setDebugView(view: Partial<DebugViewState>): void {
        const prev = this.debugView;
        this.debugView = { ...prev, ...view };
        if (view.maxFloor !== undefined && view.maxFloor > prev.maxFloor) {
            this.ensureSaveLayersUpTo(view.maxFloor);
            this.ensureBaseLayersUpTo(view.maxFloor);
        }
    }

    /**
     * Upload base map upper-layer entries (1..N) в cellTextureMgr. Workers
     * парсят все layers сразу при init, но в atlas изначально кладётся только
     * layer 0. Этажи 1+ ждут в pendingLayerPacks до этого вызова.
     */
    private ensureBaseLayersUpTo(maxLayer: number): void {
        if (!this.cellLoader || !this.cellTextureMgr) return;
        const target = Math.max(0, Math.min(3, maxLayer));
        for (let l = this.baseLoadedMaxLayer + 1; l <= target; l++) {
            const uploaded = this.cellLoader.flushLayer(
                l, this.cellTextureMgr, this.baseLayerCellStride,
            );
            console.info(`[renderer] base layer ${l} uploaded: ${uploaded} cells`);
        }
        this.baseLoadedMaxLayer = Math.max(this.baseLoadedMaxLayer, target);
    }

    /** Текущий snapshot debug view (для UI controls). */
    getDebugView(): DebugViewState {
        return { ...this.debugView };
    }

    /**
     * Возвращает (offset, length) для cell — нужно UI чтобы знать,
     * какие cells непустые при выборе в debug.
     */
    getCellEntryCount(cellX: number, cellY: number): number {
        return (this.cellTextureMgr?.getCellInfo(cellX, cellY)?.length ?? 0) / 2;
    }

    /** Доступ к bound cells (для UI слайдеров). */
    getCellRange(): { minX: number; maxX: number; minY: number; maxY: number } | null {
        if (!this.cellTextureMgr) return null;
        const info = this.cellTextureMgr.getInfo();
        return {
            minX: info.originCellX,
            maxX: info.originCellX + info.indexGridWidth - 1,
            minY: info.originCellY,
            maxY: info.originCellY + info.indexGridHeight - 1,
        };
    }

    /**
     * Auto-fit pps: рассчитывает zoom factor чтобы выбранная cell
     * целиком помещалась в canvas с небольшим padding.
     *
     * Cell в isometric проекции (PZ canonical) имеет screen-bounds
     * X = ±cellSize×sqr (диагональ ромба), Y = cellSize×sqr.
     * Top-down — квадрат (cellSize × sqr) на сторону.
     */
    computeAutoFitPps(): number {
        const { canvas } = this.opts;
        const w = canvas.clientWidth || canvas.width || 800;
        const h = canvas.clientHeight || canvas.height || 600;
        const { sqr, isometric } = this.debugView;
        const cellSizeInSquares = 256;
        const cellPxW = isometric
            ? cellSizeInSquares * sqr * 2
            : cellSizeInSquares * sqr;
        const cellPxH = isometric ? cellSizeInSquares * sqr : cellSizeInSquares * sqr;
        const padding = 1.1;
        const ppsX = w / (cellPxW * padding);
        const ppsY = h / (cellPxH * padding);
        return Math.min(ppsX, ppsY);
    }

    /**
     * Auto-fit pps на ВСЮ карту (все cells в cellRange). Используется
     * для default view: пользователь сразу видит всю карту, может
     * zoom-in.
     */
    computeAutoFitMapPps(): number {
        const { canvas } = this.opts;
        const w = canvas.clientWidth || canvas.width || 800;
        const h = canvas.clientHeight || canvas.height || 600;
        const { sqr, isometric } = this.debugView;
        const range = this.getCellRange();
        if (!range) return this.computeAutoFitPps();
        const cellSizeInSquares = 256;
        const sxRange = (range.maxX - range.minX + 1) * cellSizeInSquares;
        const syRange = (range.maxY - range.minY + 1) * cellSizeInSquares;
        let mapPxW: number;
        let mapPxH: number;
        if (isometric) {
            // Iso diamond bounds: X spans ±(sxRange + syRange)/2 × sqr,
            // Y spans (sxRange + syRange) × sqr/2.
            // Total iso width = (sxRange + syRange) * sqr (диагональ ромба)
            // Total iso height = (sxRange + syRange) * sqr / 2
            mapPxW = (sxRange + syRange) * sqr;
            mapPxH = (sxRange + syRange) * sqr * 0.5;
        } else {
            mapPxW = sxRange * sqr;
            mapPxH = syRange * sqr;
        }
        const padding = 1.05;
        const ppsX = w / (mapPxW * padding);
        const ppsY = h / (mapPxH * padding);
        return Math.min(ppsX, ppsY);
    }

    /**
     * Iso pixel center всей карты (для default camera position).
     * Возвращает (cellX, cellY) середины cellRange и (pixelX, pixelY)
     * iso центра для информации.
     */
    computeMapCenter(): { cellX: number; cellY: number } | null {
        const range = this.getCellRange();
        if (!range) return null;
        return {
            cellX: Math.floor((range.minX + range.maxX) / 2),
            cellY: Math.floor((range.minY + range.maxY) / 2),
        };
    }

    /**
     * Инициализация save-overlay pipeline. Запускается после base renderer
     * вошёл в 'ready' — не блокирует первичную загрузку.
     *
     * Никакого client-side парсинга: серверный artisan `pz:rebuild-save-cache`
     * уже выпек packed Uint32Array файлы через Python pzdataspec, nginx раздаёт
     * их напрямую. Мы просто скачиваем готовые байты и заливаем в GPU.
     */
    private async initSaveOverlay(): Promise<void> {
        if (!this.gl || !this.capabilities || !this.cellTextureMgr) return;

        const baseInfo = this.cellTextureMgr.getInfo();
        const saveBaseUrl = this.opts.saveBaseUrl ?? '/pz-save-data';

        // Atlas: индексируем по effectiveCellY = cellY + layer * layerCellStride.
        // Это позволяет хранить entries для разных layers одной и той же cell
        // в разных слотах одного atlas. layerCellStride должен быть >= ширины
        // cell range, чтобы layer 1 не пересекался с layer 0.
        const layerCellStride = baseInfo.indexGridHeight;
        const ATLAS_WIDTH = Math.min(2048, this.capabilities.maxTextureSize);
        const ATLAS_HEIGHT = Math.min(8192, this.capabilities.maxTextureSize);
        // indexGridHeight × MAX_LAYERS (4) для виртуальной грид-расширения.
        const indexGridHeightExpanded = baseInfo.indexGridHeight * 4;
        const regionRect: readonly [number, number, number, number] = [
            baseInfo.originCellX,
            baseInfo.originCellY,
            baseInfo.indexGridWidth,
            indexGridHeightExpanded,
        ];

        this.saveCellTextureMgr = new CellTextureManager({
            gl: this.gl,
            atlasWidth: ATLAS_WIDTH,
            atlasHeight: ATLAS_HEIGHT,
            indexGridWidth: baseInfo.indexGridWidth,
            indexGridHeight: indexGridHeightExpanded,
            originCellX: baseInfo.originCellX,
            originCellY: baseInfo.originCellY,
            atlasHeights: [ATLAS_HEIGHT],
            regionRects: [regionRect],
        });

        this.saveCellLoader = new SaveCellLoader({
            textureMgr: this.saveCellTextureMgr,
            saveBaseUrl,
            layerCellStride,
            signal: this.opts.signal,
        });
        this.saveLayerCellStride = layerCellStride;

        const initialManifest = await this.saveCellLoader.loadManifest();
        if (!initialManifest) {
            console.info('[renderer] save-overlay: no manifest yet (server cache not built)');
            this.saveStats = this.saveCellLoader.getStats();
        } else {
            // По дефолту только layer 0. Upper floors грузятся через
            // ensureSaveLayersUpTo() когда пользователь крутит maxFloor.
            await this.saveCellLoader.loadInitial();
            this.saveCellTextureMgr.flush();
            this.saveStats = this.saveCellLoader.getStats();
            console.info(
                `[renderer] save-overlay layer 0 loaded: ${this.saveStats.loadedSlots} cells, `
                + `save_version=B${this.saveStats.saveVersion ?? '?'}`,
            );
        }

        // Запускаем watcher для real-time updates.
        this.saveWatcher = new SaveWatcher({
            loader: this.saveCellLoader,
            onUpdate: (changedCells, lastUpdateAt) => {
                this.saveLastUpdateAt = lastUpdateAt;
                if (this.saveCellLoader) {
                    this.saveStats = this.saveCellLoader.getStats();
                }
                    console.info(
                    `[renderer] save-overlay updated: ${changedCells} cells changed`,
                );
            },
        });
        if (initialManifest) {
            this.saveWatcher.setInitialManifestVersion(initialManifest.version);
        }
        this.saveWatcher.start();
    }

    /**
     * Save-overlay pass — рендерит save-cells поверх базы используя тот же
     * shader program и uniforms, но binding отдельной cell-atlas texture
     * и устанавливая uIsSavePass=1 (для potential highlight tint).
     */
    private drawSaveOverlayPass(
        viewLeft: number,
        viewRight: number,
        viewTop: number,
        viewBottom: number,
        sqr: number,
        isometric: boolean,
        renderK: number,
    ): void {
        if (
            !this.gl
            || !this.saveCellTextureMgr
            || !this.mainProgram
            || this.saveOverlayMode === 'off'
        ) {
            return;
        }
        const gl = this.gl;
        const u = this.mainProgram.uniforms;

        gl.uniform1i(u.uIsSavePass!, 1);
        gl.uniform1i(
            u.uHighlightChanges!,
            this.saveOverlayMode === 'highlight' ? 1 : 0,
        );

        const saveInfo = this.saveCellTextureMgr.getInfo();
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1i(u.uCellAtlas!, 0);
        gl.uniform1i(u.uCellAtlasWidth!, saveInfo.atlasWidth);

        const cellSizeInSquares = 256;
        const padding = (700 + 600) * (sqr / 64);

        // Iterate всех save cells. Без super-cell logic (saveOverlay не
        // использует streaming K — это маленький overlay).
        const range = this.getCellRange();
        if (!range) {
            gl.uniform1ui(u.uIsSavePass!, 0);
            gl.uniform1ui(u.uHighlightChanges!, 0);
            return;
        }

        let boundAtlasLayer = -1;
        let drawnSave = 0;
        const maxFloor = this.debugView.maxFloor;
        const layerStride = this.saveLayerCellStride;
        // Iterate layers 0..maxFloor чтобы upper-floor sprites сдвигались
        // вверх через uFloorHeightPx × layer в vertex shader.
        for (let pzLayer = 0; pzLayer <= maxFloor && pzLayer <= 3; pzLayer++) {
            gl.uniform1i(u.uForceLayer!, pzLayer);
            for (let cy = range.minY; cy <= range.maxY; cy++) {
                for (let cx = range.minX; cx <= range.maxX; cx++) {
                    const effectiveCy = cy + pzLayer * layerStride;
                    const info = this.saveCellTextureMgr.getCellInfo(cx, effectiveCy);
                    if (!info || info.length === 0) continue;

                    const cellOriginSx = cx * cellSizeInSquares;
                    const cellOriginSy = cy * cellSizeInSquares;
                    const cellEndSx = cellOriginSx + cellSizeInSquares;
                    const cellEndSy = cellOriginSy + cellSizeInSquares;
                    let minX: number;
                    let maxX: number;
                    let minY: number;
                    let maxY: number;
                    if (isometric) {
                        const h2 = sqr * 0.5;
                        const c1x = (cellOriginSx - cellOriginSy) * sqr;
                        const c2x = (cellEndSx - cellOriginSy) * sqr;
                        const c3x = (cellOriginSx - cellEndSy) * sqr;
                        const c4x = (cellEndSx - cellEndSy) * sqr;
                        const c1y = (cellOriginSx + cellOriginSy) * h2;
                        const c2y = (cellEndSx + cellOriginSy) * h2;
                        const c3y = (cellOriginSx + cellEndSy) * h2;
                        const c4y = (cellEndSx + cellEndSy) * h2;
                        minX = Math.min(c1x, c2x, c3x, c4x) - padding;
                        maxX = Math.max(c1x, c2x, c3x, c4x) + padding;
                        minY = Math.min(c1y, c2y, c3y, c4y) - padding;
                        maxY = Math.max(c1y, c2y, c3y, c4y) + padding;
                        // Upper floors сдвигаются вверх по экрану:
                        // расширяем bounding box вверх чтобы не отсечь cells на границе viewport.
                        minY -= pzLayer * this.debugView.floorHeightPx;
                    } else {
                        minX = cellOriginSx * sqr - padding;
                        maxX = cellEndSx * sqr + padding;
                        minY = cellOriginSy * sqr - padding;
                        maxY = cellEndSy * sqr + padding;
                    }
                    if (maxX < viewLeft || minX > viewRight) continue;
                    if (maxY < viewTop || minY > viewBottom) continue;

                    const rawCount = info.strideOffsets
                        ? info.strideOffsets[renderK]!
                        : info.length;
                    const instanceCount = Math.min(rawCount, info.length);
                    if (instanceCount === 0) continue;

                    if (info.atlasLayer !== boundAtlasLayer) {
                        const tex = this.saveCellTextureMgr.getAtlasTextureForLayer(
                            info.atlasLayer,
                        );
                        if (tex) {
                            gl.bindTexture(gl.TEXTURE_2D, tex);
                            boundAtlasLayer = info.atlasLayer;
                        }
                    }
                    gl.uniform2f(u.uCellOriginSq!, cellOriginSx, cellOriginSy);
                    gl.uniform1ui(u.uCellOffsetInAtlas!, info.offset);
                    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instanceCount);
                    drawnSave++;
                }
            }
        }

        // Сбрасываем uniforms для следующего frame.
        gl.uniform1i(u.uIsSavePass!, 0);
        gl.uniform1i(u.uHighlightChanges!, 0);
        gl.uniform1i(u.uForceLayer!, -1);
        this.lastDrawnSaveCells = drawnSave;
    }

    /** Сколько save-cells было нарисовано в последнем frame. */
    private lastDrawnSaveCells = 0;
    getLastDrawnSaveCells(): number {
        return this.lastDrawnSaveCells;
    }

    private setState(newState: RendererState): void {
        this.state = newState;
        this.progress.setState(newState);
    }

    /** Освободить все ресурсы. */
    dispose(): void {
        if (this.rafHandle !== null) {
            cancelAnimationFrame(this.rafHandle);
            this.rafHandle = null;
        }
        if (this.gl) {
            if (this.debugProgram) {
                destroyShaderProgram(this.gl, this.debugProgram);
                this.debugProgram = null;
            }
            if (this.mainProgram) {
                destroyShaderProgram(this.gl, this.mainProgram);
                this.mainProgram = null;
            }
            if (this.debugVao) {
                this.gl.deleteVertexArray(this.debugVao);
                this.debugVao = null;
            }
            if (this.atlasLoader) {
                this.atlasLoader.dispose();
                this.atlasLoader = null;
            }
            if (this.cellTextureMgr) {
                this.cellTextureMgr.dispose();
                this.cellTextureMgr = null;
            }
            if (this.saveCellTextureMgr) {
                this.saveCellTextureMgr.dispose();
                this.saveCellTextureMgr = null;
            }
            if (this.spriteInfoTex) {
                this.gl.deleteTexture(this.spriteInfoTex.texture);
                this.spriteInfoTex = null;
            }
        }
        if (this.workerPool) {
            this.workerPool.dispose();
            this.workerPool = null;
        }
        if (this.saveWatcher) {
            this.saveWatcher.dispose();
            this.saveWatcher = null;
        }
        this.saveCellLoader = null;
        this.saveStats = null;
        this.saveLastUpdateAt = null;
        // Phase 6.3: clear references which might hold JS heap (Maps/Sets).
        if (this.streamingMgr) {
            this.streamingMgr.clear();
            this.streamingMgr = null;
        }
        this.existingCellsSet = null;
        this.atlasTextures = null;
        this.manifests = null;
        this.cellStats = null;
        this.gl = null;
        this.state = 'idle';
    }
}
