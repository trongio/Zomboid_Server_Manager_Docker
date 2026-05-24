/**
 * IndexedDB wrapper для persistent кэша атласов и cell chunks.
 *
 * Один DB (`pz-map-cache-v1`), несколько object stores:
 *   - `atlas-pages` — Blob/ArrayBuffer атласных страниц (immutable per atlas version)
 *   - `cell-chunks` — Blob/ArrayBuffer cell chunk-бинарей
 *
 * Лёгкая обёртка над raw IDB API без сторонних зависимостей. Используется
 * только во время init phase (одноразовый bulk-load); после init renderer
 * не трогает IDB.
 */

const DB_NAME = 'pz-map-cache-v1';
const DB_VERSION = 2;

export const ATLAS_STORE = 'atlas-pages';
export const CELL_CHUNK_STORE = 'cell-chunks';
/**
 * Phase 4.3b.1: store для уже распарсенных cell данных. Warm reload
 * пропускает worker parse: read packed Uint32Array + strideOffsets из
 * IDB → direct GPU upload. Cuts ~80% parse time.
 */
export const CELL_PACKED_STORE = 'cell-packed';

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Открыть БД (singleton). Создаёт object stores если впервые.
 */
export function openCacheDb(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(ATLAS_STORE)) {
                db.createObjectStore(ATLAS_STORE);
            }
            if (!db.objectStoreNames.contains(CELL_CHUNK_STORE)) {
                db.createObjectStore(CELL_CHUNK_STORE);
            }
            if (!db.objectStoreNames.contains(CELL_PACKED_STORE)) {
                db.createObjectStore(CELL_PACKED_STORE);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return dbPromise;
}

/** Прочитать запись из store. Возвращает undefined если ключ отсутствует. */
export async function idbGet<T>(
    db: IDBDatabase,
    storeName: string,
    key: string,
): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => reject(req.error);
    });
}

/** Записать в store. Перезаписывает существующее значение. */
export async function idbPut<T>(
    db: IDBDatabase,
    storeName: string,
    key: string,
    value: T,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.put(value as IDBValidKey | Record<string, unknown>, key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

/** Удалить ключ. */
export async function idbDelete(
    db: IDBDatabase,
    storeName: string,
    key: string,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

/** Запросить persistent storage у браузера (только Chrome/Firefox/Edge). */
export async function requestPersistentStorage(): Promise<boolean> {
    if (
        typeof navigator !== 'undefined'
        && 'storage' in navigator
        && typeof navigator.storage.persist === 'function'
    ) {
        return navigator.storage.persist();
    }
    return false;
}

/** Подсказка о свободном квоте. */
export async function getStorageEstimate(): Promise<{
    quota: number;
    usage: number;
} | null> {
    if (
        typeof navigator !== 'undefined'
        && 'storage' in navigator
        && typeof navigator.storage.estimate === 'function'
    ) {
        const e = await navigator.storage.estimate();
        return { quota: e.quota ?? 0, usage: e.usage ?? 0 };
    }
    return null;
}
