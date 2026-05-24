/**
 * Полноэкранный overlay показывающий прогресс инициализации карты.
 * Активен пока renderer.state !== 'ready'.
 */

import { useTranslation } from '@/hooks/use-translation';
import type { ProgressSnapshot } from '@/lib/pz-renderer';

interface Props {
    progress: ProgressSnapshot | null;
    onCancel?: () => void;
}

export function PzMapPreloader({ progress, onCancel }: Props) {
    const { t } = useTranslation();
    const pct = progress ? Math.round(progress.overall * 100) : 0;
    const rawLabel = progress?.label ?? 'admin.pz_map.loading_label_connecting';
    const label = rawLabel.startsWith('admin.pz_map.') ? t(rawLabel) : rawLabel;
    const eta = progress?.details?.etaSeconds;

    return (
        <div className="absolute inset-0 z-[1000] flex flex-col items-center justify-center bg-zinc-950/85 text-zinc-100 backdrop-blur-sm">
            <div className="w-80 max-w-[80%] space-y-3">
                <div className="flex items-baseline justify-between">
                    <span className="text-sm font-medium">{label}</span>
                    <span className="font-mono text-xs text-zinc-400">{pct}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                        className="h-full bg-emerald-500 transition-[width] duration-150 ease-out"
                        style={{ width: `${pct}%` }}
                    />
                </div>
                {eta !== undefined && eta > 0 && (
                    <p className="text-center text-xs text-zinc-500">
                        {t('admin.pz_map.eta_seconds', { sec: String(Math.ceil(eta)) })}
                    </p>
                )}
                <p className="text-center text-xs text-zinc-500">
                    {t('admin.pz_map.preloader_hint')}
                </p>
                {onCancel && (
                    <div className="flex justify-center pt-2">
                        <button
                            type="button"
                            onClick={onCancel}
                            className="rounded border border-zinc-700 bg-zinc-800 px-4 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-red-500 hover:bg-red-900/30 hover:text-red-300"
                        >
                            {t('admin.pz_map.cancel_load')}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
