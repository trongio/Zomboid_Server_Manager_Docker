import { Deferred, Head, router } from '@inertiajs/react';
import { Archive, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Skeleton } from '@/components/ui/skeleton';
import AppLayout from '@/layouts/app-layout';
import { fetchAction } from '@/lib/fetch-action';
import type { BackupEntry, BreadcrumbItem } from '@/types';

type PaginatedBackups = {
    data: BackupEntry[];
    current_page: number;
    last_page: number;
    total: number;
};

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Dashboard', href: '/dashboard' },
    { title: 'Backups', href: '/admin/backups' },
];

const COUNTDOWN_OPTIONS = [
    { value: '0', label: 'Immediately' },
    { value: '60', label: '1 minute' },
    { value: '120', label: '2 minutes' },
    { value: '300', label: '5 minutes' },
    { value: '600', label: '10 minutes' },
    { value: '900', label: '15 minutes' },
    { value: '1800', label: '30 minutes' },
    { value: '3600', label: '60 minutes' },
] as const;

const typeColors: Record<string, string> = {
    manual: 'bg-blue-500/10 text-blue-500',
    scheduled: 'bg-green-500/10 text-green-500',
    daily: 'bg-purple-500/10 text-purple-500',
    pre_rollback: 'bg-yellow-500/10 text-yellow-500',
    pre_update: 'bg-orange-500/10 text-orange-500',
};

