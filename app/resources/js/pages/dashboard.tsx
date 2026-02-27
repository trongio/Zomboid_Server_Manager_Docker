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
} from 'lucide-react';
import { useState } from 'react';
import AppLayout from '@/layouts/app-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { GameStateWidget } from '@/components/game-state-widget';
import { fetchAction } from '@/lib/fetch-action';
import type { BreadcrumbItem, DashboardData } from '@/types';
import { dashboard } from '@/routes';

const breadcrumbs: BreadcrumbItem[] = [
    {
        title: 'Dashboard',
        href: dashboard().url,
    },
];

export default function Dashboard({
    server,
    game_state,
    recent_audit,
    backup_summary,
}: DashboardData) {
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    usePoll(5000, { only: ['server', 'game_state'] });

    async function serverAction(action: string) {
        setActionLoading(action);
        await fetchAction(`/admin/server/${action}`);
        setActionLoading(null);
        setTimeout(() => router.reload({ only: ['server'] }), 2000);
    }

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="Dashboard" />
            <div className="flex h-full flex-1 flex-col gap-6 overflow-x-auto p-4 lg:p-6">
                {/* Server Status Banner */}
                <div className="flex items-center justify-between rounded-lg border border-border/50 bg-card p-4">
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
                    <div className="flex items-center gap-2">
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
                                    onClick={() => serverAction('restart')}
                                >
                                    <RefreshCw className="mr-1.5 size-3.5" />
                                    Restart
                                </Button>
                                <Button
                                    variant="destructive"
                                    size="sm"
                                    disabled={actionLoading !== null}
                                    onClick={() => serverAction('stop')}
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
            </div>
        </AppLayout>
    );
}
