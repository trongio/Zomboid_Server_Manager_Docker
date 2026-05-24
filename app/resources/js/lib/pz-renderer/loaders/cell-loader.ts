/**
 * CellLoader — координирует загрузку всех cells:
 *   1. fetch binary через bulk endpoint
 *   2. dispatch parse в worker pool
 *   3. append packed Uint32Array в CellTextureManager
 *   4. progress reporting
 *
 * Backend bulk endpoint формат (один HTTP запрос → много cells):
 *   GET /admin/api/pz-map/cells/bulk?coords=x_y,x_y,...
 *   Response: binary stream
 *     [count: uint32 LE]
 *     [per cell: x u16, y u16, headerLen u32, lotpackLen u32]
 *     [body: header bytes + lotpack bytes concatenated]
 *
 * Максимум 256 cells на запрос (server throttle). Concurrency: 6
 * параллельных запросов (browser HTTP/2 limit-friendly).
 */

import type { CellTextureManager } from '../gpu/cell-texture-manager';
import type { CellsManifest, SpritesManifest } from '../types';
import type { WorkerPool } from '../workers/worker-pool';
import { mapLimit } from '../utils/concurrency';
import {
    getCachedCellBinary,
    putCachedCellBinary,
} from '../cache/cell-chunk-cache';
import {
    getCachedPackedCell,
    putCachedPackedCell,
} from '../cache/cell-packed-cache';

/**
 * Server hard cap = 256 cells/request, но при ~1 MB lotpack за cell это
 * 256 MB загруженных в PHP memory за один request → 500 (memory_limit).
 * 32 cells × 1 MB = 32 MB — комфортно укладывается в PHP defaults.
 */
const BULK_REQUEST_LIMIT = 32;
const PARALLEL_BULK_REQUESTS = 6;

export interface CellLoaderOptions {
    pool: WorkerPool;
    /** Phase 5.9: textureMgr опционален. Если undefined, packs буферизируются. */
    textureMgr: CellTextureManager | null;
    cellsManifest: CellsManifest;
    cellsBaseUrl: string;
    /** Версия atlas (для IDB cache keying). */
    atlasVersion: string;
    /** Прогресс per cell (loaded из N total). */
    onCellProgress?: (loaded: number, total: number) => void;
    /**
     * Phase 4.3b.3: progressive ready. Callback вызывается ОДИН РАЗ когда
     * `parsedCells` достигает `progressiveReadyThreshold`. Renderer
     * переключается в ready state и начинает rendering, остальные cells
     * загружаются background-потоком.
     */
    progressiveReadyThreshold?: number;
    onProgressiveReady?: () => void;
    signal?: AbortSignal;
    /**
     * Phase 5.9: при true workers parsing, но packs не uploaded в atlas
     * (textureMgr игнорируется). Packs хранятся в `deferredPacks` map.
     * После завершения preflight, renderer compute exact atlas sizes
     * и invokes `flushDeferred(textureMgr)`.
     */
    deferAppend?: boolean;
}

export interface CellLoaderStats {
    totalCells: number;
    parsedCells: number;
    skippedCells: number;
    totalEntries: number;
    bytesFromCache: number;
    bytesFromNetwork: number;
    /** Cells loaded из packed cache (skip worker parse). */
    packedCacheHits: number;
}

export class CellLoader {
    private parsedCells = 0;
    private skippedCells = 0;
    private bytesFromCache = 0;
    private bytesFromNetwork = 0;
    private packedCacheHits = 0;
    private progressiveReadyFired = false;
    /** Phase 5.9: deferred packs (when deferAppend=true). */
    readonly deferredPacks: Map<string, { cellX: number; cellY: number; packed: Uint32Array; strideOffsets: Uint32Array }> = new Map();
    /**
     * Per-layer packs для слайдера этажей. Layer 0 уже uploaded в atlas как
     * основной pack. Layers 1+ хранятся здесь до явного запроса
     * `flushLayer(N)`. Key = `${cellX}_${cellY}_${layer}`.
     */
    readonly pendingLayerPacks: Map<string, {
        cellX: number;
        cellY: number;
        layer: number;
        packed: Uint32Array;
        strideOffsets: Uint32Array;
    }> = new Map();

