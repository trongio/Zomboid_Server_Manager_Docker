/**
 * Concurrency-limited execution pool.
 *
 * Эквивалент p-limit: гарантирует что одновременно выполняется не больше
 * N задач. Используется для:
 *   - параллельной загрузки atlas pages (max 4 одновременно)
 *   - параллельной загрузки cell chunks (max 6)
 *   - worker dispatch backpressure
 */

export interface Limiter {
    /** Запустить таск через лимит. Возвращает Promise результата таска. */
    <T>(task: () => Promise<T>): Promise<T>;
    /** Сколько таск сейчас активны. */
    readonly active: number;
    /** Сколько таск в очереди. */
    readonly pending: number;
}

/**
 * Создать лимитёр с лимитом `maxConcurrent`. Таски, превышающие лимит,
 * ставятся в FIFO очередь и запускаются по мере освобождения слотов.
 */
export function limit(maxConcurrent: number): Limiter {
    if (maxConcurrent < 1) {
        throw new Error('[concurrency] limit() requires maxConcurrent >= 1');
    }

    let active = 0;
    const queue: Array<() => void> = [];

    const next = (): void => {
        if (active >= maxConcurrent || queue.length === 0) {
            return;
        }
        const runner = queue.shift();
        if (runner) {
            runner();
        }
    };

    const limited = async <T>(task: () => Promise<T>): Promise<T> => {
        return new Promise<T>((resolve, reject) => {
            const runner = (): void => {
                active++;
                Promise.resolve()
                    .then(task)
                    .then(
                        (value) => {
                            active--;
                            resolve(value);
                            next();
                        },
                        (err) => {
                            active--;
                            reject(err);
                            next();
                        },
                    );
            };

            if (active < maxConcurrent) {
                runner();
            } else {
                queue.push(runner);
            }
        });
    };

    return Object.assign(limited, {
        get active() {
            return active;
        },
        get pending() {
            return queue.length;
        },
    }) as Limiter;
}

/**
 * Map массива через лимитёр. Полезный сахар для batch-обработки коллекций.
 *
 * @example
 *   const blobs = await mapLimit(urls, 4, async (url) => fetch(url).then(r => r.blob()));
 */
export async function mapLimit<T, R>(
    items: readonly T[],
    maxConcurrent: number,
    task: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
    const lim = limit(maxConcurrent);
    return Promise.all(items.map((item, idx) => lim(() => task(item, idx))));
}
