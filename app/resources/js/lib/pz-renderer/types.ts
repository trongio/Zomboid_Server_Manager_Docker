/**
 * Общие типы для WebGL2 рендерера карты Project Zomboid.
 *
 * Используются всеми слоями (loaders, GPU helpers, workers, React).
 * Источник истины для контрактов с backend (формат manifest JSON-ов)
 * и для worker postMessage сообщений.
 */

// ---------------------------------------------------------------------------
// Backend manifests (JSON shapes из /pz-atlas/* и /admin/api/pz-map/*)
// ---------------------------------------------------------------------------

/** Один LOD уровень атласа. id=0 — нативный (4096), id=3 — самый мелкий (512). */
export interface LodInfo {
    id: number;
    /** Линейный масштаб относительно LOD 0. lod0=1.0, lod1=0.5, lod2=0.25, lod3=0.125. */
    scale: number;
    /** Размер одной страницы атласа в пикселях (квадратная). */
    size: number;
}

/** Парсенный `/pz-atlas/manifest.json`. */
export interface AtlasManifest {
    version: string;
    atlas_count: number;
    sprite_count: number;
    total_bytes: number;
    lods: LodInfo[];
    has_ktx2: boolean;
    ktx2_format?: 'BC7' | 'ASTC_4x4' | null;
    has_cell_pages: boolean;
}

/** Per-LOD per-page descriptor из sprites.json (используется в `atlases[].lods`). */
export interface AtlasPageLodFile {
    lod: number;
    file_webp: string;
    size_bytes_webp: number;
    /** Размер этой LOD-вариации страницы в пикселях. */
    size: number;
    /** Опционально: KTX2-вариация той же страницы. */
    file_ktx2?: string;
    size_bytes_ktx2?: number;
}

/** Per-page descriptor из sprites.json. */
export interface AtlasPageDescriptor {
    id: number;
    file: string;
    width: number;
    height: number;
    lods: AtlasPageLodFile[];
}

/** Один спрайт в sprites.json (один MIP уровень = одна запись). */
export interface SpriteEntryRaw {
    atlas: number;
    /** Массив мипов: `[u, v, w, h]` в нормализованных [0..1] координатах. */
    mips: Array<[number, number, number, number]>;
    offset_x: number;
    offset_y: number;
}

/** Парсенный `/pz-atlas/sprites.json`. */
export interface SpritesManifest {
    version: string;
    atlas_size: number;
    /** Формат UV. После backend-рефакторинга всегда 'normalized'. */
    uv_format: 'normalized' | 'pixels';
    atlases: AtlasPageDescriptor[];
    sprites: Record<string, SpriteEntryRaw>;
}

/** Парсенный `/admin/api/pz-map/cells.json`. */
export interface CellsManifest {
    version: string;
    /** Список существующих cells на диске. */
    cells: Array<[cellX: number, cellY: number]>;
}

/** Парсенный `/pz-atlas/cell-pages.json`. Ключ = "cellX_cellY". */
export type CellPagesManifest = Record<string, number[]>;

