import { Head, router, usePoll } from '@inertiajs/react';
import { AlertTriangle, Circle, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import PlayerActionDialogs from '@/components/player-action-dialogs';
import PzMap from '@/components/pz-map';
import { useTranslation } from '@/hooks/use-translation';
import type { PzMapDisplayMode, ZoneOverlay } from '@/components/pz-map';
import { Badge } from '@/components/ui/badge';
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
    const [displayMode, setDisplayModeState] = useState<PzMapDisplayMode>(() => {
        if (typeof window === 'undefined') return 'v41';
        const stored = window.localStorage.getItem('pz-map-display-mode');
        return stored === 'v41' || stored === 'v42' || stored === 'webgl' ? stored : 'v41';
    });
    const setDisplayMode = (m: PzMapDisplayMode) => {
        setDisplayModeState(m);
        if (typeof window !== 'undefined') {
            window.localStorage.setItem('pz-map-display-mode', m);
        }
    };

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
            <div className="flex flex-1 flex-col">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-background px-4 py-2">
                    <div className="flex items-center gap-1 rounded-md border bg-muted/30 p-0.5">
                        {(['v41', 'v42', 'webgl'] as const).map((m) => (
                            <button
                                key={m}
                                type="button"
                                onClick={() => setDisplayMode(m)}
                                className={`rounded px-3 py-1 text-xs font-medium transition ${
                                    displayMode === m
                                        ? 'bg-primary text-primary-foreground shadow-sm'
                                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                                }`}
                            >
                                {t(`admin.pz_map.display_mode.${m}`)}
                            </button>
                        ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                            <Circle className="mr-1.5 size-2 fill-green-500 text-green-500" />
                            {t('admin.player_map.online_count', { count: String(counts.online) })}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                            <Circle className="mr-1.5 size-2 fill-muted text-muted" />
                            {t('admin.player_map.offline_count', { count: String(counts.offline) })}
                        </Badge>
                        {counts.dead > 0 && (
                            <Badge variant="outline" className="text-xs">
                                <Circle className="mr-1.5 size-2 fill-red-500 text-red-500" />
                                {t('admin.player_map.dead_count', { count: String(counts.dead) })}
                            </Badge>
                        )}
                    </div>
                </div>
                <div className="relative flex flex-1 flex-col">

                {(serverStatus === 'offline' || serverStatus === 'starting') && (
                    <div className="pointer-events-auto absolute top-20 left-1/2 z-[1000] -translate-x-1/2 max-w-md">
                        {serverStatus === 'offline' && (
                            <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/90 px-4 py-2 text-sm text-white shadow-sm">
                                <AlertTriangle className="size-4 shrink-0" />
                                {t('admin.player_map.server_offline')}
                            </div>
                        )}
                        {serverStatus === 'starting' && (
                            <div className="flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/90 px-4 py-2 text-sm text-white shadow-sm">
                                <Loader2 className="size-4 shrink-0 animate-spin" />
                                {t('admin.player_map.server_starting')}
                            </div>
                        )}
                    </div>
                )}

                {!hasTiles && tileProgress?.generating && (
                    <div className="pointer-events-auto absolute bottom-3 left-1/2 z-[1000] w-72 -translate-x-1/2 rounded-lg border bg-background/90 px-4 py-3 shadow-sm backdrop-blur-sm">
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

                <PzMap
                    markers={markers}
                    mapConfig={mapConfig}
                    hasTiles={hasTiles}
                    onMarkerAction={handleMarkerAction}
                    zones={zoneOverlays}
                    displayMode={displayMode}
                    className=""
                />
                </div>
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
