import { Deferred, Head, router } from '@inertiajs/react';
import { Ban, Crosshair, Filter, MapPin, UserX } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import type L from 'leaflet';
import PzMap from '@/components/pz-map';
import type { EventMarker } from '@/components/pz-map';
import PlayerActionDialogs from '@/components/player-action-dialogs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import AppLayout from '@/layouts/app-layout';
import type { BreadcrumbItem } from '@/types';
import type { GameEventEntry, MapConfig } from '@/types/server';

type PaginatedEvents = {
    data: GameEventEntry[];
    current_page: number;
    last_page: number;
    total: number;
};

type Filters = {
    event_types: string;
    player: string | null;
    from: string | null;
    to: string | null;
};

type Props = {
    mapConfig: MapConfig;
    hasTiles: boolean;
    filters: Filters;
    events: PaginatedEvents;
};

const EVENT_TYPES = [
    { value: 'pvp_kill', label: 'PvP Kill', color: '#ef4444' },
    { value: 'death', label: 'Death', color: '#9ca3af' },
    { value: 'connect', label: 'Connect', color: '#22c55e' },
    { value: 'disconnect', label: 'Disconnect', color: '#f59e0b' },
] as const;

const typeBadgeVariant: Record<string, 'destructive' | 'secondary' | 'outline'> = {
    pvp_kill: 'destructive',
    death: 'secondary',
    connect: 'outline',
    disconnect: 'outline',
};

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Dashboard', href: '/dashboard' },
    { title: 'Moderation', href: '/admin/moderation' },
];

