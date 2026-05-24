/**
 * Лёгкая обёртка над WebGL2 shader program: compile/link + uniform location
 * cache.
 *
 * Без иллюзий — это thin wrapper, не engine. Просто чтобы не таскать
 * boilerplate в renderer.
 */

export interface CompiledShaderProgram {
    program: WebGLProgram;
    uniforms: Record<string, WebGLUniformLocation | null>;
    attribs: Record<string, number>;
}

export function compileShaderProgram(
    gl: WebGL2RenderingContext,
    vertexSource: string,
    fragmentSource: string,
    uniformNames: readonly string[],
    attribNames: readonly string[] = [],
): CompiledShaderProgram {
    const vert = compile(gl, gl.VERTEX_SHADER, vertexSource);
    const frag = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);

    const program = gl.createProgram();
    if (!program) throw new Error('[shader] gl.createProgram() failed');

    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);

    // Shader objects можно удалить после линковки — program держит свою копию.
    gl.detachShader(program, vert);
    gl.detachShader(program, frag);
    gl.deleteShader(vert);
    gl.deleteShader(frag);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(program) ?? 'unknown';
        gl.deleteProgram(program);
        throw new Error(`[shader] link error: ${log}`);
    }

    const uniforms: Record<string, WebGLUniformLocation | null> = {};
    for (const name of uniformNames) {
        uniforms[name] = gl.getUniformLocation(program, name);
    }

    const attribs: Record<string, number> = {};
    for (const name of attribNames) {
        attribs[name] = gl.getAttribLocation(program, name);
    }

    return { program, uniforms, attribs };
}

function compile(
    gl: WebGL2RenderingContext,
    type: number,
    source: string,
): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('[shader] gl.createShader() failed');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader) ?? 'unknown';
        const kind = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
        gl.deleteShader(shader);
        throw new Error(`[shader] ${kind} compile error:\n${log}`);
    }
    return shader;
}

export function destroyShaderProgram(
    gl: WebGL2RenderingContext,
    program: CompiledShaderProgram,
): void {
    gl.deleteProgram(program.program);
}