    private maybeFireProgressiveReady(): void {
        if (this.progressiveReadyFired) return;
        const threshold = this.opts.progressiveReadyThreshold ?? 0;
        if (threshold > 0 && this.parsedCells >= threshold) {
            this.progressiveReadyFired = true;
            this.opts.onProgressiveReady?.();
        }
    }

    constructor(private readonly opts: CellLoaderOptions) {}

    /**
     * Phase 4.4: load specific subset of cells (streaming mode). Don't
     * dispose workers — могут понадобиться для следующего batch.
     * `cellsToLoad` — массив [cellX, cellY] для загрузки.
     */
    async loadCells(cellsToLoad: Array<[number, number]>): Promise<CellLoaderStats> {
        const total = cellsToLoad.length;

        const batches: Array<Array<[number, number]>> = [];
        for (let i = 0; i < cellsToLoad.length; i += BULK_REQUEST_LIMIT) {
            batches.push(cellsToLoad.slice(i, i + BULK_REQUEST_LIMIT));
        }

        await mapLimit(batches, PARALLEL_BULK_REQUESTS, async (batch) => {
            await this.processBatch(batch, total);
        });

        this.opts.textureMgr?.flush();

        return {
            totalCells: total,
            parsedCells: this.parsedCells,
            skippedCells: this.skippedCells,
            totalEntries: this.opts.textureMgr?.getInfo().totalEntries ?? 0,
            bytesFromCache: this.bytesFromCache,
            bytesFromNetwork: this.bytesFromNetwork,
            packedCacheHits: this.packedCacheHits,
        };
    }

    /**
     * Phase 5.5: super-cell load. К>0 → cells grouped into supers
     * (anchor + N²-1 sub-cells). Один merged super-pack appendится at
     * anchor coords, draw call один на N² cells.
     *
     * Entries из каждого sub-cell фильтруются strideOffsets[K] (только
     * stride-N-aligned tiles) и re-encoded:
     *   storedSx = subX * (256/N) + origSx / N
     * Worth N×N base cells данных сжимается до примерно одного
     * cell-worth (= same as К=0 single cell).
     */
    async loadSuperCells(
        anchors: Array<[number, number]>,
        K: number,
    ): Promise<CellLoaderStats> {
        const N = 1 << K;
        const total = anchors.length;

        await mapLimit(anchors, PARALLEL_BULK_REQUESTS, async ([anchorCx, anchorCy]) => {
            await this.processSuper(anchorCx, anchorCy, N, K, total);
        });

        this.opts.textureMgr?.flush();

        return {
            totalCells: total,
            parsedCells: this.parsedCells,
            skippedCells: this.skippedCells,
            totalEntries: this.opts.textureMgr?.getInfo().totalEntries ?? 0,
            bytesFromCache: this.bytesFromCache,
            bytesFromNetwork: this.bytesFromNetwork,
            packedCacheHits: this.packedCacheHits,
        };
    }

    private async processSuper(
        anchorCx: number,
        anchorCy: number,
        N: number,
        K: number,
        total: number,
    ): Promise<void> {
        const subPacks: Array<{
            subX: number;
            subY: number;
            packed: Uint32Array;
            strideOffsets: Uint32Array;
        } | null> = new Array(N * N).fill(null);

        const subTasks: Array<Promise<void>> = [];
        for (let subY = 0; subY < N; subY++) {
            for (let subX = 0; subX < N; subX++) {
                const cellX = anchorCx + subX;
                const cellY = anchorCy + subY;
                const slot = subY * N + subX;
                subTasks.push(
                    this.getCellPacked(cellX, cellY).then((p) => {
                        if (p) {
                            subPacks[slot] = { subX, subY, packed: p.packed, strideOffsets: p.strideOffsets };
                        }
                    }).catch((err) => {
                        console.warn(`[cell-loader] super-sub (${cellX},${cellY}) failed:`, err);
                    }),
                );
            }
        }
        await Promise.all(subTasks);

        const out = this.mergeSuperPack(subPacks, N, K);
        if (out.length === 0) {
            this.skippedCells++;
            this.opts.onCellProgress?.(this.parsedCells + this.skippedCells, total);
            return;
        }

        // Super-pack уже pre-filtered to stride-N. Render uses ВСЕ entries
        // в super-pack — strideOffsets[K] = total для любого K (forced
        // render K == loadK в renderer, Phase 5 bump disabled in super-mode).
        const superStrideOffsets = new Uint32Array(7).fill(out.length / 2);
        this.appendOrDefer(anchorCx, anchorCy, out, superStrideOffsets);
        this.parsedCells++;
        this.maybeFireProgressiveReady();
        this.opts.onCellProgress?.(this.parsedCells + this.skippedCells, total);
    }

