import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

/**
 * Vitest configuration for pz-renderer unit tests.
 *
 * Runs in jsdom environment to provide browser APIs (TextDecoder, atob, etc.)
 * without a real browser. Workers are mocked to run inline in tests.
 */
export default defineConfig({
    test: {
        environment: 'jsdom',
        globals: true,
        include: [
            'resources/js/**/parsers/__tests__/**/*.test.ts',
            'resources/js/lib/pz-renderer/__tests__/**/*.test.ts',
        ],
        exclude: ['**/node_modules/**', '**/fixtures/**'],
    },
    resolve: {
        alias: {
            '@': resolve(__dirname, 'resources/js'),
        },
    },
});
