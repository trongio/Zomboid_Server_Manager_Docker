/**
 * Парсер .lotheader binary файлов Project Zomboid.
 *
 * Layout (B41 = version 0 без LOTH magic, B42 = version 1 с LOTH magic):
 *   [0..3]   "LOTH" magic         (только для v1)
 *   [4..7]   uint32 version       (только когда magic присутствует)
 *   [..]     uint32 tile_count
 *   [..]     tile_count × newline-terminated UTF-8 string  (sprite names)
 *   v0 only: uint8 padding         (skip)
 *   [..]     uint32 width
 *   [..]     uint32 height
 *   v0:  int32 maxlayer (minlayer = 0)
 *   v1:  int32 minlayer, int32 maxlayer (maxlayer += 1 после чтения)
 *   [..]     rooms (uint32 count + room records)
 *   [..]     buildings (uint32 count + building records)
 *   [..]     zpop (CELL_SIZE × CELL_SIZE uint8)
 *
 * Для render нам нужны только: version + spriteNames + width/height +
 * minlayer/maxlayer. Rooms/buildings/zpop парсим но не используем
 * (могут пригодиться для overlays позже).
 *
 * Reference: https://github.com/cff29546/pzmap2dzi (MIT). Translated.
 */

import { BinaryReader, LOTH_MAGIC, readVersion } from './binary-reader';

export interface LotheaderRoomRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface LotheaderRoom {
    id: number;
    name: string;
    layer: number;
    rects: LotheaderRoomRect[];
    area: number;
}

export interface LotheaderBuilding {
    id: number;
    rooms: number[];
}

export interface ParsedLotheader {
    /** 0 = B41, 1 = B42. */
    version: number;
    /** Размер cell в блоках (B41: 30, B42: 32). */
    cellSizeInBlocks: number;
    /** Размер блока в squares (B41: 10, B42: 8). */
    blockSize: number;
    /** Минимальная layer (B41: 0, B42: -32). */
    minLayer: number;
    /** Максимальная layer (B41: 8, B42: 32). Эксклюзивная граница. */
    maxLayer: number;
    /** Width в squares. */
    width: number;
    /** Height в squares. */
    height: number;
    /** Имена спрайтов; индексы из lotpack ссылаются сюда. */
    spriteNames: string[];
    rooms?: LotheaderRoom[];
    buildings?: LotheaderBuilding[];
}

/** Константы по версии формата (B41/B42). */
const VERSION_LIMITS = [
    {
        // v0 = B41
        cellSizeInBlocks: 30,
        blockSize: 10,
        minLayer: 0,
        maxLayer: 8,
    },
    {
        // v1 = B42
        cellSizeInBlocks: 32,
        blockSize: 8,
        minLayer: -32,
        maxLayer: 32,
    },
] as const;

