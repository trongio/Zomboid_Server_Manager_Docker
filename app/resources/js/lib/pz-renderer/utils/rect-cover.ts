/**
 * Rect cover algorithm — port из pzmap2dzi/geometry.py.
 *
 * Покрывает sparse 2D grid cells минимальным набором прямоугольников.
 * Используется для разбиения PZ карты на регионы — каждый regular
 * geometric region даёт один rect.
 *
 * Алгоритм 2-phase:
 *   1. Horizontal scan: per column соседние cells в одной строке
 *      объединяются в vertical runs `[yStart, height]`.
 *   2. Vertical scan: соседние columns с IDENTICAL slot patterns
 *      объединяются в rectangle `[x, y, width, height]`.
 *
 * Для PZ Knox (4065 cells) даёт точно 3 rects:
 *   [0, 18, 45, 45], [45, 3, 13, 60], [58, 0, 20, 63]
 * — соответствует трём PZ map zones (Muldraugh, межгород, West Point).
 */

export type Rect = readonly [x: number, y: number, width: number, height: number];

/**
 * Минимальное прямоугольное покрытие sparse cells.
 * Возвращает rects в порядке слева-направо, сверху-вниз.
 */
export function computeRectCover(
    cells: ReadonlyArray<readonly [number, number]>,
): Rect[] {
    if (cells.length === 0) return [];

    // === Phase 1: per-column vertical runs ===
    // Sort cells: x ascending, then y ascending within column.
    const sorted = [...cells].sort((a, b) =>
        a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]);

    // m[i] = { x, slots: [[yStart, length], ...] }
    const m: Array<{ x: number; slots: Array<[number, number]> }> = [];

    let currentX = sorted[0]![0];
    let currentSlots: Array<[number, number]> = [];
    let runStart = sorted[0]![1];
    let runLen = 1;
    let yLast = sorted[0]![1];

    for (let i = 1; i < sorted.length; i++) {
        const x = sorted[i]![0];
        const y = sorted[i]![1];
        if (x === currentX && y === yLast + 1) {
            runLen++;
            yLast = y;
            continue;
        }
        // Run прерывается: либо новый column, либо разрыв в y.
        currentSlots.push([runStart, runLen]);
        if (x !== currentX) {
            m.push({ x: currentX, slots: currentSlots });
            currentX = x;
            currentSlots = [];
        }
        runStart = y;
        runLen = 1;
        yLast = y;
    }
    // Flush последнего run.
    currentSlots.push([runStart, runLen]);
    m.push({ x: currentX, slots: currentSlots });

    // === Phase 2: merge adjacent columns с identical slot patterns ===
    const rects: Array<[number, number, number, number]> = [];
    let prevSlots: Array<[number, number]> | null = null;
    let colRunStart = -1;
    let colRunLen = 0;
    let prevX = -2;

    const slotsEqual = (
        a: Array<[number, number]>,
        b: Array<[number, number]>,
    ): boolean => {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i]![0] !== b[i]![0] || a[i]![1] !== b[i]![1]) return false;
        }
        return true;
    };

    for (const entry of m) {
        const { x, slots } = entry;
        if (prevSlots && prevX === x - 1 && slotsEqual(slots, prevSlots)) {
            colRunLen++;
        } else {
            // Emit предыдущий column run как rectangles (один per slot).
            if (prevSlots) {
                for (const [yStart, h] of prevSlots) {
                    rects.push([colRunStart, yStart, colRunLen, h]);
                }
            }
            prevSlots = slots;
            colRunStart = x;
            colRunLen = 1;
        }
        prevX = x;
    }
    if (prevSlots) {
        for (const [yStart, h] of prevSlots) {
            rects.push([colRunStart, yStart, colRunLen, h]);
        }
    }

    return rects as Rect[];
}

/**
 * Найти index первого rect, содержащего cell (cellX, cellY).
 * Returns -1 если cell не в одном из rects.
 */
export function rectIndexForCell(
    rects: ReadonlyArray<Rect>,
    cellX: number,
    cellY: number,
): number {
    for (let i = 0; i < rects.length; i++) {
        const [rx, ry, rw, rh] = rects[i]!;
        if (cellX >= rx && cellX < rx + rw && cellY >= ry && cellY < ry + rh) {
            return i;
        }
    }
    return -1;
}
