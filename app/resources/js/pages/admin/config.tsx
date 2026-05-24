import { Head, Link, router } from '@inertiajs/react';
import { Download, Eye, EyeOff, Loader2, RotateCcw, Save, Search, Timer, Upload } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ImportConfigDialog } from '@/components/import-config-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTranslation } from '@/hooks/use-translation';
import AppLayout from '@/layouts/app-layout';
import {
    groupSettings,
    humaniseKey,
    inferSandboxCategory,
    inferServerCategory,
    mergeCatalog,
    SANDBOX_CATEGORY_ORDER,
    SANDBOX_META,
    SERVER_INI_CATEGORY_ORDER,
    SERVER_INI_META,
    VANILLA_NESTED_LABELS,

} from '@/lib/config-metadata';
import type {CatalogEntry, SettingMeta} from '@/lib/config-metadata';
import { fetchAction } from '@/lib/fetch-action';
import type { BreadcrumbItem } from '@/types';

type RespawnDelayConfig = {
    enabled: boolean;
    delay_minutes: number;
};

type ConfigProps = {
    server_config: Record<string, string>;
    sandbox_config: Record<string, unknown>;
    respawn_delay: RespawnDelayConfig;
    /**
     * Settings catalog produced by `php artisan zomboid:sync-config-catalog`
     * from the PZ-generated SandboxVars comments. Enriches descriptions /
     * min / max / default / enum labels on top of the hard-coded metadata.
     */
    catalog?: {
        server?: Record<string, CatalogEntry>;
        sandbox?: Record<string, CatalogEntry>;
        mods?: Record<string, { label: string; options: Record<string, CatalogEntry> }>;
    };
};

const COUNTDOWN_OPTIONS = [
    { value: '0', label: 'Immediately' },
    { value: '60', label: '1 minute' },
    { value: '120', label: '2 minutes' },
    { value: '300', label: '5 minutes' },
    { value: '600', label: '10 minutes' },
    { value: '900', label: '15 minutes' },
    { value: '1800', label: '30 minutes' },
    { value: '3600', label: '60 minutes' },
] as const;

// ── Password field with eye toggle ──────────────────────────────────

