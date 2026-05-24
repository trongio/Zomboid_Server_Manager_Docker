/**
 * Helpers для TEXTURE_2D_ARRAY (atlas pages per LOD).
 *
 * Каждый LOD хранится как один TEXTURE_2D_ARRAY: 51 layers × 4096² (LOD0),
 * 51 × 2048² (LOD1), и т.д. Layer index = pageId (прямой mapping).
 *
 * Поддерживается KTX2 BC7 (immutable compressed format) и WebP (RGBA8
 * fallback). Wrapping функции абстрагируют compressedTexImage3D vs
 * texImage3D.
 */

import { COMPRESSED_RGBA_BPTC_UNORM } from './gl-context';

/**
 * Аллоцировать пустой TEXTURE_2D_ARRAY заданного размера и формата.
 * Все layers зануляются. Layer заполняется через `uploadCompressed*`
 * / `uploadRgba8Layer` ниже.
 *
 * @param compressed — true для BC7 (KTX2), false для RGBA8 (WebP).
 */
export function createTexture2dArray(
    gl: WebGL2RenderingContext,
    size: number,
    depth: number,
    compressed: boolean,
): WebGLTexture {
    const texture = gl.createTexture();
    if (!texture) throw new Error('[texture-2d-array] createTexture failed');

    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
    // NEAREST filter: PZ sprite art стилизован под pixel art. LINEAR
    // mixes edge sprite pixel с соседним transparent pixel (rgb=0) →
    // чёрная обводка вокруг sprites. NEAREST убирает halo, edges
    // остаются sharp (pixel-perfect — родной стиль PZ).
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    if (compressed) {
        // Immutable compressed storage — единственный способ передать
        // compressedTexSubImage3D без full-texture pre-fill.
        gl.texStorage3D(
            gl.TEXTURE_2D_ARRAY,
            1, // levels — без mipmap (мы сами генерим LODs как отдельные textures)
            COMPRESSED_RGBA_BPTC_UNORM,
            size,
            size,
            depth,
        );
    } else {
        // RGBA8 path: texStorage3D с immutable format.
        gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, size, size, depth);
    }

    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    return texture;
}

/**
 * Загрузить compressed BC7 data в один layer существующего array.
 *
 * @param data — raw BC7 mip-0 bytes (для 4096×4096 → 16 MB).
 */
export function uploadCompressedLayer(
    gl: WebGL2RenderingContext,
    texture: WebGLTexture,
    layer: number,
    size: number,
    data: ArrayBufferView,
): void {
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
    gl.compressedTexSubImage3D(
        gl.TEXTURE_2D_ARRAY,
        0, // level
        0, // xoffset
        0, // yoffset
        layer, // zoffset (= array layer index)
        size,
        size,
        1, // depth
        COMPRESSED_RGBA_BPTC_UNORM,
        data,
    );
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
}

/**
 * Загрузить RGBA8 layer через ImageBitmap (декодированный WebP).
 */
export function uploadRgba8LayerFromBitmap(
    gl: WebGL2RenderingContext,
    texture: WebGLTexture,
    layer: number,
    bitmap: ImageBitmap,
): void {
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
    gl.texSubImage3D(
        gl.TEXTURE_2D_ARRAY,
        0, // level
        0,
        0,
        layer,
        bitmap.width,
        bitmap.height,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        bitmap,
    );
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
}

export function destroyTexture(
    gl: WebGL2RenderingContext,
    texture: WebGLTexture | null,
): void {
    if (texture) gl.deleteTexture(texture);
}
