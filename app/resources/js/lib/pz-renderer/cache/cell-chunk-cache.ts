/**
 * IDB persistence для cell binary данных.
 *
 * Backend отдаёт `cells/bulk` (batched binary) или pre-packed
 * `/pz-cell-data/chunk-*.bin`. После парсинга мы НЕ кэшируем результат
 * парсинга (packed Uint32Array уже в GPU). Кэшируем только raw binary
 * (header + lotpack отдельно), чтобы при следующем визите не качать
 * заново.
 *
 * Ключи: `{version}_{cellX}_{cellY}_header` и `..._lotpack`.
 */

import { CELL_CHUNK_STORE, idbGet, idbPut, openCacheDb } from './idb-cache';
import { ensureVersionMatches } from '../utils/version';

function cellKey(
    version: string,
    cellX: number,
    cellY: number,
    kind: 'header' | 'lotpack',
): string {
    return `${version}_${cellX}_${cellY}_${kind}`;
}

export async function getCachedCellBinary(
    version: string,
    cellX: number,
    cellY: number,
    kind: 'header' | 'lotpack',
): Promise<ArrayBuffer | null> {
    const db = await openCacheDb();
    await ensureVersionMatches(db, CELL_CHUNK_STORE, version);
    const buf = await idbGet<ArrayBuffer>(
        db,
        CELL_CHUNK_STORE,
        cellKey(version, cellX, cellY, kind),
    );
    return buf ?? null;
}

export async function putCachedCellBinary(
    version: string,
    cellX: number,
    cellY: number,
    kind: 'header' | 'lotpack',
    buffer: ArrayBuffer,
): Promise<void> {
    const db = await openCacheDb();
    await idbPut(db, CELL_CHUNK_STORE, cellKey(version, cellX, cellY, kind), buffer);
}
