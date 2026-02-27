import { Head, Link } from '@inertiajs/react';
import { AlertTriangle, ChevronDown, Eye, EyeOff, Save, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import AppLayout from '@/layouts/app-layout';
import {
    groupSettings,
    SANDBOX_GROUP_ORDER,
    SANDBOX_META,
    SERVER_INI_GROUP_ORDER,
    SERVER_INI_META
    
} from '@/lib/config-metadata';
import type {SettingMeta} from '@/lib/config-metadata';
import { fetchAction } from '@/lib/fetch-action';
import type { BreadcrumbItem } from '@/types';

type ConfigProps = {
    server_config: Record<string, string>;
    sandbox_config: Record<string, unknown>;
};

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Dashboard', href: '/dashboard' },
    { title: 'Config', href: '/admin/config' },
];

// ── Password field with eye toggle ──────────────────────────────────

function PasswordInput({
    id,
    value,
    onChange,
    className,
}: {
    id: string;
    value: string;
    onChange: (value: string) => void;
    className?: string;
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
            />
            <button
                type="button"
                onClick={() => setVisible(!visible)}
                className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
            >
                {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
        </div>
    );
}

// ── Smart input renderer ────────────────────────────────────────────

function SettingInput({
    settingKey,
    value,
    meta,
    isDirty,
    onChange,
}: {
    settingKey: string;
    value: string;
    meta?: SettingMeta;
    isDirty: boolean;
    onChange: (value: string) => void;
}) {
    const inputId = `cfg-${settingKey}`;
    const dirtyClass = isDirty ? 'border-blue-500' : '';

    if (!meta) {
        return (
            <Input
                id={inputId}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className={dirtyClass}
            />
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
                    <span className="text-xs text-muted-foreground">None</span>
                )}
                <Link href="/admin/mods" className="ml-1 text-xs text-blue-500 hover:underline">
                    Manage on Mods page
                </Link>
            </div>
        );
    }

    if (meta.sensitive) {
        return <PasswordInput id={inputId} value={value} onChange={onChange} className={dirtyClass} />;
    }

    if (meta.type === 'boolean') {
        return (
            <div className="flex items-center gap-2">
                <Switch
                    id={inputId}
                    checked={value === 'true'}
                    onCheckedChange={(checked) => onChange(checked ? 'true' : 'false')}
                />
                <Label htmlFor={inputId} className="cursor-pointer text-sm font-normal">
                    {value === 'true' ? 'Enabled' : 'Disabled'}
                </Label>
            </div>
        );
    }

    if (meta.type === 'enum' && meta.options) {
        return (
            <Select value={value} onValueChange={onChange}>
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
            </Select>
        );
    }

    if (meta.type === 'number') {
        return (
            <Input
                id={inputId}
                type="number"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                min={meta.min}
                max={meta.max}
                step={Number(value) % 1 !== 0 ? '0.1' : '1'}
                className={dirtyClass}
            />
        );
    }

    return (
        <Input
            id={inputId}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={dirtyClass}
        />
    );
}

// ── Config section with collapsible groups ──────────────────────────

