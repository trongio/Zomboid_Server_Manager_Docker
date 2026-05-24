/**
 * WebGL2 context initialisation + capability detection.
 *
 * Создаёт GL2 context на canvas, загружает extensions (BPTC для KTX2,
 * EXT_color_buffer_float), возвращает структуру с capabilities. Если
 * WebGL2 не поддерживается — кидает ошибку, которую вызывающий ловит
 * и показывает `<PzMapError />`.
 */

import type { GlCapabilities } from '../types';

export class WebGL2NotSupportedError extends Error {
    constructor() {
        super('WebGL2 не поддерживается в этом браузере');
        this.name = 'WebGL2NotSupportedError';
    }
}

export interface CreatedGlContext {
    gl: WebGL2RenderingContext;
    capabilities: GlCapabilities;
}

export function createGlContext(canvas: HTMLCanvasElement): CreatedGlContext {
    const gl = canvas.getContext('webgl2', {
        alpha: false,
        antialias: false,
        // depth buffer нужен для isometric painter's algorithm — fragments
        // отсортированы по глубине через gl_Position.z (см. pz-map.vert.glsl).
        depth: true,
        stencil: false,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false,
        failIfMajorPerformanceCaveat: false,
    });

    if (!gl) {
        throw new WebGL2NotSupportedError();
    }

    if (gl.isContextLost()) {
        throw new Error('GL context lost immediately after creation');
    }

    // Загружаем нужные расширения.
    const bptcExt = gl.getExtension('EXT_texture_compression_bptc');
    const colorBufferFloatExt = gl.getExtension('EXT_color_buffer_float');
    const debugRendererInfo = gl.getExtension('WEBGL_debug_renderer_info');

    let renderer = '';
    let vendor = '';
    if (debugRendererInfo) {
        renderer
            = (gl.getParameter(debugRendererInfo.UNMASKED_RENDERER_WEBGL) as string)
            ?? '';
        vendor
            = (gl.getParameter(debugRendererInfo.UNMASKED_VENDOR_WEBGL) as string)
            ?? '';
    }

    const capabilities: GlCapabilities = {
        hasBptc: bptcExt !== null,
        hasColorBufferFloat: colorBufferFloatExt !== null,
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
        maxArrayTextureLayers: gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number,
        renderer,
        vendor,
    };

    return { gl, capabilities };
}

/**
 * GL constants для BPTC (KTX2 BC7). Не во всех TypeScript lib'ах — добавляем
 * вручную как numerical constants. Значения из EXT_texture_compression_bptc spec.
 */
export const COMPRESSED_RGBA_BPTC_UNORM = 0x8e8c;
export const COMPRESSED_SRGB_ALPHA_BPTC_UNORM = 0x8e8d;
