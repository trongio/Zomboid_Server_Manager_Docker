import { Deferred, Head, router } from '@inertiajs/react';
import { AlertTriangle, Archive, ChevronLeft, ChevronRight, Loader2, Plus, RotateCcw, Search, Trash2, Upload } from 'lucide-react';
import { formatDateTime } from '@/lib/dates';
import { useMemo, useState } from 'react';
import { SortableHeader } from '@/components/sortable-header';
import { useServerSort } from '@/hooks/use-server-sort';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import AppLayout from '@/layouts/app-layout';
import { fetchAction } from '@/lib/fetch-action';
import type { BackupEntry, BreadcrumbItem } from '@/types';

type PaginatedBackups = {
    data: BackupEntry[];
    current_page: number;
    last_page: number;
    per_page: number;
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

const PER_PAGE_OPTIONS = ['10', '15', '25', '50'] as const;

const typeColors: Record<string, string> = {
    manual: 'bg-blue-500/10 text-blue-500',
    scheduled: 'bg-green-500/10 text-green-500',
    daily: 'bg-purple-500/10 text-purple-500',
    pre_rollback: 'bg-yellow-500/10 text-yellow-500',
    pre_update: 'bg-orange-500/10 text-orange-500',
    pre_import: 'bg-cyan-500/10 text-cyan-500',
};

type BackupsProps = {
    backups: PaginatedBackups;
    current_version: string | null;
    current_branch: string | null;
    filters: {
        sort: string;
        direction: string;
    };
};

type SortKey = 'filename' | 'type' | 'size_bytes' | 'created_at';

export default function Backups({ backups, current_version, current_branch, filters }: BackupsProps) {
    const [showCreate, setShowCreate] = useState(false);
    const { sortKey, sortDir, toggleSort } = useServerSort<SortKey>({
        url: '/admin/backups',
        filters: filters ?? {},
        defaultSort: 'created_at',
        defaultDir: 'desc',
    });
    const [rollbackTarget, setRollbackTarget] = useState<BackupEntry | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<BackupEntry | null>(null);
    const [notes, setNotes] = useState('');
    const [notifyPlayers, setNotifyPlayers] = useState(false);
    const [backupMessage, setBackupMessage] = useState('');
    const [loading, setLoading] = useState(false);
    const [rollbackCountdown, setRollbackCountdown] = useState('0');
    const [rollbackMessage, setRollbackMessage] = useState('');
    const [switchBranch, setSwitchBranch] = useState(false);
    const [search, setSearch] = useState('');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [showBulkDelete, setShowBulkDelete] = useState(false);
    const [showImport, setShowImport] = useState(false);
    const [importFile, setImportFile] = useState<File | null>(null);
    const [importConfirm, setImportConfirm] = useState(false);
    const [importLoading, setImportLoading] = useState(false);

    const filteredBackups = useMemo(() => {
        if (!backups?.data || !search) return backups?.data ?? [];
        const q = search.toLowerCase();
        return backups.data.filter((b) => b.filename.toLowerCase().includes(q));
    }, [backups?.data, search]);

    const allSelected = filteredBackups.length > 0 && filteredBackups.every((b) => selectedIds.has(b.id));

    function toggleSelect(id: string) {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }

    function toggleSelectAll() {
        if (allSelected) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(filteredBackups.map((b) => b.id)));
        }
    }

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
            successMessage: 'Backup started — it will appear in the list shortly',
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
        if (switchBranch && backup.steam_branch && backup.steam_branch !== current_branch) {
            data.switch_branch = backup.steam_branch;
        }
        await fetchAction(`/admin/backups/${backup.id}/rollback`, {
            data,
            successMessage: countdown > 0
                ? `Rollback scheduled in ${countdown} seconds`
                : `Rollback initiated — ${backup.filename} will be restored`,
        });
        setLoading(false);
        setRollbackTarget(null);
        setRollbackCountdown('0');
        setRollbackMessage('');
        setSwitchBranch(false);
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

    async function deleteBulk() {
        setLoading(true);
        await fetchAction('/admin/backups', {
            method: 'DELETE',
            data: { ids: Array.from(selectedIds) },
            successMessage: `Deleted ${selectedIds.size} backup(s)`,
        });
        setLoading(false);
        setShowBulkDelete(false);
        setSelectedIds(new Set());
        router.reload();
    }

    async function importWorld() {
        if (!importFile) return;
        setImportLoading(true);

        const csrfToken = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '';
        const formData = new FormData();
        formData.append('file', importFile);
        formData.append('confirm', '1');

        try {
            const res = await fetch('/admin/backups/import', {
                method: 'POST',
                headers: { 'X-CSRF-TOKEN': csrfToken, 'Accept': 'application/json' },
                body: formData,
            });
            const json = await res.json().catch(() => ({}));

            if (res.ok) {
                const { toast } = await import('sonner');
                toast.success(json.message || 'World import started');
                setShowImport(false);
                setImportFile(null);
                setImportConfirm(false);
                router.reload();
            } else {
                const { toast } = await import('sonner');
                toast.error(json.error || json.message || `Import failed (${res.status})`);
            }
        } catch {
            const { toast } = await import('sonner');
            toast.error('Network error — could not reach the server');
        }

        setImportLoading(false);
    }

    function goToPage(page: number) {
        const params: Record<string, unknown> = { page };
        if (backups?.per_page && backups.per_page !== 15) {
            params.per_page = backups.per_page;
        }
        if (filters?.sort) params.sort = filters.sort;
        if (filters?.direction) params.direction = filters.direction;
        router.get('/admin/backups', params, { preserveState: true });
    }

    function changePerPage(value: string) {
        const params: Record<string, unknown> = { per_page: value, page: 1 };
        if (filters?.sort) params.sort = filters.sort;
        if (filters?.direction) params.direction = filters.direction;
        router.get('/admin/backups', params, { preserveState: true });
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
                    <div className="flex items-center gap-2">
                        {selectedIds.size > 0 && (
                            <Button
                                variant="destructive"
                                onClick={() => setShowBulkDelete(true)}
                            >
                                <Trash2 className="mr-1.5 size-4" />
                                Delete {selectedIds.size} Selected
                            </Button>
                        )}
                        <Button variant="outline" onClick={() => setShowImport(true)}>
                            <Upload className="mr-1.5 size-4" />
                            Import World
                        </Button>
                        <Button onClick={() => setShowCreate(true)}>
                            <Plus className="mr-1.5 size-4" />
                            Create Backup
                        </Button>
                    </div>
                </div>

                <Card>
                    <CardHeader>
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <CardTitle className="flex items-center gap-2">
                                    <Archive className="size-5" />
                                    Backups
                                </CardTitle>
                                <CardDescription>Server world saves with rollback support</CardDescription>
                            </div>
                            <div className="relative">
                                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                                <Input
                                    placeholder="Search backups..."
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    className="pl-9 sm:w-[200px]"
                                />
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="overflow-x-auto">
                        <Deferred data="backups" fallback={
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-10" />
                                        <TableHead>Filename</TableHead>
                                        <TableHead className="hidden sm:table-cell">Type</TableHead>
                                        <TableHead className="hidden md:table-cell">Version</TableHead>
                                        <TableHead className="hidden sm:table-cell">Size</TableHead>
                                        <TableHead className="hidden md:table-cell">Date</TableHead>
                                        <TableHead className="hidden lg:table-cell">Notes</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {Array.from({ length: 5 }).map((_, i) => (
                                        <TableRow key={i}>
                                            <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                                            <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                                            <TableCell className="hidden sm:table-cell"><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                                            <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-16" /></TableCell>
                                            <TableCell className="hidden sm:table-cell"><Skeleton className="h-4 w-16" /></TableCell>
                                            <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-28" /></TableCell>
                                            <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-32" /></TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex items-center justify-end gap-1">
                                                    <Skeleton className="h-8 w-24 rounded-md" />
                                                    <Skeleton className="h-8 w-8 rounded-md" />
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        }>
                            {filteredBackups.length > 0 ? (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-10">
                                                <Checkbox
                                                    checked={allSelected}
                                                    onCheckedChange={toggleSelectAll}
                                                    aria-label="Select all"
                                                />
                                            </TableHead>
                                            <TableHead>
                                                <SortableHeader column="filename" label="Filename" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                                            </TableHead>
                                            <TableHead className="hidden sm:table-cell">
                                                <SortableHeader column="type" label="Type" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                                            </TableHead>
                                            <TableHead className="hidden md:table-cell">Version</TableHead>
                                            <TableHead className="hidden sm:table-cell">
                                                <SortableHeader column="size_bytes" label="Size" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                                            </TableHead>
                                            <TableHead className="hidden md:table-cell">
                                                <SortableHeader column="created_at" label="Date" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                                            </TableHead>
                                            <TableHead className="hidden lg:table-cell">Notes</TableHead>
                                            <TableHead className="text-right">Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {filteredBackups.map((backup) => (
                                            <TableRow key={backup.id} data-state={selectedIds.has(backup.id) ? 'selected' : undefined}>
                                                <TableCell>
                                                    <Checkbox
                                                        checked={selectedIds.has(backup.id)}
                                                        onCheckedChange={() => toggleSelect(backup.id)}
                                                        aria-label={`Select ${backup.filename}`}
                                                    />
                                                </TableCell>
                                                <TableCell className="font-medium text-sm">{backup.filename}</TableCell>
                                                <TableCell className="hidden sm:table-cell">
                                                    <Badge className={`text-xs ${typeColors[backup.type] ?? ''}`}>
                                                        {backup.type}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="hidden md:table-cell">
                                                    <span className="text-sm text-muted-foreground">
                                                        {backup.game_version ? `v${backup.game_version}` : 'Unknown'}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="hidden tabular-nums sm:table-cell">
                                                    {backup.size_human}
                                                </TableCell>
                                                <TableCell className="hidden md:table-cell">
                                                    {formatDateTime(backup.created_at)}
                                                </TableCell>
                                                <TableCell className="hidden lg:table-cell">
                                                    <span className="text-muted-foreground">{backup.notes ?? '-'}</span>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex items-center justify-end gap-1">
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
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            ) : (
                                <p className="py-8 text-center text-muted-foreground">
                                    {search ? 'No backups match your search' : 'No backups yet'}
                                </p>
                            )}

                            {/* Pagination */}
                            {backups && backups.total > 0 && (
                                <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <span>Rows per page</span>
                                        <Select
                                            value={String(backups.per_page)}
                                            onValueChange={changePerPage}
                                        >
                                            <SelectTrigger className="h-8 w-[70px]">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {PER_PAGE_OPTIONS.map((opt) => (
                                                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <span>
                                            {(backups.current_page - 1) * backups.per_page + 1}
                                            &ndash;
                                            {Math.min(backups.current_page * backups.per_page, backups.total)}
                                            {' '}of {backups.total}
                                        </span>
                                    </div>
                                    {backups.last_page > 1 && (
                                        <div className="flex items-center gap-1">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                disabled={backups.current_page <= 1}
                                                onClick={() => goToPage(backups.current_page - 1)}
                                            >
                                                <ChevronLeft className="size-4" />
                                            </Button>
                                            {Array.from({ length: backups.last_page }, (_, i) => i + 1).map((page) => (
                                                <Button
                                                    key={page}
                                                    variant={page === backups.current_page ? 'default' : 'outline'}
                                                    size="sm"
                                                    onClick={() => goToPage(page)}
                                                >
                                                    {page}
                                                </Button>
                                            ))}
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                disabled={backups.current_page >= backups.last_page}
                                                onClick={() => goToPage(backups.current_page + 1)}
                                            >
                                                <ChevronRight className="size-4" />
                                            </Button>
                                        </div>
                                    )}
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
                setSwitchBranch(false);
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
                        {/* Version mismatch warning */}
                        {rollbackTarget && current_version && rollbackTarget.game_version && rollbackTarget.game_version !== current_version && (
                            <div className="flex items-start gap-2 rounded-md border border-yellow-500/50 bg-yellow-500/10 p-3 text-sm text-yellow-700 dark:text-yellow-400">
                                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                                <div>
                                    <p className="font-medium">Version mismatch</p>
                                    <p>
                                        This backup was created on <strong>v{rollbackTarget.game_version}</strong>
                                        {rollbackTarget.steam_branch && <> ({rollbackTarget.steam_branch})</>},
                                        but the server is currently running <strong>v{current_version}</strong>
                                        {current_branch && <> ({current_branch})</>}.
                                        The save may not load correctly on a different game version.
                                    </p>
                                    {rollbackTarget.steam_branch && rollbackTarget.steam_branch !== current_branch && (
                                        <div className="mt-2 flex items-center gap-2">
                                            <Checkbox
                                                id="switch-branch"
                                                checked={switchBranch}
                                                onCheckedChange={(checked) => setSwitchBranch(checked === true)}
                                            />
                                            <Label htmlFor="switch-branch" className="cursor-pointer text-sm">
                                                Also switch to <strong>{rollbackTarget.steam_branch}</strong> branch after rollback
                                            </Label>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
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

            {/* Delete Single Confirmation */}
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

            {/* Delete Bulk Confirmation */}
            <Dialog open={showBulkDelete} onOpenChange={setShowBulkDelete}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete {selectedIds.size} Backup{selectedIds.size !== 1 ? 's' : ''}</DialogTitle>
                        <DialogDescription>
                            Permanently delete <strong>{selectedIds.size}</strong> selected backup{selectedIds.size !== 1 ? 's' : ''}? This cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowBulkDelete(false)}>Cancel</Button>
                        <Button
                            variant="destructive"
                            disabled={loading}
                            onClick={deleteBulk}
                        >
                            Delete {selectedIds.size} Backup{selectedIds.size !== 1 ? 's' : ''}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            {/* Import World Dialog */}
            <Dialog open={showImport} onOpenChange={(open) => {
                setShowImport(open);
                if (!open) {
                    setImportFile(null);
                    setImportConfirm(false);
                }
            }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Import World Save</DialogTitle>
                        <DialogDescription>
                            Upload a zip file containing PZ world save data. The server will be stopped,
                            a safety backup created, and the uploaded save extracted.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="flex items-start gap-2 rounded-md border border-yellow-500/50 bg-yellow-500/10 p-3 text-sm text-yellow-700 dark:text-yellow-400">
                            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                            <div>
                                <p className="font-medium">This will overwrite current save data</p>
                                <p>A pre-import safety backup will be created automatically before any changes are made.</p>
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="import-file">Zip file</Label>
                            <Input
                                id="import-file"
                                type="file"
                                accept=".zip"
                                onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
                            />
                            {importFile && (
                                <p className="text-xs text-muted-foreground">
                                    {importFile.name} ({(importFile.size / 1024 / 1024).toFixed(1)} MB)
                                </p>
                            )}
                        </div>
                        <div className="rounded-md border p-3 text-xs text-muted-foreground space-y-1">
                            <p className="font-medium text-foreground">Accepted zip layouts:</p>
                            <p><strong>Full backup</strong> — Server/, Saves/, db/ at root</p>
                            <p><strong>Save only</strong> — Saves/Multiplayer/&lt;Name&gt;/ at root</p>
                            <p><strong>Flat save</strong> — map files and players.db at root</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <Checkbox
                                id="import-confirm"
                                checked={importConfirm}
                                onCheckedChange={(checked) => setImportConfirm(checked === true)}
                            />
                            <Label htmlFor="import-confirm" className="cursor-pointer text-sm">
                                I understand this will stop the server and overwrite save data
                            </Label>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowImport(false)} disabled={importLoading}>
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            disabled={!importFile || !importConfirm || importLoading}
                            onClick={importWorld}
                        >
                            {importLoading ? (
                                <>
                                    <Loader2 className="mr-2 size-4 animate-spin" />
                                    Uploading...
                                </>
                            ) : (
                                <>
                                    <Upload className="mr-2 size-4" />
                                    Import World
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </AppLayout>
    );
}
