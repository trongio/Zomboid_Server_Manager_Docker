/**
 * Парсер .lotpack binary файлов (PZ cell square data).
 *
 * Файл состоит из:
 *   [0]      "LOTP" magic + uint32 version (опционально для v0)
 *   [..]     uint32 block_num (= cellSizeInBlocks²)
 *   [..]     block_table[block_num] — каждая запись 8 байт:
 *              { uint32 file_offset, uint32 (reserved) }
 *   [..]     данные блоков (sparse, доступ по offset из table)
 *
 * Per-block данные (rread_block):
 *   3D вложенный loop по [layer, x, y] (layer ∈ [minlayer, maxlayer)):
 *     count int32:
 *       count == -1 → читать skip int32, продвинуться на skip squares
 *       count > 1   → читать room int32 + (count-1) tile int32 (lotpack_data_parser)
 *       count ∈ {0, 1} → square пустой (без data)
 *
 * Tile IDs в выводе — **локальные** индексы в `lotheader.spriteNames`.
 * Resolve в global ID делает caller (worker entry).
 *
 * Reference: https://github.com/cff29546/pzmap2dzi (MIT). Translated.
 */

import { BinaryReader, LOTP_MAGIC, readVersion } from './binary-reader';

/**
 * Per-block выход парсера. blocks[blockIdx] либо null (пустой блок),
 * либо массив layers[layerIdx] либо null, либо массив rows[x] либо null,
 * либо массив squares[y] либо null, либо массив локальных tile IDs.
 *
 * Эта sparse структура передаётся в `packLotpackEntries()` для финальной
 * упаковки в Uint32Array для GPU.
 */
export type BlockLayer = Array<Array<Array<number[] | null> | null> | null>;

export interface ParsedLotpack {
    /** [blockIdx] где blockIdx = bx * cellSizeInBlocks + by. */
    blocks: Array<BlockLayer | null>;
    /** Min layer (включительно), для слайсинга. */
    minLayer: number;
    /** Max layer (эксклюзивно). */
    maxLayer: number;
    /** Размер блока. */
    blockSize: number;
}

export interface ParseLotpackHeader {
    minLayer: number;
    maxLayer: number;
    blockSize: number;
    cellSizeInBlocks: number;
}

export function parseLotpack(
    buffer: ArrayBuffer,
    header: ParseLotpackHeader,
): ParsedLotpack {
    const reader = new BinaryReader(buffer);

    // 1. Magic + version (optional).
    const versionRes = readVersion(reader, 0, LOTP_MAGIC, 0);
    let pos = versionRes.pos;

    // 2. Block count + table.
    const blockNumRes = reader.readUint32(pos);
    const blockNum = blockNumRes.value;
    pos = blockNumRes.pos;
    const tableStart = pos;
    // Table: blockNum × 8 bytes (offset uint32 + reserved uint32).
    // Не двигаем pos — каждый block lookup использует абсолютный offset.

    const blocks: Array<BlockLayer | null> = new Array(blockNum);
    for (let i = 0; i < blockNum; i++) {
        // Прочитать offset для этого блока (table[i].offset).
        const offsetRes = reader.readUint32(tableStart + i * 8);
        const blockStart = offsetRes.value;
        if (blockStart === 0 || blockStart >= reader.byteLength) {
            blocks[i] = null;
            continue;
        }
        const blockData = readBlock(
            reader,
            blockStart,
            header.blockSize,
            header.minLayer,
            header.maxLayer,
        );
        blocks[i] = blockData;
    }

    return {
        blocks,
        minLayer: header.minLayer,
        maxLayer: header.maxLayer,
        blockSize: header.blockSize,
    };
}

/**
 * Парсит один block данных (sparse 3D: layer × x × y).
 *
 * Эквивалент `binfile.read_block` в Python. Использует RLE-skip
 * для empty регионов.
 */
