import { Deferred, Head, router, usePoll } from '@inertiajs/react';
import {
    Archive,
    Circle,
    HardDrive,
    Map,
    Play,
    RefreshCw,
    Save,
    ScrollText,
    Square,
    Users,
    Zap,
} from 'lucide-react';
import { useState } from 'react';
import { ActivityFeed } from '@/components/activity-feed';
import { GameStateWidget } from '@/components/game-state-widget';
import { Leaderboard } from '@/components/leaderboard';
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import AppLayout from '@/layouts/app-layout';
import { fetchAction } from '@/lib/fetch-action';
import { dashboard } from '@/routes';
import type { BreadcrumbItem, DashboardData } from '@/types';

const breadcrumbs: BreadcrumbItem[] = [
    {
        title: 'Dashboard',
        href: dashboard().url,
    },
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

export default function Dashboard({
    server,
    game_state,
    recent_audit,
    backup_summary,
    leaderboard,
    game_events,
}: DashboardData) {
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [showRestartDialog, setShowRestartDialog] = useState(false);
    const [restartCountdown, setRestartCountdown] = useState('0');
    const [restartMessage, setRestartMessage] = useState('');
    const [restartLoading, setRestartLoading] = useState(false);
    const [showStopDialog, setShowStopDialog] = useState(false);
    const [stopCountdown, setStopCountdown] = useState('0');
    const [stopMessage, setStopMessage] = useState('');
    const [stopLoading, setStopLoading] = useState(false);

    usePoll(5000, { only: ['server', 'game_state'] });

    async function serverAction(action: string) {
        setActionLoading(action);
        await fetchAction(`/admin/server/${action}`);
        setActionLoading(null);
        setTimeout(() => router.reload({ only: ['server'] }), 2000);
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
        await fetchAction('/admin/server/restart', { data: Object.keys(data).length > 0 ? data : undefined });
        setRestartLoading(false);
        setShowRestartDialog(false);
        setRestartCountdown('0');
        setRestartMessage('');
        setTimeout(() => router.reload({ only: ['server'] }), 2000);
    }

    async function handleStop() {
        setStopLoading(true);
        const countdown = parseInt(stopCountdown, 10);
        const data: Record<string, unknown> = {};
        if (countdown > 0) {
            data.countdown = countdown;
            if (stopMessage.trim()) {
                data.message = stopMessage.trim();
            }
        }
        await fetchAction('/admin/server/stop', { data: Object.keys(data).length > 0 ? data : undefined });
        setStopLoading(false);
        setShowStopDialog(false);
        setStopCountdown('0');
        setStopMessage('');
        setTimeout(() => router.reload({ only: ['server'] }), 2000);
    }

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="Dashboard" />
            <div className="flex h-full flex-1 flex-col gap-6 overflow-x-auto p-4 lg:p-6">
                {/* Server Status Banner */}
                <div className="flex flex-col gap-3 rounded-lg border border-border/50 bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                        <Circle
                            className={`size-4 fill-current ${server.online ? 'text-green-500' : 'text-red-500'}`}
                        />
                        <div>
                            <span className="font-semibold">
                                Server {server.online ? 'Online' : 'Offline'}
                            </span>
                            {server.online && server.uptime && (
                                <span className="ml-2 text-sm text-muted-foreground">
                                    Uptime: {server.uptime}
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {server.online ? (
                            <>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={actionLoading !== null}
                                    onClick={() => serverAction('save')}
                                >
                                    <Save className="mr-1.5 size-3.5" />
                                    Save
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={actionLoading !== null}
                                    onClick={() => setShowRestartDialog(true)}
                                >
                                    <RefreshCw className="mr-1.5 size-3.5" />
                                    Restart
                                </Button>
                                <Button
                                    variant="destructive"
                                    size="sm"
                                    disabled={actionLoading !== null}
                                    onClick={() => setShowStopDialog(true)}
                                >
                                    <Square className="mr-1.5 size-3.5" />
                                    Stop
                                </Button>
                            </>
                        ) : (
                            <Button
                                size="sm"
                                disabled={actionLoading !== null}
                                onClick={() => serverAction('start')}
                            >
                                <Play className="mr-1.5 size-3.5" />
                                Start
                            </Button>
                        )}
                    </div>
                </div>

                {/* Game State Widget */}
                {server.online && <GameStateWidget gameState={game_state} />}

                {/* Stats Cards */}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">Players Online</CardTitle>
                            <Users className="size-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">
                                {server.player_count}
                                {server.max_players !== null && (
                                    <span className="text-base font-normal text-muted-foreground">
                                        /{server.max_players}
                                    </span>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">Map</CardTitle>
                            <Map className="size-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="truncate text-2xl font-bold">{server.map || 'N/A'}</div>
                        </CardContent>
                    </Card>

                    <Deferred data="backup_summary" fallback={
                        <>
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between pb-2">
                                    <CardTitle className="text-sm font-medium text-muted-foreground">Backups</CardTitle>
                                    <Archive className="size-4 text-muted-foreground" />
                                </CardHeader>
                                <CardContent>
                                    <Skeleton className="h-8 w-12" />
                                    <Skeleton className="mt-1 h-3 w-20" />
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between pb-2">
                                    <CardTitle className="text-sm font-medium text-muted-foreground">Last Backup</CardTitle>
                                    <HardDrive className="size-4 text-muted-foreground" />
                                </CardHeader>
                                <CardContent>
                                    <Skeleton className="h-8 w-24" />
                                </CardContent>
                            </Card>
                        </>
                    }>
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between pb-2">
                                <CardTitle className="text-sm font-medium text-muted-foreground">Backups</CardTitle>
                                <Archive className="size-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{backup_summary?.total_count}</div>
                                <p className="text-xs text-muted-foreground">{backup_summary?.total_size_human} total</p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between pb-2">
                                <CardTitle className="text-sm font-medium text-muted-foreground">Last Backup</CardTitle>
                                <HardDrive className="size-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="truncate text-2xl font-bold">
                                    {backup_summary?.last_backup
                                        ? new Date(backup_summary.last_backup.created_at).toLocaleDateString()
                                        : 'Never'}
                                </div>
                                {backup_summary?.last_backup && (
                                    <p className="text-xs text-muted-foreground">
                                        {backup_summary.last_backup.size_human} ({backup_summary.last_backup.type})
                                    </p>
                                )}
                            </CardContent>
                        </Card>
                    </Deferred>
                </div>

                <div className="grid gap-6 lg:grid-cols-2">
                    {/* Online Players */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Users className="size-5" />
                                Online Players
                            </CardTitle>
                            <CardDescription>
                                {server.player_count} connected
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {server.players.length > 0 ? (
                                <div className="space-y-2">
                                    {server.players.map((player) => (
                                        <div
                                            key={player}
                                            className="flex items-center gap-2 rounded-md border border-border/50 px-3 py-2"
                                        >
                                            <Circle className="size-2 fill-green-500 text-green-500" />
                                            <span className="text-sm font-medium">{player}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-sm text-muted-foreground">
                                    {server.online ? 'No players online' : 'Server is offline'}
                                </p>
                            )}
                        </CardContent>
                    </Card>

                    {/* Recent Activity */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <ScrollText className="size-5" />
                                Recent Activity
                            </CardTitle>
                            <CardDescription>Latest admin actions</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Deferred data="recent_audit" fallback={
                                <div className="space-y-3">
                                    {Array.from({ length: 5 }).map((_, i) => (
                                        <div key={i} className="flex items-start gap-2">
                                            <Skeleton className="h-5 w-24 shrink-0" />
                                            <div className="flex-1 space-y-1">
                                                <Skeleton className="h-4 w-32" />
                                                <Skeleton className="h-3 w-48" />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            }>
                                {recent_audit?.length > 0 ? (
                                    <div className="space-y-3">
                                        {recent_audit.map((entry) => (
                                            <div key={entry.id} className="flex items-start justify-between gap-2">
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <Badge variant="outline" className="shrink-0 text-xs">
                                                            {entry.action}
                                                        </Badge>
                                                        {entry.target && (
                                                            <span className="truncate text-sm text-muted-foreground">
                                                                {entry.target}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="mt-0.5 text-xs text-muted-foreground">
                                                        {entry.actor}
                                                        {entry.created_at && (
                                                            <> &middot; {new Date(entry.created_at).toLocaleString()}</>
                                                        )}
                                                    </p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-sm text-muted-foreground">No recent activity</p>
                                )}
                            </Deferred>
                        </CardContent>
                    </Card>
                </div>

                {/* Leaderboard */}
                <Deferred data="leaderboard" fallback={
                    <Card>
                        <CardHeader>
                            <Skeleton className="h-6 w-32" />
                            <Skeleton className="mt-1 h-4 w-40" />
                        </CardHeader>
                        <CardContent>
                            <div className="grid gap-6 sm:grid-cols-2">
                                {Array.from({ length: 2 }).map((_, col) => (
                                    <div key={col} className="space-y-2">
                                        <Skeleton className="h-4 w-28" />
                                        {Array.from({ length: 5 }).map((_, i) => (
                                            <Skeleton key={i} className="h-6 w-full" />
                                        ))}
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                }>
                    <Leaderboard data={leaderboard} />
                </Deferred>

                {/* Game Events */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Zap className="size-5" />
                            Game Events
                        </CardTitle>
                        <CardDescription>Deaths, PvP, crafting, and connections</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Deferred data="game_events" fallback={
                            <div className="space-y-2">
                                {Array.from({ length: 5 }).map((_, i) => (
                                    <div key={i} className="flex items-start gap-2.5">
                                        <Skeleton className="mt-0.5 size-4 shrink-0 rounded" />
                                        <div className="flex-1 space-y-1">
                                            <Skeleton className="h-4 w-48" />
                                            <Skeleton className="h-3 w-16" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        }>
                            <ActivityFeed events={game_events ?? []} />
                        </Deferred>
                    </CardContent>
                </Card>
            </div>

            <Dialog open={showRestartDialog} onOpenChange={setShowRestartDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Restart Server</DialogTitle>
                        <DialogDescription>
                            Choose a delay to warn players before restarting, or restart immediately.
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
                                    placeholder="Server restarting for maintenance..."
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
                            Cancel
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

            <Dialog open={showStopDialog} onOpenChange={setShowStopDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Stop Server</DialogTitle>
                        <DialogDescription>
                            Choose a delay to warn players before shutting down, or stop immediately.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="stop-countdown">Countdown</Label>
                            <Select value={stopCountdown} onValueChange={setStopCountdown}>
                                <SelectTrigger id="stop-countdown">
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
                        {stopCountdown !== '0' && (
                            <div className="grid gap-2">
                                <Label htmlFor="stop-message">Warning message (optional)</Label>
                                <Input
                                    id="stop-message"
                                    placeholder="Server shutting down for maintenance..."
                                    value={stopMessage}
                                    onChange={(e) => setStopMessage(e.target.value)}
                                    maxLength={500}
                                />
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setShowStopDialog(false)}
                            disabled={stopLoading}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={handleStop}
                            disabled={stopLoading}
                        >
                            {stopLoading
                                ? 'Stopping...'
                                : stopCountdown === '0'
                                  ? 'Stop Now'
                                  : 'Schedule Shutdown'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </AppLayout>
    );
}
