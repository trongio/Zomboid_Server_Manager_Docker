import { Head, Link, usePoll } from '@inertiajs/react';
import { Backpack, Ban, Circle, Clock, KeyRound, Search, ShieldCheck, Skull, TimerReset, UserX } from 'lucide-react';
import { useMemo, useState } from 'react';
import PlayerActionDialogs from '@/components/player-action-dialogs';
import { SortIcon } from '@/components/sort-icon';
import { useTableSort } from '@/hooks/use-table-sort';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useTranslation } from '@/hooks/use-translation';
import AppLayout from '@/layouts/app-layout';
import type { BreadcrumbItem } from '@/types';

type Player = {
    id: number | null;
    username: string;
    role: string;
    isOnline: boolean;
    createdAt: string | null;
    stats: {
        zombie_kills: number;
        hours_survived: number;
        profession: string | null;
    } | null;
};

type RespawnCooldown = {
    death_time: number;
    remaining_seconds: number;
    remaining_minutes: number;
};

type RespawnConfig = {
    enabled: boolean;
    delay_minutes: number;
};

type SortKey = 'status' | 'username' | 'kills' | 'hours' | 'joined';
type StatusFilter = 'all' | 'online' | 'offline';

const roleBadgeVariant: Record<string, 'default' | 'secondary' | 'outline'> = {
    super_admin: 'default',
    admin: 'default',
    moderator: 'secondary',
    player: 'outline',
    unknown: 'outline',
};

type PlayersProps = {
    players: Player[];
    respawn_cooldowns: Record<string, RespawnCooldown>;
    respawn_config: RespawnConfig;
};

