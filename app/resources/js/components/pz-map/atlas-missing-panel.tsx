/**
 * <AtlasMissingPanel /> — UI экран который показывается когда WebGL atlas
 * не установлен (404 на `/pz-atlas/manifest.json`).
 *
 * Два режима получения атласа:
 *   - Download: prebuilt tarball с GitHub (~700 MB, ~30-60s)
 *   - Build:    локальная генерация из texturepacks с клиента PZ (несколько часов)
 *
 * Endpoints:
 *   GET  /admin/map/render/atlas-status         — installed / building / counts
 *   PUT  /admin/map/render/atlas-url            — сохранить custom download URL
 *   POST /admin/map/render/atlas/download       — запустить background download
 *   POST /admin/map/render/atlas/build          — запустить background build
 *   POST /admin/map/render/texturepacks        — upload .pack files
 *   DEL  /admin/map/render/texturepacks        — удалить все .pack
 */

import {
    AlertCircle,
    Cog,
    Download,
    ExternalLink,
    FileArchive,
    Loader2,
    RefreshCw,
    XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useTranslation } from '@/hooks/use-translation';

interface AtlasStatus {
    installed: boolean;
    effective_url: string | null;
    custom_url: string | null;
    default_url: string;
    downloading: boolean;
    building: boolean;
    download_log_tail: string | null;
    build_log_tail: string | null;
    build_log_age_sec: number | null;
    download_log_age_sec: number | null;
    texturepacks_count: number;
    texturepacks_names: string[];
}

interface AtlasMissingPanelProps {
    onInstalled: () => void;
}

type Tab = 'download' | 'build';
type BuildPreset = 'minimal' | 'standard' | 'all';

const POLL_INTERVAL_MS = 4000;
const ATLAS_TARBALL_HUMAN_SIZE = '≈ 700 MB';
const BUILD_PRESETS: readonly BuildPreset[] = ['minimal', 'standard', 'all'];

const BUILD_PRESET_STORAGE_KEY = 'pz-atlas-build-preset';

function getCsrf(): string {
    return (document.querySelector('meta[name="csrf-token"]')
        ?.getAttribute('content')) ?? '';
}

