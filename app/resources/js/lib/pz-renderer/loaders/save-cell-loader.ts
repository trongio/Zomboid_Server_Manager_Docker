/**
 * SaveCellLoader — загружает pre-parsed save cells (выпеченные серверным
 * Python скриптом) с lazy-load по этажам.
 *
 * Без client-side parsing: nginx раздаёт packed Uint32Array напрямую.
 *
 * Endpoints (все статика через nginx, Last-Modified handles caching):
 *   GET /pz-save-data/manifest.json
 *       {
 *         version, world, save_version, generated_at,
 *         cells: [[cx, cy, mtime, { "0": n0, "1": n1, ... }], ...]
 *       }
 *   GET /pz-save-data/cell-{cx}_{cy}.l{N}.packed     (raw Uint32Array per layer)
 *   GET /pz-save-data/cell-{cx}_{cy}.l{N}.strides    (Uint32Array(7))
 *   GET /pz-save-data/cell-{cx}_{cy}.mask            (256×256 R8, layer 0 occlusion)
 *
 * По дефолту грузим только layer 0. Когда пользователь увеличивает maxFloor
 * в UI, renderer вызывает loadLayer(N) для подгрузки upper floors.
 */

import type { CellTextureManager } from '../gpu/cell-texture-manager';
import { mapLimit } from '../utils/concurrency';

const PARALLEL_CELL_FETCHES = 8;

export type CellLayerCounts = Record<string, number>; // "layer" → entry count

export type SaveCellRow = [
    cellX: number,
    cellY: number,
    mtime: number,
    counts: CellLayerCounts,
];

export interface DiscoveredFPrefix {
    prefix: string;
    count: number;
}

export interface SaveCellsManifest {
    version: string;
    world: string;
    save_version: number;
    cells: SaveCellRow[];
    generated_at: number;
    discovered_f_prefixes?: DiscoveredFPrefix[];
    active_extra_noise_prefixes?: string[];
}

export interface SaveCellLoaderOptions {
    textureMgr: CellTextureManager;
    /** Base URL для save-cache, e.g. `/pz-save-data`. */
    saveBaseUrl: string;
    /**
     * Виртуальный отступ по Y для кодирования layer в индексе cell texture.
     * effectiveCellY = cellY + layer * stride. Должен быть >= max(cellY)+1.
     */
    layerCellStride: number;
    signal?: AbortSignal;
    onCellLoaded?: (cellX: number, cellY: number, layer: number, entriesCount: number) => void;
    onProgress?: (loaded: number, total: number) => void;
}

export interface SaveCellLoaderStats {
    /** Сколько (cell, layer) пар loaded успешно. */
    loadedSlots: number;
    /** Сколько fetch failed. */
    skippedSlots: number;
    totalEntries: number;
    bytesFromNetwork: number;
    saveVersion: number | null;
    /** Max loaded layer (0..3). */
    loadedMaxLayer: number;
}

export class SaveCellLoader {
    private skippedSlots = 0;
    private bytesFromNetwork = 0;
    private saveVersion: number | null = null;
    /** Map "{cx}_{cy}_{layer}" → mtime, чтобы skip повторных fetch'ей. */
    private readonly loadedSlotMtimes = new Map<string, number>();
    private loadedMaxLayer = 0;
    private highestMtime = 0;
    private cachedManifest: SaveCellsManifest | null = null;

    constructor(private readonly opts: SaveCellLoaderOptions) {}

    getStats(): SaveCellLoaderStats {
        return {
            loadedSlots: this.loadedSlotMtimes.size,
            skippedSlots: this.skippedSlots,
            totalEntries: this.opts.textureMgr.getInfo().totalEntries,
            bytesFromNetwork: this.bytesFromNetwork,
            saveVersion: this.saveVersion,
            loadedMaxLayer: this.loadedMaxLayer,
        };
    }

    getHighestMtime(): number {
        return this.highestMtime;
    }

    getCachedManifest(): SaveCellsManifest | null {
        return this.cachedManifest;
    }

    async loadManifest(): Promise<SaveCellsManifest | null> {
        const url = new URL(
            `${this.opts.saveBaseUrl}/manifest.json`,
            window.location.origin,
        );
        try {
            const res = await fetch(url.toString(), {
                credentials: 'same-origin',
                signal: this.opts.signal,
                headers: { Accept: 'application/json' },
            });
            if (!res.ok) {
                if (res.status === 404) return null;
                console.warn(`[save-loader] manifest HTTP ${res.status}`);
                return null;
            }
            const m = (await res.json()) as SaveCellsManifest;
            this.cachedManifest = m;
            this.saveVersion = m.save_version;
            return m;
        } catch (err) {
            if ((err as Error).name === 'AbortError') throw err;
            console.warn('[save-loader] manifest fetch:', err);
            return null;
        }
    }