    private async getCellPacked(
        cellX: number,
        cellY: number,
    ): Promise<{ packed: Uint32Array; strideOffsets: Uint32Array } | null> {
        const cached = await getCachedPackedCell(
            this.opts.atlasVersion,
            cellX,
            cellY,
        );
        if (cached) {
            this.packedCacheHits++;
            this.bytesFromCache
                += cached.packed.byteLength + cached.strideOffsets.byteLength;
            return {
                packed: new Uint32Array(cached.packed),
                strideOffsets: new Uint32Array(cached.strideOffsets),
            };
        }
        // Fetch raw binaries (через bulk endpoint, 1 cell в batch).
        const binsMap = await this.bulkFetch([[cellX, cellY]]);
        const bins = binsMap.get(`${cellX}_${cellY}`);
        if (!bins) return null;
        this.bytesFromNetwork += bins.header.byteLength + bins.lotpack.byteLength;
        void putCachedCellBinary(this.opts.atlasVersion, cellX, cellY, 'header', bins.header).catch(() => {});
        void putCachedCellBinary(this.opts.atlasVersion, cellX, cellY, 'lotpack', bins.lotpack).catch(() => {});
        const result = await this.opts.pool.parseCell(
            cellX,
            cellY,
            bins.header.slice(0),
            bins.lotpack.slice(0),
        );
        const packed = new Uint32Array(result.packed);
        const strideOffsets = new Uint32Array(result.strideOffsets);
        void putCachedPackedCell(this.opts.atlasVersion, cellX, cellY, {
            packed: packed.buffer as ArrayBuffer,
            strideOffsets: strideOffsets.buffer as ArrayBuffer,
            entriesCount: result.entriesCount,
        }).catch(() => {});
        return { packed, strideOffsets };
    }

    private mergeSuperPack(
        subs: Array<{
            subX: number;
            subY: number;
            packed: Uint32Array;
            strideOffsets: Uint32Array;
        } | null>,
        N: number,
        K: number,
    ): Uint32Array {
        let total = 0;
        for (const sub of subs) {
            if (sub) total += sub.strideOffsets[K] ?? 0;
        }
        if (total === 0) return new Uint32Array(0);

        const out = new Uint32Array(total * 2);
        let outIdx = 0;
        const division = (256 / N) | 0;

        for (const sub of subs) {
            if (!sub) continue;
            const keepCount = sub.strideOffsets[K] ?? 0;
            for (let i = 0; i < keepCount; i++) {
                const e0 = sub.packed[i * 2]!;
                const e1 = sub.packed[i * 2 + 1]!;
                const origSx = e1 & 0xff;
                const origSy = (e1 >> 8) & 0xff;
                // (subX*256 + origSx) / N = subX*(256/N) + origSx/N
                const newSx = (sub.subX * division + ((origSx / N) | 0)) & 0xff;
                const newSy = (sub.subY * division + ((origSy / N) | 0)) & 0xff;
                const newE1 = ((e1 & 0xffff0000) | newSx | (newSy << 8)) >>> 0;
                out[outIdx * 2] = e0;
                out[outIdx * 2 + 1] = newE1;
                outIdx++;
            }
        }
        return out;
    }

