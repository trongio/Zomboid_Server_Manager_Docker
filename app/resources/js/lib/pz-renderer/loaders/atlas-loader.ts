/**
 * AtlasLoader — eager preload всех atlas pages всех LOD в GPU.
 *
 * На каждый LOD создаётся отдельный TEXTURE_2D_ARRAY (depth = pageCount).
 * Layer index в array = pageId (прямой mapping, никаких slot tables).
 *
 * Если backend опубликовал KTX2 BC7 + GPU поддерживает BPTC → используем
 * compressed format (~1 byte/pixel). Иначе fallback на WebP RGBA8
 * (4 bytes/pixel).
 *
 * Параллелизм: max 4 одновременно (network throughput + decode CPU).
 * IDB cache: hit → skip fetch, decode напрямую из stored ArrayBuffer.
 */

import type { AtlasManifest, GlCapabilities, LodInfo } from '../types';
import {
    getCachedAtlasPage,
    putCachedAtlasPage,
    type AtlasPageFormat,
} from '../cache/atlas-cache';
import { parseKtx2 } from './ktx2-decoder';
import {
    createTexture2dArray,
    destroyTexture,
    uploadCompressedLayer,
    uploadRgba8LayerFromBitmap,
} from '../gpu/texture-2d-array';
import { mapLimit } from '../utils/concurrency';

export interface LodTexture {
    lod: LodInfo;
    texture: WebGLTexture;
    /** Размер layer (size×size). */
    size: number;
    /** Сколько layers (= pageCount). */
    depth: number;
}

export interface AtlasLoaderOptions {
    gl: WebGL2RenderingContext;
    capabilities: GlCapabilities;
    manifest: AtlasManifest;
    atlasBaseUrl: string;
    /** Per-page progress callback. */
    onPageLoaded?: (pageId: number, lod: number, bytes: number) => void;
    /** Per-byte progress (для ETA расчёта). */
    onBytes?: (bytes: number) => void;
    signal?: AbortSignal;
}

export class AtlasLoader {
    private readonly textures: Map<number, LodTexture> = new Map();
    /** Phase 4.3b.4: какие LOD pages реально загружены (для render fallback). */
    private readonly loadedLodPages: Map<number, Set<number>> = new Map();

    constructor(private readonly opts: AtlasLoaderOptions) {}

    /**
     * Phase 4.3b.4: lazy LOD loading. Сначала грузим ТОЛЬКО initial LOD
     * (= 0 by default — full quality для close-up). Возвращает Map с
     * аллоцированными textures (some LODs могут быть empty initially).
     * Остальные LODs загружаются в фоне через `loadOthersInBackground`.
     */
    async loadInitialLod(initialLod: number): Promise<Map<number, LodTexture>> {
        const { gl, manifest, capabilities } = this.opts;
        const useKtx2 = manifest.has_ktx2 && capabilities.hasBptc;
        const format: AtlasPageFormat = useKtx2 ? 'ktx2' : 'webp';

        // 1. Аллоцируем TEXTURE_2D_ARRAY для каждого LOD (empty layers).
        for (const lod of manifest.lods) {
            const tex = createTexture2dArray(
                gl,
                lod.size,
                manifest.atlas_count,
                useKtx2,
            );
            this.textures.set(lod.id, {
                lod,
                texture: tex,
                size: lod.size,
                depth: manifest.atlas_count,
            });
            this.loadedLodPages.set(lod.id, new Set());
        }

        // 2. Грузим только initial LOD.
        const lodInfo = manifest.lods.find((l) => l.id === initialLod)
            ?? manifest.lods[0]!;
        const initialTasks: Array<{ pageId: number; lod: LodInfo }> = [];
        for (let pageId = 0; pageId < manifest.atlas_count; pageId++) {
            initialTasks.push({ pageId, lod: lodInfo });
        }
        await mapLimit(initialTasks, 4, async ({ pageId, lod }) => {
            await this.loadOnePage(pageId, lod, format);
        });

        return this.textures;
    }

    /**
     * Phase 4.3b.4: грузит остальные LODs в фоне после initial. Не блокирует.
     * Возвращает Promise который resolved когда всё догружено (можно not await).
     */
    loadOthersInBackground(initialLod: number): Promise<void> {
        const { manifest, capabilities } = this.opts;
        const useKtx2 = manifest.has_ktx2 && capabilities.hasBptc;
        const format: AtlasPageFormat = useKtx2 ? 'ktx2' : 'webp';

        const tasks: Array<{ pageId: number; lod: LodInfo }> = [];
        for (let pageId = 0; pageId < manifest.atlas_count; pageId++) {
            for (const lod of manifest.lods) {
                if (lod.id === initialLod) continue;
                tasks.push({ pageId, lod });
            }
        }
        // Меньше параллелизм чтобы не мешать render loop.
        return mapLimit(tasks, 2, async ({ pageId, lod }) => {
            await this.loadOnePage(pageId, lod, format);
        });
    }

