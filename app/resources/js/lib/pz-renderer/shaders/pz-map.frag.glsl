#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;

uniform sampler2DArray uAtlasArray;  // bound to active LOD's array texture
uniform int uDebugMode;              // 0 = normal, 1 = solid magenta, 2 = UV viz
uniform int uIsSavePass;             // 0 = base, 1 = save-overlay pass
uniform int uHighlightChanges;       // 0 = normal, 1 = тинт save sprites жёлтым

flat in int vAtlasPage;
flat in ivec2 vTileSquare;
in vec2 vUv;
in float vAlpha;

out vec4 fragColor;

void main() {
    // Debug fallbacks для диагностики проекции/UV/texture:
    if (uDebugMode == 1) {
        // Solid magenta — показывает где quads рисуются.
        fragColor = vec4(1.0, 0.0, 1.0, 1.0);
        return;
    }
    if (uDebugMode == 2) {
        // UV visualization — gradient по vUv. Если все спрайты выглядят
        // одинаково раскрашенные → UV корректные. Иначе UV сломаны.
        fragColor = vec4(vUv.x, vUv.y, 0.5, 1.0);
        return;
    }

    vec4 c = texture(uAtlasArray, vec3(vUv, float(vAtlasPage)));
    // Hard alpha cutoff: atlas filter теперь NEAREST (pixel-perfect),
    // partial alpha бывает только если у самого sprite content soft edges.
    // 0.5 threshold убирает оставшиеся artifacts на границах.
    if (c.a < 0.5) discard;
    vec3 rgb = c.rgb;
    if (uIsSavePass == 1 && uHighlightChanges == 1) {
        // Жёлтый тинт для debug подсветки save-cells.
        rgb = mix(rgb, vec3(1.0, 0.95, 0.2), 0.55);
    }
    fragColor = vec4(rgb, c.a * vAlpha);
}
