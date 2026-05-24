/**
 * Параллельная загрузка всех init-time JSON manifests.
 *
 * Один fetch на каждый ресурс, Promise.all. Если хоть один обязательный
 * (manifest, sprites, cells) фейлится — error. cell-pages и chunk-index
 * опциональны.
 */

import type {
    AtlasManifest,
    CellChunkIndex,
    CellPagesManifest,
    CellsManifest,
    SpritesManifest,
} from '../types';

export interface AllManifests {
    atlas: AtlasManifest;
    sprites: SpritesManifest;
    cells: CellsManifest;
    cellPages: CellPagesManifest | null;
    chunkIndex: CellChunkIndex | null;
}

export interface LoadManifestsOptions {
    atlasBaseUrl: string;
    cellsBaseUrl: string;
    chunksBaseUrl?: string;
    signal?: AbortSignal;
}

export async function loadAllManifests(
    opts: LoadManifestsOptions,
): Promise<AllManifests> {
    const { atlasBaseUrl, cellsBaseUrl, chunksBaseUrl, signal } = opts;

    const fetchJson = async <T>(url: string): Promise<T> => {
        const res = await fetch(url, {
            credentials: 'same-origin',
            signal,
        });
        if (!res.ok) {
            throw new Error(`[manifest-loader] ${url} → HTTP ${res.status}`);
        }
        return (await res.json()) as T;
    };

    const fetchJsonOptional = async <T>(url: string): Promise<T | null> => {
        try {
            const res = await fetch(url, { credentials: 'same-origin', signal });
            if (!res.ok) return null;
            return (await res.json()) as T;
        } catch {
            return null;
        }
    };

    const [atlas, sprites, cells, cellPages, chunkIndex] = await Promise.all([
        fetchJson<AtlasManifest>(`${atlasBaseUrl}/manifest.json`),
        fetchJson<SpritesManifest>(`${atlasBaseUrl}/sprites.json`),
        fetchJson<CellsManifest>(`${cellsBaseUrl}/cells.json`),
        fetchJsonOptional<CellPagesManifest>(`${atlasBaseUrl}/cell-pages.json`),
        chunksBaseUrl
            ? fetchJsonOptional<CellChunkIndex>(`${chunksBaseUrl}/index.json`)
            : Promise.resolve(null),
    ]);

    return { atlas, sprites, cells, cellPages, chunkIndex };
}
