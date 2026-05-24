/**
 * SpriteInfoTexture — RGBA32F lookup texture с metadata всех спрайтов
 * × всех LOD. Vertex shader делает `texelFetch` чтобы получить UV +
 * atlas page + offset для каждого instance.
 *
 * Layout (2D plain):
 *   width  = INFO_TEXTURE_WIDTH (4096 — безопасно для всех GPU)
 *   height = ceil(N_SPRITES × N_LOD × 2 / width)
 *
 * 1D index → 2D coord:
 *   linearIdx = spriteId * N_LOD + lod
 *   texelOffA = linearIdx * 2
 *   texelOffB = linearIdx * 2 + 1
 *   coordA    = ivec2(texelOffA % width, texelOffA / width)
 *   coordB    = ivec2(texelOffB % width, texelOffB / width)
 *
 * Texel A (RGBA32F):
 *   R: uv_u (0..1)
 *   G: uv_v (0..1)
 *   B: uv_w (0..1)
 *   A: uv_h (0..1)
 *
 * Texel B (RGBA32F):
 *   R: atlas_page_id (float, для texture(uAtlasArray, vec3(uv, B.r)))
 *   G: mip_native_size_px (size текущего mip в native pixels)
 *   B: offset_x_native (anchor offset, native px)
 *   A: offset_y_native
 *
 * Memory: ~12k sprites × 4 LOD × 2 texels × 16 bytes = ~1.5 MB.
 */

import type { SpritesManifest } from '../types';

/**
 * Width в texels. 4096 — гарантированный минимум WebGL2 maxTextureSize
 * на всех GPU. Может уменьшаться через capability cap.
 */
const DEFAULT_INFO_WIDTH = 4096;

export interface SpriteInfoTexture {
    texture: WebGLTexture;
    width: number;
    height: number;
    nSprites: number;
    nLods: number;
}

export interface BuildSpriteInfoOptions {
    gl: WebGL2RenderingContext;
    sprites: SpritesManifest;
    /** Sprite name → id mapping (тот же что отдан воркерам). */
    spriteNameToId: Map<string, number>;
    /** Сколько LOD-уровней (типично 4). */
    nLods: number;
    /** Максимальная текстура (из GlCapabilities). */
    maxTextureSize: number;
}

/**
 * Строит и загружает sprite info texture.
 *
 * `sprites.uv_format`:
 *   - 'normalized' — UVs уже в [0..1], используем как есть.
 *   - 'pixels' — конвертируем делением на atlas_size.
 */
export function buildSpriteInfoTexture(
    opts: BuildSpriteInfoOptions,
): SpriteInfoTexture {
    const { gl, sprites, spriteNameToId, nLods, maxTextureSize } = opts;
    const nSprites = spriteNameToId.size;

    // 2D layout: width capped по GPU. 4096 — безопасный default.
    const width = Math.min(DEFAULT_INFO_WIDTH, maxTextureSize);
    const totalTexels = nSprites * nLods * 2;
    const height = Math.ceil(totalTexels / width);
    if (height > maxTextureSize) {
        throw new Error(
            `[sprite-info-texture] height ${height} > maxTextureSize ${maxTextureSize}`,
        );
    }

    // RGBA32F: 4 floats per texel = 16 bytes.
    const data = new Float32Array(width * height * 4);

    const pixelScale
        = sprites.uv_format === 'normalized' ? 1 : 1 / Math.max(1, sprites.atlas_size);

    // Sprite-level mip chain (`raw.mips[1..N]`) — это уменьшенные копии
    // спрайта внутри LOD0 atlas (для anti-aliasing). НЕ соответствует
    // per-LOD atlas pages (которые держат весь атлас в разных
    // resolutions с одинаковым content layout). Поэтому всегда берём
    // mip[0] — sprite native UV — и пишем одинаковые данные во все LOD
    // slots. Per-LOD атлас page выбирается через bindTexture; sprite
    // sample даёт правильный pixel из текущего LOD page.
    //
    // Per-LOD layout сохранён как scaffold для будущей anti-aliasing
    // оптимизации (texelFetch mip[N] for far zooms).
    for (const [name, spriteId] of spriteNameToId) {
        const raw = sprites.sprites[name];
        if (!raw || raw.mips.length === 0) continue;
        const nativeMip = raw.mips[0]!;
        const [u, v, w, h] = nativeMip;
        const nativePxW
            = w * (sprites.uv_format === 'normalized' ? sprites.atlas_size : 1);
        for (let lod = 0; lod < nLods; lod++) {
            const linearIdx = spriteId * nLods + lod;
            const texelOffA = linearIdx * 2;
            const texelOffB = texelOffA + 1;
            const ax = texelOffA % width;
            const ay = Math.floor(texelOffA / width);
            const bx = texelOffB % width;
            const by = Math.floor(texelOffB / width);
            const offA = (ay * width + ax) * 4;
            const offB = (by * width + bx) * 4;

            // Texel A: native UV rect (one and the same для всех LOD).
            data[offA + 0] = u * pixelScale;
            data[offA + 1] = v * pixelScale;
            data[offA + 2] = w * pixelScale;
            data[offA + 3] = h * pixelScale;

            // Texel B: native size + offset.
            data[offB + 0] = raw.atlas;
            data[offB + 1] = nativePxW;
            data[offB + 2] = raw.offset_x;
            data[offB + 3] = raw.offset_y;
        }
    }

    const texture = gl.createTexture();
    if (!texture) throw new Error('[sprite-info-texture] createTexture failed');

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, width, height);
    gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        width,
        height,
        gl.RGBA,
        gl.FLOAT,
        data,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);

    return { texture, width, height, nSprites, nLods };
}
