#version 300 es
precision highp float;

out vec2 vUv;

const vec2 POSITIONS[4] = vec2[4](
    vec2(-1.0, -1.0),
    vec2( 1.0, -1.0),
    vec2(-1.0,  1.0),
    vec2( 1.0,  1.0)
);

const vec2 UVS[4] = vec2[4](
    vec2(0.0, 1.0),
    vec2(1.0, 1.0),
    vec2(0.0, 0.0),
    vec2(1.0, 0.0)
);

void main() {
    gl_Position = vec4(POSITIONS[gl_VertexID], 0.0, 1.0);
    vUv = UVS[gl_VertexID];
}
