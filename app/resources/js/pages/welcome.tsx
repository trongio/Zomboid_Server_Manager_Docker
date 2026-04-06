import { Deferred, Head, Link } from '@inertiajs/react';
import {
    Archive,
    Bell,
    Check,
    ChevronRight,
    Clock,
    Copy,
    Crosshair,
    Gamepad2,
    Globe,
    Heart,
    LayoutGrid,
    MapPin,
    Package,
    Shield,
    ShieldAlert,
    Skull,
    Star,
    Sword,
    Terminal,
    Trophy,
    Users,
    Wallet,
    Wrench,
    Zap,
    type LucideIcon,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { AnimatedCounter } from '@/components/animated-counter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useClipboard } from '@/hooks/use-clipboard';
import { usePing } from '@/hooks/use-ping';
import { useTranslation } from '@/hooks/use-translation';
import PublicLayout from '@/layouts/public-layout';
import type { WelcomePageData } from '@/types';

const iconMap: Record<string, LucideIcon> = {
    Archive,
    Bell,
    Clock,
    Crosshair,
    Gamepad2,
    Globe,
    Heart,
    LayoutGrid,
    MapPin,
    Package,
    Shield,
    ShieldAlert,
    Skull,
    Star,
    Sword,
    Terminal,
    Trophy,
    Users,
    Wallet,
    Wrench,
    Zap,
};

function CopyField({ label, value }: { label: string; value: string }) {
    const [, copy] = useClipboard();
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        const ok = await copy(value);
        if (ok) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    return (
        <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/30 px-3 py-2">
            <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="font-mono text-sm font-medium">{value}</p>
            </div>
            <button
                onClick={handleCopy}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title="Copy to clipboard"
            >
                {copied ? <Check className="size-4 text-green-500" /> : <Copy className="size-4" />}
            </button>
        </div>
    );
}

function HeroSection({
    hero,
    server,
    ping,
    connection,
}: Pick<WelcomePageData, 'hero' | 'server' | 'connection'> & { ping: number | null }) {
    const { t } = useTranslation();

    return (
        <section className="relative overflow-hidden py-20 lg:py-28">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/5 via-transparent to-transparent" />
            <div className="relative mx-auto max-w-7xl px-4 text-center">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                    className="mb-6 inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/50 px-4 py-1.5 text-sm text-muted-foreground"
                >
                    <Globe className="size-4" />
                    {hero.badge}
                </motion.div>
                <motion.h1
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.1 }}
                    className="mb-4 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl"
                >
                    {hero.title}
                    <br />
                    <span className="text-muted-foreground">{hero.subtitle}</span>
                </motion.h1>

                {/* Server status indicator */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                    className="mb-6 flex items-center justify-center gap-2 text-sm"
                >
                    <span
                        className={`inline-block size-2.5 rounded-full ${
                            server.status === 'online'
                                ? 'animate-pulse bg-green-500'
                                : server.status === 'starting'
                                  ? 'animate-pulse bg-yellow-500'
                                  : 'bg-red-500'
                        }`}
                    />
                    <span className="font-medium">
                        {server.status === 'online'
                            ? `${t('status.online')} — ${server.player_count} ${server.player_count !== 1 ? t('common.players') : t('common.player')}`
                            : server.status === 'starting'
                              ? t('status.starting')
                              : t('status.offline')}
                    </span>
                    {ping !== null && server.status === 'online' && (
                        <span className="text-muted-foreground">— {ping}ms</span>
                    )}
                </motion.div>

                <motion.p
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                    className="mx-auto mb-8 max-w-2xl text-lg text-muted-foreground"
                >
                    {hero.description}
                </motion.p>
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.3 }}
                    className="flex items-center justify-center gap-4"
                >
                    <Dialog>
                        <DialogTrigger asChild>
                            <Button size="lg">
                                {hero.button_text}
                                <ChevronRight className="ml-1 size-4" />
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-md">
                            <DialogHeader>
                                <DialogTitle>{hero.button_text}</DialogTitle>
                                <DialogDescription>
                                    {t('connection.description')}
                                </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-3 py-2">
                                {connection.ip ? (
                                    <>
                                        <CopyField label={t('connection.server_ip')} value={connection.ip} />
                                        <CopyField label={t('connection.port')} value={connection.port} />
                                    </>
                                ) : (
                                    <p className="text-sm text-muted-foreground">
                                        {t('connection.not_configured')}
                                    </p>
                                )}
                                <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2.5 text-sm text-muted-foreground">
                                    <p className="mb-1 font-medium text-foreground">{t('connection.how_to')}</p>
                                    <ol className="list-inside list-decimal space-y-0.5">
                                        <li>{t('connection.step_1')}</li>
                                        <li>{t('connection.step_2')}</li>
                                        <li>{t('connection.step_3')}</li>
                                        <li>{t('connection.step_4')}</li>
                                    </ol>
                                </div>
                            </div>
                            <DialogFooter>
                                <DialogClose asChild>
                                    <Button variant="outline">{t('common.close')}</Button>
                                </DialogClose>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                    <Button asChild variant="outline" size="lg">
                        <Link href="/rankings">
                            <Trophy className="mr-1.5 size-4" />
                            {t('landing.view_rankings')}
                        </Link>
                    </Button>
                </motion.div>
            </div>
        </section>
    );
}

