import { Head, router, usePoll } from '@inertiajs/react';
import { AlertTriangle, Circle, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import PlayerActionDialogs from '@/components/player-action-dialogs';
import PzMap from '@/components/pz-map';
import { useTranslation } from '@/hooks/use-translation';
import type { ZoneOverlay } from '@/components/pz-map';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import AppLayout from '@/layouts/app-layout';
import type { BreadcrumbItem } from '@/types';
import type { MapConfig, PlayerMarker } from '@/types/server';

type TileProgress = {
    generating: boolean;
    completed: number;
    total: number;
    percent: number;
};

type SafeZone = {
    id: string;
    name: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
};

type Props = {
    markers: PlayerMarker[];
    onlineCount: number;
    serverStatus: 'offline' | 'starting' | 'online';
    mapConfig: MapConfig;
    hasTiles: boolean;
    tileProgress: TileProgress | null;
    safeZones: SafeZone[];
};

const statusDotColor: Record<PlayerMarker['status'], string> = {
    online: 'fill-green-500 text-green-500',
    offline: 'fill-muted text-muted',
    dead: 'fill-red-500 text-red-500',
};

const ZONE_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899'];

export default function PlayerMap({ markers, onlineCount, serverStatus, mapConfig, hasTiles, tileProgress, safeZones }: Props) {
    const { t } = useTranslation();
    usePoll(5000, { only: ['markers', 'onlineCount', 'serverStatus', 'hasTiles', 'tileProgress', 'safeZones'] });

    const zoneOverlays: ZoneOverlay[] = useMemo(
        () => safeZones.map((zone, i) => ({ ...zone, color: ZONE_COLORS[i % ZONE_COLORS.length] })),
        [safeZones],
    );

    const [kickTarget, setKickTarget] = useState<string | null>(null);
    const [banTarget, setBanTarget] = useState<string | null>(null);
    const [accessTarget, setAccessTarget] = useState<string | null>(null);

    const counts = useMemo(() => {
        const online = Math.max(onlineCount, markers.filter((m) => m.status === 'online').length);
        const offline = markers.filter((m) => m.status === 'offline').length;
        const dead = markers.filter((m) => m.status === 'dead').length;
        return { online, offline, dead, total: markers.length };
    }, [markers, onlineCount]);

    function handleMarkerAction(marker: PlayerMarker, action: string) {
        switch (action) {
            case 'kick':
                setKickTarget(marker.username);
                break;
            case 'ban':
                setBanTarget(marker.username);
                break;
            case 'access':
                setAccessTarget(marker.username);
                break;
            case 'inventory':
                router.visit(`/admin/players/${marker.username}/inventory`);
                break;
        }
    }

    const breadcrumbs: BreadcrumbItem[] = [
        { title: t('nav.dashboard'), href: '/dashboard' },
        { title: t('nav.players'), href: '/admin/players' },
        { title: t('admin.player_map.breadcrumb'), href: '/admin/players/map' },
    ];

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title={t('admin.player_map.title')} />
            <div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">{t('admin.player_map.title')}</h1>
                        <p className="text-muted-foreground">
                            {t('admin.player_map.players_tracked', { count: String(counts.total) })}
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="text-sm">
                            <Circle className="mr-1.5 size-2 fill-green-500 text-green-500" />
                            {t('admin.player_map.online_count', { count: String(counts.online) })}
                        </Badge>
                        <Badge variant="outline" className="text-sm">
                            <Circle className="mr-1.5 size-2 fill-muted text-muted" />
                            {t('admin.player_map.offline_count', { count: String(counts.offline) })}
                        </Badge>
                        {counts.dead > 0 && (
                            <Badge variant="outline" className="text-sm">
                                <Circle className="mr-1.5 size-2 fill-red-500 text-red-500" />
                                {t('admin.player_map.dead_count', { count: String(counts.dead) })}
                            </Badge>
                        )}
                    </div>
                </div>

                {serverStatus === 'offline' && (
                    <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                        <AlertTriangle className="size-4 shrink-0" />
                        {t('admin.player_map.server_offline')}
                    </div>
                )}
                {serverStatus === 'starting' && (
                    <div className="flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-400">
                        <Loader2 className="size-4 shrink-0 animate-spin" />
                        {t('admin.player_map.server_starting')}
                    </div>
                )}

                <Card className="isolate flex-1">
                    <CardContent className="relative h-[350px] p-0 sm:h-[500px] lg:h-[600px]">
                        {!hasTiles && tileProgress?.generating && (
                            <div className="absolute top-2 left-1/2 z-[1000] w-64 -translate-x-1/2 rounded-lg border bg-background/90 px-4 py-3 shadow-sm backdrop-blur-sm sm:w-72">
                                <div className="flex items-center gap-2 text-sm font-medium">
                                    <Loader2 className="size-4 animate-spin text-primary" />
                                    {t('admin.player_map.generating_tiles')}
                                </div>
                                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                                    {tileProgress.completed > 0 ? (
                                        <div
                                            className="h-full rounded-full bg-primary transition-all duration-500"
                                            style={{ width: `${Math.max(tileProgress.percent, 2)}%` }}
                                        />
                                    ) : (
                                        <div className="h-full w-full animate-pulse rounded-full bg-primary/30" />
                                    )}
                                </div>
                                <p className="text-muted-foreground mt-1 text-xs">
                                    {tileProgress.completed > 0
                                        ? t('admin.player_map.tiles_rendered', { count: tileProgress.completed.toLocaleString(), percent: String(tileProgress.percent) })
                                        : t('admin.player_map.preparing_render')}
                                </p>
                            </div>
                        )}
                        {!hasTiles && !tileProgress?.generating && (
                            <div className="bg-muted/80 text-muted-foreground absolute top-2 left-1/2 z-[1000] -translate-x-1/2 rounded-md px-3 py-1.5 text-xs backdrop-blur-sm">
                                {t('admin.player_map.no_tiles')} <code className="font-mono">{t('admin.player_map.no_tiles_command')}</code> {t('admin.player_map.no_tiles_suffix')}
                            </div>
                        )}
                        <PzMap
                            markers={markers}
                            mapConfig={mapConfig}
                            hasTiles={hasTiles}
                            onMarkerAction={handleMarkerAction}
                            zones={zoneOverlays}
                            className="rounded-xl"
                        />
                    </CardContent>
                </Card>

                {markers.length > 0 && (
                    <Card>
                        <CardHeader>
                            <CardTitle>{t('admin.player_map.player_positions')}</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                {markers.map((marker) => (
                                    <div
                                        key={marker.username}
                                        className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2"
                                    >
                                        <div className="flex items-center gap-2">
                                            <Circle className={`size-2 ${statusDotColor[marker.status]}`} />
                                            <span className="text-sm font-medium">{marker.name}</span>
                                        </div>
                                        <span className="font-mono text-xs text-muted-foreground">
                                            {marker.x.toFixed(0)}, {marker.y.toFixed(0)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                )}
            </div>

            <PlayerActionDialogs
                kickTarget={kickTarget}
                banTarget={banTarget}
                accessTarget={accessTarget}
                onCloseKick={() => setKickTarget(null)}
                onCloseBan={() => setBanTarget(null)}
                onCloseAccess={() => setAccessTarget(null)}
                reloadOnly={['markers']}
            />
        </AppLayout>
    );
}
