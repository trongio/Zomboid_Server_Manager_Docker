/**
 * StreamingManager — Phase 4.4 viewport-driven cell loading.
 *
 * Subscribes к view changes (pan/zoom). На каждое изменение:
 *   1. Вычисляет set визуально visible cells.
 *   2. Вычисляет extended ring (visible + N margin) — cells которые
 *      worth loading для smooth pan.
 *   3. Diff с currently loaded:
 *      - In ring but not loaded → schedule load (worker, IDB hit warm)
 *      - Loaded but outside ring → unload (free slot)
 *   4. Atlas slot allocator (в CellTextureManager) reused через unload.
 *
 * Existing cells limited к manifest.cells list — пустые cells (off-map)
 * не загружаются.
 */

import type { CellTextureManager } from '../gpu/cell-texture-manager';
import type { CellLoader } from './cell-loader';

export interface StreamingManagerOptions {
    loader: CellLoader;
    textureMgr: CellTextureManager;
    /** Set всех cells доступных на backend (из manifest.cells). */
    existingCells: Set<string>;
    /** Дополнительный буфер cells вокруг visible для smooth pan. */
    ringMarginCells: number;
    /** Cells outside this radius from visible — evict. Должно быть ≥ ringMarginCells. */
    evictMarginCells: number;
}

function cellKey(cx: number, cy: number): string {
    return `${cx}_${cy}`;
}

export class StreamingManager {
    private readonly opts: StreamingManagerOptions;
    /** Cells полностью загруженные в cellAtlas. */
    private loaded = new Set<string>();
    /** Cells в процессе загрузки — НЕ schedulim повторно. */
    private loading = new Set<string>();
    /** Last frame seq когда cell видели visible — для freshness tracking. */
    private lastSeenFrame = new Map<string, number>();
    private currentFrame = 0;
    /** Phase 4.5: текущий K. При смене — full reload с новым slot size. */
    private currentK = 0;
    /** Phase 5: pending K, ждёт debounce. */
    private pendingK: number | null = null;
    /** Время последнего setCurrentK request (ms). */
    private lastSetKAt = 0;
    /** Debounce window — K меняется только если стабильна ≥ 350ms. */
    private static readonly K_DEBOUNCE_MS = 350;

    constructor(opts: StreamingManagerOptions) {
        this.opts = opts;
        this.opts.textureMgr.recreateAllocatorForK(0);
    }

    /**
     * Phase 4.5+5: K-change с debounce. Atlas wipe stoit'ит дорого (50+
     * cells reload), поэтому только при ACTUAL stabilized К. Per-frame
     * вызов с тем же К → no-op. Per-frame с разным К → defer until stable.
     */
    setCurrentK(k: number): boolean {
        if (k === this.currentK && this.pendingK === null) return false;
        const now = performance.now();
        if (k === this.currentK) {
            this.pendingK = null;
            return false;
        }
        if (this.pendingK !== k) {
            this.pendingK = k;
            this.lastSetKAt = now;
            return false;
        }
        // Same pending K — check if stable достаточно долго.
        if (now - this.lastSetKAt < StreamingManager.K_DEBOUNCE_MS) {
            return false;
        }
        // Stable: apply.
        this.currentK = k;
        this.pendingK = null;
        this.opts.textureMgr.recreateAllocatorForK(k);
        this.loaded.clear();
        return true;
    }

    getCurrentK(): number {
        return this.currentK;
    }

    /** Helper: подсчёт visible cells для UI/HUD. */
    getStats(): { loaded: number; loading: number } {
        return {
            loaded: this.loaded.size,
            loading: this.loading.size,
        };
    }

    /** Set визуально visible cells (без margin). Used для priority. */
    isLoaded(cx: number, cy: number): boolean {
        return this.loaded.has(cellKey(cx, cy));
    }