export function parseLotheader(
    buffer: ArrayBuffer,
    /**
     * Если true — парсим rooms/buildings/zpop. По умолчанию false для
     * скорости (нам нужны только sprite names + dimensions).
     */
    includeOverlays = false,
): ParsedLotheader {
    const reader = new BinaryReader(buffer);

    // 1. Magic + version (v0 без magic).
    const versionRes = readVersion(reader, 0, LOTH_MAGIC, 0);
    const version = versionRes.value;
    let pos = versionRes.pos;
    if (version > 1) {
        throw new Error(`[lotheader] неизвестная версия: ${version}`);
    }
    const limits = VERSION_LIMITS[version]!;

    // 2. Tile defs (sprite names).
    const tileCount = reader.readUint32(pos);
    pos = tileCount.pos;
    const spriteNames: string[] = new Array(tileCount.value);
    for (let i = 0; i < tileCount.value; i++) {
        const line = reader.readLine(pos);
        spriteNames[i] = line.value;
        pos = line.pos;
    }

    // 3. v0: skip 1 padding byte.
    if (version === 0) {
        pos += 1;
    }

    // 4. Width / height (squares).
    const widthRes = reader.readUint32(pos);
    const width = widthRes.value;
    pos = widthRes.pos;
    const heightRes = reader.readUint32(pos);
    const height = heightRes.value;
    pos = heightRes.pos;

    // 5. Layer range.
    let minLayer: number;
    let maxLayer: number;
    if (version === 0) {
        minLayer = 0;
        const ml = reader.readInt32(pos);
        maxLayer = ml.value;
        pos = ml.pos;
    } else {
        const minL = reader.readInt32(pos);
        minLayer = minL.value;
        pos = minL.pos;
        const maxL = reader.readInt32(pos);
        maxLayer = maxL.value + 1; // v1: +1 после чтения (mirrors Python)
        pos = maxL.pos;
    }

    // Clamp к версионным лимитам.
    minLayer = Math.max(minLayer, limits.minLayer);
    maxLayer = Math.min(maxLayer, limits.maxLayer);

    const result: ParsedLotheader = {
        version,
        cellSizeInBlocks: limits.cellSizeInBlocks,
        blockSize: limits.blockSize,
        minLayer,
        maxLayer,
        width,
        height,
        spriteNames,
    };

    if (includeOverlays) {
        const { rooms, pos: posAfterRooms } = readRooms(reader, pos);
        result.rooms = rooms;
        pos = posAfterRooms;
        const { buildings } = readBuildings(reader, pos);
        result.buildings = buildings;
        // zpop опускаем — для render не нужно.
    }

    return result;
}

function readRooms(
    reader: BinaryReader,
    pos: number,
): { rooms: LotheaderRoom[]; pos: number } {
    const countRes = reader.readUint32(pos);
    pos = countRes.pos;
    const rooms: LotheaderRoom[] = new Array(countRes.value);
    for (let i = 0; i < countRes.value; i++) {
        const r = readOneRoom(reader, pos);
        r.room.id = i;
        rooms[i] = r.room;
        pos = r.pos;
    }
    return { rooms, pos };
}

function readOneRoom(
    reader: BinaryReader,
    pos: number,
): { room: LotheaderRoom; pos: number } {
    const name = reader.readLine(pos);
    pos = name.pos;
    const layer = reader.readInt32(pos);
    pos = layer.pos;
    const rectCount = reader.readUint32(pos);
    pos = rectCount.pos;
    const rects: LotheaderRoomRect[] = new Array(rectCount.value);
    let area = 0;
    for (let i = 0; i < rectCount.value; i++) {
        const x = reader.readInt32(pos);
        pos = x.pos;
        const y = reader.readInt32(pos);
        pos = y.pos;
        const w = reader.readInt32(pos);
        pos = w.pos;
        const h = reader.readInt32(pos);
        pos = h.pos;
        rects[i] = { x: x.value, y: y.value, w: w.value, h: h.value };
        area += w.value * h.value;
    }
    // Meta objects — мы их пропускаем, но pos должен быть продвинут.
    const metaCount = reader.readUint32(pos);
    pos = metaCount.pos;
    for (let i = 0; i < metaCount.value; i++) {
        // meta_type, x, y — каждый int32
        pos += 4 * 3;
    }
    return {
        room: { id: 0, name: name.value, layer: layer.value, rects, area },
        pos,
    };
}

function readBuildings(
    reader: BinaryReader,
    pos: number,
): { buildings: LotheaderBuilding[]; pos: number } {
    const countRes = reader.readUint32(pos);
    pos = countRes.pos;
    const buildings: LotheaderBuilding[] = new Array(countRes.value);
    for (let i = 0; i < countRes.value; i++) {
        const roomCountRes = reader.readUint32(pos);
        pos = roomCountRes.pos;
        const roomIds: number[] = new Array(roomCountRes.value);
        for (let j = 0; j < roomCountRes.value; j++) {
            const idRes = reader.readUint32(pos);
            roomIds[j] = idRes.value;
            pos = idRes.pos;
        }
        buildings[i] = { id: i, rooms: roomIds };
    }
    return { buildings, pos };
}
