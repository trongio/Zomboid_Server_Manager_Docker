/**
 * Полноэкранный UI для фатальных ошибок рендерера. Распознаёт:
 *   - WebGL2NotSupportedError
 *   - QuotaExceededError (IDB полна)
 *   - "Cancelled by user" (user через preloader cancel button)
 *   - Network / parse failures (generic)
 */

import { useTranslation } from '@/hooks/use-translation';

interface Props {
    error: Error;
    onRetry?: () => void;
}

type ErrorKind = 'webgl' | 'quota' | 'cancelled' | 'network' | 'generic';

function classifyError(error: Error): ErrorKind {
    if (error.name === 'WebGL2NotSupportedError') return 'webgl';
    if (error.name === 'QuotaExceededError'
        || /quota/i.test(error.message)) return 'quota';
    if (/cancel/i.test(error.message)) return 'cancelled';
    if (/network|fetch|http/i.test(error.message)) return 'network';
    return 'generic';
}

export function PzMapError({ error, onRetry }: Props) {
    const { t } = useTranslation();
    const kind = classifyError(error);
    const title = t(`admin.pz_map.error.${kind}_title`);
    const hint = t(`admin.pz_map.error.${kind}_hint`);
    const isCancelled = kind === 'cancelled';
    return (
        <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-zinc-950/95 text-zinc-100">
            <div
                className={`max-w-md space-y-4 rounded-lg border p-6 ${
                    isCancelled
                        ? 'border-amber-800 bg-amber-950/30'
                        : 'border-red-800 bg-red-950/40'
                }`}
            >
                <h2
                    className={`text-lg font-semibold ${
                        isCancelled ? 'text-amber-300' : 'text-red-300'
                    }`}
                >
                    {title}
                </h2>
                <p className="text-sm text-zinc-300">{error.message}</p>
                <p className="text-xs text-zinc-400">{hint}</p>
                <div className="flex gap-2">
                    {onRetry && (
                        <button
                            type="button"
                            onClick={onRetry}
                            className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-600"
                        >
                            {t('admin.pz_map.error.retry')}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => window.location.reload()}
                        className="rounded-md border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-zinc-700"
                    >
                        {t('admin.pz_map.error.reload')}
                    </button>
                </div>
            </div>
        </div>
    );
}