export function AtlasMissingPanel({ onInstalled }: AtlasMissingPanelProps) {
    const { t } = useTranslation();
    const [tab, setTab] = useState<Tab>('download');
    const [status, setStatus] = useState<AtlasStatus | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [savingUrl, setSavingUrl] = useState(false);
    const [busy, setBusy] = useState(false);
    const [uploadingPacks, setUploadingPacks] = useState(false);
    const [customUrlInput, setCustomUrlInput] = useState('');
    const [buildPreset, setBuildPreset] = useState<BuildPreset>(() => {
        try {
            const v = localStorage.getItem(BUILD_PRESET_STORAGE_KEY);
            if (v === 'minimal' || v === 'standard' || v === 'all') return v;
        } catch {
            // localStorage недоступен
        }
        return 'minimal';
    });
    const customUrlInit = useRef(false);

    useEffect(() => {
        try {
            localStorage.setItem(BUILD_PRESET_STORAGE_KEY, buildPreset);
        } catch {
            // ignore
        }
    }, [buildPreset]);

    const onInstalledRef = useRef(onInstalled);
    useEffect(() => {
        onInstalledRef.current = onInstalled;
    });

    const fetchStatus = useCallback(async (): Promise<AtlasStatus | null> => {
        try {
            const res = await fetch('/admin/map/render/atlas-status', {
                credentials: 'same-origin',
                headers: { Accept: 'application/json' },
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const data = (await res.json()) as AtlasStatus;
            setStatus(data);
            setError(null);
            if (!customUrlInit.current) {
                setCustomUrlInput(data.custom_url ?? '');
                customUrlInit.current = true;
            }
            return data;
        } catch (err) {
            setError((err as Error).message);
            return null;
        }
    }, []);

    useEffect(() => {
        void fetchStatus();
        const interval = setInterval(() => {
            void fetchStatus().then((s) => {
                if (s?.installed) {
                    clearInterval(interval);
                    onInstalledRef.current();
                }
            });
        }, POLL_INTERVAL_MS);
        return () => clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const saveCustomUrl = async (): Promise<void> => {
        setSavingUrl(true);
        setError(null);
        try {
            const res = await fetch('/admin/map/render/atlas-url', {
                method: 'PUT',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    'X-CSRF-TOKEN': getCsrf(),
                },
                body: JSON.stringify({ atlas_download_url: customUrlInput || null }),
            });
            if (!res.ok) {
                throw new Error(await res.text() || `HTTP ${res.status}`);
            }
            await fetchStatus();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setSavingUrl(false);
        }
    };

    const startAction = async (url: string, payload: Record<string, unknown> = {}): Promise<void> => {
        setBusy(true);
        setError(null);
        try {
            const res = await fetch(url, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    'X-CSRF-TOKEN': getCsrf(),
                },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => null) as { message?: string } | null;
                throw new Error(data?.message ?? `HTTP ${res.status}`);
            }
            await fetchStatus();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const uploadTexturepacks = async (files: FileList | null): Promise<void> => {
        if (!files || files.length === 0) return;
        setUploadingPacks(true);
        setError(null);
        try {
            const form = new FormData();
            for (const file of Array.from(files)) {
                const name = file.name.toLowerCase();
                if (name.endsWith('.zip') || name.endsWith('.tar.gz') || name.endsWith('.tgz')) {
                    // ZipArchive expects single 'archive' field.
                    form.append('archive', file);
                } else {
                    form.append('files[]', file);
                }
            }
            const res = await fetch('/admin/map/render/texturepacks', {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    Accept: 'application/json',
                    'X-CSRF-TOKEN': getCsrf(),
                },
                body: form,
            });
            const data = await res.json().catch(() => null) as { message?: string } | null;
            if (!res.ok) {
                throw new Error(data?.message ?? `HTTP ${res.status}`);
            }
            if (data?.message) {
                setError(data.message);
            }
            await fetchStatus();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setUploadingPacks(false);
        }
    };

    return (
        <div className="absolute inset-0 z-[1000] flex items-center justify-center overflow-y-auto bg-zinc-950 p-8">
            <div className="w-full max-w-2xl rounded-lg border border-zinc-700 bg-zinc-900 p-6 text-zinc-200 shadow-xl">
                <div className="mb-4 flex items-center gap-3">
                    <Download className="h-6 w-6 text-amber-400" />
                    <h2 className="text-lg font-semibold">{t('admin.pz_map.atlas_missing.title')}</h2>
                </div>

                <p className="mb-4 text-sm text-zinc-400">
                    {t('admin.pz_map.atlas_missing.body')}
                </p>

                <div className="mb-4 flex gap-1 border-b border-zinc-700">
                    <button
                        type="button"
                        onClick={() => setTab('download')}
                        className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition ${
                            tab === 'download'
                                ? 'border-amber-500 text-amber-300'
                                : 'border-transparent text-zinc-400 hover:text-zinc-200'
                        }`}
                    >
                        <Download className="h-3.5 w-3.5" />
                        {t('admin.pz_map.atlas_missing.download.tab')}
                    </button>
                    <button
                        type="button"
                        onClick={() => setTab('build')}
                        className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition ${
                            tab === 'build'
                                ? 'border-amber-500 text-amber-300'
                                : 'border-transparent text-zinc-400 hover:text-zinc-200'
                        }`}
                    >
                        <Cog className="h-3.5 w-3.5" />
                        {t('admin.pz_map.atlas_missing.build.tab')}
                    </button>
                </div>

                {error && (
                    <div className="mb-3 flex items-start gap-2 rounded border border-red-700 bg-red-900/30 px-3 py-2 text-sm text-red-300">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span className="break-all">{error}</span>
                    </div>
                )}

                {!status
                    ? (
                            <div className="flex items-center gap-2 text-sm text-zinc-500">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                {t('admin.pz_map.atlas_missing.loading')}
                            </div>
                        )
                    : tab === 'download'
                        ? (
                                <DownloadTab
                                    status={status}
                                    busy={busy}
                                    savingUrl={savingUrl}
                                    customUrlInput={customUrlInput}
                                    setCustomUrlInput={setCustomUrlInput}
                                    onSaveUrl={saveCustomUrl}
                                    onStart={() => startAction('/admin/map/render/atlas/download')}
                                    onRefresh={() => void fetchStatus()}
                                />
                            )
                        : (
                                <BuildTab
                                    status={status}
                                    busy={busy}
                                    uploadingPacks={uploadingPacks}
                                    preset={buildPreset}
                                    setPreset={setBuildPreset}
                                    onUpload={uploadTexturepacks}
                                    onStart={() => startAction('/admin/map/render/atlas/build', { preset: buildPreset })}
                                    onCancel={() => startAction('/admin/map/render/atlas/build/cancel')}
                                    onRefresh={() => void fetchStatus()}
                                />
                            )}
            </div>
        </div>
    );
}

interface DownloadTabProps {
    status: AtlasStatus;
    busy: boolean;
    savingUrl: boolean;
    customUrlInput: string;
    setCustomUrlInput: (v: string) => void;
    onSaveUrl: () => Promise<void>;
    onStart: () => Promise<void>;
    onRefresh: () => void;
}

function DownloadTab({
    status,
    busy,
    savingUrl,
    customUrlInput,
    setCustomUrlInput,
    onSaveUrl,
    onStart,
    onRefresh,
}: DownloadTabProps) {
    const { t } = useTranslation();
    return (
        <div className="space-y-3">
            <p className="text-xs text-zinc-400">
                {t('admin.pz_map.atlas_missing.download.heading', { size: ATLAS_TARBALL_HUMAN_SIZE })}
            </p>

            <div className="space-y-2">
                <label className="block text-xs uppercase tracking-wider text-zinc-500">
                    {t('admin.pz_map.atlas_missing.download.url_label')}
                </label>
                <div className="flex gap-2">
                    <input
                        type="url"
                        value={customUrlInput}
                        onChange={(e) => setCustomUrlInput(e.target.value)}
                        placeholder={status.default_url}
                        className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-xs text-zinc-200 placeholder:text-zinc-500 focus:border-amber-600 focus:outline-none"
                    />
                    <button
                        type="button"
                        onClick={() => void onSaveUrl()}
                        disabled={savingUrl}
                        className="rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-xs text-zinc-200 transition hover:bg-zinc-700 disabled:opacity-50"
                    >
                        {savingUrl
                            ? t('admin.pz_map.atlas_missing.download.save_url_saving')
                            : t('admin.pz_map.atlas_missing.download.save_url')}
                    </button>
                </div>
                <div className="text-[10px] text-zinc-500">
                    {t('admin.pz_map.atlas_missing.download.default_url_label')}{' '}
                    <a
                        href={status.default_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-amber-400 hover:underline"
                    >
                        {status.default_url}
                        <ExternalLink className="h-3 w-3" />
                    </a>
                </div>
                {status.effective_url && status.effective_url !== status.default_url && (
                    <div className="text-[10px] text-amber-400">
                        {t('admin.pz_map.atlas_missing.download.effective_label')} {status.effective_url}
                    </div>
                )}
            </div>

            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={() => void onStart()}
                    disabled={busy || status.downloading}
                    className="flex flex-1 items-center justify-center gap-2 rounded border border-amber-600 bg-amber-700/30 px-4 py-2 text-sm text-amber-100 transition hover:bg-amber-700/50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {(busy || status.downloading)
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Download className="h-4 w-4" />}
                    {status.downloading
                        ? t('admin.pz_map.atlas_missing.download.running')
                        : t('admin.pz_map.atlas_missing.download.start', { size: ATLAS_TARBALL_HUMAN_SIZE })}
                </button>
                <button
                    type="button"
                    onClick={onRefresh}
                    className="rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-xs text-zinc-200 transition hover:bg-zinc-700"
                    title={t('admin.pz_map.atlas_missing.refresh')}
                >
                    <RefreshCw className="h-4 w-4" />
                </button>
            </div>

            {status.download_log_tail && (
                <details className="text-xs">
                    <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">
                        {t('admin.pz_map.atlas_missing.download.log_summary')}
                    </summary>
                    <pre className="mt-2 max-h-64 overflow-auto rounded bg-zinc-950 p-2 font-mono text-[10px] text-zinc-400">
                        {status.download_log_tail}
                    </pre>
                </details>
            )}

            <div className="text-[10px] text-zinc-500">
                {t('admin.pz_map.atlas_missing.download.note', { seconds: String(POLL_INTERVAL_MS / 1000) })}
            </div>
        </div>
    );
}

interface BuildTabProps {
    status: AtlasStatus;
    busy: boolean;
    uploadingPacks: boolean;
    preset: BuildPreset;
    setPreset: (p: BuildPreset) => void;
    onUpload: (files: FileList | null) => Promise<void>;
    onStart: () => Promise<void>;
    onCancel: () => Promise<void>;
    onRefresh: () => void;
}

function BuildTab({ status, busy, uploadingPacks, preset, setPreset, onUpload, onStart, onCancel, onRefresh }: BuildTabProps) {
    const { t } = useTranslation();
    const hasPacks = status.texturepacks_count > 0;
    const selectedEstimate = t(`admin.pz_map.atlas_missing.preset.${preset}.estimate`);
    return (
        <div className="space-y-3">
            <p className="text-xs text-zinc-400">
                {t('admin.pz_map.atlas_missing.build.heading')}
            </p>

            <div
                className="rounded border border-amber-800/60 bg-amber-950/20 p-3 text-xs text-amber-200"
                dangerouslySetInnerHTML={{
                    __html: t('admin.pz_map.atlas_missing.texturepacks.client_note')
                        + ' <code class="ml-1 rounded bg-zinc-800 px-1 text-amber-300">Steam/steamapps/common/ProjectZomboid/media/texturepacks/</code>',
                }}
            />

            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <label className="text-xs uppercase tracking-wider text-zinc-500">
                        {t('admin.pz_map.atlas_missing.texturepacks.label')}
                    </label>
                    <span className={`text-xs ${hasPacks ? 'text-emerald-400' : 'text-zinc-500'}`}>
                        {t('admin.pz_map.atlas_missing.texturepacks.count', { count: String(status.texturepacks_count) })}
                    </span>
                </div>

                <label className="flex cursor-pointer items-center justify-center gap-2 rounded border border-dashed border-zinc-600 bg-zinc-800/50 px-4 py-3 text-xs text-zinc-300 transition hover:border-zinc-500 hover:bg-zinc-800">
                    {uploadingPacks
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <FileArchive className="h-4 w-4" />}
                    <span>
                        {uploadingPacks
                            ? t('admin.pz_map.atlas_missing.texturepacks.uploading')
                            : hasPacks
                                ? t('admin.pz_map.atlas_missing.texturepacks.add_more')
                                : t('admin.pz_map.atlas_missing.texturepacks.choose')}
                    </span>
                    <input
                        type="file"
                        multiple
                        accept=".pack,.zip,.tar.gz,.tgz"
                        className="hidden"
                        onChange={(e) => void onUpload(e.target.files)}
                    />
                </label>

                {hasPacks && status.texturepacks_names.length > 0 && (
                    <details className="text-xs">
                        <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">
                            {t('admin.pz_map.atlas_missing.texturepacks.list_summary', { count: String(status.texturepacks_count) })}
                        </summary>
                        <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto pl-4 font-mono text-[10px] text-zinc-400">
                            {status.texturepacks_names.map((name) => (
                                <li key={name}>{name}</li>
                            ))}
                        </ul>
                    </details>
                )}
            </div>

            <div className="space-y-1">
                <label className="block text-xs uppercase tracking-wider text-zinc-500">
                    {t('admin.pz_map.atlas_missing.preset.label')}
                </label>
                <div className="grid grid-cols-3 gap-1">
                    {BUILD_PRESETS.map((key) => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => setPreset(key)}
                            disabled={status.building}
                            className={`rounded border px-2 py-1.5 text-xs transition ${
                                preset === key
                                    ? 'border-amber-500 bg-amber-700/30 text-amber-200'
                                    : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-600'
                            } disabled:cursor-not-allowed disabled:opacity-50`}
                        >
                            <div className="font-semibold">{t(`admin.pz_map.atlas_missing.preset.${key}.label`)}</div>
                            <div className="mt-0.5 text-[10px] opacity-80">{t(`admin.pz_map.atlas_missing.preset.${key}.estimate`)}</div>
                        </button>
                    ))}
                </div>
                <p className="text-[10px] text-zinc-500">
                    {t(`admin.pz_map.atlas_missing.preset.${preset}.description`)}
                </p>
            </div>

            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={() => void onStart()}
                    disabled={busy || status.building || !hasPacks}
                    className="flex flex-1 items-center justify-center gap-2 rounded border border-amber-600 bg-amber-700/30 px-4 py-2 text-sm text-amber-100 transition hover:bg-amber-700/50 disabled:cursor-not-allowed disabled:opacity-50"
                    title={!hasPacks ? t('admin.pz_map.atlas_missing.build.tooltip_no_packs') : ''}
                >
                    {(busy || status.building)
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Cog className="h-4 w-4" />}
                    {status.building
                        ? (status.build_log_age_sec !== null && status.build_log_age_sec > 30
                                ? t('admin.pz_map.atlas_missing.build.running_silent', { seconds: String(Math.floor(status.build_log_age_sec)) })
                                : t('admin.pz_map.atlas_missing.build.running'))
                        : t('admin.pz_map.atlas_missing.build.start', { estimate: selectedEstimate })}
                </button>
                {status.building && (
                    <button
                        type="button"
                        onClick={() => {
                            if (confirm(t('admin.pz_map.atlas_missing.build.cancel_confirm'))) {
                                void onCancel();
                            }
                        }}
                        disabled={busy}
                        className="flex items-center gap-1 rounded border border-red-700 bg-red-900/30 px-3 py-2 text-xs text-red-200 transition hover:bg-red-900/50 disabled:opacity-50"
                        title={t('admin.pz_map.atlas_missing.build.cancel')}
                    >
                        <XCircle className="h-4 w-4" />
                        {t('admin.pz_map.atlas_missing.build.cancel')}
                    </button>
                )}
                <button
                    type="button"
                    onClick={onRefresh}
                    className="rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-xs text-zinc-200 transition hover:bg-zinc-700"
                    title={t('admin.pz_map.atlas_missing.refresh')}
                >
                    <RefreshCw className="h-4 w-4" />
                </button>
            </div>

            {status.build_log_tail && (
                <details className="text-xs" open={status.building}>
                    <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">
                        {t('admin.pz_map.atlas_missing.build.log_summary')}
                    </summary>
                    <pre className="mt-2 max-h-64 overflow-auto rounded bg-zinc-950 p-2 font-mono text-[10px] text-zinc-400">
                        {status.build_log_tail}
                    </pre>
                </details>
            )}

            <div className="text-[10px] text-zinc-500">
                {t('admin.pz_map.atlas_missing.build.note', { seconds: String(POLL_INTERVAL_MS / 1000) })}
            </div>
        </div>
    );
}