function readBlock(
    reader: BinaryReader,
    startPos: number,
    blockSize: number,
    minLayer: number,
    maxLayer: number,
): BlockLayer {
    const squarePerLayer = blockSize * blockSize;
    let pos = startPos;
    let skip = 0;
    const layerCount = maxLayer - minLayer;
    const blockData: BlockLayer = new Array(layerCount);

    for (let z = 0; z < layerCount; z++) {
        if (skip >= squarePerLayer) {
            skip -= squarePerLayer;
            blockData[z] = null;
            continue;
        }
        const layerData: Array<Array<number[] | null> | null> = new Array(blockSize);
        let layerHasData = false;
        for (let x = 0; x < blockSize; x++) {
            if (skip >= blockSize) {
                skip -= blockSize;
                layerData[x] = null;
                continue;
            }
            const rowData: Array<number[] | null> = new Array(blockSize);
            let rowHasData = false;
            for (let y = 0; y < blockSize; y++) {
                if (skip > 0) {
                    skip -= 1;
                    rowData[y] = null;
                    continue;
                }
                const countRes = reader.readInt32(pos);
                let count = countRes.value;
                pos = countRes.pos;
                if (count === -1) {
                    // RLE: следующий int32 = skip squares.
                    const skipRes = reader.readInt32(pos);
                    skip = skipRes.value;
                    pos = skipRes.pos;
                    if (skip > 0) {
                        skip -= 1;
                        rowData[y] = null;
                        continue;
                    }
                }
                if (count > 1) {
                    // lotpack_data_parser: room int32 (skipped) + (count-1) tile int32s.
                    pos += 4; // skip room
                    const tileCount = count - 1;
                    const tiles: number[] = new Array(tileCount);
                    for (let t = 0; t < tileCount; t++) {
                        const tileRes = reader.readInt32(pos);
                        tiles[t] = tileRes.value;
                        pos = tileRes.pos;
                    }
                    rowData[y] = tiles;
                    rowHasData = true;
                } else {
                    rowData[y] = null;
                }
            }
            layerData[x] = rowHasData ? rowData : null;
            if (rowHasData) layerHasData = true;
        }
        blockData[z] = layerHasData ? layerData : null;
    }
    return blockData;
}

// ---------------------------------------------------------------------------
// Packing utilities: ParsedLotpack → Uint32Array для GPU.
// ---------------------------------------------------------------------------

/**
 * Опции упаковки. По дефолту парсим только layers ≥ 0 (видимые с
 * аэровью) — это режет данные в 2× по сравнению с full -32..31 range
 * на B42 и устраняет проблему overflow для крупных карт.
 */
export interface PackOptions {
    /** Минимальный layer (включительно). Default: 0 (ground). */
    keepMinLayer?: number;
    /** Максимальный layer (эксклюзивно). Default: undefined (без верхнего лимита). */
    keepMaxLayer?: number;
}

/**
 * Упаковывает sparse 4D структуру в плоский Uint32Array согласно формату:
 *   Texel 0 (R32UI):
 *     bits 0-23 = global sprite_id
 *     bits 24-31 = layer_signed + 32
 *   Texel 1 (R32UI):
 *     bits 0-7  = sx (0..blockSize-1 в координатах cell)
 *     bits 8-15 = sy
 *     bits 16-23 = z_within_stack
 *     bits 24-30 = flags (зарезервировано)
 *     bit 31 = reserved
 *
 * Возвращает packed Uint32Array (2 × N entries) + entriesCount.
 * Если global sprite_id не найден (sprite не в атласе) — instance
 * пропускается. Layers вне `[keepMinLayer, keepMaxLayer)` пропускаются.
 */
/**
 * trailing-zeros count для n, capped at 6 (stride 64 = 2^6).
 * n=0 → возвращает 6 (divisible by anything).
 * n=8 (=0b1000) → 3.
 * n=1 → 0 (odd, only stride-1).
 */
function trailingZerosCap6(n: number): number {
    if (n === 0) return 6;
    let k = 0;
    while ((n & 1) === 0 && k < 6) {
        n >>= 1;
        k++;
    }
    return k;
}

/**
 * Stride level для entry: max K (0..6) such that 2^K делит BOTH sx и sy.
 * K=0 → stride-1 (always rendered)
 * K=6 → stride-64 (rendered только когда decimation grossly).
 */
function strideLevel(sx: number, sy: number): number {
    return Math.min(trailingZerosCap6(sx), trailingZerosCap6(sy));
}

