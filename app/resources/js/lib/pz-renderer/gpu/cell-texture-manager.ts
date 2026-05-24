/**
 * CellTextureManager — упаковывает packed sprite streams всех cells в
 * один большой R32UI texture (`cellAtlas`) + RG32UI mapping
 * `(cellX, cellY) → (offset, length)` в `cellIndex`.
 *
 * Архитектурный выбор: одна большая GPU texture лучше чем N маленьких
 * (один `bindTexture` на весь draw call, никакого texture-swap
 * overhead). Sparse через prefix-sum: empty cells просто имеют length=0
 * в cellIndex.
 *
 * Layout cellAtlas (R32UI):
 *   Линейный u32 stream. Каждые 2 u32 = одна sprite entry (см. types.ts
 *   `ParsedCell`). Адресация через `texelFetch(atlas, ivec2(idx % W, idx / W))`.
 *
 * Layout cellIndex (RG32UI):
 *   2D grid по (cellX - originX, cellY - originY). Texel:
 *     R = offset в cellAtlas (в u32 индексах)
 *     G = length (количество sprite entries × 2 u32)
 *
 * Capacity: WebGL2 max texture = 16384×16384 = 268M texels. Достаточно
 * для ~134M sprite entries (одна cell ~5k entries → ~27k cells fit).
 */

export interface CellTextureManagerOptions {
    gl: WebGL2RenderingContext;
    /** Размер cellAtlas texture в texels. width = atlasWidth, height = atlasHeight. */
    atlasWidth: number;
    atlasHeight: number;
    /** Размер cellIndex grid (макс cells по X/Y). */
    indexGridWidth: number;
    indexGridHeight: number;
    /** Origin cell coords (если карта имеет cells в отрицательных координатах). */
    originCellX: number;
    originCellY: number;
    /**
     * Phase 5.8: per-region atlas heights. Каждый region (rect) имеет
     * own TEXTURE_2D с heights[i] высоты. Width общий (atlasWidth).
     * Renderer переключает binding между textures для разных regions.
     * Per-region size позволяет minimize VRAM use (large region = tall
     * texture, small region = short).
     */
    atlasHeights: ReadonlyArray<number>;
    /**
     * Region rects из rect_cover (port pzmap2dzi). `[x, y, w, h]` в cell
     * coordinates. Cell мaпится на layer = index первого rect содержащего её.
     */
    regionRects: ReadonlyArray<readonly [number, number, number, number]>;
}

export interface CellTextureInfo {
    /** Per-region atlas textures. Bind correct one based on cell's layer. */
    cellAtlases: ReadonlyArray<WebGLTexture>;
    /** Backward compat — points к первому atlas. */
    cellAtlas: WebGLTexture;
    cellIndex: WebGLTexture;
    atlasWidth: number;
    /** Per-region heights (same length как cellAtlases). */
    atlasHeights: ReadonlyArray<number>;
    indexGridWidth: number;
    indexGridHeight: number;
    originCellX: number;
    originCellY: number;
    /** Сколько entries реально занято во всех atlases (для статистики). */
    totalEntries: number;
}

/**
 * Fixed-size slot allocator для cellAtlas. Atlas разделён на N равных
 * слотов, каждый достаточно большой для любой PZ cell (~252k max
 * texels observed). Allocate возвращает первый free slot offset.
 * Free помечает slot free. НИКАКОЙ фрагментации — слоты дискретные.
 *
 * Используется в streaming mode (Phase 4.4): allocate/free бесконечно
 * без degradation.
 */
/**
 * Variable-size allocator (free-list). Cells have wildly varying sizes
 * (ground cell 5k..200k texels), fixed slots waste atlas space. Free-list
 * с coalescing работает для bulk load (только allocate, no free →
 * effectively linear cursor → нет фрагментации).
 */
function slotSizeForK(_k: number): number {
    // Compat stub — не используется в текущем bulk-load режиме.
    return 1024 * 1024;
}

/**
 * Variable-size free-list allocator. Each free region described by
 * {offset, length} в u32 texels. Allocate: first-fit, splits if larger.
 * Free: insert + coalesce с adjacent regions.
 *
 * Для bulk loadAll (Phase 6): только allocate, no free — фрагментация
 * не возникает (фактически cursor allocator). Каждая cell получает
 * слот exactly её размера, без waste.
 */
class FreeListAllocator {
    /** Free ranges, sorted by offset ascending. */
    private free: Array<{ offset: number; length: number }> = [];
    /** Stub compatibility — used by codepaths expecting "slotSize". */
    readonly slotSize: number = 0;

    constructor(totalCapacity: number) {
        this.free.push({ offset: 0, length: totalCapacity });
    }

