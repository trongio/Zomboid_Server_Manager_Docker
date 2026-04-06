import { Deferred, Head, Link } from '@inertiajs/react';
import { Clock, Coins, Crosshair, Medal, ShoppingCart, Skull, Swords, Trophy, Users } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { AnimatedCounter } from '@/components/animated-counter';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useTranslation } from '@/hooks/use-translation';
import PublicLayout from '@/layouts/public-layout';
import type { DeathLeaderboardEntry, LeaderboardEntry, RankingsPageData, RatioLeaderboardEntry, WalletLeaderboardEntry } from '@/types';

type TabKey = 'kills' | 'survival' | 'deaths' | 'kd' | 'hd' | 'pvpd' | 'spent' | 'balance';

function RankBadge({ rank }: { rank: number }) {
    if (rank === 1) {
        return (
            <span className="inline-flex size-7 items-center justify-center rounded-full bg-yellow-500/20 text-xs font-bold text-yellow-600 dark:text-yellow-400">
                1
            </span>
        );
    }
    if (rank === 2) {
        return (
            <span className="inline-flex size-7 items-center justify-center rounded-full bg-zinc-200 text-xs font-bold text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300">
                2
            </span>
        );
    }
    if (rank === 3) {
        return (
            <span className="inline-flex size-7 items-center justify-center rounded-full bg-amber-800/20 text-xs font-bold text-amber-700 dark:text-amber-500">
                3
            </span>
        );
    }
    return (
        <span className="inline-flex size-7 items-center justify-center text-xs font-medium text-muted-foreground">
            {rank}
        </span>
    );
}

function KillsTable({ data }: { data: LeaderboardEntry[] }) {
    const { t } = useTranslation();
    if (data.length === 0) {
        return <p className="py-8 text-center text-sm text-muted-foreground">{t('rankings.no_stats')}</p>;
    }

    return (
        <div className="space-y-1">
            {data.map((entry, i) => (
                <motion.div
                    key={entry.username}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: i * 0.03 }}
                >
                    <Link
                        href={`/rankings/${entry.username}`}
                        className="flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted/50"
                    >
                        <div className="flex items-center gap-3">
                            <RankBadge rank={entry.rank} />
                            <span className="font-medium">{entry.username}</span>
                            {entry.profession && (
                                <Badge variant="secondary" className="text-xs">{entry.profession}</Badge>
                            )}
                            {entry.is_dead && <Skull className="size-3.5 text-red-500" title="Dead" />}
                        </div>
                        <span className="font-semibold tabular-nums">{entry.zombie_kills.toLocaleString()}</span>
                    </Link>
                </motion.div>
            ))}
        </div>
    );
}

function SurvivalTable({ data }: { data: LeaderboardEntry[] }) {
    const { t } = useTranslation();
    if (data.length === 0) {
        return <p className="py-8 text-center text-sm text-muted-foreground">{t('rankings.no_stats')}</p>;
    }

    return (
        <div className="space-y-1">
            {data.map((entry, i) => (
                <motion.div
                    key={entry.username}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: i * 0.03 }}
                >
                    <Link
                        href={`/rankings/${entry.username}`}
                        className="flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted/50"
                    >
                        <div className="flex items-center gap-3">
                            <RankBadge rank={entry.rank} />
                            <span className="font-medium">{entry.username}</span>
                            {entry.profession && (
                                <Badge variant="secondary" className="text-xs">{entry.profession}</Badge>
                            )}
                            {entry.is_dead && <Skull className="size-3.5 text-red-500" title="Dead" />}
                        </div>
                        <span className="font-semibold tabular-nums">
                            {entry.hours_survived.toLocaleString(undefined, { maximumFractionDigits: 1 })}h
                        </span>
                    </Link>
                </motion.div>
            ))}
        </div>
    );
}

function DeathsTable({ data }: { data: DeathLeaderboardEntry[] }) {
    const { t } = useTranslation();
    if (data.length === 0) {
        return <p className="py-8 text-center text-sm text-muted-foreground">{t('rankings.no_deaths')}</p>;
    }

    return (
        <div className="space-y-1">
            {data.map((entry, i) => (
                <motion.div
                    key={entry.username}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: i * 0.03 }}
                >
                    <Link
                        href={`/rankings/${entry.username}`}
                        className="flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted/50"
                    >
                        <div className="flex items-center gap-3">
                            <RankBadge rank={entry.rank} />
                            <span className="font-medium">{entry.username}</span>
                        </div>
                        <span className="font-semibold tabular-nums">{entry.death_count.toLocaleString()}</span>
                    </Link>
                </motion.div>
            ))}
        </div>
    );
}

