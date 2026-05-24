/**
 * Version compare для инвалидации IDB cache.
 *
 * Atlas pages и cell chunks immutable per `version`. Если backend опубликовал
 * новую версию атласа, мы должны:
 *   1. Удалить все cached atlas pages и cell chunks старой версии.
 *   2. Загрузить новые.
 *
 * Каждый IDB store хранит запись с `__version` key. При init проверяем:
 *   - Если current version === stored version → читать кэш.
 *   - Иначе → wipe + redownload.
 */

const VERSION_KEY = '__version';

/**
 * Проверить, нужно ли инвалидировать кэш. Сравнивает текущую версию с
 * сохранённой в store. Если различаются — wipe.
 *
 * @returns true если cache валиден (можно использовать), false если был wipe.
 */
export async function ensureVersionMatches(
    db: IDBDatabase,
    storeName: string,
    currentVersion: string,
): Promise<boolean> {
    const storedVersion = await getStoredVersion(db, storeName);
    if (storedVersion === currentVersion) {
        return true;
    }
    await clearStore(db, storeName);
    await setStoredVersion(db, storeName, currentVersion);
    return false;
}

async function getStoredVersion(
    db: IDBDatabase,
    storeName: string,
): Promise<string | null> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.get(VERSION_KEY);
        req.onsuccess = () => {
            const val = req.result as { version?: string } | undefined;
            resolve(val?.version ?? null);
        };
        req.onerror = () => reject(req.error);
    });
}

async function setStoredVersion(
    db: IDBDatabase,
    storeName: string,
    version: string,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.put({ version }, VERSION_KEY);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

async function clearStore(db: IDBDatabase, storeName: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}
