import { Head } from '@inertiajs/react';
import { AlertTriangle, Save } from 'lucide-react';
import { useState } from 'react';
import AppLayout from '@/layouts/app-layout';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { BreadcrumbItem } from '@/types';

type ConfigProps = {
    server_config: Record<string, string>;
    sandbox_config: Record<string, unknown>;
};

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Dashboard', href: '/dashboard' },
    { title: 'Config', href: '/admin/config' },
];

function ConfigSection({
    title,
    description,
    config,
    onSave,
}: {
    title: string;
    description: string;
    config: Record<string, string>;
    onSave: (settings: Record<string, string>) => void;
}) {
    const [values, setValues] = useState<Record<string, string>>(config);
    const [dirty, setDirty] = useState<Set<string>>(new Set());

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

    const entries = Object.entries(values);

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <div>
                    <CardTitle>{title}</CardTitle>
                    <CardDescription>{description}</CardDescription>
                </div>
                {dirty.size > 0 && (
                    <Button onClick={handleSave}>
                        <Save className="mr-1.5 size-4" />
                        Save {dirty.size} change{dirty.size !== 1 ? 's' : ''}
                    </Button>
                )}
            </CardHeader>
            <CardContent>
                {entries.length > 0 ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                        {entries.map(([key, value]) => (
                            <div key={key} className="space-y-1.5">
                                <Label htmlFor={`cfg-${key}`} className="text-xs font-medium text-muted-foreground">
                                    {key}
                                </Label>
                                <Input
                                    id={`cfg-${key}`}
                                    value={value}
                                    onChange={(e) => handleChange(key, e.target.value)}
                                    className={dirty.has(key) ? 'border-blue-500' : ''}
                                />
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="py-8 text-center text-muted-foreground">
                        Config file not available. The server may not have been started yet.
                    </p>
                )}
            </CardContent>
        </Card>
    );
}

export default function Config({ server_config, sandbox_config }: ConfigProps) {
    const [restartBanner, setRestartBanner] = useState(false);
    const [saving, setSaving] = useState(false);

    const csrfToken = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '';

    function saveConfig(url: string, settings: Record<string, string>) {
        setSaving(true);
        fetch(url, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-TOKEN': csrfToken,
            },
            body: JSON.stringify({ settings }),
        })
            .then((r) => r.json())
            .then((data) => {
                if (data.restart_required) {
                    setRestartBanner(true);
                }
            })
            .finally(() => setSaving(false));
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
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Server Configuration</h1>
                    <p className="text-muted-foreground">
                        Edit server.ini and SandboxVars.lua settings
                    </p>
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
                    onSave={(settings) => saveConfig('/admin/config/server', settings)}
                />

                <ConfigSection
                    title="Sandbox Settings"
                    description="SandboxVars.lua — Gameplay and world settings"
                    config={flatSandbox}
                    onSave={(settings) => saveConfig('/admin/config/sandbox', settings)}
                />
            </div>
        </AppLayout>
    );
}