function ConfigSection({
    title,
    description,
    config,
    meta,
    groupOrder,
    search,
    onSave,
}: {
    title: string;
    description: string;
    config: Record<string, string>;
    meta: Record<string, SettingMeta>;
    groupOrder: string[];
    search: string;
    onSave: (settings: Record<string, string>) => void;
}) {
    const [values, setValues] = useState<Record<string, string>>(config);
    const [dirty, setDirty] = useState<Set<string>>(new Set());
    const [openGroups, setOpenGroups] = useState<Set<string>>(new Set(groupOrder));

    const groups = useMemo(() => groupSettings(values, meta, groupOrder), [values, meta, groupOrder]);

    const filteredGroups = useMemo(() => {
        if (!search) return groups;
        const q = search.toLowerCase();
        return groups
            .map((g) => ({
                ...g,
                entries: g.entries.filter(
                    (e) =>
                        e.key.toLowerCase().includes(q) ||
                        (e.meta?.description ?? '').toLowerCase().includes(q),
                ),
            }))
            .filter((g) => g.entries.length > 0);
    }, [groups, search]);

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

    function handleSave() {
        const changed: Record<string, string> = {};
        dirty.forEach((key) => {
            changed[key] = values[key];
        });
        onSave(changed);
        setDirty(new Set());
    }

    function toggleGroup(group: string) {
        setOpenGroups((prev) => {
            const next = new Set(prev);
            if (next.has(group)) {
                next.delete(group);
            } else {
                next.add(group);
            }
            return next;
        });
    }

    if (Object.keys(config).length === 0) {
        return (
            <div className="rounded-lg border p-8 text-center text-muted-foreground">
                <p className="text-sm">{title} — Config file not available. The server may not have been started yet.</p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-lg font-semibold">{title}</h2>
                    <p className="text-sm text-muted-foreground">{description}</p>
                </div>
                {dirty.size > 0 && (
                    <Button onClick={handleSave} size="sm">
                        <Save className="mr-1.5 size-4" />
                        Save {dirty.size} change{dirty.size !== 1 ? 's' : ''}
                    </Button>
                )}
            </div>

            {filteredGroups.map(({ group, entries }) => (
                <Collapsible key={group} open={openGroups.has(group)} onOpenChange={() => toggleGroup(group)}>
                    <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border bg-card px-4 py-3 text-left hover:bg-accent/50 transition-colors">
                        <div className="flex items-center gap-2">
                            <span className="font-medium">{group}</span>
                            <Badge variant="secondary" className="text-xs">
                                {entries.length}
                            </Badge>
                        </div>
                        <ChevronDown
                            className={`size-4 text-muted-foreground transition-transform ${
                                openGroups.has(group) ? 'rotate-180' : ''
                            }`}
                        />
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                        <div className="mt-1 rounded-lg border bg-card p-4">
                            <div className="grid gap-5 sm:grid-cols-2">
                                {entries.map(({ key, value, meta: settingMeta }) => (
                                    <div key={key} className="space-y-1.5">
                                        <Label
                                            htmlFor={`cfg-${key}`}
                                            className="text-xs font-medium"
                                        >
                                            {key}
                                        </Label>
                                        <SettingInput
                                            settingKey={key}
                                            value={value}
                                            meta={settingMeta}
                                            isDirty={dirty.has(key)}
                                            onChange={(v) => handleChange(key, v)}
                                        />
                                        {settingMeta?.description && (
                                            <p className="text-xs text-muted-foreground">
                                                {settingMeta.description}
                                            </p>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </CollapsibleContent>
                </Collapsible>
            ))}

            {filteredGroups.length === 0 && search && (
                <p className="py-4 text-center text-sm text-muted-foreground">
                    No settings match &quot;{search}&quot; in {title.toLowerCase()}.
                </p>
            )}
        </div>
    );
}

// ── Main config page ────────────────────────────────────────────────

export default function Config({ server_config, sandbox_config }: ConfigProps) {
    const [restartBanner, setRestartBanner] = useState(false);
    const [saving, setSaving] = useState(false);
    const [search, setSearch] = useState('');

    async function saveConfig(url: string, settings: Record<string, string>) {
        setSaving(true);
        const result = await fetchAction(url, {
            method: 'PATCH',
            data: { settings },
            successMessage: 'Configuration saved',
        });
        if (result?.restart_required) {
            setRestartBanner(true);
        }
        setSaving(false);
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
            <Head title="Server Config" />
            <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Server Configuration</h1>
                        <p className="text-muted-foreground">
                            Edit server.ini and SandboxVars.lua settings
                        </p>
                    </div>
                    <div className="relative w-full sm:w-72">
                        <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            placeholder="Search settings..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="pl-9"
                        />
                    </div>
                </div>

                {restartBanner && (
                    <Alert variant="destructive">
                        <AlertTriangle className="size-4" />
                        <AlertDescription>
                            Config changes saved. A server restart is required for changes to take effect.
                        </AlertDescription>
                    </Alert>
                )}

                <ConfigSection
                    title="Server Settings"
                    description="server.ini — General server configuration"
                    config={server_config}
                    meta={SERVER_INI_META}
                    groupOrder={SERVER_INI_GROUP_ORDER}
                    search={search}
                    onSave={(settings) => saveConfig('/admin/config/server', settings)}
                />

                <ConfigSection
                    title="Sandbox Settings"
                    description="SandboxVars.lua — Gameplay and world settings"
                    config={flatSandbox}
                    meta={SANDBOX_META}
                    groupOrder={SANDBOX_GROUP_ORDER}
                    search={search}
                    onSave={(settings) => saveConfig('/admin/config/sandbox', settings)}
                />
            </div>
        </AppLayout>
    );
}
