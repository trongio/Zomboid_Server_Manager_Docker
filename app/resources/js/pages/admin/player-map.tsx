import { Head, router, usePoll } from '@inertiajs/react';
import { Ban, Circle, Loader2, ShieldCheck, UserX } from 'lucide-react';
import { useMemo, useState } from 'react';
import PzMap from '@/components/pz-map';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import AppLayout from '@/layouts/app-layout';
import { fetchAction } from '@/lib/fetch-action';
import type { BreadcrumbItem } from '@/types';
import type { MapConfig, PlayerMarker } from '@/types/server';

type TileProgress = {
    generating: boolean;
    completed: number;
    total: number;
    percent: number;
};

type Props = {
    markers: PlayerMarker[];
    mapConfig: MapConfig;
    hasTiles: boolean;
    tileProgress: TileProgress | null;
};

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Dashboard', href: '/dashboard' },
    { title: 'Players', href: '/admin/players' },
    { title: 'Map', href: '/admin/players/map' },
];

const statusDotColor: Record<PlayerMarker['status'], string> = {
    online: 'fill-green-500 text-green-500',
    offline: 'fill-muted text-muted',
    dead: 'fill-red-500 text-red-500',
};

export default function PlayerMap({ markers, mapConfig, hasTiles, tileProgress }: Props) {
    usePoll(5000, { only: ['markers', 'hasTiles', 'tileProgress'] });

    const [kickTarget, setKickTarget] = useState<string | null>(null);
    const [banTarget, setBanTarget] = useState<string | null>(null);
    const [accessTarget, setAccessTarget] = useState<string | null>(null);
    const [reason, setReason] = useState('');
    const [accessLevel, setAccessLevel] = useState('none');
    const [loading, setLoading] = useState(false);

    const counts = useMemo(() => {
        const online = markers.filter((m) => m.status === 'online').length;
        const offline = markers.filter((m) => m.status === 'offline').length;
        const dead = markers.filter((m) => m.status === 'dead').length;
        return { online, offline, dead, total: markers.length };
    }, [markers]);

    async function handleAction(url: string, data: Record<string, unknown>, onDone: () => void) {
        setLoading(true);
        await fetchAction(url, { data });
        setLoading(false);
        onDone();
        router.reload({ only: ['markers'] });
    }

    function handleMarkerAction(marker: PlayerMarker, action: string) {
        switch (action) {
            case 'kick':
                setReason('');
                setKickTarget(marker.username);
                break;
            case 'ban':
                setReason('');
                setBanTarget(marker.username);
                break;
            case 'access':
                setAccessLevel('none');
                setAccessTarget(marker.username);
                break;
            case 'inventory':
                router.visit(`/admin/players/${marker.username}/inventory`);
                break;
        }
    }

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="Player Map" />
            <div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Player Map</h1>
                        <p className="text-muted-foreground">
                            {counts.total} players tracked
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="text-sm">
                            <Circle className="mr-1.5 size-2 fill-green-500 text-green-500" />
                            {counts.online} Online
                        </Badge>
                        <Badge variant="outline" className="text-sm">
                            <Circle className="mr-1.5 size-2 fill-muted text-muted" />
                            {counts.offline} Offline
                        </Badge>
                        {counts.dead > 0 && (
                            <Badge variant="outline" className="text-sm">
                                <Circle className="mr-1.5 size-2 fill-red-500 text-red-500" />
                                {counts.dead} Dead
                            </Badge>
                        )}
                    </div>
                </div>

                <Card className="isolate flex-1">
                    <CardContent className="relative h-[350px] p-0 sm:h-[500px] lg:h-[600px]">
                        {!hasTiles && tileProgress?.generating && (
                            <div className="absolute top-2 left-1/2 z-[1000] w-64 -translate-x-1/2 rounded-lg border bg-background/90 px-4 py-3 shadow-sm backdrop-blur-sm sm:w-72">
                                <div className="flex items-center gap-2 text-sm font-medium">
                                    <Loader2 className="size-4 animate-spin text-primary" />
                                    Generating map tiles...
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
                                        ? `${tileProgress.completed.toLocaleString()} tiles rendered (~${tileProgress.percent}%)`
                                        : 'Preparing render...'}
                                </p>
                            </div>
                        )}
                        {!hasTiles && !tileProgress?.generating && (
                            <div className="bg-muted/80 text-muted-foreground absolute top-2 left-1/2 z-[1000] -translate-x-1/2 rounded-md px-3 py-1.5 text-xs backdrop-blur-sm">
                                No map tiles available. Run <code className="font-mono">php artisan zomboid:generate-map-tiles</code> to generate.
                            </div>
                        )}
                        <PzMap
                            markers={markers}
                            mapConfig={mapConfig}
                            hasTiles={hasTiles}
                            onMarkerAction={handleMarkerAction}
                            className="rounded-xl"
                        />
                    </CardContent>
                </Card>

                {markers.length > 0 && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Player Positions</CardTitle>
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

            {/* Kick Dialog */}
            <Dialog open={kickTarget !== null} onOpenChange={() => setKickTarget(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Kick {kickTarget}</DialogTitle>
                        <DialogDescription>This player will be disconnected from the server.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Label htmlFor="map-kick-reason">Reason (optional)</Label>
                        <Input
                            id="map-kick-reason"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Reason for kick..."
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setKickTarget(null)}>Cancel</Button>
                        <Button
                            disabled={loading}
                            onClick={() =>
                                handleAction(`/admin/players/${kickTarget}/kick`, { reason }, () => setKickTarget(null))
                            }
                        >
                            <UserX className="mr-1.5 size-3.5" />
                            Kick Player
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Ban Dialog */}
            <Dialog open={banTarget !== null} onOpenChange={() => setBanTarget(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Ban {banTarget}</DialogTitle>
                        <DialogDescription>This player will be permanently banned from the server.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Label htmlFor="map-ban-reason">Reason (optional)</Label>
                        <Input
                            id="map-ban-reason"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Reason for ban..."
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setBanTarget(null)}>Cancel</Button>
                        <Button
                            variant="destructive"
                            disabled={loading}
                            onClick={() =>
                                handleAction(`/admin/players/${banTarget}/ban`, { reason }, () => setBanTarget(null))
                            }
                        >
                            <Ban className="mr-1.5 size-3.5" />
                            Ban Player
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Access Level Dialog */}
            <Dialog open={accessTarget !== null} onOpenChange={() => setAccessTarget(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Set Access Level for {accessTarget}</DialogTitle>
                        <DialogDescription>Change the player's server access level.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Label>Access Level</Label>
                        <Select value={accessLevel} onValueChange={setAccessLevel}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="admin">Admin</SelectItem>
                                <SelectItem value="moderator">Moderator</SelectItem>
                                <SelectItem value="overseer">Overseer</SelectItem>
                                <SelectItem value="gm">GM</SelectItem>
                                <SelectItem value="observer">Observer</SelectItem>
                                <SelectItem value="none">None</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setAccessTarget(null)}>Cancel</Button>
                        <Button
                            disabled={loading}
                            onClick={() =>
                                handleAction(
                                    `/admin/players/${accessTarget}/access`,
                                    { level: accessLevel },
                                    () => setAccessTarget(null),
                                )
                            }
                        >
                            <ShieldCheck className="mr-1.5 size-3.5" />
                            Set Access
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </AppLayout>
    );
}
