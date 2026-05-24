/**
 * <SaveFilterControls /> — spoiler с checkbox'ами для prefix фильтра save.
 *
 * Source: `/pz-save-data/manifest.json` → `discovered_f_prefixes` (на самом
 * деле теперь все prefixes, не только f_).
 * Auto-apply: toggle сразу POST'ит в `/admin/api/pz-map/save/noise-prefixes`,
 * с debounce 600ms — server делает full rebuild через RebuildSaveCacheJob.
 */

import { ChevronDown, ChevronRight, Filter, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useTranslation } from '@/hooks/use-translation';

interface DiscoveredPrefix {
    prefix: string;
    count: number;
}

interface ManifestShape {
    version?: string;
    discovered_f_prefixes?: DiscoveredPrefix[];
    active_extra_noise_prefixes?: string[];
}

const APPLY_DEBOUNCE_MS = 600;

export function SaveFilterControls() {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(false);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [discovered, setDiscovered] = useState<DiscoveredPrefix[]>([]);
    const [active, setActive] = useState<Set<string>>(new Set());
    const [error, setError] = useState<string | null>(null);
    const [statusMsg, setStatusMsg] = useState<string | null>(null);
    const initialLoadDone = useRef(false);
    const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!expanded || initialLoadDone.current) return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        fetch('/pz-save-data/manifest.json', {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
        })
            .then(async (res) => {
                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}`);
                }
                const data = (await res.json()) as ManifestShape;
                if (cancelled) return;
                const list = data.discovered_f_prefixes ?? [];
                setDiscovered([...list].sort((a, b) => b.count - a.count));
                setActive(new Set(data.active_extra_noise_prefixes ?? []));
                initialLoadDone.current = true;
            })
            .catch((err: Error) => {
                if (!cancelled) setError(err.message);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [expanded]);

    const scheduleSave = (next: Set<string>): void => {
        if (debounceTimer.current !== null) {
            clearTimeout(debounceTimer.current);
        }
        setStatusMsg(t('admin.pz_map.save_filter.scheduled', {
            count: String(next.size),
            seconds: String(APPLY_DEBOUNCE_MS / 1000),
        }));
        debounceTimer.current = setTimeout(() => {
            void applyNow(next);
        }, APPLY_DEBOUNCE_MS);
    };

    const applyNow = async (prefixes: Set<string>): Promise<void> => {
        setSaving(true);
        setError(null);
        try {
            const csrf = (document.querySelector('meta[name="csrf-token"]')
                ?.getAttribute('content')) ?? '';
            const res = await fetch('/admin/api/pz-map/save/noise-prefixes', {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    'X-CSRF-TOKEN': csrf,
                },
                body: JSON.stringify({ prefixes: Array.from(prefixes) }),
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            setStatusMsg(t('admin.pz_map.save_filter.applied'));
        } catch (err) {
            setError((err as Error).message);
            setStatusMsg(null);
        } finally {
            setSaving(false);
        }
    };

    const toggle = (prefix: string): void => {
        setActive((prev) => {
            const next = new Set(prev);
            if (next.has(prefix)) {
                next.delete(prefix);
            } else {
                next.add(prefix);
            }
            scheduleSave(next);
            return next;
        });
    };

    return (
        <div className="w-72 rounded-md border border-zinc-700 bg-zinc-900/90 text-[10px] text-zinc-300 backdrop-blur">
            <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="flex w-full items-center justify-between px-3 py-2 font-mono uppercase tracking-wider text-amber-400 hover:bg-zinc-800/60"
            >
                <span className="flex items-center gap-1.5">
                    <Filter className="h-3 w-3" />
                    {t('admin.pz_map.save_filter.title')}
                    {active.size > 0 && (
                        <span className="rounded bg-amber-700/50 px-1 text-[9px] text-amber-100">
                            {active.size}
                        </span>
                    )}
                </span>
                {expanded
                    ? <ChevronDown className="h-3 w-3" />
                    : <ChevronRight className="h-3 w-3" />}
            </button>
            {expanded && (
                <div className="space-y-1 border-t border-zinc-700 p-3 font-mono">
                    {loading && (
                        <div className="flex items-center gap-2 text-zinc-500">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            {t('admin.pz_map.save_filter.loading')}
                        </div>
                    )}
                    {error && (
                        <div className="text-red-400">{t('admin.pz_map.save_filter.error_label')} {error}</div>
                    )}
                    {!loading && !error && discovered.length === 0 && (
                        <div className="text-zinc-500">{t('admin.pz_map.save_filter.empty')}</div>
                    )}
                    {!loading && !error && discovered.length > 0 && (
                        <>
                            <p className="mb-2 text-zinc-500">
                                {t('admin.pz_map.save_filter.help')}
                            </p>
                            <div className="max-h-72 space-y-0.5 overflow-y-auto pr-1">
                                {discovered.map(({ prefix, count }) => (
                                    <label
                                        key={prefix}
                                        className="flex cursor-pointer items-center justify-between rounded px-1 py-0.5 hover:bg-zinc-800"
                                    >
                                        <span className="flex items-center gap-1.5">
                                            <input
                                                type="checkbox"
                                                checked={active.has(prefix)}
                                                onChange={() => toggle(prefix)}
                                                className="h-3 w-3 accent-amber-500"
                                            />
                                            <span className={active.has(prefix) ? 'text-amber-300 line-through' : 'text-zinc-300'}>
                                                {prefix}
                                            </span>
                                        </span>
                                        <span className="text-zinc-500">{count.toLocaleString()}</span>
                                    </label>
                                ))}
                            </div>
                            <div className="mt-2 flex items-center gap-2 text-[9px] text-zinc-500">
                                {saving && <Loader2 className="h-3 w-3 animate-spin" />}
                                <span>{statusMsg ?? t('admin.pz_map.save_filter.status_count', { count: String(active.size) })}</span>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
