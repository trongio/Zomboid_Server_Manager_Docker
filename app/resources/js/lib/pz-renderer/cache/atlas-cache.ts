/**
 * Atlas page persistence через IndexedDB.
 *
 * Atlas pages immutable per `version` — формат filename включает hash:
 * `atlas-{version}-{pageId}-lod{lod}.{webp|ktx2}`. Если version изменился
 * (backend пересобрал атлас), весь store wipe'ится через
 * `ensureVersionMatches`.
 *
 * Ключи в store: `{version}_{pageId}_{lod}_{format}` (например
 * `v1716123-12-0-ktx2`). Значение: `ArrayBuffer` (сжатый KTX2 или WebP).
 */

import { ATLAS_STORE, idbGet, idbPut, openCacheDb } from './idb-cache';
import { ensureVersionMatches } from '../utils/version';

export type AtlasPageFormat = 'webp' | 'ktx2';

function atlasKey(
    version: string,
    pageId: number,
    lod: number,
    format: AtlasPageFormat,
): string {
    return `${version}_${pageId}_${lod}_${format}`;
}

/**
 * Прочитать атлас page из кэша. Возвращает ArrayBuffer или null если
 * ключ отсутствует (значит надо скачать с сервера).
 */
export async function getCachedAtlasPage(
    version: string,
    pageId: number,
    lod: number,
    format: AtlasPageFormat,
): Promise<ArrayBuffer | null> {
    const db = await openCacheDb();
    // Гарантируем что store соответствует текущей версии (wipe при mismatch).
    await ensureVersionMatches(db, ATLAS_STORE, version);
    const buf = await idbGet<ArrayBuffer>(
        db,
        ATLAS_STORE,
        atlasKey(version, pageId, lod, format),
    );
    return buf ?? null;
}

/**
 * Сохранить атлас page в кэш. Идемпотентно — повторный put перезапишет.
 */
export async function putCachedAtlasPage(
    version: string,
    pageId: number,
    lod: number,
    format: AtlasPageFormat,
    buffer: ArrayBuffer,
): Promise<void> {
    const db = await openCacheDb();
    await idbPut(db, ATLAS_STORE, atlasKey(version, pageId, lod, format), buffer);
}
