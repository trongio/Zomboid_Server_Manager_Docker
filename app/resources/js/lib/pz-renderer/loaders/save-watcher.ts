/**
 * SaveWatcher — periodic poll `/pz-save-data/manifest.json`, диффим cells
 * по mtime и подгружаем изменённые. Пауза при `document.hidden`.
 */

import type { SaveCellLoader, SaveCellsManifest } from './save-cell-loader';

const DEFAULT_POLL_INTERVAL_MS = 5000;

export interface SaveWatcherOptions {
    loader: SaveCellLoader;
    intervalMs?: number;
    onUpdate?: (changedCells: number, lastUpdateAt: number) => void;
}

export class SaveWatcher {
    private timer: ReturnType<typeof setInterval> | null = null;
    private visibilityListener: (() => void) | null = null;
    private paused = false;
    private disposed = false;
    private inFlight = false;
    private lastUpdateAt: number | null = null;
    private lastManifestVersion: string | null = null;

    constructor(private readonly opts: SaveWatcherOptions) {}

    start(): void {
        if (this.disposed || this.timer !== null) return;
        const interval = this.opts.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
        this.timer = setInterval(() => this.tick(), interval);

        if (typeof document !== 'undefined') {
            this.visibilityListener = () => this.handleVisibilityChange();
            document.addEventListener('visibilitychange', this.visibilityListener);
        }
    }

    getLastUpdateAt(): number | null {
        return this.lastUpdateAt;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
        if (this.visibilityListener && typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', this.visibilityListener);
            this.visibilityListener = null;
        }
    }

    /** Записать версию manifest'а после initial load — чтобы первый tick диффил. */
    setInitialManifestVersion(version: string): void {
        this.lastManifestVersion = version;
    }

    private handleVisibilityChange(): void {
        if (typeof document === 'undefined') return;
        this.paused = document.hidden;
    }

    private async tick(): Promise<void> {
        if (this.disposed || this.paused || this.inFlight) return;
        this.inFlight = true;
        try {
            const manifest = await this.opts.loader.loadManifest();
            if (!manifest) return;
            if (manifest.version === this.lastManifestVersion) return;
            this.lastManifestVersion = manifest.version;

            const changedCount = await this.opts.loader.refreshChangedCells();
            if (changedCount === 0) return;

            this.lastUpdateAt = Date.now();
            this.opts.onUpdate?.(changedCount, this.lastUpdateAt);
        } catch (err) {
            if ((err as Error).name !== 'AbortError') {
                console.warn('[save-watcher] tick failed:', err);
            }
        } finally {
            this.inFlight = false;
        }
    }
}

export type { SaveCellsManifest };
