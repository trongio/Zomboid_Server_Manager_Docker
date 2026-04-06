import { Head, router } from '@inertiajs/react';
import { Clock, Plus, Timer, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { fetchAction } from '@/lib/fetch-action';
import AppLayout from '@/layouts/app-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { useTranslation } from '@/hooks/use-translation';
import type { BreadcrumbItem } from '@/types';

type ScheduleEntry = {
    id: number;
    time: string;
    enabled: boolean;
};

type Settings = {
    enabled: boolean;
    warning_minutes: number;
    warning_message: string | null;
    timezone: string;
    discord_reminder_minutes: number;
};

type Props = {
    settings: Settings;
    schedule: ScheduleEntry[];
    next_restart_at: string | null;
};

const WARNING_OPTIONS = [
    { value: '2', label: '2 minutes' },
    { value: '5', label: '5 minutes' },
    { value: '10', label: '10 minutes' },
    { value: '15', label: '15 minutes' },
    { value: '30', label: '30 minutes' },
] as const;

const DISCORD_REMINDER_OPTIONS = [
    { value: '5', label: '5 minutes' },
    { value: '10', label: '10 minutes' },
    { value: '15', label: '15 minutes' },
    { value: '30', label: '30 minutes' },
    { value: '60', label: '60 minutes' },
] as const;

const TIMEZONE_OPTIONS = [
    'Asia/Tbilisi',
    'Europe/Moscow',
    'Europe/London',
    'Europe/Berlin',
    'Europe/Paris',
    'America/New_York',
    'America/Chicago',
    'America/Los_Angeles',
    'Asia/Tokyo',
    'Australia/Sydney',
    'UTC',
] as const;

export default function AutoRestart({ settings, schedule, next_restart_at }: Props) {
    const { t } = useTranslation();
    const breadcrumbs: BreadcrumbItem[] = [
        { title: t('nav.dashboard'), href: '/dashboard' },
        { title: t('admin.auto_restart.title'), href: '/admin/auto-restart' },
    ];
    const [enabled, setEnabled] = useState(settings.enabled);
    const [warningMinutes, setWarningMinutes] = useState(String(settings.warning_minutes));
    const [warningMessage, setWarningMessage] = useState(settings.warning_message ?? '');
    const [timezone, setTimezone] = useState(settings.timezone);
    const [discordReminderMinutes, setDiscordReminderMinutes] = useState(String(settings.discord_reminder_minutes));
    const [saving, setSaving] = useState(false);
    const [newTime, setNewTime] = useState('');
    const [addingTime, setAddingTime] = useState(false);

    async function save() {
        setSaving(true);
        await fetchAction('/admin/auto-restart', {
            method: 'PATCH',
            data: {
                enabled,
                warning_minutes: parseInt(warningMinutes, 10),
                warning_message: warningMessage.trim() || null,
                timezone,
                discord_reminder_minutes: parseInt(discordReminderMinutes, 10),
            },
            successMessage: t('admin.auto_restart.toast_settings_saved'),
        });
        setSaving(false);
        router.reload();
    }

    async function addTime() {
        if (!newTime) return;
        setAddingTime(true);
        const result = await fetchAction('/admin/auto-restart/times', {
            method: 'POST',
            data: { time: newTime },
            successMessage: t('admin.auto_restart.toast_time_added'),
        });
        setAddingTime(false);
        if (result) {
            setNewTime('');
            router.reload();
        }
    }

    async function deleteTime(id: number) {
        await fetchAction(`/admin/auto-restart/times/${id}`, {
            method: 'DELETE',
            successMessage: t('admin.auto_restart.toast_time_removed'),
        });
        router.reload();
    }

    async function toggleTime(id: number) {
        await fetchAction(`/admin/auto-restart/times/${id}/toggle`, {
            method: 'POST',
            successMessage: t('admin.auto_restart.toast_time_toggled'),
        });
        router.reload();
    }

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title={t('admin.auto_restart.title')} />
            <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">{t('admin.auto_restart.title')}</h1>
                    <p className="text-muted-foreground">
                        {t('admin.auto_restart.description')}
                    </p>
                </div>

                {/* Settings Card */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Timer className="size-5" />
                            {t('admin.auto_restart.settings_title')}
                        </CardTitle>
                        <CardDescription>
                            {t('admin.auto_restart.settings_description')}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {/* Enable/Disable */}
                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <Label htmlFor="auto-restart-enabled">{t('admin.auto_restart.enable_label')}</Label>
                                <p className="text-sm text-muted-foreground">
                                    {t('admin.auto_restart.enable_description')}
                                </p>
                            </div>
                            <Switch
                                id="auto-restart-enabled"
                                checked={enabled}
                                onCheckedChange={setEnabled}
                            />
                        </div>

                        <Separator />

                        {/* Timezone */}
                        <div className="grid gap-2">
                            <Label htmlFor="timezone">{t('admin.auto_restart.timezone_label')}</Label>
                            <p className="text-sm text-muted-foreground">
                                {t('admin.auto_restart.timezone_description')}
                            </p>
                            <Select value={timezone} onValueChange={setTimezone}>
                                <SelectTrigger id="timezone">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {TIMEZONE_OPTIONS.map((tz) => (
                                        <SelectItem key={tz} value={tz}>
                                            {tz}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Warning Minutes */}
                        <div className="grid gap-2">
                            <Label htmlFor="warning">{t('admin.auto_restart.warning_time_label')}</Label>
                            <p className="text-sm text-muted-foreground">
                                {t('admin.auto_restart.warning_time_description')}
                            </p>
                            <Select value={warningMinutes} onValueChange={setWarningMinutes}>
                                <SelectTrigger id="warning">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {WARNING_OPTIONS.map((opt) => (
                                        <SelectItem key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Discord Reminder Minutes */}
                        <div className="grid gap-2">
                            <Label htmlFor="discord-reminder">{t('admin.auto_restart.discord_reminder_label')}</Label>
                            <p className="text-sm text-muted-foreground">
                                {t('admin.auto_restart.discord_reminder_description')}
                            </p>
                            <Select value={discordReminderMinutes} onValueChange={setDiscordReminderMinutes}>
                                <SelectTrigger id="discord-reminder">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {DISCORD_REMINDER_OPTIONS.map((opt) => (
                                        <SelectItem key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Warning Message */}
                        <div className="grid gap-2">
                            <Label htmlFor="warning-message">{t('admin.auto_restart.warning_message_label')}</Label>
                            <Input
                                id="warning-message"
                                value={warningMessage}
                                onChange={(e) => setWarningMessage(e.target.value)}
                                placeholder={t('admin.auto_restart.warning_message_placeholder')}
                                maxLength={500}
                            />
                            <p className="text-sm text-muted-foreground">
                                {t('admin.auto_restart.warning_message_description')}
                            </p>
                        </div>

                        <Separator />

                        <Button onClick={save} disabled={saving}>
                            {saving ? t('common.saving') : t('admin.auto_restart.save_settings')}
                        </Button>
                    </CardContent>
                </Card>

                {/* Schedule Card */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Clock className="size-5" />
                            {t('admin.auto_restart.schedule_title')}
                        </CardTitle>
                        <CardDescription>
                            {t('admin.auto_restart.schedule_description', { timezone: settings.timezone })}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {/* Existing times */}
                        {schedule.length > 0 ? (
                            <div className="space-y-2">
                                {schedule.map((entry) => (
                                    <div
                                        key={entry.id}
                                        className="flex items-center justify-between rounded-md border border-border px-4 py-3"
                                    >
                                        <div className="flex items-center gap-3">
                                            <span className="font-mono text-lg font-semibold">
                                                {entry.time}
                                            </span>
                                            {!entry.enabled && (
                                                <Badge variant="secondary">{t('common.disabled')}</Badge>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Switch
                                                checked={entry.enabled}
                                                onCheckedChange={() => toggleTime(entry.id)}
                                            />
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => deleteTime(entry.id)}
                                            >
                                                <Trash2 className="size-4 text-destructive" />
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-sm text-muted-foreground">
                                {t('admin.auto_restart.no_times')}
                            </p>
                        )}

                        <Separator />

                        {/* Add new time */}
                        <div className="flex items-end gap-3">
                            <div className="grid gap-2">
                                <Label htmlFor="new-time">{t('admin.auto_restart.add_time_label')}</Label>
                                <Input
                                    id="new-time"
                                    type="time"
                                    value={newTime}
                                    onChange={(e) => setNewTime(e.target.value)}
                                    disabled={schedule.length >= 5}
                                />
                            </div>
                            <Button
                                onClick={addTime}
                                disabled={!newTime || addingTime || schedule.length >= 5}
                            >
                                <Plus className="mr-1.5 size-4" />
                                {addingTime ? t('admin.auto_restart.adding') : t('common.add')}
                            </Button>
                        </div>

                        <p className="text-sm text-muted-foreground">
                            {t('admin.auto_restart.slots_used', { count: String(schedule.length) })}
                        </p>

                        {/* Next Restart Info */}
                        {next_restart_at && (
                            <div className="rounded-md border border-border bg-muted/50 p-3 text-sm">
                                {t('admin.auto_restart.next_restart')}{' '}
                                <span className="font-semibold">
                                    {new Date(next_restart_at).toLocaleString()}
                                </span>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </AppLayout>
    );
}
