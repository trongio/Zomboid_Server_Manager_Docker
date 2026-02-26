import { Head, router } from '@inertiajs/react';
import { Plus, RefreshCw, Shield, Trash2 } from 'lucide-react';
import { useState } from 'react';
import AppLayout from '@/layouts/app-layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import type { BreadcrumbItem } from '@/types';

type WhitelistEntry = {
    username: string;
    password_hash: string;
};

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Dashboard', href: '/dashboard' },
    { title: 'Whitelist', href: '/admin/whitelist' },
];

export default function Whitelist({ entries }: { entries: WhitelistEntry[] }) {
    const [showAdd, setShowAdd] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);

    const csrfToken = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '';

    function addUser() {
        setLoading(true);
        fetch('/admin/whitelist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrfToken },
            body: JSON.stringify({ username, password }),
        }).finally(() => {
            setLoading(false);
            setShowAdd(false);
            setUsername('');
            setPassword('');
            router.reload({ only: ['entries'] });
        });
    }

    function removeUser(name: string) {
        setLoading(true);
        fetch(`/admin/whitelist/${name}`, {
            method: 'DELETE',
            headers: { 'X-CSRF-TOKEN': csrfToken },
        }).finally(() => {
            setLoading(false);
            setDeleteTarget(null);
            router.reload({ only: ['entries'] });
        });
    }

    function syncWhitelist() {
        setSyncing(true);
        fetch('/admin/whitelist/sync', {
            method: 'POST',
            headers: { 'X-CSRF-TOKEN': csrfToken },
        }).finally(() => {
            setSyncing(false);
            router.reload({ only: ['entries'] });
        });
    }

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="Whitelist" />
            <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Whitelist Management</h1>
                        <p className="text-muted-foreground">
                            {entries.length} user{entries.length !== 1 ? 's' : ''} whitelisted
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" onClick={syncWhitelist} disabled={syncing}>
                            <RefreshCw className={`mr-1.5 size-4 ${syncing ? 'animate-spin' : ''}`} />
                            Sync
                        </Button>
                        <Button onClick={() => setShowAdd(true)}>
                            <Plus className="mr-1.5 size-4" />
                            Add User
                        </Button>
                    </div>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Shield className="size-5" />
                            Whitelisted Users
                        </CardTitle>
                        <CardDescription>
                            Users who can join when the server has whitelist enabled (Open=false)
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {entries.length > 0 ? (
                            <div className="space-y-2">
                                {entries.map((entry) => (
                                    <div
                                        key={entry.username}
                                        className="flex items-center justify-between rounded-lg border border-border/50 px-4 py-3"
                                    >
                                        <span className="font-medium">{entry.username}</span>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="text-destructive hover:text-destructive"
                                            onClick={() => setDeleteTarget(entry.username)}
                                        >
                                            <Trash2 className="size-4" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="py-8 text-center text-muted-foreground">No users whitelisted</p>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Add User Dialog */}
            <Dialog open={showAdd} onOpenChange={setShowAdd}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Add User to Whitelist</DialogTitle>
                        <DialogDescription>
                            Create PZ credentials for the user. They will use these to join the server.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="wl-username">Username</Label>
                            <Input
                                id="wl-username"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                placeholder="PZ username"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="wl-password">Password</Label>
                            <Input
                                id="wl-password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="PZ password"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
                        <Button disabled={loading || !username || !password} onClick={addUser}>
                            Add User
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation */}
            <Dialog open={deleteTarget !== null} onOpenChange={() => setDeleteTarget(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Remove User</DialogTitle>
                        <DialogDescription>
                            Remove <strong>{deleteTarget}</strong> from the whitelist?
                            They will no longer be able to join if the server requires whitelist.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
                        <Button
                            variant="destructive"
                            disabled={loading}
                            onClick={() => deleteTarget && removeUser(deleteTarget)}
                        >
                            Remove
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </AppLayout>
    );
}
