import { Head, router } from '@inertiajs/react';
import { Bell, Send } from 'lucide-react';
import { useState } from 'react';
import { fetchAction } from '@/lib/fetch-action';
import { useTranslation } from '@/hooks/use-translation';
import AppLayout from '@/layouts/app-layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import type { BreadcrumbItem } from '@/types';

type Settings = {
    has_webhook_url: boolean;
    webhook_url_masked: string | null;
    enabled: boolean;
    enabled_events: string[];
};

type EventConfig = {
    label: string;
    default: boolean;
    group: string;
};

type Props = {
    settings: Settings;
    available_events: Record<string, EventConfig>;
};

export default function DiscordWebhook({ settings, available_events }: Props) {
    const { t } = useTranslation();
    const breadcrumbs: BreadcrumbItem[] = [
        { title: t('nav.dashboard'), href: '/dashboard' },
        { title: t('admin.discord.title'), href: '/admin/discord' },
    ];
    const [webhookUrl, setWebhookUrl] = useState('');
    const [showUrlInput, setShowUrlInput] = useState(!settings.has_webhook_url);
    const [enabled, setEnabled] = useState(settings.enabled);
    const [enabledEvents, setEnabledEvents] = useState<string[]>(settings.enabled_events);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);

    const allEventKeys = Object.keys(available_events);
    const allSelected = allEventKeys.length === enabledEvents.length;

    // Group events by their group
    const groupedEvents: Record<string, [string, EventConfig][]> = {};
    for (const [key, config] of Object.entries(available_events)) {
        if (!groupedEvents[config.group]) {
            groupedEvents[config.group] = [];
        }
        groupedEvents[config.group].push([key, config]);
    }

    function toggleEvent(eventKey: string, checked: boolean) {
        setEnabledEvents((prev) =>
            checked ? [...prev, eventKey] : prev.filter((e) => e !== eventKey),
        );
    }

    function selectAll() {
        setEnabledEvents(allEventKeys);
    }

    function deselectAll() {
        setEnabledEvents([]);
    }

    async function save() {
        setSaving(true);
        const data: Record<string, unknown> = {
            enabled,
            enabled_events: enabledEvents,
        };

        if (showUrlInput && webhookUrl) {
            data.webhook_url = webhookUrl;
        } else if (showUrlInput && !webhookUrl && settings.has_webhook_url) {
            // User cleared the URL
            data.webhook_url = null;
        }

        await fetchAction('/admin/discord', {
            method: 'PATCH',
            data,
            successMessage: t('admin.discord.toast_settings_saved'),
        });
        setSaving(false);
        router.reload();
    }

    async function sendTest() {
        setTesting(true);
        const result = await fetchAction('/admin/discord/test', {
            successMessage: t('admin.discord.toast_test_sent'),
        });
        setTesting(false);
        if (result && !result.success) {
            // Error toast is already shown by fetchAction
        }
    }

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title={t('admin.discord.title')} />
            <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">{t('admin.discord.title')}</h1>
                    <p className="text-muted-foreground">
                        {t('admin.discord.description')}
                    </p>
                </div>

                {/* Settings Card */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Bell className="size-5" />
                            {t('admin.discord.settings_title')}
                        </CardTitle>
                        <CardDescription>
                            {t('admin.discord.settings_description')}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {/* Webhook URL */}
                        <div className="space-y-2">
                            <Label htmlFor="webhook-url">{t('admin.discord.webhook_url_label')}</Label>
                            {settings.has_webhook_url && !showUrlInput ? (
                                <div className="flex items-center gap-2">
                                    <Input
                                        value={settings.webhook_url_masked ?? ''}
                                        disabled
                                        className="font-mono"
                                    />
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setShowUrlInput(true)}
                                    >
                                        {t('admin.discord.change_url')}
                                    </Button>
                                </div>
                            ) : (
                                <Input
                                    id="webhook-url"
                                    type="url"
                                    value={webhookUrl}
                                    onChange={(e) => setWebhookUrl(e.target.value)}
                                    placeholder="https://discord.com/api/webhooks/..."
                                />
                            )}
                        </div>

                        <Separator />

                        {/* Enable/Disable */}
                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <Label htmlFor="webhook-enabled">{t('admin.discord.enable_label')}</Label>
                                <p className="text-sm text-muted-foreground">
                                    {t('admin.discord.enable_description')}
                                </p>
                            </div>
                            <Switch
                                id="webhook-enabled"
                                checked={enabled}
                                onCheckedChange={setEnabled}
                            />
                        </div>

                        <Separator />

                        {/* Actions */}
                        <div className="flex items-center gap-2">
                            <Button onClick={save} disabled={saving}>
                                {saving ? t('common.saving') : t('admin.discord.save_settings')}
                            </Button>
                            {settings.has_webhook_url && (
                                <Button
                                    variant="outline"
                                    onClick={sendTest}
                                    disabled={testing}
                                >
                                    <Send className="mr-1.5 size-4" />
                                    {testing ? t('admin.discord.sending') : t('admin.discord.send_test')}
                                </Button>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* Event Selection Card */}
                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle>{t('admin.discord.events_title')}</CardTitle>
                                <CardDescription>
                                    {t('admin.discord.events_description')}
                                </CardDescription>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button variant="outline" size="sm" onClick={selectAll} disabled={allSelected}>
                                    {t('admin.discord.select_all')}
                                </Button>
                                <Button variant="outline" size="sm" onClick={deselectAll} disabled={enabledEvents.length === 0}>
                                    {t('admin.discord.deselect_all')}
                                </Button>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        {Object.entries(groupedEvents).map(([group, events]) => (
                            <div key={group}>
                                <h3 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
                                    {group}
                                </h3>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    {events.map(([key, config]) => (
                                        <label
                                            key={key}
                                            className="flex items-center gap-3 rounded-lg border border-border/50 px-4 py-3 cursor-pointer hover:bg-accent/50 transition-colors"
                                        >
                                            <Checkbox
                                                checked={enabledEvents.includes(key)}
                                                onCheckedChange={(checked) => toggleEvent(key, checked === true)}
                                            />
                                            <span className="text-sm font-medium">{config.label}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            </div>
        </AppLayout>
    );
}