export default function Moderation({ mapConfig, hasTiles, filters, events }: Props) {
    const [localFilters, setLocalFilters] = useState({
        event_types: filters.event_types || '',
        player: filters.player || '',
        from: filters.from || '',
        to: filters.to || '',
    });
    const [highlightedEventId, setHighlightedEventId] = useState<number | null>(null);
    const [kickTarget, setKickTarget] = useState<string | null>(null);
    const [banTarget, setBanTarget] = useState<string | null>(null);
    const mapInstanceRef = useRef<L.Map | null>(null);

    const selectedTypes = localFilters.event_types ? localFilters.event_types.split(',') : [];

    function toggleEventType(type: string) {
        const current = selectedTypes.includes(type)
            ? selectedTypes.filter((t) => t !== type)
            : [...selectedTypes, type];
        setLocalFilters((f) => ({ ...f, event_types: current.join(',') }));
    }

    function applyFilters() {
        const params: Record<string, string> = {};
        if (localFilters.event_types) params.event_types = localFilters.event_types;
        if (localFilters.player) params.player = localFilters.player;
        if (localFilters.from) params.from = localFilters.from;
        if (localFilters.to) params.to = localFilters.to;

        router.get('/admin/moderation', params, { preserveState: true });
    }

    function clearFilters() {
        setLocalFilters({ event_types: 'pvp_kill,death', player: '', from: '', to: '' });
        router.get('/admin/moderation', { event_types: 'pvp_kill,death' }, { preserveState: true });
    }

    function panToEvent(event: GameEventEntry) {
        if (event.x == null || event.y == null || !mapInstanceRef.current) return;
        mapInstanceRef.current.setView([-event.y, event.x], mapConfig.maxZoom - 2, { animate: true });
        setHighlightedEventId(event.id);
    }

    const handleEventMarkerClick = useCallback((marker: EventMarker) => {
        setHighlightedEventId(marker.id);
        const row = document.getElementById(`event-row-${marker.id}`);
        row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, []);

    const handleMapReady = useCallback((map: L.Map) => {
        mapInstanceRef.current = map;
    }, []);

    // Build event markers from loaded events
    const eventMarkers: EventMarker[] = events?.data
        ?.filter((e) => e.x != null && e.y != null)
        .map((e) => ({
            id: e.id,
            x: e.x!,
            y: e.y!,
            type: e.event_type,
            player: e.player,
            target: e.target,
            label: e.event_type.replace('_', ' '),
        })) ?? [];

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="Moderation" />
            <div className="flex h-full flex-1 flex-col gap-6 overflow-x-auto p-4 lg:p-6">
                {/* Filters */}
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Filter className="size-4" />
                            Filters
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            <div>
                                <Label className="mb-2 block text-xs">Event Types</Label>
                                <div className="flex flex-wrap gap-2">
                                    {EVENT_TYPES.map((et) => (
                                        <Button
                                            key={et.value}
                                            variant={selectedTypes.includes(et.value) ? 'default' : 'outline'}
                                            size="sm"
                                            onClick={() => toggleEventType(et.value)}
                                        >
                                            <span
                                                className="mr-1.5 inline-block size-2.5 rounded-full"
                                                style={{ backgroundColor: et.color }}
                                            />
                                            {et.label}
                                        </Button>
                                    ))}
                                </div>
                            </div>
                            <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-2 lg:grid-cols-4">
                                <div className="space-y-1.5">
                                    <Label className="text-xs">Player</Label>
                                    <Input
                                        value={localFilters.player}
                                        onChange={(e) => setLocalFilters((f) => ({ ...f, player: e.target.value }))}
                                        placeholder="Search player name..."
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs">From</Label>
                                    <Input
                                        type="date"
                                        value={localFilters.from}
                                        onChange={(e) => setLocalFilters((f) => ({ ...f, from: e.target.value }))}
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs">To</Label>
                                    <Input
                                        type="date"
                                        value={localFilters.to}
                                        onChange={(e) => setLocalFilters((f) => ({ ...f, to: e.target.value }))}
                                    />
                                </div>
                                <div className="flex gap-2">
                                    <Button size="sm" onClick={applyFilters}>Apply</Button>
                                    <Button size="sm" variant="outline" onClick={clearFilters}>Clear</Button>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Map */}
                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="flex items-center gap-2">
                                    <MapPin className="size-5" />
                                    Event Map
                                </CardTitle>
                                <CardDescription>
                                    Click a marker to highlight the event below, or click a table row to pan the map
                                </CardDescription>
                            </div>
                            <div className="flex flex-wrap gap-3">
                                {EVENT_TYPES.map((et) => (
                                    <div key={et.value} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                        <span
                                            className="inline-block size-2.5 rounded-full"
                                            style={{ backgroundColor: et.color }}
                                        />
                                        {et.label}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[400px] overflow-hidden rounded-md border">
                            <PzMap
                                mapConfig={mapConfig}
                                hasTiles={hasTiles}
                                eventMarkers={eventMarkers}
                                onEventMarkerClick={handleEventMarkerClick}
                                onMapReady={handleMapReady}
                            />
                        </div>
                    </CardContent>
                </Card>

                {/* Events Table */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Crosshair className="size-5" />
                            Events
                        </CardTitle>
                        <CardDescription>
                            {events ? `${events.total} event${events.total !== 1 ? 's' : ''} found` : 'Loading...'}
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Deferred data="events" fallback={
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Time</TableHead>
                                        <TableHead>Type</TableHead>
                                        <TableHead>Player</TableHead>
                                        <TableHead>Target</TableHead>
                                        <TableHead>Location</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {Array.from({ length: 6 }).map((_, i) => (
                                        <TableRow key={i}>
                                            <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                                            <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                                            <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                                            <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                                            <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                                            <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        }>
                            {events?.data.length > 0 ? (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Time</TableHead>
                                            <TableHead>Type</TableHead>
                                            <TableHead>Player</TableHead>
                                            <TableHead>Target</TableHead>
                                            <TableHead>Location</TableHead>
                                            <TableHead className="text-right">Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {events.data.map((event) => (
                                            <TableRow
                                                key={event.id}
                                                id={`event-row-${event.id}`}
                                                className={`cursor-pointer transition-colors ${highlightedEventId === event.id ? 'bg-muted/50' : ''}`}
                                                onClick={() => panToEvent(event)}
                                            >
                                                <TableCell className="text-xs">
                                                    {event.created_at
                                                        ? new Date(event.created_at).toLocaleString()
                                                        : ''}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant={typeBadgeVariant[event.event_type] ?? 'outline'}>
                                                        {event.event_type.replace('_', ' ')}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="font-medium">{event.player}</TableCell>
                                                <TableCell className="text-muted-foreground">
                                                    {event.target ?? '-'}
                                                </TableCell>
                                                <TableCell className="font-mono text-xs">
                                                    {event.x != null ? (
                                                        <span className="flex items-center gap-1">
                                                            <MapPin className="size-3" />
                                                            {event.x}, {event.y}
                                                        </span>
                                                    ) : (
                                                        '-'
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => setKickTarget(event.player)}
                                                        >
                                                            <UserX className="mr-1 size-3" />
                                                            Kick
                                                        </Button>
                                                        <Button
                                                            variant="destructive"
                                                            size="sm"
                                                            onClick={() => setBanTarget(event.player)}
                                                        >
                                                            <Ban className="mr-1 size-3" />
                                                            Ban
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            ) : (
                                <p className="py-8 text-center text-muted-foreground">
                                    No events found matching filters
                                </p>
                            )}

                            {/* Pagination */}
                            {events?.last_page > 1 && (
                                <div className="mt-4 flex items-center justify-center gap-2">
                                    {Array.from({ length: events.last_page }, (_, i) => i + 1).map((page) => (
                                        <Button
                                            key={page}
                                            variant={page === events.current_page ? 'default' : 'outline'}
                                            size="sm"
                                            onClick={() => {
                                                const params: Record<string, string> = {};
                                                if (localFilters.event_types) params.event_types = localFilters.event_types;
                                                if (localFilters.player) params.player = localFilters.player;
                                                if (localFilters.from) params.from = localFilters.from;
                                                if (localFilters.to) params.to = localFilters.to;
                                                router.get(
                                                    '/admin/moderation',
                                                    { ...params, page: String(page) },
                                                    { preserveState: true },
                                                );
                                            }}
                                        >
                                            {page}
                                        </Button>
                                    ))}
                                </div>
                            )}
                        </Deferred>
                    </CardContent>
                </Card>
            </div>

            <PlayerActionDialogs
                kickTarget={kickTarget}
                banTarget={banTarget}
                accessTarget={null}
                onCloseKick={() => setKickTarget(null)}
                onCloseBan={() => setBanTarget(null)}
                onCloseAccess={() => {}}
                reloadOnly={['events']}
            />
        </AppLayout>
    );
}