    /**
     * Совместимость: legacy entry point — грузит все LOD сразу.
     * Эквивалентно loadInitialLod + (await) loadOthersInBackground.
     */
    async loadAll(): Promise<Map<number, LodTexture>> {
        await this.loadInitialLod(0);
        await this.loadOthersInBackground(0);
        return this.textures;
    }

    /** Загрузка одной (pageId, lod) — fetch + decode + upload. */
    private async loadOnePage(
        pageId: number,
        lod: LodInfo,
        format: AtlasPageFormat,
    ): Promise<void> {
        const { manifest, atlasBaseUrl, gl, signal } = this.opts;

        // 1. Try IDB cache.
        let buffer = await getCachedAtlasPage(
            manifest.version,
            pageId,
            lod.id,
            format,
        );
        let bytesFromNetwork = 0;

        if (!buffer) {
            // 2. Fetch с сервера.
            const url = this.atlasPageUrl(pageId, lod.id, format);
            const res = await fetch(url, {
                credentials: 'same-origin',
                signal,
            });
            if (!res.ok) {
                // Fallback на legacy filename для LOD 0 + WebP.
                if (
                    res.status === 404
                    && lod.id === 0
                    && format === 'webp'
                ) {
                    const legacyUrl = `${atlasBaseUrl}/atlas-${manifest.version}-${pageId}.webp`;
                    const legacy = await fetch(legacyUrl, {
                        credentials: 'same-origin',
                        signal,
                    });
                    if (!legacy.ok) {
                        throw new Error(
                            `[atlas-loader] не удалось скачать page ${pageId} lod ${lod.id}: HTTP ${res.status}`,
                        );
                    }
                    buffer = await legacy.arrayBuffer();
                } else {
                    throw new Error(
                        `[atlas-loader] не удалось скачать page ${pageId} lod ${lod.id}: HTTP ${res.status}`,
                    );
                }
            } else {
                buffer = await res.arrayBuffer();
            }
            bytesFromNetwork = buffer.byteLength;
            // Сохраняем в IDB (fire-and-forget — не ждём).
            void putCachedAtlasPage(
                manifest.version,
                pageId,
                lod.id,
                format,
                buffer,
            ).catch(() => {/* IDB quota — non-fatal */});
        }

        // 3. Decode + upload.
        const target = this.textures.get(lod.id);
        if (!target) {
            throw new Error(`[atlas-loader] no texture for lod ${lod.id}`);
        }

        if (format === 'ktx2') {
            const ktx2 = parseKtx2(buffer);
            uploadCompressedLayer(gl, target.texture, pageId, ktx2.width, ktx2.mip0);
        } else {
            // WebP: создаём ImageBitmap.
            const blob = new Blob([buffer], { type: 'image/webp' });
            const bitmap = await createImageBitmap(blob, {
                imageOrientation: 'none',
                premultiplyAlpha: 'none',
            });
            uploadRgba8LayerFromBitmap(gl, target.texture, pageId, bitmap);
            bitmap.close();
        }

        const loadedSet = this.loadedLodPages.get(lod.id);
        if (loadedSet) loadedSet.add(pageId);

        this.opts.onPageLoaded?.(pageId, lod.id, bytesFromNetwork);
        if (bytesFromNetwork > 0) this.opts.onBytes?.(bytesFromNetwork);
    }

    /** Phase 4.3b.4: проверка готовности LOD layer для конкретного pageId. */
    hasLodPage(lodId: number, pageId: number): boolean {
        return this.loadedLodPages.get(lodId)?.has(pageId) ?? false;
    }

    /** Сколько pages загружено в данный LOD. */
    loadedPageCount(lodId: number): number {
        return this.loadedLodPages.get(lodId)?.size ?? 0;
    }

    private atlasPageUrl(
        pageId: number,
        lod: number,
        format: AtlasPageFormat,
    ): string {
        const { atlasBaseUrl, manifest } = this.opts;
        return `${atlasBaseUrl}/atlas-${manifest.version}-${pageId}-lod${lod}.${format}`;
    }

    /** Освободить все GPU ресурсы. */
    dispose(): void {
        const { gl } = this.opts;
        for (const t of this.textures.values()) {
            destroyTexture(gl, t.texture);
        }
        this.textures.clear();
    }

    /** Прямой доступ к LOD texture (по lod.id). */
    getTexture(lod: number): WebGLTexture | undefined {
        return this.textures.get(lod)?.texture;
    }
}
