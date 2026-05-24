/**
 * SaveMaskAtlas — sampler2DArray R8 (256×256 per layer) с occlusion bitmap'ами
 * для save cells. Каждый layer соответствует одной save cell.
 *
 * Используется в pz-map.frag.glsl: при base pass для cell с save данными
 * shader проверяет bit на (sx, sy). Если 1 → save перекрывает base тайл →
 * discard fragment. Это устраняет проблему "двойного рендера" (например
 * закрытая дверь из base видна сквозь открытую дверь из save).
 *
 * Layout: 256×256 R8 × MAX_LAYERS. Memory = 64 KB × layers (256 layers = 16 MB).
 */

const MASK_SIZE = 256;
const MAX_LAYERS = 512;

export class SaveMaskAtlas {
    private readonly gl: WebGL2RenderingContext;
    readonly texture: WebGLTexture;
    private readonly cellToLayer = new Map<string, number>();
    private readonly freeLayers: number[] = [];
    private nextLayer = 0;
    private readonly capacity: number;

    constructor(gl: WebGL2RenderingContext, capacity: number = MAX_LAYERS) {
        this.gl = gl;
        this.capacity = capacity;
        const tex = gl.createTexture();
        if (!tex) throw new Error('[save-mask-atlas] createTexture failed');
        this.texture = tex;
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
        gl.texStorage3D(
            gl.TEXTURE_2D_ARRAY,
            1,
            gl.R8,
            MASK_SIZE,
            MASK_SIZE,
            capacity,
        );
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    }

    /** Получить layer для cell, или -1 если cell не в atlas. */
    getLayer(cellX: number, cellY: number): number {
        return this.cellToLayer.get(`${cellX}_${cellY}`) ?? -1;
    }

    /**
     * Загрузить mask для cell. Если cell уже есть — переиспользуем layer
     * (обновление при изменении save).
     */
    upload(cellX: number, cellY: number, mask: Uint8Array): boolean {
        if (mask.length !== MASK_SIZE * MASK_SIZE) {
            console.warn(
                `[save-mask] cell (${cellX},${cellY}) — bad mask size ${mask.length}`,
            );
            return false;
        }
        const key = `${cellX}_${cellY}`;
        let layer = this.cellToLayer.get(key);
        if (layer === undefined) {
            if (this.freeLayers.length > 0) {
                layer = this.freeLayers.pop()!;
            } else if (this.nextLayer < this.capacity) {
                layer = this.nextLayer++;
            } else {
                console.warn(`[save-mask] capacity ${this.capacity} exceeded`);
                return false;
            }
            this.cellToLayer.set(key, layer);
        }
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texSubImage3D(
            gl.TEXTURE_2D_ARRAY,
            0,
            0, 0, layer,
            MASK_SIZE, MASK_SIZE, 1,
            gl.RED,
            gl.UNSIGNED_BYTE,
            mask,
        );
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
        return true;
    }

    /** Освободить layer (при выгрузке cell). */
    release(cellX: number, cellY: number): void {
        const key = `${cellX}_${cellY}`;
        const layer = this.cellToLayer.get(key);
        if (layer === undefined) return;
        this.cellToLayer.delete(key);
        this.freeLayers.push(layer);
    }

    getInfo(): { usedLayers: number; capacity: number } {
        return {
            usedLayers: this.cellToLayer.size,
            capacity: this.capacity,
        };
    }

    dispose(): void {
        this.gl.deleteTexture(this.texture);
        this.cellToLayer.clear();
        this.freeLayers.length = 0;
        this.nextLayer = 0;
    }
}