    async loadAll(): Promise<CellLoaderStats> {
        const cells = this.opts.cellsManifest.cells;
        const total = cells.length;

        // Разбиваем на батчи по BULK_REQUEST_LIMIT.
        const batches: Array<typeof cells> = [];
        for (let i = 0; i < cells.length; i += BULK_REQUEST_LIMIT) {
            batches.push(cells.slice(i, i + BULK_REQUEST_LIMIT));
        }

        // Параллельные bulk requests.
        await mapLimit(batches, PARALLEL_BULK_REQUESTS, async (batch) => {
            await this.processBatch(batch, total);
        });

        // Финальный flush GPU buffers.
        this.opts.textureMgr?.flush();

        return {
            totalCells: total,
            parsedCells: this.parsedCells,
            skippedCells: this.skippedCells,
            totalEntries: this.opts.textureMgr?.getInfo().totalEntries ?? 0,
            bytesFromCache: this.bytesFromCache,
            bytesFromNetwork: this.bytesFromNetwork,
            packedCacheHits: this.packedCacheHits,
        };
    }

    /**
     * Обрабатывает один batch cells: смотрит IDB cache, fetch missing,
     * dispatch в worker, append в texture.
     */
    private async processBatch(
        batch: Array<[number, number]>,
        total: number,
    ): Promise<void> {
        // 0. Packed cache check: cells где уже есть готовый Uint32Array
        //    skipping worker parse. Direct GPU append. Per-layer cache:
        //    layer 0 → atlas сразу, upper layers → pendingLayerPacks для slider.
        const stillNeedingParse: Array<[number, number]> = [];
        for (const [cx, cy] of batch) {
            const cached = await getCachedPackedCell(
                this.opts.atlasVersion,
                cx,
                cy,
            );
            if (cached) {
                const packed = new Uint32Array(cached.packed);
                const strideOffsets = new Uint32Array(cached.strideOffsets);
                this.appendOrDefer(cx, cy, packed, strideOffsets);
                this.parsedCells++;
                this.packedCacheHits++;
                this.bytesFromCache
                    += cached.packed.byteLength + cached.strideOffsets.byteLength;
                // Восстанавливаем upper layers (1..3) из cache для maxFloor slider.
                if (cached.layers) {
                    for (const lr of cached.layers) {
                        if (lr.layer === 0 || lr.entriesCount === 0) continue;
                        this.pendingLayerPacks.set(`${cx}_${cy}_${lr.layer}`, {
                            cellX: cx,
                            cellY: cy,
                            layer: lr.layer,
                            packed: new Uint32Array(lr.packed),
                            strideOffsets: new Uint32Array(lr.strideOffsets),
                        });
                        this.bytesFromCache
                            += lr.packed.byteLength + lr.strideOffsets.byteLength;
                    }
                }
                this.opts.onCellProgress?.(
                    this.parsedCells + this.skippedCells,
                    total,
                );
                this.maybeFireProgressiveReady();
            } else {
                stillNeedingParse.push([cx, cy]);
            }
        }

        if (stillNeedingParse.length === 0) {
            this.opts.textureMgr?.flush();
            return;
        }

        // 1. Разделяем на cached / missing (raw binaries).
        const cachedBinaries = new Map<
            string,
            { header: ArrayBuffer; lotpack: ArrayBuffer }
        >();
        const missing: Array<[number, number]> = [];

        for (const [cx, cy] of stillNeedingParse) {
            const [hdr, lp] = await Promise.all([
                getCachedCellBinary(this.opts.atlasVersion, cx, cy, 'header'),
                getCachedCellBinary(this.opts.atlasVersion, cx, cy, 'lotpack'),
            ]);
            if (hdr && lp) {
                cachedBinaries.set(`${cx}_${cy}`, { header: hdr, lotpack: lp });
                this.bytesFromCache += hdr.byteLength + lp.byteLength;
            } else {
                missing.push([cx, cy]);
            }
        }

        // 2. Bulk fetch missing.
        const fetchedBinaries = await this.bulkFetch(missing);
        for (const [key, bins] of fetchedBinaries) {
            cachedBinaries.set(key, bins);
            this.bytesFromNetwork += bins.header.byteLength + bins.lotpack.byteLength;
            // Сохраняем в IDB (fire-and-forget).
            const [cx, cy] = key.split('_').map(Number) as [number, number];
            void putCachedCellBinary(
                this.opts.atlasVersion,
                cx,
                cy,
                'header',
                bins.header,
            ).catch(() => {/* IDB quota — non-fatal */});
            void putCachedCellBinary(
                this.opts.atlasVersion,
                cx,
                cy,
                'lotpack',
                bins.lotpack,
            ).catch(() => {});
        }

        // 3. Parse через workers (параллельно) + append в texture.
        const parseTasks = Array.from(cachedBinaries.entries()).map(
            async ([key, bins]) => {
                const [cx, cy] = key.split('_').map(Number) as [number, number];
                try {
                    // Worker transferable использует ArrayBuffer'ы — после
                    // postMessage main thread не может их читать. IDB cache
                    // надо положить ДО transfer (мы уже сделали выше).
                    // Делаем slice() копию для worker, оригинал остаётся в IDB
                    // (был помещён через putCachedCellBinary — копия в IDB).
                    const headerCopy = bins.header.slice(0);
                    const lotpackCopy = bins.lotpack.slice(0);
                    const result = await this.opts.pool.parseCell(
                        cx,
                        cy,
                        headerCopy,
                        lotpackCopy,
                    );
                    const packed = new Uint32Array(result.packed);
                    const strideOffsets = new Uint32Array(result.strideOffsets);
                    // Per-layer cache: layer 0 + upper. На reload это даёт
                    // мгновенный slider этажей без re-parse.
                    const cachedLayers = result.perLayer?.map((lr) => ({
                        layer: lr.layer,
                        packed: lr.packed,
                        strideOffsets: lr.strideOffsets,
                        entriesCount: lr.entriesCount,
                    }));
                    void putCachedPackedCell(this.opts.atlasVersion, cx, cy, {
                        packed: packed.buffer as ArrayBuffer,
                        strideOffsets: strideOffsets.buffer as ArrayBuffer,
                        entriesCount: result.entriesCount,
                        layers: cachedLayers,
                    }).catch(() => {/* IDB quota — non-fatal */});
                    this.appendOrDefer(cx, cy, packed, strideOffsets);
                    // Upper layers (1+) сохраняем для последующего upload
                    // через flushLayer() — UI maxFloor slider grows lazy.
                    if (result.perLayer) {
                        for (const lr of result.perLayer) {
                            if (lr.layer === 0 || lr.entriesCount === 0) continue;
                            this.pendingLayerPacks.set(`${cx}_${cy}_${lr.layer}`, {
                                cellX: cx,
                                cellY: cy,
                                layer: lr.layer,
                                packed: new Uint32Array(lr.packed),
                                strideOffsets: new Uint32Array(lr.strideOffsets),
                            });
                        }
                    }
                    this.parsedCells++;
                    this.maybeFireProgressiveReady();
                } catch (err) {
                    this.skippedCells++;
                    console.warn(
                        `[cell-loader] cell (${cx},${cy}) parse failed:`,
                        err,
                    );
                }
                this.opts.onCellProgress?.(
                    this.parsedCells + this.skippedCells,
                    total,
                );
            },
        );
        await Promise.all(parseTasks);

        // Flush GPU buffers пакетно (каждый batch).
        this.opts.textureMgr?.flush();
    }