    /**
     * Загрузить layer N для всех cells где manifest показывает entries.
     * Idempotent — повторные вызовы skip уже loaded slots.
     */
    async loadLayer(layer: number): Promise<void> {
        if (!this.cachedManifest) {
            await this.loadManifest();
        }
        const manifest = this.cachedManifest;
        if (!manifest) return;

        const slots: Array<[cellX: number, cellY: number, layer: number, mtime: number]> = [];
        for (const [cx, cy, mtime, counts] of manifest.cells) {
            if (mtime > this.highestMtime) this.highestMtime = mtime;
            const count = counts[String(layer)];
            if (!count || count === 0) continue;
            const key = `${cx}_${cy}_${layer}`;
            if ((this.loadedSlotMtimes.get(key) ?? 0) >= mtime) continue;
            slots.push([cx, cy, layer, mtime]);
        }

        if (slots.length === 0) return;

        let progress = 0;
        await mapLimit(slots, PARALLEL_CELL_FETCHES, async ([cx, cy, l, mtime]) => {
            try {
                await this.fetchAndUploadSlot(cx, cy, l);
                this.loadedSlotMtimes.set(`${cx}_${cy}_${l}`, mtime);
                if (l > this.loadedMaxLayer) this.loadedMaxLayer = l;
            } catch (err) {
                this.skippedSlots++;
                if ((err as Error).name !== 'AbortError') {
                    console.warn(`[save-loader] cell (${cx},${cy}) l${l}:`, err);
                }
            }
            progress++;
            this.opts.onProgress?.(progress, slots.length);
        });

        this.opts.textureMgr.flush();
    }

    /**
     * Initial load (layer 0 only) + manifest fetch. Возвращает stats после load.
     */
    async loadInitial(): Promise<SaveCellLoaderStats> {
        await this.loadLayer(0);
        return this.getStats();
    }

    /**
     * Обновить ВСЕ уже загруженные layers для изменённых cells (используется
     * watcher'ом). Загружаем те же layers что были раньше, ничего нового.
     */
    async refreshChangedCells(): Promise<number> {
        if (!this.cachedManifest) return 0;
        const previouslyLoadedLayers = new Set<number>();
        for (const key of this.loadedSlotMtimes.keys()) {
            const parts = key.split('_');
            previouslyLoadedLayers.add(Number(parts[2]));
        }
        if (previouslyLoadedLayers.size === 0) {
            previouslyLoadedLayers.add(0);
        }
        let totalChanged = 0;
        for (const layer of previouslyLoadedLayers) {
            const before = this.loadedSlotMtimes.size;
            await this.loadLayer(layer);
            totalChanged += this.loadedSlotMtimes.size - before;
        }
        return totalChanged;
    }

    private async fetchAndUploadSlot(cellX: number, cellY: number, layer: number): Promise<void> {
        const base = this.opts.saveBaseUrl;
        const packedUrl = new URL(
            `${base}/cell-${cellX}_${cellY}.l${layer}.packed`,
            window.location.origin,
        );
        const stridesUrl = new URL(
            `${base}/cell-${cellX}_${cellY}.l${layer}.strides`,
            window.location.origin,
        );

        const [packedRes, stridesRes] = await Promise.all([
            fetch(packedUrl.toString(), {
                credentials: 'same-origin',
                signal: this.opts.signal,
            }),
            fetch(stridesUrl.toString(), {
                credentials: 'same-origin',
                signal: this.opts.signal,
            }),
        ]);

        if (!packedRes.ok) throw new Error(`packed HTTP ${packedRes.status}`);
        if (!stridesRes.ok) throw new Error(`strides HTTP ${stridesRes.status}`);

        const [packedBuf, stridesBuf] = await Promise.all([
            packedRes.arrayBuffer(),
            stridesRes.arrayBuffer(),
        ]);

        this.bytesFromNetwork += packedBuf.byteLength + stridesBuf.byteLength;

        const packed = new Uint32Array(packedBuf);
        const strideOffsets = new Uint32Array(stridesBuf);
        const effectiveCellY = cellY + layer * this.opts.layerCellStride;
        this.opts.textureMgr.append(cellX, effectiveCellY, packed, strideOffsets);

        this.opts.onCellLoaded?.(cellX, cellY, layer, packed.length);
    }
}