function PasswordInput({
    id,
    value,
    onChange,
    className,
    disabled = false,
}: {
    id: string;
    value: string;
    onChange: (value: string) => void;
    className?: string;
    disabled?: boolean;
}) {
    const [visible, setVisible] = useState(false);

    return (
        <div className="relative">
            <Input
                id={id}
                type={visible ? 'text' : 'password'}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className={className}
                disabled={disabled}
            />
            <button
                type="button"
                onClick={() => setVisible(!visible)}
                className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
                disabled={disabled}
            >
                {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
        </div>
    );
}

// ── Smart input renderer ────────────────────────────────────────────

/**
 * Native range slider + compact number input. Drags update a local
 * draft so the parent doesn't mark the field dirty mid-drag — that
 * would expand the sticky "save" footer and shift the slider out
 * from under the cursor, dropping the pointer capture. The committed
 * value is sent on release / Enter / blur instead.
 */
function RangeSliderInput({
    id,
    value,
    min,
    max,
    step,
    onChange,
    disabled,
    className,
    settingKey,
}: {
    id: string;
    value: string;
    min: number;
    max: number;
    step: string;
    onChange: (value: string) => void;
    disabled: boolean;
    className: string;
    settingKey: string;
}) {
    const [draft, setDraft] = useState(value);

    useEffect(() => {
        setDraft(value);
    }, [value]);

    const commit = (next: string) => {
        if (next !== value) {
            onChange(next);
        }
    };

    const numericDraft = Number(draft);
    const sliderValue = Number.isFinite(numericDraft) ? numericDraft : min;

    return (
        <div className="flex items-center gap-3">
            <input
                id={id}
                type="range"
                min={min}
                max={max}
                step={step}
                value={sliderValue}
                onChange={(e) => setDraft(e.target.value)}
                onPointerUp={(e) => commit((e.target as HTMLInputElement).value)}
                onKeyUp={(e) => commit((e.target as HTMLInputElement).value)}
                onBlur={(e) => commit(e.target.value)}
                className={`h-2 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-primary disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
                disabled={disabled}
            />
            <Input
                type="number"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={(e) => commit(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        commit((e.target as HTMLInputElement).value);
                    }
                }}
                min={min}
                max={max}
                step={step}
                className={`w-24 text-right tabular-nums ${className}`}
                disabled={disabled}
                aria-label={settingKey}
            />
        </div>
    );
}

function SettingInput({
    settingKey,
    value,
    meta,
    isDirty,
    onChange,
    disabled = false,
    disabledReason,
    onRestoreDefault,
}: {
    settingKey: string;
    value: string;
    meta?: SettingMeta;
    isDirty: boolean;
    onChange: (value: string) => void;
    disabled?: boolean;
    disabledReason?: string;
    onRestoreDefault?: () => void;
}) {
    const { t } = useTranslation();
    const inputId = `cfg-${settingKey}`;
    const dirtyClass = isDirty ? 'border-blue-500' : '';

    const restoreButton = isDirty && onRestoreDefault && !disabled ? (
        <button
            type="button"
            onClick={onRestoreDefault}
            title={t('admin.config.restore_default_tooltip')}
            aria-label={t('admin.config.restore_default_tooltip')}
            className="ml-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            data-testid={`restore-default-${settingKey}`}
        >
            <RotateCcw className="size-3.5" />
        </button>
    ) : null;

    const wrap = (node: ReactNode) =>
        restoreButton ? (
            <div className="flex items-center" title={disabled ? disabledReason : undefined}>
                <div className="flex-1">{node}</div>
                {restoreButton}
            </div>
        ) : (
            <div title={disabled ? disabledReason : undefined}>{node}</div>
        );

    if (!meta) {
        return wrap(
            <Input
                id={inputId}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className={dirtyClass}
                disabled={disabled}
            />,
        );
    }

    if (meta.readOnly && meta.type === 'list') {
        const items = value ? value.split(';').filter(Boolean) : [];
        return (
            <div className="flex flex-wrap gap-1.5">
                {items.length > 0 ? (
                    items.map((item) => (
                        <Badge key={item} variant="secondary">
                            {item}
                        </Badge>
                    ))
                ) : (
                    <span className="text-xs text-muted-foreground">{t('common.none')}</span>
                )}
                <Link href="/admin/mods" className="ml-1 text-xs text-blue-500 hover:underline">
                    {t('admin.config.manage_mods_link')}
                </Link>
            </div>
        );
    }

    if (meta.sensitive) {
        return wrap(
            <PasswordInput
                id={inputId}
                value={value}
                onChange={onChange}
                className={dirtyClass}
                disabled={disabled}
            />,
        );
    }

    if (meta.type === 'boolean') {
        return wrap(
            <div className="flex items-center gap-2">
                <Switch
                    id={inputId}
                    checked={value === 'true'}
                    onCheckedChange={(checked) => onChange(checked ? 'true' : 'false')}
                    disabled={disabled}
                />
                <Label htmlFor={inputId} className="cursor-pointer text-sm font-normal">
                    {value === 'true' ? t('common.enabled') : t('common.disabled')}
                </Label>
            </div>,
        );
    }

    if (meta.type === 'enum' && meta.options) {
        return wrap(
            <Select value={value} onValueChange={onChange} disabled={disabled}>
                <SelectTrigger id={inputId} className={dirtyClass}>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {meta.options.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>,
        );
    }

    if (meta.type === 'number') {
        // Use 0.1 only when the catalog explicitly marks the field as
        // float (the server-ini parser sets this when Min/Max/Default
        // or the current value contained a decimal). Everything else
        // gets the integer step — PZ's int fields refuse decimals.
        const step = meta.float ? '0.1' : '1';
        // Show a slider only when the range is small enough to scrub
        // meaningfully. PZ uses `Max: 2147483647` (int32 max) as a
        // sentinel for "no upper bound" on dozens of fields, port
        // fields use Min:0/Max:65535, and even "small" PZ ranges like
        // 0-1000 (cooldown timers) are too wide to click-target
        // accurately. 200 keeps sliders for the cases they're
        // actually useful for — percentages, player counts, hour
        // limits, multiplier 0-100.
        const SLIDER_MAX_RANGE = 200;
        const hasRange = typeof meta.min === 'number'
            && typeof meta.max === 'number'
            && meta.max - meta.min <= SLIDER_MAX_RANGE;

        // Render a native range slider with a compact text box on the
        // right when we know the field's bounds (catalog `Min:`/`Max:`
        // hints). Fall back to a plain number input for unbounded
        // values so users can still type freely.
        if (hasRange) {
            return wrap(
                <RangeSliderInput
                    id={inputId}
                    value={value}
                    min={meta.min as number}
                    max={meta.max as number}
                    step={step}
                    onChange={onChange}
                    disabled={disabled}
                    className={dirtyClass}
                    settingKey={settingKey}
                />,
            );
        }

        return wrap(
            <Input
                id={inputId}
                type="number"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                min={meta.min}
                max={meta.max}
                step={step}
                className={dirtyClass}
                disabled={disabled}
            />,
        );
    }

    return wrap(
        <Input
            id={inputId}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={dirtyClass}
            disabled={disabled}
        />,
    );
}

// ── Config section with collapsible groups ──────────────────────────

type ConfigSectionHandle = {
    save(): Promise<boolean>;
};

type ConfigSectionProps = {
    title: string;
    description: string;
    config: Record<string, string>;
    meta: Record<string, SettingMeta>;
    groupOrder: string[];
    search: string;
    onSave: (settings: Record<string, string>) => Promise<boolean>;
    onDirtyChange: (count: number) => void;
    /**
     * Optional predicate restricting which `meta.group` values are visible.
     * The section still owns every field's value + dirty state internally,
     * so saves carry edits from outside the current filter (handy when the
     * page splits the same logical section across multiple tabs).
     */
    groupFilter?: (group: string) => boolean;
    /**
     * Optional fallback that maps an unknown key to its category. Used by
     * the Server tab to consume our `inferServerCategory()` taxonomy so
     * that every server.ini key lands in a sensible tab without each one
     * needing a hand-written `group` field on its SettingMeta.
     */
    inferGroup?: (key: string) => string;
    /**
     * Hide the section without unmounting (preserves internal state across
     * tab switches). When false, the section renders nothing.
     */
    visible?: boolean;
    /**
     * Suppress the duplicate section title/description when the surrounding
     * tab already provides a header.
     */
    hideHeader?: boolean;
};

const ConfigSection = forwardRef<ConfigSectionHandle, ConfigSectionProps>(function ConfigSection(
    {
        title,
        description,
        config,
        meta,
        groupOrder,
        search,
        onSave,
        onDirtyChange,
        groupFilter,
        inferGroup,
        visible = true,
        hideHeader = false,
    },
    ref,
) {
    const { t } = useTranslation();
    const [values, setValues] = useState<Record<string, string>>(config);
    const [dirty, setDirty] = useState<Set<string>>(new Set());
    const [activeSubTab, setActiveSubTab] = useState<string | null>(null);

    const groups = useMemo(
        () => groupSettings(values, meta, groupOrder, inferGroup),
        [values, meta, groupOrder, inferGroup],
    );

    const filteredGroups = useMemo(() => {
        const passesGroup = (g: { group: string }) => (groupFilter ? groupFilter(g.group) : true);
        if (!search) return groups.filter(passesGroup);
        const q = search.toLowerCase();
        return groups
            .filter(passesGroup)
            .map((g) => ({
                ...g,
                entries: g.entries.filter(
                    (e) =>
                        e.key.toLowerCase().includes(q) ||
                        (e.meta?.description ?? '').toLowerCase().includes(q),
                ),
            }))
            .filter((g) => g.entries.length > 0);
    }, [groups, search, groupFilter]);

    useEffect(() => {
        onDirtyChange(dirty.size);
    }, [dirty.size]);

    function handleChange(key: string, value: string) {
        setValues((prev) => ({ ...prev, [key]: value }));
        if (value !== config[key]) {
            setDirty((prev) => new Set(prev).add(key));
        } else {
            setDirty((prev) => {
                const next = new Set(prev);
                next.delete(key);
                return next;
            });
        }
    }

    async function handleSave(): Promise<boolean> {
        if (dirty.size === 0) return true;
        const changed: Record<string, string> = {};
        dirty.forEach((key) => {
            changed[key] = values[key];
        });
        const success = await onSave(changed);
        if (success) {
            setDirty(new Set());
        }
        return success;
    }

    useImperativeHandle(ref, () => ({ save: handleSave }));

    // Pick the first visible group as the active sub-tab. Keeps the
    // selection stable as long as it's still in `filteredGroups`; falls
    // back to the first group when the previous selection got filtered
    // out (eg. after typing in the search box).
    const activeGroup = useMemo(() => {
        if (filteredGroups.length === 0) return null;
        const stillVisible = filteredGroups.some((g: { group: string }) => g.group === activeSubTab);
        return stillVisible ? activeSubTab : filteredGroups[0].group;
    }, [filteredGroups, activeSubTab]);

    useEffect(() => {
        if (activeGroup && activeGroup !== activeSubTab) {
            setActiveSubTab(activeGroup);
        }
    }, [activeGroup, activeSubTab]);

    if (Object.keys(config).length === 0) {
        if (!visible) return null;
        return (
            <div className="rounded-lg border p-8 text-center text-muted-foreground">
                <p className="text-sm">{t('admin.config.config_not_available', { title })}</p>
            </div>
        );
    }

    return (
        <div className="space-y-3" hidden={!visible}>
            {!hideHeader && (
                <div>
                    <h2 className="text-lg font-semibold">{title}</h2>
                    <p className="text-sm text-muted-foreground">{description}</p>
                </div>
            )}

            <Tabs value={activeGroup ?? ''} onValueChange={setActiveSubTab}>
                <TabsList className="h-auto flex-wrap justify-start gap-1 bg-transparent p-0">
                    {filteredGroups.map(({ group, entries }) => (
                        <TabsTrigger
                            key={group}
                            value={group}
                            className="h-7 gap-1.5 rounded-md border border-transparent bg-muted px-2.5 text-xs font-normal data-[state=active]:border-border data-[state=active]:bg-background"
                        >
                            <span>{group}</span>
                            <Badge variant="secondary" className="text-[10px] px-1 py-0">
                                {entries.length}
                            </Badge>
                        </TabsTrigger>
                    ))}
                </TabsList>
                {filteredGroups.map(({ group, entries }) => (
                    <TabsContent key={group} value={group} className="mt-3">
                        <div className="rounded-lg border bg-card p-4">
                            <div className="grid gap-5 sm:grid-cols-2">
                                {entries.map(({ key, value, meta: settingMeta }) => {
                                    // Conditional disable: a field with `requires` is only
                                    // enabled when its referenced sibling currently holds
                                    // the expected value.
                                    let isDisabled = false;
                                    let disabledReason: string | undefined;
                                    if (settingMeta?.requires) {
                                        const { key: reqKey, value: reqValue } = settingMeta.requires;
                                        const current = values[reqKey];
                                        if (String(current) !== String(reqValue)) {
                                            isDisabled = true;
                                            disabledReason = t('admin.config.requires_tooltip', {
                                                key: reqKey,
                                                value: String(reqValue),
                                            });
                                        }
                                    }

                                    const hasDefault = typeof settingMeta?.default !== 'undefined';
                                    const defaultString = hasDefault
                                        ? String(settingMeta!.default)
                                        : undefined;
                                    const restoreToDefault =
                                        hasDefault && defaultString !== value
                                            ? () => handleChange(key, defaultString!)
                                            : undefined;

                                    const displayLabel = settingMeta?.label
                                        ?? (key.includes('.') ? humaniseKey(key) : key);

                                    return (
                                        <div key={key} className="space-y-1.5">
                                            <Label
                                                htmlFor={`cfg-${key}`}
                                                className="text-xs font-medium"
                                                title={settingMeta?.description || key}
                                            >
                                                {displayLabel}
                                            </Label>
                                            <SettingInput
                                                settingKey={key}
                                                value={value}
                                                meta={settingMeta}
                                                isDirty={dirty.has(key)}
                                                onChange={(v) => handleChange(key, v)}
                                                disabled={isDisabled}
                                                disabledReason={disabledReason}
                                                onRestoreDefault={restoreToDefault}
                                            />
                                            {settingMeta?.description && (
                                                <p className="whitespace-pre-line text-xs text-muted-foreground">
                                                    {settingMeta.description}
                                                </p>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </TabsContent>
                ))}
            </Tabs>

            {filteredGroups.length === 0 && search && (
                <p className="py-4 text-center text-sm text-muted-foreground">
                    {t('admin.config.no_settings_match', { search, section: title.toLowerCase() })}
                </p>
            )}
        </div>
    );
});

// ── Main config page ────────────────────────────────────────────────

export default function Config({ server_config, sandbox_config, respawn_delay, catalog }: ConfigProps) {
    const { t } = useTranslation();
    const breadcrumbs: BreadcrumbItem[] = [
        { title: t('nav.dashboard'), href: '/dashboard' },
        { title: t('admin.config.title'), href: '/admin/config' },
    ];
    const [saving, setSaving] = useState(false);
    const [search, setSearch] = useState('');
    const [serverDirty, setServerDirty] = useState(0);
    const [sandboxDirty, setSandboxDirty] = useState(0);
    const [modsDirty, setModsDirty] = useState(0);
    const [activeTab, setActiveTab] = useState<'server' | 'sandbox' | 'mods'>('server');

    // Import dialog state
    const [showImportDialog, setShowImportDialog] = useState(false);

    // Restart dialog state
    const [showRestartDialog, setShowRestartDialog] = useState(false);
    const [restartCountdown, setRestartCountdown] = useState('0');
    const [restartMessage, setRestartMessage] = useState('');
    const [restartLoading, setRestartLoading] = useState(false);

    // Respawn delay state
    const [respawnEnabled, setRespawnEnabled] = useState(respawn_delay.enabled);
    const [respawnMinutes, setRespawnMinutes] = useState(respawn_delay.delay_minutes);
    const [respawnSaving, setRespawnSaving] = useState(false);

    const serverRef = useRef<ConfigSectionHandle>(null);
    const sandboxRef = useRef<ConfigSectionHandle>(null);
    const modsRef = useRef<ConfigSectionHandle>(null);

    // Hydrate hard-coded metadata with PZ-supplied descriptions / min / max
    // / enum labels. The catalog is regenerated by `zomboid:sync-config-catalog`
    // every time mods change, so descriptions stay in sync with what the
    // running game server actually loaded.
    const serverMeta = useMemo(
        () => mergeCatalog(SERVER_INI_META, catalog?.server),
        [catalog?.server],
    );
    const sandboxMeta = useMemo(
        () => {
            const base = mergeCatalog(SANDBOX_META, catalog?.sandbox);

            // The parser surfaces every nested table inside `SandboxVars` —
            // both vanilla groups PZ ships (`ZombieLore`, `Basement`, `Map`,
            // `ZombieConfig`, `MultiplierConfig`, ...) and actual mod
            // namespaces. We pick the right bucket in two layers:
            //   1. VANILLA_NESTED_LABELS — an explicit whitelist of known
            //      vanilla sub-tables that get a friendly group label.
            //   2. Inferred prefix: if SANDBOX_META already defines any
            //      `<Namespace>.<Anything>` key, that namespace is vanilla
            //      and the new option inherits its sibling's group.
            //   3. Otherwise it's a mod and ends up under "Mod: <Label>".
            const vanillaPrefixGroup: Record<string, string> = { ...VANILLA_NESTED_LABELS };
            for (const [k, m] of Object.entries(SANDBOX_META)) {
                const dot = k.indexOf('.');
                if (dot > 0 && m.group) {
                    const prefix = k.slice(0, dot);
                    if (!vanillaPrefixGroup[prefix]) {
                        vanillaPrefixGroup[prefix] = m.group;
                    }
                }
            }

            for (const [modKey, modBlock] of Object.entries(catalog?.mods ?? {})) {
                const vanillaGroup = vanillaPrefixGroup[modKey];

                for (const [optKey, entry] of Object.entries(modBlock.options ?? {})) {
                    const flatKey = `${modKey}.${optKey}`;
                    const existing = base[flatKey];
                    const type: SettingMeta['type'] = entry.type === 'enum' ? 'enum'
                        : entry.type === 'boolean' ? 'boolean'
                        : entry.type === 'number' ? 'number'
                        : 'string';

                    if (existing) {
                        // Exact match in hard-coded meta — enrich only.
                        const enriched: SettingMeta = { ...existing };
                        if (entry.label) enriched.label = entry.label;
                        if (entry.description) enriched.description = entry.description;
                        if (typeof entry.default !== 'undefined') enriched.default = entry.default;
                        if (typeof entry.min === 'number') enriched.min = entry.min;
                        if (typeof entry.max === 'number') enriched.max = entry.max;
                        if (entry.options?.length) {
                            enriched.options = entry.options.map((o) => ({
                                value: String(o.value),
                                label: o.label,
                            }));
                        }
                        base[flatKey] = enriched;
                        continue;
                    }

                    const group = vanillaGroup ?? `Mod: ${modBlock.label ?? modKey}`;
                    base[flatKey] = {
                        type,
                        group,
                        label: entry.label,
                        description: entry.description ?? '',
                        default: entry.default,
                        min: entry.min,
                        max: entry.max,
                        options: entry.options?.map((o) => ({
                            value: String(o.value),
                            label: o.label,
                        })),
                    };
                }
            }

            return base;
        },
        [catalog?.sandbox, catalog?.mods],
    );

    const totalDirty = serverDirty + sandboxDirty + modsDirty;

    // Pre-compute the list of "Mod: <Label>" groups our sandboxMeta carries.
    // The Mods tab needs both a count (for the tab badge) and an explicit
    // group order so collapsibles open in a stable sequence.
    const { modGroupOrder, modGroupCount } = useMemo(() => {
        const seen = new Set<string>();
        const order: string[] = [];
        for (const m of Object.values(sandboxMeta) as SettingMeta[]) {
            if (m.group && m.group.startsWith('Mod: ') && !seen.has(m.group)) {
                seen.add(m.group);
                order.push(m.group);
            }
        }
        return { modGroupOrder: order, modGroupCount: order.length };
    }, [sandboxMeta]);

    async function saveConfig(url: string, settings: Record<string, string>): Promise<boolean> {
        setSaving(true);
        const result = await fetchAction(url, {
            method: 'PATCH',
            data: { settings },
            successMessage: t('admin.config.toast_config_saved'),
        });
        setSaving(false);
        return result !== null;
    }

    async function handleFloatingSave() {
        const results = await Promise.all([
            serverRef.current?.save() ?? Promise.resolve(true),
            sandboxRef.current?.save() ?? Promise.resolve(true),
            modsRef.current?.save() ?? Promise.resolve(true),
        ]);
        if (results.every(Boolean)) {
            setShowRestartDialog(true);
        }
    }

    async function handleRestart() {
        setRestartLoading(true);
        const countdown = parseInt(restartCountdown, 10);
        const data: Record<string, unknown> = {};
        if (countdown > 0) {
            data.countdown = countdown;
            if (restartMessage.trim()) {
                data.message = restartMessage.trim();
            }
        }
        const result = await fetchAction('/admin/server/restart', { data: Object.keys(data).length > 0 ? data : undefined });
        setRestartLoading(false);
        if (result === null) {
            return;
        }
        setShowRestartDialog(false);
        setRestartCountdown('0');
        setRestartMessage('');
        setTimeout(() => router.reload({ only: ['server_config', 'sandbox_config'] }), 2000);
    }

    async function saveRespawnDelay() {
        setRespawnSaving(true);
        await fetchAction('/admin/respawn-delay', {
            method: 'PATCH',
            data: { enabled: respawnEnabled, delay_minutes: respawnMinutes },
            successMessage: t('admin.config.toast_respawn_saved'),
        });
        setRespawnSaving(false);
    }

    // Flatten sandbox config for display
    const flatSandbox: Record<string, string> = {};
    function flatten(obj: Record<string, unknown>, prefix = '') {
        for (const [key, val] of Object.entries(obj)) {
            const fullKey = prefix ? `${prefix}.${key}` : key;
            if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
                flatten(val as Record<string, unknown>, fullKey);
            } else {
                flatSandbox[fullKey] = String(val ?? '');
            }
        }
    }
    flatten(sandbox_config as Record<string, unknown>);

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title={t('admin.config.title')} />
            <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">{t('admin.config.title')}</h1>
                        <p className="text-muted-foreground">
                            {t('admin.config.description')}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" asChild>
                            <a href="/admin/config/export/server" download>
                                <Download className="mr-1.5 size-3.5" />
                                server.ini
                            </a>
                        </Button>
                        <Button variant="outline" size="sm" asChild>
                            <a href="/admin/config/export/sandbox" download>
                                <Download className="mr-1.5 size-3.5" />
                                SandboxVars.lua
                            </a>
                        </Button>
                        <Button variant="outline" onClick={() => setShowImportDialog(true)}>
                            <Upload className="mr-2 size-4" />
                            {t('common.import')}
                        </Button>
                        <div className="relative w-full sm:w-72">
                            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                type="search"
                                placeholder={t('admin.config.search_placeholder')}
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="pl-9"
                                autoComplete="off"
                                autoCorrect="off"
                                autoCapitalize="off"
                                spellCheck={false}
                                name="config-search"
                                data-form-type="other"
                            />
                        </div>
                    </div>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Timer className="size-5" />
                            {t('admin.config.custom_rules_title')}
                        </CardTitle>
                        <CardDescription>
                            {t('admin.config.custom_rules_description')}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                                <Label htmlFor="respawn-enabled" className="text-sm font-medium">
                                    {t('admin.config.respawn_delay_label')}
                                </Label>
                                <p className="text-xs text-muted-foreground">
                                    {t('admin.config.respawn_delay_description')}
                                </p>
                            </div>
                            <Switch
                                id="respawn-enabled"
                                checked={respawnEnabled}
                                onCheckedChange={setRespawnEnabled}
                            />
                        </div>
                        {respawnEnabled && (
                            <div className="grid gap-2">
                                <Label htmlFor="respawn-minutes">{t('admin.config.cooldown_label')}</Label>
                                <Input
                                    id="respawn-minutes"
                                    type="number"
                                    min={1}
                                    max={10080}
                                    value={respawnMinutes}
                                    onChange={(e) => setRespawnMinutes(Math.max(1, parseInt(e.target.value, 10) || 1))}
                                    className="w-32"
                                />
                                <p className="text-xs text-muted-foreground">
                                    {t('admin.config.cooldown_description')}
                                </p>
                            </div>
                        )}
                        <Button
                            onClick={saveRespawnDelay}
                            disabled={respawnSaving}
                            size="sm"
                        >
                            {respawnSaving ? (
                                <>
                                    <Loader2 className="mr-2 size-4 animate-spin" />
                                    {t('common.saving')}
                                </>
                            ) : (
                                t('common.save')
                            )}
                        </Button>
                    </CardContent>
                </Card>

                {/* Diagnostic: show what the page actually got from the
                    backend. Visible only while we are stabilising the catalog
                    pipeline — flip to dev-only when this all settles. */}
                <div
                    className="rounded-md border border-dashed bg-muted/30 px-3 py-1.5 font-mono text-[11px] text-muted-foreground"
                    data-testid="catalog-debug"
                >
                    catalog: sandbox={Object.keys(catalog?.sandbox ?? {}).length}{' '}
                    mods={Object.keys(catalog?.mods ?? {}).length}{' '}
                    serverMeta={Object.keys(serverMeta).length}{' '}
                    sandboxMeta={Object.keys(sandboxMeta).length}
                </div>

                <Tabs value={activeTab} onValueChange={setActiveTab}>
                    <TabsList>
                        <TabsTrigger value="server">{t('admin.config.tab_server')}</TabsTrigger>
                        <TabsTrigger value="sandbox">{t('admin.config.tab_sandbox')}</TabsTrigger>
                        <TabsTrigger value="mods">
                            {t('admin.config.tab_mods')}
                            <span className="ml-2 rounded bg-muted-foreground/15 px-1.5 py-0.5 text-[10px] font-semibold">
                                {modGroupCount}
                            </span>
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="server">
                        <ConfigSection
                            ref={serverRef}
                            title={t('admin.config.server_settings_title')}
                            description={t('admin.config.server_settings_description')}
                            config={server_config}
                            meta={serverMeta}
                            groupOrder={SERVER_INI_CATEGORY_ORDER}
                            inferGroup={inferServerCategory}
                            search={search}
                            onSave={(settings) => saveConfig('/admin/config/server', settings)}
                            onDirtyChange={setServerDirty}
                            hideHeader
                        />
                    </TabsContent>

                    <TabsContent value="sandbox">
                        <ConfigSection
                            ref={sandboxRef}
                            title={t('admin.config.sandbox_settings_title')}
                            description={t('admin.config.sandbox_settings_description')}
                            config={flatSandbox}
                            meta={sandboxMeta}
                            groupOrder={SANDBOX_CATEGORY_ORDER}
                            inferGroup={inferSandboxCategory}
                            search={search}
                            onSave={(settings) => saveConfig('/admin/config/sandbox', settings)}
                            onDirtyChange={setSandboxDirty}
                            groupFilter={(g) => !g.startsWith('Mod: ')}
                            hideHeader
                        />
                    </TabsContent>

                    <TabsContent value="mods">
                        <ConfigSection
                            ref={modsRef}
                            title={t('admin.config.tab_mods')}
                            description={t('admin.config.mods_tab_description')}
                            config={flatSandbox}
                            meta={sandboxMeta}
                            groupOrder={modGroupOrder}
                            search={search}
                            onSave={(settings) => saveConfig('/admin/config/sandbox', settings)}
                            onDirtyChange={setModsDirty}
                            groupFilter={(g) => g.startsWith('Mod: ')}
                            hideHeader
                        />
                    </TabsContent>
                </Tabs>
            </div>

            {/* Floating save button */}
            <div
                className={`fixed bottom-6 right-6 z-50 transition-all duration-200 ${
                    totalDirty > 0
                        ? 'translate-y-0 opacity-100'
                        : 'pointer-events-none translate-y-4 opacity-0'
                }`}
            >
                <Button
                    size="lg"
                    onClick={handleFloatingSave}
                    disabled={saving}
                    className="shadow-lg"
                >
                    <Save className="mr-2 size-4" />
                    {saving ? t('common.saving') : t('admin.config.save_changes', { count: String(totalDirty) })}
                </Button>
            </div>

            {/* Import dialog */}
            <ImportConfigDialog
                open={showImportDialog}
                onOpenChange={setShowImportDialog}
                onImportComplete={() => setShowRestartDialog(true)}
            />

            {/* Restart dialog */}
            <Dialog open={showRestartDialog} onOpenChange={setShowRestartDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('admin.config.restart_dialog_title')}</DialogTitle>
                        <DialogDescription>
                            {t('admin.config.restart_dialog_description')}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="restart-countdown">{t('admin.config.restart_countdown_label')}</Label>
                            <Select value={restartCountdown} onValueChange={setRestartCountdown}>
                                <SelectTrigger id="restart-countdown">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {COUNTDOWN_OPTIONS.map((opt) => (
                                        <SelectItem key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        {restartCountdown !== '0' && (
                            <div className="grid gap-2">
                                <Label htmlFor="restart-message">{t('admin.config.restart_warning_label')}</Label>
                                <Input
                                    id="restart-message"
                                    placeholder={t('admin.config.restart_warning_placeholder')}
                                    value={restartMessage}
                                    onChange={(e) => setRestartMessage(e.target.value)}
                                    maxLength={500}
                                />
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setShowRestartDialog(false)}
                            disabled={restartLoading}
                        >
                            {t('admin.config.restart_skip')}
                        </Button>
                        <Button
                            variant={restartCountdown === '0' ? 'destructive' : 'default'}
                            onClick={handleRestart}
                            disabled={restartLoading}
                        >
                            {restartLoading
                                ? t('admin.config.restarting')
                                : restartCountdown === '0'
                                  ? t('admin.config.restart_now')
                                  : t('admin.config.schedule_restart')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </AppLayout>
    );
}
