/**
 * Примитивы для парсинга PZ binary форматов (lotheader, lotpack).
 *
 * Все целочисленные поля — little-endian (Python `struct` без явного
 * byte-order prefix на x86 hosts даёт LE; PZ binaries генерируются на
 * Windows x86 → little-endian). Pattern: каждая функция возвращает
 * `{ value, pos }`, где pos — обновлённый offset.
 *
 * Reference: https://github.com/cff29546/pzmap2dzi `pzmap2dzi/util.py`,
 * `pzmap2dzi/binfile.py` (MIT licensed). Translated to TypeScript.
 */

export interface ReadResult<T> {
    value: T;
    pos: number;
}

export class BinaryReader {
    private readonly view: DataView;
    private readonly bytes: Uint8Array;

    constructor(buffer: ArrayBuffer) {
        this.view = new DataView(buffer);
        this.bytes = new Uint8Array(buffer);
    }

    get byteLength(): number {
        return this.view.byteLength;
    }

    readUint8(pos: number): ReadResult<number> {
        return { value: this.view.getUint8(pos), pos: pos + 1 };
    }

    readUint32(pos: number): ReadResult<number> {
        return { value: this.view.getUint32(pos, /* littleEndian */ true), pos: pos + 4 };
    }

    readInt32(pos: number): ReadResult<number> {
        return { value: this.view.getInt32(pos, /* littleEndian */ true), pos: pos + 4 };
    }

    /**
     * Читает байты до 0x0A (newline) и возвращает их как UTF-8 строку
     * (без trailing newline). Используется для tile names и room names
     * в lotheader.
     */
    readLine(pos: number): ReadResult<string> {
        let end = pos;
        while (end < this.bytes.length && this.bytes[end] !== 0x0a) {
            end++;
        }
        const slice = this.bytes.subarray(pos, end);
        // TextDecoder быстрее ручного decode на больших строках.
        const value = textDecoder.decode(slice).trim();
        return { value, pos: end + 1 };
    }

    /**
     * Проверяет magic bytes по offset, возвращает true если совпадает.
     */
    matchMagic(pos: number, magic: Uint8Array): boolean {
        if (pos + magic.length > this.bytes.length) return false;
        for (let i = 0; i < magic.length; i++) {
            if (this.bytes[pos + i] !== magic[i]) return false;
        }
        return true;
    }
}

const textDecoder = new TextDecoder('utf-8');

/**
 * Проверка magic + чтение версии. Эквивалент `binfile.get_version` в
 * Python. Если magic совпадает — после него читается uint32 version,
 * иначе возвращается default (без сдвига pos).
 *
 * Использование:
 *   const lothMagic = new Uint8Array([0x4C, 0x4F, 0x54, 0x48]);
 *   const { value: version, pos } = readVersion(reader, 0, lothMagic, 0);
 */
export function readVersion(
    reader: BinaryReader,
    pos: number,
    magic: Uint8Array,
    defaultVersion: number,
): ReadResult<number> {
    if (reader.matchMagic(pos, magic)) {
        return reader.readUint32(pos + magic.length);
    }
    return { value: defaultVersion, pos };
}

// ASCII magic bytes для lotheader и lotpack.
export const LOTH_MAGIC = new Uint8Array([0x4c, 0x4f, 0x54, 0x48]); // "LOTH"
export const LOTP_MAGIC = new Uint8Array([0x4c, 0x4f, 0x54, 0x50]); // "LOTP"