    allocate(length: number): number {
        for (let i = 0; i < this.free.length; i++) {
            const r = this.free[i]!;
            if (r.length >= length) {
                const offset = r.offset;
                if (r.length === length) {
                    this.free.splice(i, 1);
                } else {
                    r.offset += length;
                    r.length -= length;
                }
                return offset;
            }
        }
        return -1;
    }

    free_(offset: number, length: number): void {
        if (length === 0) return;
        let i = 0;
        while (i < this.free.length && this.free[i]!.offset < offset) i++;
        const prev = i > 0 ? this.free[i - 1]! : null;
        const next = i < this.free.length ? this.free[i]! : null;
        const mergePrev = prev !== null && prev.offset + prev.length === offset;
        const mergeNext = next !== null && offset + length === next.offset;
        if (mergePrev && mergeNext) {
            prev.length += length + next!.length;
            this.free.splice(i, 1);
        } else if (mergePrev) {
            prev.length += length;
        } else if (mergeNext) {
            next!.offset = offset;
            next!.length += length;
        } else {
            this.free.splice(i, 0, { offset, length });
        }
    }

    freeBytes(): number {
        let total = 0;
        for (const r of this.free) total += r.length;
        return total;
    }

    largestFreeRun(): number {
        let max = 0;
        for (const r of this.free) if (r.length > max) max = r.length;
        return max;
    }

    usedSlotCount(): number {
        return 0; // не tracked для variable-size
    }
}

// Type alias для остального кода (use FreeListAllocator).
type SlotAllocator = FreeListAllocator;
// eslint-disable-next-line @typescript-eslint/no-redeclare
const SlotAllocator = FreeListAllocator;

/**
 * Phase 5.7: per-layer info. Cell stored в specific atlas layer.
 */
interface CellSlotInfo {
    atlasLayer: number;
    offset: number;
    length: number;
    strideOffsets?: Uint32Array;
}

export class CellTextureManager {
    private readonly gl: WebGL2RenderingContext;
    private readonly opts: CellTextureManagerOptions;
    /** Phase 5.8: separate TEXTURE_2D per region. Different heights. */
    private cellAtlases: WebGLTexture[];
    /** Vestigial — kept для compat. */
    private cellIndex: WebGLTexture;
    /** Per-layer allocator. Capacity = atlasWidth × atlasHeights[i]. */
    private allocators: SlotAllocator[];
    private currentK = 0;
    private cellSlots: Map<number, CellSlotInfo> = new Map();
    private pendingUploadsPerLayer: Array<Array<{ offset: number; data: Uint32Array }>>;

