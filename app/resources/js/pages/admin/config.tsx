import { Head, Link, router } from '@inertiajs/react';
import { ChevronDown, Download, Eye, EyeOff, Loader2, Save, Search, Timer, Upload } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
import AppLayout from '@/layouts/app-layout';
import {
    groupSettings,
    SANDBOX_GROUP_ORDER,
    SANDBOX_META,
    SERVER_INI_GROUP_ORDER,
    SERVER_INI_META
    
} from '@/lib/config-metadata';
import type {SettingMeta} from '@/lib/config-metadata';
import { ImportConfigDialog } from '@/components/import-config-dialog';
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
};

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Dashboard', href: '/dashboard' },
    { title: 'Config', href: '/admin/config' },
];

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
};

const ConfigSection = forwardRef<ConfigSectionHandle, ConfigSectionProps>(function ConfigSection(
    { title, description, config, meta, groupOrder, search, onSave, onDirtyChange },
    ref,
) {
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
            <div>
                <h2 className="text-lg font-semibold">{title}</h2>
                <p className="text-sm text-muted-foreground">{description}</p>
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
});

// ── Main config page ────────────────────────────────────────────────

export default function Config({ server_config, sandbox_config, respawn_delay }: ConfigProps) {
    const [saving, setSaving] = useState(false);
    const [search, setSearch] = useState('');
    const [serverDirty, setServerDirty] = useState(0);
    const [sandboxDirty, setSandboxDirty] = useState(0);

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

    const totalDirty = serverDirty + sandboxDirty;

    async function saveConfig(url: string, settings: Record<string, string>): Promise<boolean> {
        setSaving(true);
        const result = await fetchAction(url, {
            method: 'PATCH',
            data: { settings },
            successMessage: 'Configuration saved',
        });
        setSaving(false);
        return result !== null;
    }

    async function handleFloatingSave() {
        const results = await Promise.all([
            serverRef.current?.save() ?? Promise.resolve(true),
            sandboxRef.current?.save() ?? Promise.resolve(true),
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
            successMessage: 'Respawn delay settings saved',
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
            <Head title="Server Config" />
            <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Server Configuration</h1>
                        <p className="text-muted-foreground">
                            Edit server.ini and SandboxVars.lua settings
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
                            Import
                        </Button>
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
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Timer className="size-5" />
                            Custom Rules
                        </CardTitle>
                        <CardDescription>
                            Server-side rules enforced by the ZomboidManager Lua mod
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                                <Label htmlFor="respawn-enabled" className="text-sm font-medium">
                                    Respawn Delay
                                </Label>
                                <p className="text-xs text-muted-foreground">
                                    Prevent players from immediately creating a new character after death
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
                                <Label htmlFor="respawn-minutes">Cooldown (minutes)</Label>
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
                                    No server restart required — changes apply within 60 seconds
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
                                    Saving...
                                </>
                            ) : (
                                'Save'
                            )}
                        </Button>
                    </CardContent>
                </Card>

                <ConfigSection
                    ref={serverRef}
                    title="Server Settings"
                    description="server.ini — General server configuration"
                    config={server_config}
                    meta={SERVER_INI_META}
                    groupOrder={SERVER_INI_GROUP_ORDER}
                    search={search}
                    onSave={(settings) => saveConfig('/admin/config/server', settings)}
                    onDirtyChange={setServerDirty}
                />

                <ConfigSection
                    ref={sandboxRef}
                    title="Sandbox Settings"
                    description="SandboxVars.lua — Gameplay and world settings"
                    config={flatSandbox}
                    meta={SANDBOX_META}
                    groupOrder={SANDBOX_GROUP_ORDER}
                    search={search}
                    onSave={(settings) => saveConfig('/admin/config/sandbox', settings)}
                    onDirtyChange={setSandboxDirty}
                />
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
                    {saving ? 'Saving...' : `Save ${totalDirty} change${totalDirty !== 1 ? 's' : ''}`}
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
                        <DialogTitle>Restart Server</DialogTitle>
                        <DialogDescription>
                            Config saved. Restart the server for changes to take effect, or skip if you want to restart later.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="restart-countdown">Countdown</Label>
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
                                <Label htmlFor="restart-message">Warning message (optional)</Label>
                                <Input
                                    id="restart-message"
                                    placeholder="Server restarting for config changes..."
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
                            Skip
                        </Button>
                        <Button
                            variant={restartCountdown === '0' ? 'destructive' : 'default'}
                            onClick={handleRestart}
                            disabled={restartLoading}
                        >
                            {restartLoading
                                ? 'Restarting...'
                                : restartCountdown === '0'
                                  ? 'Restart Now'
                                  : 'Schedule Restart'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </AppLayout>
    );
}