function StatsSection({ server_stats, server }: Pick<WelcomePageData, 'server_stats' | 'server'>) {
    const { t } = useTranslation();

    return (
        <Deferred data="server_stats" fallback={
            <section className="border-y border-border/40 bg-muted/20 py-8">
                <div className="mx-auto grid max-w-7xl grid-cols-2 gap-4 px-4 sm:grid-cols-4">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="flex flex-col items-center gap-2">
                            <Skeleton className="size-8 rounded" />
                            <Skeleton className="h-7 w-16" />
                            <Skeleton className="h-3 w-20" />
                        </div>
                    ))}
                </div>
            </section>
        }>
            {server_stats && (
                <section className="border-y border-border/40 bg-muted/20 py-8">
                    <div className="mx-auto grid max-w-7xl grid-cols-2 gap-6 px-4 sm:grid-cols-4 lg:grid-cols-5">
                        <div className="flex flex-col items-center gap-1">
                            <div className="flex size-10 items-center justify-center rounded-lg bg-blue-500/10">
                                <Users className="size-5 text-blue-500" />
                            </div>
                            <span className="text-2xl font-bold tabular-nums">
                                <AnimatedCounter value={server_stats.total_players} />
                            </span>
                            <span className="text-xs text-muted-foreground">{t('status.total_players')}</span>
                        </div>
                        <div className="flex flex-col items-center gap-1">
                            <div className="flex size-10 items-center justify-center rounded-lg bg-red-500/10">
                                <Skull className="size-5 text-red-500" />
                            </div>
                            <span className="text-2xl font-bold tabular-nums">
                                <AnimatedCounter value={server_stats.total_zombie_kills} />
                            </span>
                            <span className="text-xs text-muted-foreground">{t('status.zombie_kills')}</span>
                        </div>
                        <div className="flex flex-col items-center gap-1">
                            <div className="flex size-10 items-center justify-center rounded-lg bg-green-500/10">
                                <Clock className="size-5 text-green-500" />
                            </div>
                            <span className="text-2xl font-bold tabular-nums">
                                <AnimatedCounter value={server_stats.total_hours_survived} decimals={1} suffix="h" />
                            </span>
                            <span className="text-xs text-muted-foreground">{t('status.hours_survived')}</span>
                        </div>
                        <div className="flex flex-col items-center gap-1">
                            <div className="flex size-10 items-center justify-center rounded-lg bg-orange-500/10">
                                <Skull className="size-5 text-orange-500" />
                            </div>
                            <span className="text-2xl font-bold tabular-nums">
                                <AnimatedCounter value={server_stats.total_deaths} />
                            </span>
                            <span className="text-xs text-muted-foreground">{t('status.deaths')}</span>
                        </div>
                        <div className="hidden flex-col items-center gap-1 lg:flex">
                            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                                <Users className="size-5 text-primary" />
                            </div>
                            <span className="text-2xl font-bold tabular-nums">
                                {server.player_count}
                            </span>
                            <span className="text-xs text-muted-foreground">{t('status.players_online')}</span>
                        </div>
                    </div>
                </section>
            )}
        </Deferred>
    );
}

