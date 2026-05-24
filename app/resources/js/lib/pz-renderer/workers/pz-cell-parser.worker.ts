/**
 * Web Worker entry для парсинга PZ cell binaries.
 *
 * Stateless после init: получает sprite name → id mapping один раз через
 * `WorkerInitMessage`, далее на каждый `WorkerParseMessage` возвращает
 * packed Uint32Array (sprite stream для cellAtlas).
 *
 * Никаких retained state map'ов cellData, никаких LRU. Воркер — pure
 * функция input → output. После init phase main thread terminate'ит pool.
 */

import { parseLotheader } from './lotheader-parser';
import { packLotpackEntries, parseLotpack } from './lotpack-parser';
import type {
    WorkerMessageIn,
    WorkerMessageOut,
} from '../types';

const spriteNameToId = new Map<string, number>();

const post = self as unknown as {
    postMessage(msg: WorkerMessageOut, transfer?: Transferable[]): void;
};

/**
 * Сколько PZ layers парсить из base lotpack.
 * 0 = ground, 1 = walls/окна, 2 = furniture/objects, 3 = низ 2-го этажа.
 * Слайдер maxFloor в UI ограничен 0..3 → парсим все.
 */
const NUM_LAYERS = 4;

self.onmessage = (ev: MessageEvent<WorkerMessageIn>) => {
    const msg = ev.data;

    if (msg.type === 'init') {
        spriteNameToId.clear();
        for (const [name, id] of msg.spriteNameToId) {
            spriteNameToId.set(name, id);
        }
        return;
    }

    if (msg.type !== 'parse') return;

    const { taskId, cellX, cellY, headerBuf, lotpackBuf } = msg;

    try {
        const t0 = performance.now();
        const header = parseLotheader(headerBuf, /* includeOverlays */ false);
        const lotpack = parseLotpack(lotpackBuf, {
            minLayer: header.minLayer,
            maxLayer: header.maxLayer,
            blockSize: header.blockSize,
            cellSizeInBlocks: header.cellSizeInBlocks,
        });

        // Парсим каждый layer отдельно (даже если PZ-layer не присутствует
        // в lotpack — получим пустой результат с entriesCount=0).
        const perLayer: Array<{
            layer: number;
            packed: ArrayBuffer;
            entriesCount: number;
            strideOffsets: ArrayBuffer;
        }> = [];
        const transfer: ArrayBuffer[] = [];

        for (let layer = 0; layer < NUM_LAYERS; layer++) {
            const result = packLotpackEntries(
                lotpack,
                header.cellSizeInBlocks,
                header.spriteNames,
                spriteNameToId,
                { keepMinLayer: layer, keepMaxLayer: layer + 1 },
            );
            const packedBuf = result.packed.buffer as ArrayBuffer;
            const stridesBuf = result.strideOffsets.buffer as ArrayBuffer;
            perLayer.push({
                layer,
                packed: packedBuf,
                entriesCount: result.entriesCount,
                strideOffsets: stridesBuf,
            });
            transfer.push(packedBuf, stridesBuf);
        }

        const parseTimeMs = performance.now() - t0;
        // Legacy single-packed для backward compat (= layer 0).
        const layer0 = perLayer[0]!;
        post.postMessage(
            {
                type: 'parse-result',
                taskId,
                cellX,
                cellY,
                packed: layer0.packed,
                entriesCount: layer0.entriesCount,
                strideOffsets: layer0.strideOffsets,
                parseTimeMs,
                perLayer,
            },
            transfer,
        );
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        post.postMessage({
            type: 'error',
            taskId,
            error: `parse cell (${cellX},${cellY}): ${error}`,
        });
    }
};
