/**
 * Worker pool для cell binary parsing.
 *
 * Stateless workers — input → output, без retained кэшей. Round-robin
 * диспатч между N воркерами (N = min(hardwareConcurrency, 8)).
 *
 * Используется только в init phase. После init вызывают `terminate()`,
 * воркеры освобождаются.
 *
 * Sprite name → id mapping транслируется в каждый worker одноразово
 * через init message.
 */

// eslint-disable-next-line import/no-unresolved
import PzCellParserWorker from './pz-cell-parser.worker.ts?worker';

import type {
    WorkerErrorResponse,
    WorkerMessageOut,
    WorkerParseMessage,
    WorkerParseResponse,
} from '../types';

interface PendingTask {
    resolve: (resp: WorkerParseResponse) => void;
    reject: (err: Error) => void;
}

interface WorkerSlot {
    worker: Worker;
    pending: Map<number, PendingTask>;
}

const DEFAULT_POOL_SIZE = (() => {
    if (typeof navigator === 'undefined' || !navigator.hardwareConcurrency) {
        return 4;
    }
    return Math.max(2, Math.min(8, navigator.hardwareConcurrency));
})();

export class WorkerPool {
    private readonly slots: WorkerSlot[];
    private nextTaskId = 1;
    private nextSlotIdx = 0;
    private disposed = false;

    constructor(size: number = DEFAULT_POOL_SIZE) {
        this.slots = Array.from({ length: size }, () => this.createSlot());
    }

    get size(): number {
        return this.slots.length;
    }

    /**
     * Транслирует sprite name → id mapping в каждый worker. Должно быть
     * вызвано ОДИН РАЗ перед любым `parseCell`.
     */
    initSpriteIndex(spriteNameToId: Map<string, number>): void {
        const payload = Array.from(spriteNameToId.entries());
        for (const slot of this.slots) {
            slot.worker.postMessage({
                type: 'init',
                spriteNameToId: payload,
            });
        }
    }

    /**
     * Парсит одну cell. Round-robin worker selection. ArrayBuffer'ы
     * передаются через transferable (zero-copy).
     */
    parseCell(
        cellX: number,
        cellY: number,
        headerBuf: ArrayBuffer,
        lotpackBuf: ArrayBuffer,
    ): Promise<WorkerParseResponse> {
        if (this.disposed) {
            return Promise.reject(new Error('[worker-pool] disposed'));
        }
        return new Promise((resolve, reject) => {
            const slot = this.slots[this.nextSlotIdx % this.slots.length]!;
            this.nextSlotIdx++;
            const taskId = this.nextTaskId++;
            slot.pending.set(taskId, { resolve, reject });
            const msg: WorkerParseMessage = {
                type: 'parse',
                taskId,
                cellX,
                cellY,
                headerBuf,
                lotpackBuf,
            };
            slot.worker.postMessage(msg, [headerBuf, lotpackBuf]);
        });
    }

    /** Освободить всех воркеров. После dispose pool неюзабелен. */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const slot of this.slots) {
            const err = new Error('[worker-pool] disposed before completion');
            for (const task of slot.pending.values()) {
                task.reject(err);
            }
            slot.pending.clear();
            slot.worker.terminate();
        }
    }

    private createSlot(): WorkerSlot {
        const worker = new PzCellParserWorker() as Worker;
        const pending = new Map<number, PendingTask>();

        worker.onmessage = (ev: MessageEvent<WorkerMessageOut>) => {
            const msg = ev.data;
            if (msg.type === 'parse-result') {
                const task = pending.get(msg.taskId);
                if (task) {
                    pending.delete(msg.taskId);
                    task.resolve(msg);
                }
            } else if (msg.type === 'error') {
                const task = pending.get(msg.taskId);
                if (task) {
                    pending.delete(msg.taskId);
                    task.reject(new Error(msg.error));
                }
            }
        };

        worker.onerror = (ev) => {
            const err = new Error(`[worker-pool] worker error: ${ev.message}`);
            for (const task of pending.values()) {
                task.reject(err);
            }
            pending.clear();
        };

        return { worker, pending };
    }
}