function RatioTable({ data, unit }: { data: RatioLeaderboardEntry[]; unit?: string }) {
    const { t } = useTranslation();
    if (data.length === 0) {
        return <p className="py-8 text-center text-sm text-muted-foreground">{t('rankings.no_ratio_data')}</p>;
    }

    return (
        <div className="space-y-1">
            {data.map((entry, i) => (
                <motion.div
                    key={entry.username}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: i * 0.03 }}
                >
                    <Link
                        href={`/rankings/${entry.username}`}
                        className="flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted/50"
                    >
                        <div className="flex items-center gap-3">
                            <RankBadge rank={entry.rank} />
                            <span className="font-medium">{entry.username}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                                ({entry.numerator.toLocaleString(undefined, { maximumFractionDigits: 1 })}{unit ?? ''} / {entry.death_count}d)
                            </span>
                            <span className="font-semibold tabular-nums">{entry.ratio.toFixed(2)}</span>
                        </div>
                    </Link>
                </motion.div>
            ))}
        </div>
    );
}

function WalletTable({ data, field }: { data: WalletLeaderboardEntry[]; field: 'total_spent' | 'balance' }) {
    const { t } = useTranslation();
    if (data.length === 0) {
        return <p className="py-8 text-center text-sm text-muted-foreground">{t('rankings.no_wallet_data')}</p>;
    }

    return (
        <div className="space-y-1">
            {data.map((entry, i) => (
                <motion.div
                    key={entry.username}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: i * 0.03 }}
                >
                    <Link
                        href={`/rankings/${entry.username}`}
                        className="flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted/50"
                    >
                        <div className="flex items-center gap-3">
                            <RankBadge rank={entry.rank} />
                            <span className="font-medium">{entry.username}</span>
                        </div>
                        <span className="font-semibold tabular-nums">
                            {entry[field].toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                    </Link>
                </motion.div>
            ))}
        </div>
    );
}

function LeaderboardSkeleton() {
    return (
        <div className="space-y-2 py-2">
            {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-2">
                    <div className="flex items-center gap-3">
                        <Skeleton className="size-7 rounded-full" />
                        <Skeleton className="h-4 w-24" />
                    </div>
                    <Skeleton className="h-4 w-12" />
                </div>
            ))}
        </div>
    );
}

const tabs: { key: TabKey; labelKey: string; icon: typeof Skull }[] = [
    { key: 'kills', labelKey: 'rankings.tab_kills', icon: Skull },
    { key: 'survival', labelKey: 'rankings.tab_survival', icon: Clock },
    { key: 'deaths', labelKey: 'rankings.tab_deaths', icon: Medal },
    { key: 'kd', labelKey: 'rankings.tab_kd', icon: Crosshair },
    { key: 'hd', labelKey: 'rankings.tab_hd', icon: Clock },
    { key: 'pvpd', labelKey: 'rankings.tab_pvpd', icon: Swords },
    { key: 'spent', labelKey: 'rankings.tab_spent', icon: ShoppingCart },
    { key: 'balance', labelKey: 'rankings.tab_balance', icon: Coins },
];

