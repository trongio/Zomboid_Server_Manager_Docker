/**
 * Convert a hex color string to oklch CSS value.
 * Conversion path: hex → sRGB → linear RGB → XYZ D65 → Oklab → Oklch
 */
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function hexToOklch(hex: string): string {
    if (!HEX_RE.test(hex)) return 'oklch(0.205 0 0)';
    const rgb = hexToSrgb(hex);
    const linear = rgb.map(srgbToLinear);
    const [l, a, b] = linearRgbToOklab(linear[0], linear[1], linear[2]);
    const c = Math.sqrt(a * a + b * b);
    const h = (Math.atan2(b, a) * 180) / Math.PI;
    const hue = h < 0 ? h + 360 : h;

    return `oklch(${round(l)} ${round(c, 4)} ${round(hue, 2)})`;
}

/**
 * Get an appropriate foreground color (light or dark) for a given hex background.
 */
export function autoForeground(hex: string): string {
    if (!HEX_RE.test(hex)) return 'oklch(0.985 0 0)';
    const rgb = hexToSrgb(hex);
    const linear = rgb.map(srgbToLinear);
    const [l] = linearRgbToOklab(linear[0], linear[1], linear[2]);

    // If lightness > 0.6, use dark foreground; otherwise light
    return l > 0.6 ? 'oklch(0.205 0 0)' : 'oklch(0.985 0 0)';
}

function hexToSrgb(hex: string): [number, number, number] {
    const h = hex.replace('#', '');
    return [
        parseInt(h.slice(0, 2), 16) / 255,
        parseInt(h.slice(2, 4), 16) / 255,
        parseInt(h.slice(4, 6), 16) / 255,
    ];
}

function srgbToLinear(c: number): number {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearRgbToOklab(r: number, g: number, b: number): [number, number, number] {
    const l_ = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    const m_ = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
    const s_ = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

    const l = Math.cbrt(l_);
    const m = Math.cbrt(m_);
    const s = Math.cbrt(s_);

    return [
        0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
}

function round(n: number, digits = 3): number {
    const f = Math.pow(10, digits);
    return Math.round(n * f) / f;
}