export default function Players({ players, respawn_cooldowns = {}, respawn_config }: PlayersProps) {
    const { t } = useTranslation();

    const breadcrumbs: BreadcrumbItem[] = [
        { title: t('nav.dashboard'), href: '/dashboard' },
        { title: t('admin.players.title'), href: '/admin/players' },
    ];

    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const { sortKey, sortDir, toggleSort } = useTableSort<SortKey>('status', 'desc');

    const [kickTarget, setKickTarget] = useState<string | null>(null);
    const [banTarget, setBanTarget] = useState<string | null>(null);
    const [accessTarget, setAccessTarget] = useState<string | null>(null);
    const [resetTimerTarget, setResetTimerTarget] = useState<string | null>(null);
    const [passwordTarget, setPasswordTarget] = useState<string | null>(null);

    usePoll(5000, { only: ['players'] });

    const onlineCount = useMemo(() => players.filter((p) => p.isOnline).length, [players]);

    const filteredPlayers = useMemo(() => {
        let result = players;

        if (statusFilter === 'online') {
            result = result.filter((p) => p.isOnline);
        } else if (statusFilter === 'offline') {
            result = result.filter((p) => !p.isOnline);
        }

        if (search) {
            const q = search.toLowerCase();
            result = result.filter((p) => p.username.toLowerCase().includes(q));
        }

        const sorted = [...result];
        sorted.sort((a, b) => {
            let cmp = 0;
            if (sortKey === 'status') {
                cmp = Number(a.isOnline) - Number(b.isOnline);
            } else if (sortKey === 'username') {
                cmp = a.username.localeCompare(b.username);
            } else if (sortKey === 'kills') {
                cmp = (a.stats?.zombie_kills ?? 0) - (b.stats?.zombie_kills ?? 0);
            } else if (sortKey === 'hours') {
                cmp = (a.stats?.hours_survived ?? 0) - (b.stats?.hours_survived ?? 0);
            } else if (sortKey === 'joined') {
                const aDate = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                const bDate = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                cmp = aDate - bDate;
            }
            return sortDir === 'desc' ? -cmp : cmp;
        });

        return sorted;
    }, [players, search, statusFilter, sortKey, sortDir]);

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title={t('admin.players.title')} />
            <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">{t('admin.players.title')}</h1>
                        <p className="text-muted-foreground">
                            {t('admin.players.subtitle', { online: String(onlineCount), total: String(players.length) })}
                        </p>
                    </div>
                    <Badge variant="outline" className="text-sm">
                        <Circle className="mr-1.5 size-2 fill-green-500 text-green-500" />
                        {t('common.live')}
                    </Badge>
                </div>

                <Card>
                    <CardHeader>
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <CardTitle>{t('admin.players.card_title')}</CardTitle>
                                <CardDescription>
                                    {t('admin.players.card_description', { filtered: String(filteredPlayers.length), total: String(players.length) })}
                                </CardDescription>
                            </div>
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                <div className="relative">
                                    <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                                    <Input
                                        placeholder={t('admin.players.search_placeholder')}
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        className="pl-9 sm:w-[200px]"
                                    />
                                </div>
                                <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                                    <SelectTrigger className="w-full sm:w-[130px]">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">{t('common.all')}</SelectItem>
                                        <SelectItem value="online">{t('common.online')}</SelectItem>
                                        <SelectItem value="offline">{t('common.offline')}</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {filteredPlayers.length > 0 ? (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-[40px]">
                                            <button type="button" className="flex items-center hover:text-foreground" onClick={() => toggleSort('status')}>
                                                <SortIcon column="status" sortKey={sortKey} sortDir={sortDir} />
                                            </button>
                                        </TableHead>
                                        <TableHead>
                                            <button type="button" className="flex items-center hover:text-foreground" onClick={() => toggleSort('username')}>
                                                {t('admin.players.table_player')}
                                                <SortIcon column="username" sortKey={sortKey} sortDir={sortDir} />
                                            </button>
                                        </TableHead>
                                        <TableHead className="hidden sm:table-cell">{t('admin.players.table_role')}</TableHead>
                                        <TableHead className="hidden md:table-cell">
                                            <button type="button" className="flex items-center hover:text-foreground" onClick={() => toggleSort('kills')}>
                                                <Skull className="mr-1 size-3" />
                                                {t('admin.players.table_kills')}
                                                <SortIcon column="kills" sortKey={sortKey} sortDir={sortDir} />
                                            </button>
                                        </TableHead>
                                        <TableHead className="hidden md:table-cell">
                                            <button type="button" className="flex items-center hover:text-foreground" onClick={() => toggleSort('hours')}>
                                                <Clock className="mr-1 size-3" />
                                                {t('admin.players.table_hours')}
                                                <SortIcon column="hours" sortKey={sortKey} sortDir={sortDir} />
                                            </button>
                                        </TableHead>
                                        <TableHead className="hidden lg:table-cell">
                                            <button type="button" className="flex items-center hover:text-foreground" onClick={() => toggleSort('joined')}>
                                                {t('admin.players.table_joined')}
                                                <SortIcon column="joined" sortKey={sortKey} sortDir={sortDir} />
                                            </button>
                                        </TableHead>
                                        <TableHead className="text-right">{t('common.actions')}</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredPlayers.map((player) => (
                                        <TableRow key={player.id ?? `online-${player.username}`}>
                                            <TableCell>
                                                <Circle
                                                    className={`size-2 ${player.isOnline ? 'fill-green-500 text-green-500' : 'fill-muted text-muted'}`}
                                                />
                                            </TableCell>
                                            <TableCell className="font-medium">
                                                <div className="flex items-center gap-1.5">
                                                    {player.username}
                                                    {respawn_cooldowns[player.username] && (
                                                        <Badge variant="destructive" className="text-xs">
                                                            <Clock className="mr-0.5 size-3" />
                                                            {respawn_cooldowns[player.username].remaining_minutes}m
                                                        </Badge>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell className="hidden sm:table-cell">
                                                <Badge variant={roleBadgeVariant[player.role] ?? 'outline'}>
                                                    {player.role.replace('_', ' ')}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="hidden tabular-nums md:table-cell">
                                                {player.stats?.zombie_kills.toLocaleString() ?? '-'}
                                            </TableCell>
                                            <TableCell className="hidden tabular-nums md:table-cell">
                                                {player.stats
                                                    ? `${player.stats.hours_survived.toLocaleString(undefined, { maximumFractionDigits: 1 })}h`
                                                    : '-'}
                                            </TableCell>
                                            <TableCell className="hidden lg:table-cell">
                                                {player.createdAt
                                                    ? new Date(player.createdAt).toLocaleDateString()
                                                    : '-'}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex items-center justify-end gap-1">
                                                    <Button variant="ghost" size="sm" asChild title={t('admin.players.tooltip_inventory')}>
                                                        <Link href={`/admin/players/${player.username}/inventory`}>
                                                            <Backpack className="size-3.5" />
                                                        </Link>
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => setAccessTarget(player.username)}
                                                        title={t('admin.players.tooltip_access_level')}
                                                    >
                                                        <ShieldCheck className="size-3.5" />
                                                    </Button>
                                                    {player.id !== null && (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => setPasswordTarget(player.username)}
                                                            title={t('admin.players.tooltip_set_password')}
                                                        >
                                                            <KeyRound className="size-3.5" />
                                                        </Button>
                                                    )}
                                                    {respawn_cooldowns[player.username] && (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => setResetTimerTarget(player.username)}
                                                            title={t('admin.players.tooltip_reset_timer')}
                                                        >
                                                            <TimerReset className="size-3.5" />
                                                        </Button>
                                                    )}
                                                    {player.isOnline && (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => {
                                                                setKickTarget(player.username);
                                                            }}
                                                            title={t('admin.players.tooltip_kick')}
                                                        >
                                                            <UserX className="size-3.5" />
                                                        </Button>
                                                    )}
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => {
                                                            setBanTarget(player.username);
                                                        }}
                                                        title={t('admin.players.tooltip_ban')}
                                                    >
                                                        <Ban className="size-3.5 text-destructive" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        ) : (
                            <p className="py-8 text-center text-muted-foreground">
                                {search || statusFilter !== 'all' ? t('admin.players.no_players_filtered') : t('admin.players.no_players')}
                            </p>
                        )}
                    </CardContent>
                </Card>
            </div>

            <PlayerActionDialogs
                kickTarget={kickTarget}
                banTarget={banTarget}
                accessTarget={accessTarget}
                passwordTarget={passwordTarget}
                resetTimerTarget={resetTimerTarget}
                onCloseKick={() => setKickTarget(null)}
                onCloseBan={() => setBanTarget(null)}
                onCloseAccess={() => setAccessTarget(null)}
                onClosePassword={() => setPasswordTarget(null)}
                onCloseResetTimer={() => setResetTimerTarget(null)}
                reloadOnly={['players', 'respawn_cooldowns']}
            />
        </AppLayout>
    );
}