    /**
     * Главный entry point — вызывается при view change. cellsInRing —
     * cells которые нужны (visible + margin). cellsOutsideEvictRing —
     * пороги для eviction.
     *
     * Async kickoff load for needed. Sync evict для outside.
     */
    async update(
        cellsInRing: Array<[number, number]>,
        cellsToKeepLoaded: Set<string>,
    ): Promise<void> {
        this.currentFrame++;

        // Phase 5.5: при K>0 convert ring cells И keep set в super-anchor
        // keys. Loaded set содержит anchors при К>0; comparison должен быть
        // на одинаковых ключах.
        const K = this.currentK;
        const N = 1 << K;
        let effectiveRing = cellsInRing;
        let effectiveKeep = cellsToKeepLoaded;
        if (K > 0) {
            const ringSet = new Set<string>();
            const ringList: Array<[number, number]> = [];
            for (const [cx, cy] of cellsInRing) {
                const acx = Math.floor(cx / N) * N;
                const acy = Math.floor(cy / N) * N;
                const key = cellKey(acx, acy);
                if (!ringSet.has(key)) {
                    ringSet.add(key);
                    ringList.push([acx, acy]);
                }
            }
            const keepSet = new Set<string>();
            for (const baseKey of cellsToKeepLoaded) {
                const [cxStr, cyStr] = baseKey.split('_');
                const acx = Math.floor(Number(cxStr) / N) * N;
                const acy = Math.floor(Number(cyStr) / N) * N;
                keepSet.add(cellKey(acx, acy));
            }
            effectiveRing = ringList;
            effectiveKeep = keepSet;
        }

        // Mark all ring cells как seen.
        for (const [cx, cy] of effectiveRing) {
            this.lastSeenFrame.set(cellKey(cx, cy), this.currentFrame);
        }

        // === Evict cells outside effectiveKeep ===
        const toEvict: string[] = [];
        for (const key of this.loaded) {
            if (!effectiveKeep.has(key)) {
                toEvict.push(key);
            }
        }
        for (const key of toEvict) {
            const [cxStr, cyStr] = key.split('_');
            const cx = Number(cxStr);
            const cy = Number(cyStr);
            this.opts.textureMgr.unload(cx, cy);
            this.loaded.delete(key);
        }
        if (toEvict.length > 0) {
            this.opts.textureMgr.flush();
        }

        // === Schedule load для cells в ring но not loaded ===
        if (K === 0) {
            const toLoad: Array<[number, number]> = [];
            for (const [cx, cy] of effectiveRing) {
                const key = cellKey(cx, cy);
                if (this.loaded.has(key)) continue;
                if (this.loading.has(key)) continue;
                if (!this.opts.existingCells.has(key)) continue;
                toLoad.push([cx, cy]);
                this.loading.add(key);
            }
            if (toLoad.length === 0) return;
            try {
                await this.opts.loader.loadCells(toLoad);
                for (const [cx, cy] of toLoad) {
                    const key = cellKey(cx, cy);
                    this.loading.delete(key);
                    if (this.opts.textureMgr.getCellInfo(cx, cy)) {
                        this.loaded.add(key);
                    }
                }
            } catch (err) {
                console.warn('[streaming] load batch failed:', err);
                for (const [cx, cy] of toLoad) {
                    this.loading.delete(cellKey(cx, cy));
                }
            }
        } else {
            // Phase 5.5: effectiveRing уже содержит super-anchors.
            const toLoadAnchors: Array<[number, number]> = [];
            for (const [acx, acy] of effectiveRing) {
                const key = cellKey(acx, acy);
                if (this.loaded.has(key) || this.loading.has(key)) continue;
                // Anchor может не быть в existingCells (e.g., ocean), но
                // sub-cells могут. Check has хотя бы один sub.
                let anyExists = false;
                for (let dy = 0; dy < N && !anyExists; dy++) {
                    for (let dx = 0; dx < N && !anyExists; dx++) {
                        if (this.opts.existingCells.has(cellKey(acx + dx, acy + dy))) {
                            anyExists = true;
                        }
                    }
                }
                if (!anyExists) continue;
                toLoadAnchors.push([acx, acy]);
                this.loading.add(key);
            }
            if (toLoadAnchors.length === 0) return;
            try {
                await this.opts.loader.loadSuperCells(toLoadAnchors, K);
                for (const [acx, acy] of toLoadAnchors) {
                    const key = cellKey(acx, acy);
                    this.loading.delete(key);
                    if (this.opts.textureMgr.getCellInfo(acx, acy)) {
                        this.loaded.add(key);
                    }
                }
            } catch (err) {
                console.warn('[streaming] super load batch failed:', err);
                for (const [acx, acy] of toLoadAnchors) {
                    this.loading.delete(cellKey(acx, acy));
                }
            }
        }
    }

    /** Полная reset (для dispose/restart). */
    clear(): void {
        for (const key of this.loaded) {
            const [cxStr, cyStr] = key.split('_');
            this.opts.textureMgr.unload(Number(cxStr), Number(cyStr));
        }
        this.loaded.clear();
        this.loading.clear();
        this.lastSeenFrame.clear();
    }
}
