#version 300 es
precision highp float;
precision highp sampler2DArray;

uniform sampler2DArray uAtlasArray;
uniform float uLayer;       // которую страницу показать
uniform float uBrightness;  // 1.0 = native, 2.0 = brighter (для тёмных pages)

in vec2 vUv;
out vec4 fragColor;

void main() {
    vec4 c = texture(uAtlasArray, vec3(vUv, uLayer));
    fragColor = vec4(c.rgb * uBrightness, c.a);
}
