/**
 * Projection math для конвертации PZ square coords → screen pixels.
 *
 * PZ использует две проекции:
 *   - **isometric** (default): 1 square покрывает (sqr×sqr/2) pixels на
 *     экране, ромбом. World x растёт вправо-вниз, world y растёт
 *     влево-вниз. Используется в подавляющем большинстве карт.
 *   - **top-down**: 1 square = sqr×sqr pixels. Прямоугольная сетка,
 *     удобно для отладки.
 *
 * Параметры:
 *   sqr — pixels per square при native zoom (типично 64 для PZ).
 *   pps — pixels per square на ТЕКУЩЕМ зуме (= sqr × 2^zoomDelta).
 */

export interface ProjectionParams {
    isometric: boolean;
    /** Pixels per square edge на native zoom. */
    sqr: number;
}

/**
 * Преобразование (sx, sy) world-square → world-pixel (изометрический ромб
 * или прямоугольник в зависимости от `isometric`).
 *
 * Возвращает координаты в **native pixel space** (без учёта текущего
 * zoom). Camera/zoom применяются позже через uViewProj в shader.
 */
export function squareToWorldPixel(
    sx: number,
    sy: number,
    proj: ProjectionParams,
): [number, number] {
    if (proj.isometric) {
        const halfSqr = proj.sqr * 0.5;
        const quarterSqr = proj.sqr * 0.25;
        return [(sx - sy) * halfSqr, (sx + sy) * quarterSqr];
    }
    return [sx * proj.sqr, sy * proj.sqr];
}

/**
 * Размер cell в pixel coords. Для isometric cell — это bounding box
 * ромба (×2 по обоим axis для покрытия диагоналей).
 */
export function cellBoundsInPixels(
    cellSizeInSquares: number,
    proj: ProjectionParams,
): { width: number; height: number } {
    if (proj.isometric) {
        // Ромб cell имеет ширину cellSize × sqr (диагональ) и высоту
        // cellSize × sqr / 2.
        return {
            width: cellSizeInSquares * proj.sqr,
            height: cellSizeInSquares * (proj.sqr * 0.5),
        };
    }
    return {
        width: cellSizeInSquares * proj.sqr,
        height: cellSizeInSquares * proj.sqr,
    };
}

/**
 * Ortho matrix (column-major, для passes в GLSL uniform mat4).
 * Стандартный gl-matrix style.
 *
 * Маппит rect [left, right, bottom, top] → NDC [-1..1].
 */
export function makeOrthoMatrix(
    left: number,
    right: number,
    bottom: number,
    top: number,
    near = -1,
    far = 1,
): Float32Array {
    const rl = right - left;
    const tb = top - bottom;
    const fn = far - near;
    const out = new Float32Array(16);
    out[0] = 2 / rl;
    out[5] = 2 / tb;
    out[10] = -2 / fn;
    out[12] = -(right + left) / rl;
    out[13] = -(top + bottom) / tb;
    out[14] = -(far + near) / fn;
    out[15] = 1;
    return out;
}
