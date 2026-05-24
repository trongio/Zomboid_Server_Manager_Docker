/**
 * Tiny fixed badge that shows the Vite build timestamp baked into the
 * bundle via `define.__BUILD_VERSION__` in vite.config.ts. Helps confirm
 * that a fresh `npm run build` actually reached the browser.
 */
declare const __BUILD_VERSION__: string;

export function BuildVersionBadge() {
    const version = typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : 'dev';

    return (
        <div
            className="pointer-events-none fixed right-2 bottom-2 z-50 select-none rounded-md bg-background/70 px-2 py-0.5 font-mono text-[10px] text-muted-foreground shadow-sm ring-1 ring-border backdrop-blur"
            data-testid="build-version"
            title="Frontend build timestamp"
        >
            build {version}
        </div>
    );
}