function TopPlayersSection({ top_players }: Pick<WelcomePageData, 'top_players'>) {
    const { t } = useTranslation();
    return (
        <Deferred data="top_players" fallback={
            <section className="py-16">
                <div className="mx-auto max-w-7xl px-4 text-center">
                    <Skeleton className="mx-auto mb-8 h-8 w-48" />
                    <div className="flex items-end justify-center gap-2 sm:gap-4">
                        {Array.from({ length: 3 }).map((_, i) => (
                            <Skeleton key={i} className={`w-28 rounded-lg sm:w-40 ${i === 1 ? 'h-52' : 'h-40'}`} />
                        ))}
                    </div>
                </div>
            </section>
        }>
            {top_players && top_players.length > 0 && (
                <section className="py-16">
                    <div className="mx-auto max-w-7xl px-4">
                        <div className="mb-10 text-center">
                            <h2 className="mb-2 text-2xl font-bold tracking-tight sm:text-3xl">
                                {t('landing.top_survivors')}
                            </h2>
                            <p className="text-muted-foreground">{t('landing.top_survivors_desc')}</p>
                        </div>
                        <div className="flex items-end justify-center gap-2 sm:gap-4">
                            {/* 2nd place */}
                            {top_players.length > 1 && (
                                <motion.div
                                    initial={{ opacity: 0, y: 30 }}
                                    whileInView={{ opacity: 1, y: 0 }}
                                    viewport={{ once: true }}
                                    transition={{ duration: 0.5, delay: 0.1 }}
                                >
                                    <Card className="w-28 border-zinc-400/30 sm:w-44">
                                        <CardContent className="pt-4 text-center">
                                            <div className="mx-auto mb-2 flex size-8 items-center justify-center rounded-full bg-zinc-200 text-sm font-bold text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300">
                                                2
                                            </div>
                                            <p className="truncate text-sm font-semibold">{top_players[1].username}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {top_players[1].zombie_kills.toLocaleString()} {t('common.kills')}
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                {top_players[1].hours_survived.toLocaleString(undefined, { maximumFractionDigits: 1 })}h {t('common.survived')}
                                            </p>
                                            {top_players[1].profession && (
                                                <span className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 text-xs">
                                                    {top_players[1].profession}
                                                </span>
                                            )}
                                        </CardContent>
                                    </Card>
                                </motion.div>
                            )}

                            {/* 1st place */}
                            <motion.div
                                initial={{ opacity: 0, y: 30 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ duration: 0.5 }}
                            >
                                <Card className="w-32 border-yellow-500/30 sm:w-52">
                                    <CardContent className="pt-4 text-center">
                                        <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-full bg-yellow-500/20 text-base font-bold text-yellow-600 dark:text-yellow-400">
                                            1
                                        </div>
                                        <p className="truncate font-semibold">{top_players[0].username}</p>
                                        <p className="text-sm text-muted-foreground">
                                            {top_players[0].zombie_kills.toLocaleString()} {t('common.kills')}
                                        </p>
                                        <p className="text-sm text-muted-foreground">
                                            {top_players[0].hours_survived.toLocaleString(undefined, { maximumFractionDigits: 1 })}h {t('common.survived')}
                                        </p>
                                        {top_players[0].profession && (
                                            <span className="mt-1 inline-block rounded bg-yellow-500/10 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:text-yellow-400">
                                                {top_players[0].profession}
                                            </span>
                                        )}
                                    </CardContent>
                                </Card>
                            </motion.div>

                            {/* 3rd place */}
                            {top_players.length > 2 && (
                                <motion.div
                                    initial={{ opacity: 0, y: 30 }}
                                    whileInView={{ opacity: 1, y: 0 }}
                                    viewport={{ once: true }}
                                    transition={{ duration: 0.5, delay: 0.2 }}
                                >
                                    <Card className="w-28 border-amber-700/30 sm:w-44">
                                        <CardContent className="pt-4 text-center">
                                            <div className="mx-auto mb-2 flex size-8 items-center justify-center rounded-full bg-amber-800/20 text-sm font-bold text-amber-700 dark:text-amber-500">
                                                3
                                            </div>
                                            <p className="truncate text-sm font-semibold">{top_players[2].username}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {top_players[2].zombie_kills.toLocaleString()} {t('common.kills')}
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                {top_players[2].hours_survived.toLocaleString(undefined, { maximumFractionDigits: 1 })}h {t('common.survived')}
                                            </p>
                                            {top_players[2].profession && (
                                                <span className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 text-xs">
                                                    {top_players[2].profession}
                                                </span>
                                            )}
                                        </CardContent>
                                    </Card>
                                </motion.div>
                            )}
                        </div>
                        <div className="mt-6 text-center">
                            <Link
                                href="/rankings"
                                className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
                            >
                                <Trophy className="size-4" />
                                {t('landing.view_full_rankings')}
                            </Link>
                        </div>
                    </div>
                </section>
            )}
        </Deferred>
    );
}

