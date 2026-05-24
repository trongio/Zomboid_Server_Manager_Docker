import { wayfinder } from '@laravel/vite-plugin-wayfinder';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import laravel from 'laravel-vite-plugin';
import { defineConfig } from 'vite';

// Stamp the bundle with a build timestamp so the running admin UI can
// advertise its own version. Surfaced via `__BUILD_VERSION__` and rendered
// in the app footer — gives an instant visual signal whether a fresh
// `npm run build` actually reached the browser (vs. a cached old bundle).
const BUILD_VERSION = new Date()
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, ' UTC');

export default defineConfig({
    define: {
        __BUILD_VERSION__: JSON.stringify(BUILD_VERSION),
    },
    plugins: [
        laravel({
            input: ['resources/css/app.css', 'resources/js/app.tsx'],
            ssr: 'resources/js/ssr.tsx',
            refresh: true,
        }),
        react({
            babel: {
                plugins: ['babel-plugin-react-compiler'],
            },
        }),
        tailwindcss(),
        wayfinder({
            formVariants: true,
        }),
    ],
    server: {
        host: '0.0.0.0',
        port: 5173,
        strictPort: true,
        hmr: {
            host: 'localhost',
        },
        watch: {
            usePolling: true,
        },
    },
    esbuild: {
        jsx: 'automatic',
    },
});
