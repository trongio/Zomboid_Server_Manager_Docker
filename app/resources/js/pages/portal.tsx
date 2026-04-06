import { Head, Link, usePage } from '@inertiajs/react';
import { formatDateTime } from '@/lib/dates';
import PzMap from '@/components/pz-map';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useTranslation } from '@/hooks/use-translation';
import AppLayout from '@/layouts/app-layout';
import type { BreadcrumbItem } from '@/types';
import type { MapConfig, PlayerMarker } from '@/types/server';
import { edit } from '@/routes/profile';

type PlayerPosition = {
    username: string;
    x: number;
    y: number;
    z: number;
    is_dead: boolean;
};

type PzAccount = {
    username: string;
    whitelisted: boolean;
    isOnline: boolean;
    syncedAt: string | null;
};

type Props = {
    pzAccount: PzAccount;
    hasEmail: boolean;
    emailVerified: boolean;
    playerPosition: PlayerPosition | null;
    mapConfig: MapConfig;
    hasTiles: boolean;
};

const breadcrumbs: BreadcrumbItem[] = [
    {
        title: 'Player Portal',
        href: '/portal',
    },
];

export default function Portal({ pzAccount, hasEmail, emailVerified, playerPosition, mapConfig, hasTiles }: Props) {
    const { auth } = usePage().props;
    const { t } = useTranslation();

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title={t('portal.title')} />

            <div className="mx-auto max-w-3xl space-y-6 p-6">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">{t('portal.title')}</h1>
                    <p className="text-muted-foreground">
                        {t('portal.description')}
                    </p>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>{t('portal.game_account')}</CardTitle>
                        <CardDescription>
                            {t('portal.game_account_desc')}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{t('portal.username')}</span>
                            <span className="font-mono text-sm">{pzAccount.username}</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{t('portal.whitelist_status')}</span>
                            {pzAccount.whitelisted ? (
                                <Badge variant="default">{t('portal.whitelisted')}</Badge>
                            ) : (
                                <Badge variant="destructive">{t('portal.not_whitelisted')}</Badge>
                            )}
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{t('portal.server_status')}</span>
                            {pzAccount.isOnline ? (
                                <Badge className="bg-green-600">{t('status.online')}</Badge>
                            ) : (
                                <Badge variant="secondary">{t('status.offline')}</Badge>
                            )}
                        </div>
                        {pzAccount.syncedAt && (
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-medium">{t('portal.last_synced')}</span>
                                <span className="text-sm text-muted-foreground">
                                    {formatDateTime(pzAccount.syncedAt)}
                                </span>
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>{t('portal.profile')}</CardTitle>
                        <CardDescription>
                            {t('portal.profile_desc')}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{t('portal.email')}</span>
                            {hasEmail ? (
                                <div className="flex items-center gap-2">
                                    <span className="text-sm">{auth.user.email}</span>
                                    {emailVerified ? (
                                        <Badge variant="default">{t('portal.verified')}</Badge>
                                    ) : (
                                        <Badge variant="outline">{t('portal.unverified')}</Badge>
                                    )}
                                </div>
                            ) : (
                                <span className="text-sm text-muted-foreground">{t('portal.not_set')}</span>
                            )}
                        </div>

                        <div className="flex flex-wrap gap-3 pt-2">
                            <Button asChild variant="outline" size="sm">
                                <Link href={edit()}>{t('portal.edit_profile')}</Link>
                            </Button>
                            <Button asChild variant="outline" size="sm">
                                <Link href="/settings/password">{t('portal.change_password')}</Link>
                            </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            {t('portal.password_note')}
                        </p>

                        {!hasEmail && (
                            <p className="text-xs text-muted-foreground">
                                {t('portal.add_email_note')}
                            </p>
                        )}
                    </CardContent>
                </Card>

                {playerPosition && (
                    <Card>
                        <CardHeader>
                            <CardTitle>{t('portal.your_location')}</CardTitle>
                            <CardDescription>
                                {t('portal.location_desc', { x: playerPosition.x.toFixed(0), y: playerPosition.y.toFixed(0) })}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="h-[300px] p-0">
                            <PzMap
                                markers={[
                                    {
                                        username: pzAccount.username,
                                        name: pzAccount.username,
                                        x: playerPosition.x,
                                        y: playerPosition.y,
                                        z: playerPosition.z,
                                        status: playerPosition.is_dead ? 'dead' : pzAccount.isOnline ? 'online' : 'offline',
                                        is_online: pzAccount.isOnline,
                                    },
                                ]}
                                mapConfig={{
                                    ...mapConfig,
                                    center: { x: playerPosition.x, y: playerPosition.y },
                                    defaultZoom: 5,
                                }}
                                hasTiles={hasTiles}
                                interactive={false}
                                className="rounded-b-xl"
                            />
                        </CardContent>
                    </Card>
                )}
            </div>
        </AppLayout>
    );
}
