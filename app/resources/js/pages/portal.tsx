import { Head, Link, usePage } from '@inertiajs/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import AppLayout from '@/layouts/app-layout';
import type { BreadcrumbItem } from '@/types';
import { edit } from '@/routes/profile';

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
};

const breadcrumbs: BreadcrumbItem[] = [
    {
        title: 'Player Portal',
        href: '/portal',
    },
];

export default function Portal({ pzAccount, hasEmail, emailVerified }: Props) {
    const { auth } = usePage().props;

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="Player Portal" />

            <div className="mx-auto max-w-3xl space-y-6 p-6">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Player Portal</h1>
                    <p className="text-muted-foreground">
                        Manage your game account and profile settings.
                    </p>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>Game Account</CardTitle>
                        <CardDescription>
                            Your Project Zomboid server account details.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">Username</span>
                            <span className="font-mono text-sm">{pzAccount.username}</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">Whitelist Status</span>
                            {pzAccount.whitelisted ? (
                                <Badge variant="default">Whitelisted</Badge>
                            ) : (
                                <Badge variant="destructive">Not Whitelisted</Badge>
                            )}
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">Server Status</span>
                            {pzAccount.isOnline ? (
                                <Badge className="bg-green-600">Online</Badge>
                            ) : (
                                <Badge variant="secondary">Offline</Badge>
                            )}
                        </div>
                        {pzAccount.syncedAt && (
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-medium">Last Synced</span>
                                <span className="text-sm text-muted-foreground">
                                    {new Date(pzAccount.syncedAt).toLocaleString()}
                                </span>
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Profile</CardTitle>
                        <CardDescription>
                            Your account settings and email verification status.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">Email</span>
                            {hasEmail ? (
                                <div className="flex items-center gap-2">
                                    <span className="text-sm">{auth.user.email}</span>
                                    {emailVerified ? (
                                        <Badge variant="default">Verified</Badge>
                                    ) : (
                                        <Badge variant="outline">Unverified</Badge>
                                    )}
                                </div>
                            ) : (
                                <span className="text-sm text-muted-foreground">Not set</span>
                            )}
                        </div>

                        <div className="flex gap-3 pt-2">
                            <Button asChild variant="outline" size="sm">
                                <Link href={edit()}>Edit Profile</Link>
                            </Button>
                            <Button asChild variant="outline" size="sm">
                                <Link href="/settings/password">Change Password</Link>
                            </Button>
                        </div>

                        {!hasEmail && (
                            <p className="text-xs text-muted-foreground">
                                Add an email address to enable password recovery.
                            </p>
                        )}
                    </CardContent>
                </Card>
            </div>
        </AppLayout>
    );
}
