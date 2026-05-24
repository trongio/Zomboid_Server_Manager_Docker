/**
 * React hook для управления жизненным циклом PzMapRenderer.
 *
 * - Создаёт renderer при mount, init() запускается асинхронно.
 * - Подписывается на progress + ready/error события.
 * - Освобождает renderer при unmount (dispose).
 * - Поддерживает AbortController для отмены init.
 */

import { useEffect, useRef, useState } from 'react';

import {
    PzMapRenderer,
    type ProgressSnapshot,
    type PzMapRendererOptions,
} from '@/lib/pz-renderer';

export interface UseMapRendererOptions {
    canvasRef: React.RefObject<HTMLCanvasElement | null>;
    atlasBaseUrl?: string;
    cellsBaseUrl?: string;
    /** Если false — renderer не создаётся (для условного монтирования). */
    enabled?: boolean;
}

export interface UseMapRendererState {
    renderer: PzMapRenderer | null;
    progress: ProgressSnapshot | null;
    error: Error | null;
    isReady: boolean;
    /** Phase 6: отмена ongoing init. Сразу aborts workers, network, IDB. */
    cancel: () => void;
}

const DEFAULT_ATLAS_URL = '/pz-atlas';
const DEFAULT_CELLS_URL = '/admin/api/pz-map';

export function useMapRenderer(opts: UseMapRendererOptions): UseMapRendererState {
    const {
        canvasRef,
        atlasBaseUrl = DEFAULT_ATLAS_URL,
        cellsBaseUrl = DEFAULT_CELLS_URL,
        enabled = true,
    } = opts;

    const rendererRef = useRef<PzMapRenderer | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const [progress, setProgress] = useState<ProgressSnapshot | null>(null);
    const [error, setError] = useState<Error | null>(null);
    const [isReady, setIsReady] = useState(false);

    useEffect(() => {
        if (!enabled) return;
        const canvas = canvasRef.current;
        if (!canvas) return;

        const controller = new AbortController();
        abortControllerRef.current = controller;
        const rendererOpts: PzMapRendererOptions = {
            canvas,
            atlasBaseUrl,
            cellsBaseUrl,
            signal: controller.signal,
            onProgress: (snapshot) => setProgress(snapshot),
            onReady: () => setIsReady(true),
            onError: (err) => setError(err),
        };

        const renderer = new PzMapRenderer(rendererOpts);
        rendererRef.current = renderer;
        void renderer.init();

        return () => {
            controller.abort();
            renderer.dispose();
            rendererRef.current = null;
            setIsReady(false);
        };
    }, [enabled, atlasBaseUrl, cellsBaseUrl, canvasRef]);

    const cancel = (): void => {
        abortControllerRef.current?.abort();
        setError(new Error('Cancelled by user'));
    };

    return {
        renderer: rendererRef.current,
        progress,
        error,
        isReady,
        cancel,
    };
}