    /** Phase 5.9: append или defer в зависимости от opts.deferAppend. */
    private appendOrDefer(
        cx: number,
        cy: number,
        packed: Uint32Array,
        strideOffsets: Uint32Array,
    ): void {
        if (this.opts.deferAppend) {
            this.deferredPacks.set(`${cx}_${cy}`, { cellX: cx, cellY: cy, packed, strideOffsets });
        } else if (this.opts.textureMgr) {
            this.opts.textureMgr.append(cx, cy, packed, strideOffsets);
        }
    }

    /**
     * Phase 5.9: flush all deferred packs к provided textureMgr.
     * Используется after preflight phase когда atlas сoздаётся с точными
     * размерами на основе know-ledge о реальных entry counts.
     */
    flushDeferred(textureMgr: CellTextureManager): void {
        for (const { cellX, cellY, packed, strideOffsets } of this.deferredPacks.values()) {
            textureMgr.append(cellX, cellY, packed, strideOffsets);
        }
        textureMgr.flush();
        this.deferredPacks.clear();
    }

    /**
     * Upload entries для конкретного PZ layer N (1..3) в base atlas. Каждый
     * layer кодируется через виртуальный cellY = cellY + layer * stride —
     * подход симметричный save-overlay. Idempotent.
     */
    flushLayer(layer: number, textureMgr: CellTextureManager, stride: number): number {
        if (layer === 0) return 0;
        let uploaded = 0;
        const remaining: Array<string> = [];
        for (const [key, slot] of this.pendingLayerPacks.entries()) {
            if (slot.layer !== layer) continue;
            const effectiveCellY = slot.cellY + layer * stride;
            const ok = textureMgr.append(
                slot.cellX,
                effectiveCellY,
                slot.packed,
                slot.strideOffsets,
            );
            if (ok) {
                uploaded++;
                remaining.push(key);
            }
        }
        for (const k of remaining) {
            this.pendingLayerPacks.delete(k);
        }
        textureMgr.flush();
        return uploaded;
    }