export default function Backups({ backups }: { backups: PaginatedBackups }) {
    const [showCreate, setShowCreate] = useState(false);
    const [rollbackTarget, setRollbackTarget] = useState<BackupEntry | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<BackupEntry | null>(null);
    const [notes, setNotes] = useState('');
    const [notifyPlayers, setNotifyPlayers] = useState(false);
    const [backupMessage, setBackupMessage] = useState('');
    const [loading, setLoading] = useState(false);
    const [rollbackCountdown, setRollbackCountdown] = useState('0');
    const [rollbackMessage, setRollbackMessage] = useState('');

    async function createBackup() {
        setLoading(true);
        const data: Record<string, unknown> = { notes: notes || null };
        if (notifyPlayers) {
            data.notify_players = true;
            if (backupMessage.trim()) {
                data.message = backupMessage.trim();
            }
        }
        await fetchAction('/admin/backups', {
            data,
            successMessage: 'Backup created',
        });
        setLoading(false);
        setShowCreate(false);
        setNotes('');
        setNotifyPlayers(false);
        setBackupMessage('');
        router.reload();
    }

    async function rollback(backup: BackupEntry) {
        setLoading(true);
        const countdown = parseInt(rollbackCountdown, 10);
        const data: Record<string, unknown> = { confirm: true };
        if (countdown > 0) {
            data.countdown = countdown;
            if (rollbackMessage.trim()) {
                data.message = rollbackMessage.trim();
            }
        }
        await fetchAction(`/admin/backups/${backup.id}/rollback`, {
            data,
            successMessage: countdown > 0
                ? `Rollback scheduled in ${countdown} seconds`
                : `Rolled back to ${backup.filename}`,
        });
        setLoading(false);
        setRollbackTarget(null);
        setRollbackCountdown('0');
        setRollbackMessage('');
        router.reload();
    }

    async function deleteBackup(backup: BackupEntry) {
        setLoading(true);
        await fetchAction(`/admin/backups/${backup.id}`, {
            method: 'DELETE',
            successMessage: 'Backup deleted',
        });
        setLoading(false);
        setDeleteTarget(null);
        router.reload();
    }

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="Backups" />
            <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Backup Management</h1>
                        <p className="text-muted-foreground">{backups ? `${backups.total} backup${backups.total !== 1 ? 's' : ''}` : 'Loading...'}</p>
                    </div>
                    <Button onClick={() => setShowCreate(true)}>
                        <Plus className="mr-1.5 size-4" />
                        Create Backup
                    </Button>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Archive className="size-5" />
                            Backups
                        </CardTitle>
                        <CardDescription>Server world saves with rollback support</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Deferred data="backups" fallback={
                            <div className="space-y-2">
                                {Array.from({ length: 5 }).map((_, i) => (
                                    <div key={i} className="flex items-center justify-between rounded-lg border border-border/50 px-4 py-3">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <Skeleton className="h-4 w-48" />
                                                <Skeleton className="h-5 w-16 rounded-full" />
                                            </div>
                                            <div className="mt-1 flex items-center gap-2">
                                                <Skeleton className="h-3 w-16" />
                                                <Skeleton className="h-3 w-28" />
                                            </div>
                                        </div>
                                        <div className="ml-4 flex items-center gap-1.5">
                                            <Skeleton className="h-8 w-24 rounded-md" />
                                            <Skeleton className="h-8 w-8 rounded-md" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        }>
                            {backups?.data.length > 0 ? (
                                <div className="space-y-2">
                                    {backups.data.map((backup) => (
                                        <div
                                            key={backup.id}
                                            className="flex flex-col gap-2 rounded-lg border border-border/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                                        >
                                            <div className="min-w-0 flex-1">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="truncate font-medium text-sm">{backup.filename}</span>
                                                    <Badge className={`text-xs ${typeColors[backup.type] ?? ''}`}>
                                                        {backup.type}
                                                    </Badge>
                                                </div>
                                                <div className="mt-0.5 text-xs text-muted-foreground">
                                                    {backup.size_human} &middot; {new Date(backup.created_at).toLocaleString()}
                                                    {backup.notes && <> &middot; {backup.notes}</>}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1.5 sm:ml-4">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => setRollbackTarget(backup)}
                                                >
                                                    <RotateCcw className="mr-1.5 size-3.5" />
                                                    Rollback
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="text-destructive hover:text-destructive"
                                                    onClick={() => setDeleteTarget(backup)}
                                                >
                                                    <Trash2 className="size-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="py-8 text-center text-muted-foreground">No backups yet</p>
                            )}

                            {/* Pagination */}
                            {backups?.last_page > 1 && (
                                <div className="mt-4 flex items-center justify-center gap-2">
                                    {Array.from({ length: backups.last_page }, (_, i) => i + 1).map((page) => (
                                        <Button
                                            key={page}
                                            variant={page === backups.current_page ? 'default' : 'outline'}
                                            size="sm"
                                            onClick={() => router.get('/admin/backups', { page }, { preserveState: true })}
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

            {/* Create Backup Dialog */}
            <Dialog open={showCreate} onOpenChange={setShowCreate}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Create Backup</DialogTitle>
                        <DialogDescription>
                            Create a manual backup of the current server state.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="backup-notes">Notes (optional)</Label>
                            <Input
                                id="backup-notes"
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder="e.g. Before mod update"
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <Checkbox
                                id="notify-players"
                                checked={notifyPlayers}
                                onCheckedChange={(checked) => setNotifyPlayers(checked === true)}
                            />
                            <Label htmlFor="notify-players" className="cursor-pointer">
                                Notify players in-game
                            </Label>
                        </div>
                        {notifyPlayers && (
                            <div className="grid gap-2">
                                <Label htmlFor="backup-message">Notification message (optional)</Label>
                                <Input
                                    id="backup-message"
                                    value={backupMessage}
                                    onChange={(e) => setBackupMessage(e.target.value)}
                                    placeholder="Backup in progress — expect a brief lag"
                                    maxLength={500}
                                />
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
                        <Button disabled={loading} onClick={createBackup}>
                            Create Backup
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Rollback Confirmation */}
            <Dialog open={rollbackTarget !== null} onOpenChange={() => {
                setRollbackTarget(null);
                setRollbackCountdown('0');
                setRollbackMessage('');
            }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Rollback to Backup</DialogTitle>
                        <DialogDescription>
                            This will stop the server, restore from <strong>{rollbackTarget?.filename}</strong>,
                            and restart it. A pre-rollback safety backup will be created automatically.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="rollback-countdown">Countdown</Label>
                            <Select value={rollbackCountdown} onValueChange={setRollbackCountdown}>
                                <SelectTrigger id="rollback-countdown">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {COUNTDOWN_OPTIONS.map((opt) => (
                                        <SelectItem key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        {rollbackCountdown !== '0' && (
                            <div className="grid gap-2">
                                <Label htmlFor="rollback-message">Warning message (optional)</Label>
                                <Input
                                    id="rollback-message"
                                    placeholder="Server rolling back — you will be disconnected..."
                                    value={rollbackMessage}
                                    onChange={(e) => setRollbackMessage(e.target.value)}
                                    maxLength={500}
                                />
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => {
                            setRollbackTarget(null);
                            setRollbackCountdown('0');
                            setRollbackMessage('');
                        }}>Cancel</Button>
                        <Button
                            variant="destructive"
                            disabled={loading}
                            onClick={() => rollbackTarget && rollback(rollbackTarget)}
                        >
                            {rollbackCountdown === '0' ? 'Rollback Now' : 'Schedule Rollback'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation */}
            <Dialog open={deleteTarget !== null} onOpenChange={() => setDeleteTarget(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete Backup</DialogTitle>
                        <DialogDescription>
                            Permanently delete <strong>{deleteTarget?.filename}</strong>? This cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
                        <Button
                            variant="destructive"
                            disabled={loading}
                            onClick={() => deleteTarget && deleteBackup(deleteTarget)}
                        >
                            Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </AppLayout>
    );
}