/** Парсенный `/pz-cell-data/index.json` (опционально, если pre-packed chunks). */
export interface CellChunkIndex {
    version: string;
    /** Ключ = "cellX_cellY", значение = chunkKey (filename без префикса/расширения). */
    cells: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Sprite metadata (после построения SpriteInfoTexture)
// ---------------------------------------------------------------------------

/**
 * Числовой ID спрайта (индекс в `SpritesManifest.sprites` после ordering).
 * Воркеры конвертируют name → id при парсинге lotpack.
 */
export type SpriteId = number;

/** Mapping `name → id` для воркеров. */
export type SpriteNameToId = Map<string, SpriteId>;

// ---------------------------------------------------------------------------
// Cell binary parsing (worker output)
// ---------------------------------------------------------------------------

/** Содержимое распарсенного lotheader. */
export interface CellHeader {
    version: number;
    cellX: number;
    cellY: number;
    /** Имена спрайтов в этой cell (локальные индексы используются в lotpack). */
    spriteNames: string[];
    cellSizeInBlocks: number;
    blockSize: number;
    minLayer: number;
    maxLayer: number;
}

/**
 * Результат парсинга одной cell — packed Uint32Array для upload в `cellAtlas`.
 *
 * Layout (2 u32 texela на sprite entry):
 *   Texel 0: bits 0-23 = spriteId, bits 24-31 = layer_signed + 32
 *   Texel 1: bits 0-7 = sx, 8-15 = sy, 16-23 = zStack, 24-30 = flags, 31 = reserved
 */
export interface ParsedCell {
    cellX: number;
    cellY: number;
    /** Float32Array.buffer? Нет — Uint32Array.buffer (transferable). */
    packed: Uint32Array;
    /** Количество sprite entries (packed.length / 2). */
    entriesCount: number;
}

// ---------------------------------------------------------------------------
// Worker контракты
// ---------------------------------------------------------------------------

export interface ParseCellRequest {
    taskId: number;
    cellX: number;
    cellY: number;
    /** Lotheader binary (transferable). */
    headerBuf: ArrayBuffer;
    /** Lotpack binary (transferable). */
    lotpackBuf: ArrayBuffer;
    /**
     * Spriteindex для конвертации имён в id. Передаётся один раз через
     * init message и кэшируется в worker (read-only).
     */
}

export interface WorkerInitMessage {
    type: 'init';
    /** name → id mapping для всех спрайтов. */
    spriteNameToId: Array<[string, number]>;
}

export interface WorkerParseMessage {
    type: 'parse';
    taskId: number;
    cellX: number;
    cellY: number;
    headerBuf: ArrayBuffer;
    lotpackBuf: ArrayBuffer;
}

export interface WorkerParseResponse {
    type: 'parse-result';
    taskId: number;
    cellX: number;
    cellY: number;
    /** Layer 0 packed (backward compat). Тот же что perLayer[0].packed. */
    packed: ArrayBuffer;
    entriesCount: number;
    /**
     * Cumulative entry counts по stride buckets, Uint32Array(7).buffer.
     *   strideOffsets[K] = количество entries, у которых strideLevel ≥ K.
     *   strideOffsets[0] = total (= entriesCount)
     *   strideOffsets[6] = entries stride-64-aligned (рендерятся на extreme zoom-out)
     * Entries в packed уже отсортированы: высокие K идут ПЕРВЫМИ, так что
     * `drawArraysInstanced(..., 0, 4, strideOffsets[K])` рисует ровно те sprites,
     * которые нужны для render с effectiveStride = 2^K.
     */
    strideOffsets: ArrayBuffer;
    parseTimeMs: number;
    /**
     * Per-layer packed entries для slider'а этажей. layer 0 = ground (= packed
     * выше), 1+ = upper floors. Renderer upload'ит на GPU по запросу.
     */
    perLayer: Array<{
        layer: number;
        packed: ArrayBuffer;
        entriesCount: number;
        strideOffsets: ArrayBuffer;
    }>;
}

export interface WorkerErrorResponse {
    type: 'error';
    taskId: number;
    error: string;
}

export type WorkerMessageIn = WorkerInitMessage | WorkerParseMessage;
export type WorkerMessageOut = WorkerParseResponse | WorkerErrorResponse;

// ---------------------------------------------------------------------------
// Renderer state machine
// ---------------------------------------------------------------------------

export type RendererState =
    | 'idle'
    | 'fetching-manifests'
    | 'preloading-atlas'
    | 'preloading-cells'
    | 'finalizing'
    | 'ready'
    | 'error'
    | 'cancelled';

/** Snapshot прогресса инициализации, эмитится через события renderer-а. */
export interface ProgressSnapshot {
    state: RendererState;
    /** Общий процент 0..1 (агрегированный из всех фаз). */
    overall: number;
    /** Текстовая метка фазы (для UI). */
    label: string;
    /** Опциональные детальные счётчики (для debug HUD). */
    details?: {
        bytesDownloaded?: number;
        bytesTotal?: number;
        cellsParsed?: number;
        cellsTotal?: number;
        atlasPagesUploaded?: number;
        atlasPagesTotal?: number;
        etaSeconds?: number;
    };
    /** Сообщение об ошибке (если state === 'error'). */
    error?: string;
}

// ---------------------------------------------------------------------------
// View / camera (приходит из Leaflet)
// ---------------------------------------------------------------------------

/** Информация о текущем viewport, получаемая из Leaflet каждый pan/zoom. */
export interface ViewportInfo {
    /** Размер canvas в device pixels. */
    width: number;
    height: number;
    /** Текущий zoom (может быть fractional во время анимации). */
    zoom: number;
    /** Левый-верхний угол viewport в PZ pixel coords (native, не масштабированных). */
    topLeftPzPx: { x: number; y: number };
    /** Pixels per PZ square на текущем зуме. */
    pps: number;
    /** Активный LOD (0..3). */
    lod: number;
    /** Cell stride (1..10). */
    cellStride: number;
    /** Square stride (внутри cell). */
    squareStride: number;
    /** Isometric или top-down. */
    isometric: boolean;
}

// ---------------------------------------------------------------------------
// Renderer options (passed в `new PzMapRenderer(opts)`)
// ---------------------------------------------------------------------------

export interface PzMapRendererOptions {
    /** Canvas элемент для WebGL2 контекста. */
    canvas: HTMLCanvasElement;
    /** Base URL для атласа (`/pz-atlas`). */
    atlasBaseUrl: string;
    /** Base URL для cell data (`/admin/api/pz-map` или `/pz-cell-data`). */
    cellsBaseUrl: string;
    /** Base URL для save-game endpoints (default: `${cellsBaseUrl}/save`). */
    saveBaseUrl?: string;
    /** Опциональный AbortSignal для отмены init. */
    signal?: AbortSignal;
    /** Callback на изменение progress (часто, throttled). */
    onProgress?: (snapshot: ProgressSnapshot) => void;
    /** Callback когда renderer перешёл в 'ready'. */
    onReady?: () => void;
    /** Callback при фатальной ошибке. */
    onError?: (err: Error) => void;
    /** Включить ли загрузку save-overlay данных после ready. Default: true. */
    enableSaveOverlay?: boolean;
}

/**
 * Режим отображения save-game overlay:
 *   - 'off':       только базовая карта
 *   - 'overlay':   save-cells поверх базы (приоритет depth-equal)
 *   - 'highlight': save-cells поверх базы + жёлтый тинт (debug)
 */
export type SaveOverlayMode = 'off' | 'overlay' | 'highlight';

// ---------------------------------------------------------------------------
// GL capabilities (определяются при создании контекста)
// ---------------------------------------------------------------------------

export interface GlCapabilities {
    /** Есть ли EXT_texture_compression_bptc (для KTX2 BC7). */
    hasBptc: boolean;
    /** Есть ли EXT_color_buffer_float (для R32F render targets). */
    hasColorBufferFloat: boolean;
    /** Максимальный размер texture. */
    maxTextureSize: number;
    /** Максимум layers в TEXTURE_2D_ARRAY. */
    maxArrayTextureLayers: number;
    /** Vendor / renderer строки (для дебага). */
    renderer: string;
    vendor: string;
}