function FeaturesSection({ features }: { features: WelcomePageData['features'] }) {
    const { t } = useTranslation();

    return (
        <section className="border-t border-border/40 bg-muted/30 py-16 lg:py-20">
            <div className="mx-auto max-w-7xl px-4">
                <div className="mb-12 text-center">
                    <h2 className="mb-3 text-2xl font-bold tracking-tight sm:text-3xl">
                        {t('landing.features_title')}
                    </h2>
                    <p className="text-muted-foreground">
                        {t('landing.features_desc')}
                    </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {features.map((feature, index) => {
                        const Icon = iconMap[feature.icon] ?? Star;
                        return (
                            <motion.div
                                key={index}
                                initial={{ opacity: 0, y: 20 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ duration: 0.4, delay: index * 0.1 }}
                            >
                                <Card className="border-border/50">
                                    <CardHeader>
                                        <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/10">
                                            <Icon className="size-5 text-primary" />
                                        </div>
                                        <CardTitle className="text-base">{feature.title}</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <CardDescription className="text-sm leading-relaxed">
                                            {feature.description}
                                        </CardDescription>
                                    </CardContent>
                                </Card>
                            </motion.div>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}

export default function Welcome({
    server,
    server_stats,
    top_players,
    connection,
    hero,
    features,
    landing_sections,
}: WelcomePageData) {
    const ping = usePing('/ping', 15000);

    const sortedSections = [...landing_sections]
        .filter((s) => s.enabled)
        .sort((a, b) => a.order - b.order);

    const sectionRenderers: Record<string, () => React.ReactNode> = {
        hero: () => <HeroSection key="hero" hero={hero} server={server} ping={ping} connection={connection} />,
        stats: () => <StatsSection key="stats" server_stats={server_stats} server={server} />,
        top_players: () => <TopPlayersSection key="top_players" top_players={top_players} />,
        features: () => <FeaturesSection key="features" features={features} />,
    };

    return (
        <>
            <Head title={hero.title} />
            <PublicLayout>
                {sortedSections.map((section) => sectionRenderers[section.id]?.())}
            </PublicLayout>
        </>
    );
}
