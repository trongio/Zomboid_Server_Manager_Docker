/// <reference types="vite/client" />

// Allow importing GLSL files as raw strings via Vite's ?raw suffix.
// e.g. import src from './shader.vert.glsl?raw'
declare module '*.glsl?raw' {
    const content: string;
    export default content;
}

declare module '*.vert.glsl?raw' {
    const content: string;
    export default content;
}

declare module '*.frag.glsl?raw' {
    const content: string;
    export default content;
}