    /**
     * Bulk fetch missing cells через /cells/bulk endpoint.
     *
     * Response binary format:
     *   [count uint32 LE]
     *   per cell: x u16, y u16, headerLen u32, lotpackLen u32
     *   bodies: header + lotpack concatenated
     */
    private async bulkFetch(
        coords: Array<[number, number]>,
    ): Promise<Map<string, { header: ArrayBuffer; lotpack: ArrayBuffer }>> {
        const result = new Map<
            string,
            { header: ArrayBuffer; lotpack: ArrayBuffer }
        >();
        if (coords.length === 0) return result;

        const url = new URL(`${this.opts.cellsBaseUrl}/cells/bulk`, window.location.origin);
        url.searchParams.set(
            'coords',
            coords.map(([x, y]) => `${x}_${y}`).join(','),
        );

        const res = await fetch(url.toString(), {
            credentials: 'same-origin',
            signal: this.opts.signal,
        });
        if (!res.ok) {
            console.warn(
                `[cell-loader] bulk fetch HTTP ${res.status} для ${coords.length} cells`,
            );
            return result;
        }
        const buffer = await res.arrayBuffer();
        const dv = new DataView(buffer);
        let pos = 0;
        const count = dv.getUint32(pos, /* LE */ true);
        pos += 4;

        // Sub-header table: count × (x u16, y u16, headerLen u32, lotpackLen u32) = 12 bytes/entry
        const headerSize = 12;
        const entries: Array<{
            x: number;
            y: number;
            headerLen: number;
            lotpackLen: number;
        }> = [];
        for (let i = 0; i < count; i++) {
            const x = dv.getUint16(pos, true);
            const y = dv.getUint16(pos + 2, true);
            const headerLen = dv.getUint32(pos + 4, true);
            const lotpackLen = dv.getUint32(pos + 8, true);
            entries.push({ x, y, headerLen, lotpackLen });
            pos += headerSize;
        }

        // Bodies.
        for (const entry of entries) {
            const headerBuf = buffer.slice(pos, pos + entry.headerLen);
            pos += entry.headerLen;
            const lotpackBuf = buffer.slice(pos, pos + entry.lotpackLen);
            pos += entry.lotpackLen;
            // PZ cell coords могут быть negative — server использует u16 как
            // unsigned, но логически они signed. Если carry-bit unset, value < 32768
            // → коорд > 0. Большинство map'ов используют unsigned coords.
            result.set(`${entry.x}_${entry.y}`, {
                header: headerBuf,
                lotpack: lotpackBuf,
            });
        }

        return result;
    }
}

/**
 * Построить sprite name → id map из sprites manifest.
 * Used by worker init.
 */
export function buildSpriteNameToId(
    sprites: SpritesManifest,
): Map<string, number> {
    const map = new Map<string, number>();
    let nextId = 0;
    for (const name of Object.keys(sprites.sprites)) {
        map.set(name, nextId++);
    }
    return map;
}