export function packLotpackEntries(
    lotpack: ParsedLotpack,
    cellSizeInBlocks: number,
    spriteNamesLocal: string[],
    spriteNameToId: Map<string, number>,
    options: PackOptions = {},
): { packed: Uint32Array; entriesCount: number; strideOffsets: Uint32Array } {
    const { blocks, minLayer, maxLayer, blockSize } = lotpack;
    const layerCount = maxLayer - minLayer;
    const keepMin = options.keepMinLayer ?? 0;
    const keepMax = options.keepMaxLayer ?? maxLayer;

    // Предварительно резолвим локальные имена → global ids. Cache per-cell.
    const localToGlobal: Int32Array = new Int32Array(spriteNamesLocal.length);
    for (let i = 0; i < spriteNamesLocal.length; i++) {
        const id = spriteNameToId.get(spriteNamesLocal[i]!);
        localToGlobal[i] = id === undefined ? -1 : id;
    }

    // Первый проход — собираем все entries в temp arrays (e0, e1, strideK).
    // Pre-count для аллокации.
    let entriesCount = 0;
    for (let bx = 0; bx < cellSizeInBlocks; bx++) {
        for (let by = 0; by < cellSizeInBlocks; by++) {
            const block = blocks[bx * cellSizeInBlocks + by];
            if (!block) continue;
            for (let z = 0; z < layerCount; z++) {
                const worldLayer = z + minLayer;
                if (worldLayer < keepMin || worldLayer >= keepMax) continue;
                const layerData = block[z];
                if (!layerData) continue;
                for (let x = 0; x < blockSize; x++) {
                    const rowData = layerData[x];
                    if (!rowData) continue;
                    for (let y = 0; y < blockSize; y++) {
                        const tiles = rowData[y];
                        if (!tiles) continue;
                        for (const localId of tiles) {
                            if (localId >= 0
                                && localId < localToGlobal.length
                                && localToGlobal[localId]! >= 0) {
                                entriesCount++;
                            }
                        }
                    }
                }
            }
        }
    }

    // Compact 1-texel encoding (ground-only mode): один u32 per entry.
    // Layout: sprite_id (16 bits) | sx (8) | sy (8). Drop layer/zStack/flags
    // (всегда 0 в ground-only режиме).
    const tmpE = new Uint32Array(entriesCount);
    const tmpK = new Uint8Array(entriesCount);
    let i = 0;

    for (let bx = 0; bx < cellSizeInBlocks; bx++) {
        for (let by = 0; by < cellSizeInBlocks; by++) {
            const block = blocks[bx * cellSizeInBlocks + by];
            if (!block) continue;
            for (let z = 0; z < layerCount; z++) {
                const worldLayer = z + minLayer;
                if (worldLayer < keepMin || worldLayer >= keepMax) continue;
                const layerData = block[z];
                if (!layerData) continue;
                for (let x = 0; x < blockSize; x++) {
                    const rowData = layerData[x];
                    if (!rowData) continue;
                    const sxWorld = (bx * blockSize + x) & 0xff;
                    for (let y = 0; y < blockSize; y++) {
                        const tiles = rowData[y];
                        if (!tiles) continue;
                        const syWorld = (by * blockSize + y) & 0xff;
                        for (const localId of tiles) {
                            if (localId < 0 || localId >= localToGlobal.length) continue;
                            const globalId = localToGlobal[localId]!;
                            if (globalId < 0) continue;
                            tmpE[i] = ((globalId & 0xffff) | (sxWorld << 16) | (syWorld << 24)) >>> 0;
                            tmpK[i] = strideLevel(sxWorld, syWorld);
                            i++;
                        }
                    }
                }
            }
        }
    }

    // === Bucket sort по strideLevel (highest K first) ===
    //
    // strideOffsets[K] = cumulative count of entries with strideLevel ≥ K.
    // Это позволяет render call'у запросить ровно `strideOffsets[K]` instances
    // для рендера на effectiveStride = 2^K.
    //
    // Output order: bucket[6] (stride-64), bucket[5] (stride-32), ..., bucket[0].
    //   strideOffsets[6] = |bucket[6]|
    //   strideOffsets[5] = |bucket[6]| + |bucket[5]|
    //   strideOffsets[0] = total entriesCount
    //
    // При render с stride=K, первые strideOffsets[K] entries в packed —
    // exactly те, у которых strideLevel ≥ K → они нужны.

    const bucketSize = new Uint32Array(7);
    for (let j = 0; j < entriesCount; j++) bucketSize[tmpK[j]!]++;

    // Output offset для каждого K: bucket[6] первый, bucket[0] последний.
    const bucketWritePos = new Uint32Array(7);
    let pos = 0;
    for (let K = 6; K >= 0; K--) {
        bucketWritePos[K] = pos;
        pos += bucketSize[K]!;
    }

    // strideOffsets[K] = cumulative count entries with level ≥ K.
    const strideOffsets = new Uint32Array(7);
    let cum = 0;
    for (let K = 6; K >= 0; K--) {
        cum += bucketSize[K]!;
        strideOffsets[K] = cum;
    }

    // Scatter в packed (1 u32 per entry — compact ground-only format).
    const packed = new Uint32Array(entriesCount);
    const writeIdx = bucketWritePos.slice();
    for (let j = 0; j < entriesCount; j++) {
        const K = tmpK[j]!;
        const out = writeIdx[K]!;
        writeIdx[K]++;
        packed[out] = tmpE[j]!;
    }

    return { packed, entriesCount, strideOffsets };
}