export default function Rankings({
    server_stats,
    leaderboard_kills,
    leaderboard_survival,
    leaderboard_deaths,
    leaderboard_kd,
    leaderboard_hd,
    leaderboard_pvpd,
    leaderboard_spent,
    leaderboard_balance,
}: RankingsPageData) {
    const [activeTab, setActiveTab] = useState<TabKey>('kills');
    const { t } = useTranslation();

    return (
        <>
            <Head title={t('rankings.title')} />
            <PublicLayout>
                <main className="mx-auto max-w-7xl px-4 py-8">
                    <h1 className="mb-6 text-3xl font-bold tracking-tight">{t('rankings.title')}</h1>

                    {/* Server Stats Hero */}
                    <div className="mb-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                        <Card>
                            <CardContent className="flex items-center gap-3 pt-4">
                                <div className="flex size-10 items-center justify-center rounded-lg bg-blue-500/10">
                                    <Users className="size-5 text-blue-500" />
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">{t('rankings.total_players')}</p>
                                    <p className="text-2xl font-bold tabular-nums">
                                        <AnimatedCounter value={server_stats.total_players} />
                                    </p>
                                </div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="flex items-center gap-3 pt-4">
                                <div className="flex size-10 items-center justify-center rounded-lg bg-red-500/10">
                                    <Skull className="size-5 text-red-500" />
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">{t('rankings.zombie_kills')}</p>
                                    <p className="text-2xl font-bold tabular-nums">
                                        <AnimatedCounter value={server_stats.total_zombie_kills} />
                                    </p>
                                </div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="flex items-center gap-3 pt-4">
                                <div className="flex size-10 items-center justify-center rounded-lg bg-green-500/10">
                                    <Clock className="size-5 text-green-500" />
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">{t('rankings.hours_played')}</p>
                                    <p className="text-2xl font-bold tabular-nums">
                                        <AnimatedCounter value={server_stats.total_hours_survived} decimals={1} suffix="h" />
                                    </p>
                                </div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="flex items-center gap-3 pt-4">
                                <div className="flex size-10 items-center justify-center rounded-lg bg-orange-500/10">
                                    <Skull className="size-5 text-orange-500" />
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">{t('rankings.deaths')}</p>
                                    <p className="text-2xl font-bold tabular-nums">
                                        <AnimatedCounter value={server_stats.total_deaths} />
                                    </p>
                                </div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="flex items-center gap-3 pt-4">
                                <div className="flex size-10 items-center justify-center rounded-lg bg-purple-500/10">
                                    <Swords className="size-5 text-purple-500" />
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">{t('rankings.pvp_kills')}</p>
                                    <p className="text-2xl font-bold tabular-nums">
                                        <AnimatedCounter value={server_stats.total_pvp_kills} />
                                    </p>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Tabbed Leaderboards */}
                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <CardTitle className="flex items-center gap-2">
                                    <Trophy className="size-5" />
                                    {t('rankings.leaderboards')}
                                </CardTitle>
                            </div>
                            <div className="flex gap-1 overflow-x-auto border-b border-border pt-2">
                                {tabs.map((tab) => (
                                    <button
                                        key={tab.key}
                                        onClick={() => setActiveTab(tab.key)}
                                        className={`flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                                            activeTab === tab.key
                                                ? 'border-primary text-foreground'
                                                : 'border-transparent text-muted-foreground hover:text-foreground'
                                        }`}
                                    >
                                        <tab.icon className="size-3.5" />
                                        {t(tab.labelKey)}
                                    </button>
                                ))}
                            </div>
                        </CardHeader>
                        <CardContent>
                            {activeTab === 'kills' && (
                                <Deferred data="leaderboard_kills" fallback={<LeaderboardSkeleton />}>
                                    <KillsTable data={leaderboard_kills ?? []} />
                                </Deferred>
                            )}
                            {activeTab === 'survival' && (
                                <Deferred data="leaderboard_survival" fallback={<LeaderboardSkeleton />}>
                                    <SurvivalTable data={leaderboard_survival ?? []} />
                                </Deferred>
                            )}
                            {activeTab === 'deaths' && (
                                <Deferred data="leaderboard_deaths" fallback={<LeaderboardSkeleton />}>
                                    <DeathsTable data={leaderboard_deaths ?? []} />
                                </Deferred>
                            )}
                            {activeTab === 'kd' && (
                                <Deferred data="leaderboard_kd" fallback={<LeaderboardSkeleton />}>
                                    <RatioTable data={leaderboard_kd ?? []} />
                                </Deferred>
                            )}
                            {activeTab === 'hd' && (
                                <Deferred data="leaderboard_hd" fallback={<LeaderboardSkeleton />}>
                                    <RatioTable data={leaderboard_hd ?? []} unit="h" />
                                </Deferred>
                            )}
                            {activeTab === 'pvpd' && (
                                <Deferred data="leaderboard_pvpd" fallback={<LeaderboardSkeleton />}>
                                    <RatioTable data={leaderboard_pvpd ?? []} />
                                </Deferred>
                            )}
                            {activeTab === 'spent' && (
                                <Deferred data="leaderboard_spent" fallback={<LeaderboardSkeleton />}>
                                    <WalletTable data={leaderboard_spent ?? []} field="total_spent" />
                                </Deferred>
                            )}
                            {activeTab === 'balance' && (
                                <Deferred data="leaderboard_balance" fallback={<LeaderboardSkeleton />}>
                                    <WalletTable data={leaderboard_balance ?? []} field="balance" />
                                </Deferred>
                            )}
                        </CardContent>
                    </Card>
                </main>
            </PublicLayout>
        </>
    );
}
