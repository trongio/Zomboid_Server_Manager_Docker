/**
 * KTX2 header parser — извлекает raw BC7 mip-0 byte range из контейнера.
 *
 * Минимальная реализация для нашего use case: backend генерит KTX2 без mips
 * (один LOD = один KTX2 файл с уровнем 0). Нам нужно ровно одно поле —
 * offset и size mip-0 в исходном ArrayBuffer.
 *
 * Spec: https://github.khronos.org/KTX-Specification/
 *
 * Layout (relevant fields):
 *   Bytes 0..11    : identifier `«KTX 20»` magic
 *   Bytes 12..15   : vkFormat (uint32 LE) — должно быть BC7 (146)
 *   Bytes 16..19   : typeSize
 *   Bytes 20..23   : pixelWidth
 *   Bytes 24..27   : pixelHeight
 *   Bytes 28..31   : pixelDepth
 *   Bytes 32..35   : layerCount
 *   Bytes 36..39   : faceCount
 *   Bytes 40..43   : levelCount
 *   Bytes 44..47   : supercompressionScheme (uint32 LE) — должно быть 0 (none)
 *   Bytes 48..55   : DFD byteOffset (uint64 LE — но используем только low 32)
 *   Bytes 56..63   : DFD byteLength
 *   ...
 *   Level index (после header, size = levelCount * 24):
 *     per level: { byteOffset:u64, byteLength:u64, uncompressedByteLength:u64 }
 */

const KTX2_IDENTIFIER = new Uint8Array([
    // «KTX 20» + line ending markers
    0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const VK_FORMAT_BC7_UNORM_BLOCK = 146;

export interface Ktx2Info {
    width: number;
    height: number;
    /** vkFormat константа (для verification). */
    format: number;
    /** Уровни mip — для нашего use case всегда 1 (mip-0 only). */
    levelCount: number;
    /** Raw BC7 байты mip-0 (view в исходный ArrayBuffer, без copy). */
    mip0: Uint8Array;
}

export function parseKtx2(buffer: ArrayBuffer): Ktx2Info {
    const u8 = new Uint8Array(buffer);
    const dv = new DataView(buffer);

    // Verify magic.
    for (let i = 0; i < KTX2_IDENTIFIER.length; i++) {
        if (u8[i] !== KTX2_IDENTIFIER[i]) {
            throw new Error('[ktx2] неверный magic (не KTX2 файл)');
        }
    }

    const vkFormat = dv.getUint32(12, /* littleEndian */ true);
    const pixelWidth = dv.getUint32(20, true);
    const pixelHeight = dv.getUint32(24, true);
    const levelCount = dv.getUint32(40, true);
    const supercompression = dv.getUint32(44, true);

    if (vkFormat !== VK_FORMAT_BC7_UNORM_BLOCK) {
        throw new Error(
            `[ktx2] неподдерживаемый vkFormat=${vkFormat}, ожидался BC7_UNORM (${VK_FORMAT_BC7_UNORM_BLOCK})`,
        );
    }
    if (supercompression !== 0) {
        throw new Error(
            `[ktx2] supercompression=${supercompression} не поддерживается, ожидался 0 (none)`,
        );
    }

    // Level index начинается сразу после header (80 байт).
    // Каждая запись 24 байта: { byteOffset:u64, byteLength:u64, uncompressedByteLength:u64 }
    // KTX2 хранит уровни в обратном порядке (mip-N first, mip-0 last).
    // Нам нужен mip-0 — последний элемент в index (если levelCount > 1).
    const levelIndexStart = 80;
    const lastLevelOffset = levelIndexStart + (levelCount - 1) * 24;

    // u64 → читаем low 32 (наши mip-0 < 4 GB).
    const mip0ByteOffsetLo = dv.getUint32(lastLevelOffset, true);
    const mip0ByteOffsetHi = dv.getUint32(lastLevelOffset + 4, true);
    if (mip0ByteOffsetHi !== 0) {
        throw new Error('[ktx2] mip0 offset > 4 GB не поддерживается');
    }
    const mip0ByteLengthLo = dv.getUint32(lastLevelOffset + 8, true);
    const mip0ByteLengthHi = dv.getUint32(lastLevelOffset + 12, true);
    if (mip0ByteLengthHi !== 0) {
        throw new Error('[ktx2] mip0 length > 4 GB не поддерживается');
    }

    const mip0 = new Uint8Array(buffer, mip0ByteOffsetLo, mip0ByteLengthLo);

    return {
        width: pixelWidth,
        height: pixelHeight,
        format: vkFormat,
        levelCount,
        mip0,
    };
}