    constructor(opts: CellTextureManagerOptions) {
        this.gl = opts.gl;
        this.opts = opts;

        const layerCount = Math.max(1, opts.atlasHeights.length);
        this.cellAtlases = [];
        this.allocators = [];
        this.pendingUploadsPerLayer = [];

        for (let i = 0; i < layerCount; i++) {
            const h = opts.atlasHeights[i]!;
            const tex = this.gl.createTexture();
            if (!tex) throw new Error('[cell-texture] createTexture failed');
            this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
            this.gl.texStorage2D(
                this.gl.TEXTURE_2D, 1, this.gl.R32UI, opts.atlasWidth, h,
            );
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
            this.cellAtlases.push(tex);
            this.allocators.push(new SlotAllocator(opts.atlasWidth * h));
            this.pendingUploadsPerLayer.push([]);
        }
        this.gl.bindTexture(this.gl.TEXTURE_2D, null);

        // cellIndex vestigial.
        const idx = this.gl.createTexture();
        if (!idx) throw new Error('[cell-texture] createTexture failed');
        this.cellIndex = idx;
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.cellIndex);
        this.gl.texStorage2D(this.gl.TEXTURE_2D, 1, this.gl.RG32UI, 1, 1);
        this.gl.bindTexture(this.gl.TEXTURE_2D, null);
    }

    /**
     * Phase 5.7: cell → layer mapping. Использует regionRects из PZ map
     * config (computed через rect_cover algorithm). Cells в одном
     * region rect — в одном atlas layer. Если cell не в одном из rects
     * (или rects не заданы) — fallback на cellX range split.
     */
    private chooseLayerForCell(cellX: number, cellY: number): number {
        const layerCount = this.allocators.length;
        if (layerCount === 1) return 0;
        const rects = this.opts.regionRects;
        if (rects && rects.length > 0) {
            for (let i = 0; i < rects.length; i++) {
                const [rx, ry, rw, rh] = rects[i]!;
                if (cellX >= rx && cellX < rx + rw
                    && cellY >= ry && cellY < ry + rh) {
                    return Math.min(i, layerCount - 1);
                }
            }
            // Cell не в одном из rects — fallback layer 0.
        }
        // Fallback: split по cellX range равномерно.
        const localX = cellX - this.opts.originCellX;
        const span = Math.max(1, this.opts.indexGridWidth);
        const layer = Math.floor((localX * layerCount) / span);
        return Math.max(0, Math.min(layerCount - 1, layer));
    }

    /**
     * Аппендит одну cell в cellAtlas + помечает её в cellIndex.
     *
     * Возвращает `true` если cell записана, `false` если был overflow
     * (тогда cell записывается в cellIndex с length=0 и draw call её
     * пропустит).
     */
    append(
        cellX: number,
        cellY: number,
        packed: Uint32Array,
        strideOffsets?: Uint32Array,
    ): boolean {
        const localX = cellX - this.opts.originCellX;
        const localY = cellY - this.opts.originCellY;
        if (
            localX < 0
            || localY < 0
            || localX >= this.opts.indexGridWidth
            || localY >= this.opts.indexGridHeight
        ) {
            console.warn(
                `[cell-texture] cell (${cellX},${cellY}) outside indexGrid origin (${this.opts.originCellX},${this.opts.originCellY})`,
            );
            return false;
        }

        const cellKey = localY * this.opts.indexGridWidth + localX;
        const uploadLength = packed.length;

        // Освободить старый slot если cell уже в atlas (для re-upload).
        const existing = this.cellSlots.get(cellKey);
        if (existing) {
            this.allocators[existing.atlasLayer]!.free_(existing.offset, existing.length);
            this.cellSlots.delete(cellKey);
        }

        if (uploadLength === 0) return true;

        // Выбираем layer по region rect. Если переполнено, пробуем другие
        // layers как fallback (на случай неравномерной плотности данных).
        const preferredLayer = this.chooseLayerForCell(cellX, cellY);
        let chosenLayer = -1;
        let offset = -1;
        // Try preferred first, then others as fallback.
        for (let attempt = 0; attempt < this.allocators.length; attempt++) {
            const layer = (preferredLayer + attempt) % this.allocators.length;
            const o = this.allocators[layer]!.allocate(uploadLength);
            if (o >= 0) {
                chosenLayer = layer;
                offset = o;
                break;
            }
        }

        if (chosenLayer < 0) {
            if (!this.overflowReported) {
                this.overflowReported = true;
                const stats = this.allocators.map((a, i) =>
                    `L${i}: free=${a.freeBytes()}, max=${a.largestFreeRun()}`,
                ).join('; ');
                console.warn(
                    `[cell-texture] no slot для cell (${cellX},${cellY}) length=${uploadLength}. ${stats}`,
                );
            }
            return false;
        }

        this.cellSlots.set(cellKey, {
            atlasLayer: chosenLayer,
            offset,
            length: uploadLength,
            strideOffsets,
        });
        this.pendingUploadsPerLayer[chosenLayer]!.push({ offset, data: packed });
        return true;
    }

    /** Stub для backward compat (Phase 4.5 streaming не используется). */
    recreateAllocatorForK(_k: number): void {
        void slotSizeForK;
    }

    /** Текущий K — для diagnostics. */
    getCurrentK(): number {
        return this.currentK;
    }

    unload(cellX: number, cellY: number): boolean {
        const localX = cellX - this.opts.originCellX;
        const localY = cellY - this.opts.originCellY;
        if (localX < 0 || localY < 0
            || localX >= this.opts.indexGridWidth
            || localY >= this.opts.indexGridHeight) return false;
        const cellKey = localY * this.opts.indexGridWidth + localX;
        const slot = this.cellSlots.get(cellKey);
        if (!slot) return false;
        this.allocators[slot.atlasLayer]!.free_(slot.offset, slot.length);
        this.cellSlots.delete(cellKey);
        this.overflowReported = false;
        return true;
    }

    getAllocatorStats(): { free: number; largest: number; total: number } {
        let free = 0, largest = 0, total = 0;
        for (let i = 0; i < this.allocators.length; i++) {
            free += this.allocators[i]!.freeBytes();
            const l = this.allocators[i]!.largestFreeRun();
            if (l > largest) largest = l;
            total += this.opts.atlasWidth * this.opts.atlasHeights[i]!;
        }
        return { free, largest, total };
    }

    private overflowReported = false;

    /** Сколько cells были скипнуты из-за overflow (для статистики). */
    get hasOverflowed(): boolean {
        return this.overflowReported;
    }

    /**
     * Lookup `(offset, length)` для конкретной cell. Возвращает null
     * если cell вне grid или у неё нет данных.
     *
     * offset в u32 индексах cellAtlas.
     * length = entries × 2 (количество u32 texels).
     */
    getCellInfo(
        cellX: number,
        cellY: number,
    ): {
        offset: number;
        length: number;
        atlasLayer: number;
        strideOffsets?: Uint32Array;
    } | null {
        const localX = cellX - this.opts.originCellX;
        const localY = cellY - this.opts.originCellY;
        if (localX < 0 || localY < 0
            || localX >= this.opts.indexGridWidth
            || localY >= this.opts.indexGridHeight) {
            return null;
        }
        const cellKey = localY * this.opts.indexGridWidth + localX;
        const slot = this.cellSlots.get(cellKey);
        if (!slot) return null;
        return {
            offset: slot.offset,
            length: slot.length,
            atlasLayer: slot.atlasLayer,
            strideOffsets: slot.strideOffsets,
        };
    }

    /**
     * Сбрасывает все pending uploads на GPU.
     *
     * Phase 4.3b.2: coalesce contiguous uploads. Cells appended
     * последовательно через cursor — все pending uploads contiguous в
     * cellAtlas. Объединяем в один staging buffer + один upload через
     * uploadAtlasRange (он split'ит per row of cellAtlas). 4000 cells ×
     * 30 row uploads = 120K texSubImage2D → ~100-1000 texSubImage2D.
     *
     * Для cellIndex: один большой texSubImage2D обновляющий весь grid
     * (это всего ~8 MB).
     */
    flush(): void {
        for (let layer = 0; layer < this.pendingUploadsPerLayer.length; layer++) {
            const pending = this.pendingUploadsPerLayer[layer]!;
            if (pending.length === 0) continue;
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.cellAtlases[layer]!);
            const sorted = [...pending].sort((a, b) => a.offset - b.offset);
            let i = 0;
            while (i < sorted.length) {
                let j = i + 1;
                let endOffset = sorted[i]!.offset + sorted[i]!.data.length;
                while (j < sorted.length && sorted[j]!.offset === endOffset) {
                    endOffset += sorted[j]!.data.length;
                    j++;
                }
                if (j - i === 1) {
                    this.uploadAtlasRange(sorted[i]!.offset, sorted[i]!.data);
                } else {
                    const total = endOffset - sorted[i]!.offset;
                    const staging = new Uint32Array(total);
                    let pos = 0;
                    for (let k = i; k < j; k++) {
                        staging.set(sorted[k]!.data, pos);
                        pos += sorted[k]!.data.length;
                    }
                    this.uploadAtlasRange(sorted[i]!.offset, staging);
                }
                i = j;
            }
            pending.length = 0;
        }
        this.gl.bindTexture(this.gl.TEXTURE_2D, null);
    }

    /** Upload в currently bound 2D texture. */
    private uploadAtlasRange(offset: number, data: Uint32Array): void {
        const W = this.opts.atlasWidth;
        let dataPos = 0;
        let remaining = data.length;
        let absOffset = offset;

        while (remaining > 0) {
            const x = absOffset % W;
            const y = Math.floor(absOffset / W);
            const lineRemaining = W - x;
            const chunkLen = Math.min(remaining, lineRemaining);
            const chunk = data.subarray(dataPos, dataPos + chunkLen);
            this.gl.texSubImage2D(
                this.gl.TEXTURE_2D, 0, x, y, chunkLen, 1,
                this.gl.RED_INTEGER, this.gl.UNSIGNED_INT, chunk,
            );
            dataPos += chunkLen;
            absOffset += chunkLen;
            remaining -= chunkLen;
        }
    }

    /** Получить texture для конкретного layer (для renderer binding). */
    getAtlasTextureForLayer(layer: number): WebGLTexture | null {
        return this.cellAtlases[layer] ?? null;
    }

    getInfo(): CellTextureInfo {
        let used = 0;
        for (let i = 0; i < this.allocators.length; i++) {
            used += this.opts.atlasWidth * this.opts.atlasHeights[i]! - this.allocators[i]!.freeBytes();
        }
        return {
            cellAtlases: this.cellAtlases,
            cellAtlas: this.cellAtlases[0]!, // compat first
            cellIndex: this.cellIndex,
            atlasWidth: this.opts.atlasWidth,
            atlasHeights: this.opts.atlasHeights,
            indexGridWidth: this.opts.indexGridWidth,
            indexGridHeight: this.opts.indexGridHeight,
            originCellX: this.opts.originCellX,
            originCellY: this.opts.originCellY,
            totalEntries: used,
        };
    }

    dispose(): void {
        for (const t of this.cellAtlases) this.gl.deleteTexture(t);
        this.gl.deleteTexture(this.cellIndex);
        for (const arr of this.pendingUploadsPerLayer) arr.length = 0;
        this.cellSlots.clear();
    }
}
