import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors  } from '@dnd-kit/core';
import type {DragEndEvent} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Head, router } from '@inertiajs/react';
import { AlertTriangle, CheckCircle2, Clock, GripVertical, Loader2, Package, Pencil, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
import { fetchAction } from '@/lib/fetch-action';
import type { BreadcrumbItem, ModEntry } from '@/types';

type LookupResult = {
    found: boolean;
    workshop_id: string;
    title?: string;
    preview_url?: string | null;
    mod_ids?: string[];
    map_folders?: string[];
};

type LookupState =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'success'; title: string; previewUrl: string | null; modIds: string[]; mapFolders: string[] }
    | { status: 'not_found' }
    | { status: 'no_mod_ids'; title: string; previewUrl: string | null; mapFolders: string[] }
    | { status: 'error' };

function StatusBadge({ status }: { status: ModEntry['status'] }) {
    const { t } = useTranslation();

    if (status === 'active') {
        return (
            <Badge
                variant="outline"
                className="gap-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                data-testid="mod-status-active"
            >
                <CheckCircle2 className="size-3" />
                {t('admin.mods.status_active')}
            </Badge>
        );
    }

    if (status === 'pending_restart') {
        return (
            <Badge
                variant="outline"
                className="gap-1 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                data-testid="mod-status-pending"
            >
                <Clock className="size-3" />
                {t('admin.mods.status_pending')}
            </Badge>
        );
    }

    return (
        <Badge variant="outline" className="gap-1 text-muted-foreground" data-testid="mod-status-stopped">
            {t('admin.mods.status_stopped')}
        </Badge>
    );
}

function SortableModRow({
    mod,
    index,
    onDelete,
    isDragDisabled,
    isProtected,
}: {
    mod: ModEntry;
    index: number;
    onDelete: (mod: ModEntry) => void;
    isDragDisabled: boolean;
    isProtected: boolean;
}) {
    const { t } = useTranslation();
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: mod.workshop_id,
        disabled: isDragDisabled,
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : undefined,
    };

    return (
        <TableRow ref={setNodeRef} style={style} className={isDragging ? 'bg-muted' : undefined}>
            <TableCell className="w-[50px]">
                {!isDragDisabled ? (
                    <button
                        type="button"
                        aria-label={`Reorder ${mod.mod_id}`}
                        className="cursor-grab touch-none text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        {...attributes}
                        {...listeners}
                    >
                        <GripVertical className="size-4" />
                    </button>
                ) : (
                    <span className="font-mono text-xs text-muted-foreground">{index + 1}</span>
                )}
            </TableCell>
            <TableCell className="font-medium">
                <span className="flex items-center gap-2">
                    {mod.mod_id}
                    {isProtected && (
                        <Badge variant="outline" className="text-xs">
                            {t('admin.mods.required_badge')}
                        </Badge>
                    )}
                </span>
            </TableCell>
            <TableCell className="hidden sm:table-cell">
                <Badge variant="secondary" className="text-xs">
                    {mod.workshop_id}
                </Badge>
            </TableCell>
            <TableCell>
                <StatusBadge status={mod.status} />
            </TableCell>
            <TableCell className="text-right">
                {!isProtected && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => onDelete(mod)}
                    >
                        <Trash2 className="size-4" />
                    </Button>
                )}
            </TableCell>
        </TableRow>
    );
}

export default function Mods({
    mods,
    protectedWorkshopIds = [],
    pendingRestart = false,
    serverRunning = false,
}: {
    mods: ModEntry[];
    protectedWorkshopIds?: string[];
    pendingRestart?: boolean;
    serverRunning?: boolean;
}) {
    const { t } = useTranslation();
    const protectedSet = useMemo(() => new Set(protectedWorkshopIds), [protectedWorkshopIds]);

    const breadcrumbs: BreadcrumbItem[] = [
        { title: t('nav.dashboard'), href: '/dashboard' },
        { title: t('admin.mods.title'), href: '/admin/mods' },
    ];
    const [showAdd, setShowAdd] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<ModEntry | null>(null);
    const [workshopId, setWorkshopId] = useState('');
    const [modId, setModId] = useState('');
    const [mapFolder, setMapFolder] = useState('');
    const [loading, setLoading] = useState(false);
    const [restarting, setRestarting] = useState(false);
    const [search, setSearch] = useState('');
    const [orderedMods, setOrderedMods] = useState(mods);
    const [lookup, setLookup] = useState<LookupState>({ status: 'idle' });
    const [manualOverride, setManualOverride] = useState(false);
    const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lookupAbort = useRef<AbortController | null>(null);

    const isFiltering = search.length > 0;

    useEffect(() => {
        setOrderedMods(mods);
    }, [mods]);

    const resetLookupState = useCallback(() => {
        setLookup({ status: 'idle' });
        setModId('');
        setMapFolder('');
        setManualOverride(false);
    }, []);

    const runLookup = useCallback(async (rawId: string) => {
        const trimmed = rawId.trim();
        if (!/^\d{1,20}$/.test(trimmed)) {
            setLookup({ status: 'idle' });
            return;
        }

        lookupAbort.current?.abort();
        const controller = new AbortController();
        lookupAbort.current = controller;
        setLookup({ status: 'loading' });

        const csrfToken =
            document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '';

        try {
            const res = await fetch('/admin/mods/lookup', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-CSRF-TOKEN': csrfToken,
                },
                body: JSON.stringify({ workshop_id: trimmed }),
                signal: controller.signal,
            });
            const json = (await res.json().catch(() => ({}))) as LookupResult;

            if (res.status === 404 || json.found === false) {
                setLookup({ status: 'not_found' });
                setModId('');
                setMapFolder('');
                setManualOverride(true);
                return;
            }

            if (!res.ok) {
                setLookup({ status: 'error' });
                setManualOverride(true);
                return;
            }

            const modIds = json.mod_ids ?? [];
            const mapFolders = json.map_folders ?? [];
            const title = json.title ?? '';
            const previewUrl = json.preview_url ?? null;

            if (modIds.length === 0) {
                setLookup({ status: 'no_mod_ids', title, previewUrl, mapFolders });
                setModId('');
                setMapFolder(mapFolders[0] ?? '');
                setManualOverride(true);
                return;
            }

            setLookup({ status: 'success', title, previewUrl, modIds, mapFolders });
            setModId(modIds[0]);
            setMapFolder(mapFolders[0] ?? '');
            setManualOverride(false);
        } catch (err) {
            if ((err as DOMException)?.name === 'AbortError') return;
            setLookup({ status: 'error' });
            setManualOverride(true);
        }
    }, []);

    useEffect(() => {
        if (!showAdd) {
            return;
        }
        if (lookupTimer.current) {
            clearTimeout(lookupTimer.current);
        }
        const trimmed = workshopId.trim();
        if (trimmed === '') {
            resetLookupState();
            return;
        }
        lookupTimer.current = setTimeout(() => {
            runLookup(trimmed);
        }, 400);
        return () => {
            if (lookupTimer.current) clearTimeout(lookupTimer.current);
        };
    }, [workshopId, showAdd, runLookup, resetLookupState]);

    const filteredMods = useMemo(() => {
        if (!search) return orderedMods;
        const q = search.toLowerCase();
        return orderedMods.filter((m) => m.mod_id.toLowerCase().includes(q) || m.workshop_id.toLowerCase().includes(q));
    }, [orderedMods, search]);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    async function handleDragEnd(event: DragEndEvent) {
        const { active, over } = event;
        if (!over || active.id === over.id) return;

        const oldIndex = orderedMods.findIndex((m) => m.workshop_id === active.id);
        const newIndex = orderedMods.findIndex((m) => m.workshop_id === over.id);
        const reordered = arrayMove(orderedMods, oldIndex, newIndex);

        setOrderedMods(reordered);

        await fetchAction('/admin/mods/order', {
            method: 'PUT',
            data: {
                mods: reordered.map((m) => ({ workshop_id: m.workshop_id, mod_id: m.mod_id })),
            },
            successMessage: t('admin.mods.toast_order_updated'),
        });

        router.reload({ only: ['mods', 'pendingRestart', 'serverRunning'] });
    }

    async function restartServer() {
        setRestarting(true);
        await fetchAction('/admin/server/restart', {
            method: 'POST',
            successMessage: t('admin.mods.toast_restart_started'),
        });
        setRestarting(false);
        router.reload({ only: ['mods', 'pendingRestart', 'serverRunning'] });
    }

    function closeAddDialog() {
        setShowAdd(false);
        setWorkshopId('');
        resetLookupState();
    }

    async function addMod() {
        setLoading(true);
        await fetchAction('/admin/mods', {
            data: { workshop_id: workshopId, mod_id: modId, map_folder: mapFolder || null },
            successMessage: t('admin.mods.toast_added', { mod_id: modId }),
        });
        setLoading(false);
        closeAddDialog();
        router.reload({ only: ['mods', 'pendingRestart', 'serverRunning'] });
    }

    async function removeMod(mod: ModEntry) {
        setLoading(true);
        await fetchAction(`/admin/mods/${mod.workshop_id}`, {
            method: 'DELETE',
            successMessage: t('admin.mods.toast_removed', { mod_id: mod.mod_id }),
        });
        setLoading(false);
        setDeleteTarget(null);
        router.reload({ only: ['mods', 'pendingRestart', 'serverRunning'] });
    }

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title={t('admin.mods.title')} />
            <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">{t('admin.mods.title')}</h1>
                        <p className="text-muted-foreground">
                            {t('admin.mods.mods_installed', { count: String(mods.length) })}
                        </p>
                    </div>
                    <Button onClick={() => setShowAdd(true)}>
                        <Plus className="mr-1.5 size-4" />
                        {t('admin.mods.add_mod')}
                    </Button>
                </div>

                <Card>
                    <CardHeader>
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <CardTitle className="flex items-center gap-2">
                                    <Package className="size-5" />
                                    {t('admin.mods.installed_mods')}
                                </CardTitle>
                                <CardDescription>
                                    {t('admin.mods.installed_mods_description', { filtered: String(filteredMods.length), total: String(mods.length) })}
                                </CardDescription>
                            </div>
                            <div className="relative">
                                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                                <Input
                                    placeholder={t('admin.mods.search_placeholder')}
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    className="pl-9 sm:w-[200px]"
                                />
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {pendingRestart && (
                            <Alert
                                className="mb-4 border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200 [&>svg]:text-amber-600"
                                data-testid="pending-restart-banner"
                            >
                                <AlertTriangle className="size-4" />
                                <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <span>{t('admin.mods.pending_restart_banner')}</span>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={restarting || !serverRunning}
                                        onClick={restartServer}
                                        data-testid="restart-server-button"
                                    >
                                        <RotateCcw className={`mr-1.5 size-4 ${restarting ? 'animate-spin' : ''}`} />
                                        {restarting ? t('admin.mods.restarting') : t('admin.mods.restart_now')}
                                    </Button>
                                </AlertDescription>
                            </Alert>
                        )}
                        {filteredMods.length > 0 ? (
                            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-[50px]">{isFiltering ? '#' : ''}</TableHead>
                                            <TableHead>{t('admin.mods.table_mod_id')}</TableHead>
                                            <TableHead className="hidden sm:table-cell">{t('admin.mods.table_workshop_id')}</TableHead>
                                            <TableHead>{t('admin.mods.table_status')}</TableHead>
                                            <TableHead className="text-right">{t('common.actions')}</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <SortableContext
                                        items={filteredMods.map((m) => m.workshop_id)}
                                        strategy={verticalListSortingStrategy}
                                    >
                                        <TableBody>
                                            {filteredMods.map((mod, index) => (
                                                <SortableModRow
                                                    key={mod.workshop_id}
                                                    mod={mod}
                                                    index={index}
                                                    onDelete={setDeleteTarget}
                                                    isDragDisabled={isFiltering}
                                                    isProtected={protectedSet.has(mod.workshop_id)}
                                                />
                                            ))}
                                        </TableBody>
                                    </SortableContext>
                                </Table>
                            </DndContext>
                        ) : (
                            <p className="py-8 text-center text-muted-foreground">
                                {search ? t('admin.mods.no_mods_search') : t('admin.mods.no_mods')}
                            </p>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Add Mod Dialog */}
            <Dialog open={showAdd} onOpenChange={(open) => (open ? setShowAdd(true) : closeAddDialog())}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('admin.mods.add_dialog_title')}</DialogTitle>
                        <DialogDescription>
                            {t('admin.mods.add_dialog_description')}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="workshop-id">{t('admin.mods.table_workshop_id')}</Label>
                            <div className="relative">
                                <Input
                                    id="workshop-id"
                                    inputMode="numeric"
                                    value={workshopId}
                                    onChange={(e) => setWorkshopId(e.target.value)}
                                    placeholder={t('admin.mods.workshop_id_placeholder')}
                                    data-testid="workshop-id-input"
                                />
                                {lookup.status === 'loading' && (
                                    <Loader2 className="absolute right-2.5 top-2.5 size-4 animate-spin text-muted-foreground" />
                                )}
                            </div>
                            {(lookup.status === 'success' || lookup.status === 'no_mod_ids') && (
                                <div
                                    className="flex items-center gap-3 rounded-md border bg-muted/30 p-2"
                                    data-testid="workshop-preview"
                                >
                                    {lookup.previewUrl && (
                                        <img
                                            src={lookup.previewUrl}
                                            alt=""
                                            className="size-10 rounded object-cover"
                                        />
                                    )}
                                    <p className="line-clamp-2 text-sm text-muted-foreground">
                                        {lookup.title}
                                    </p>
                                </div>
                            )}
                            {lookup.status === 'not_found' && (
                                <p className="text-xs text-amber-600 dark:text-amber-400">
                                    {t('admin.mods.lookup_not_found')}
                                </p>
                            )}
                            {lookup.status === 'error' && (
                                <p className="text-xs text-destructive">
                                    {t('admin.mods.lookup_error')}
                                </p>
                            )}
                            {lookup.status === 'no_mod_ids' && (
                                <p className="text-xs text-amber-600 dark:text-amber-400">
                                    {t('admin.mods.lookup_no_mod_ids')}
                                </p>
                            )}
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label htmlFor="mod-id">{t('admin.mods.table_mod_id')}</Label>
                                {lookup.status === 'success' && !manualOverride && (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-auto px-2 py-0.5 text-xs"
                                        onClick={() => setManualOverride(true)}
                                        data-testid="mod-id-edit-manually"
                                    >
                                        <Pencil className="mr-1 size-3" />
                                        {t('admin.mods.edit_manually')}
                                    </Button>
                                )}
                            </div>
                            {lookup.status === 'success' && lookup.modIds.length > 1 && !manualOverride ? (
                                <Select value={modId} onValueChange={setModId}>
                                    <SelectTrigger id="mod-id" data-testid="mod-id-select">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {lookup.modIds.map((id) => (
                                            <SelectItem key={id} value={id}>
                                                {id}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : (
                                <Input
                                    id="mod-id"
                                    value={modId}
                                    onChange={(e) => setModId(e.target.value)}
                                    placeholder={t('admin.mods.mod_id_placeholder')}
                                    disabled={
                                        lookup.status === 'loading' ||
                                        (lookup.status === 'success' && !manualOverride)
                                    }
                                    data-testid="mod-id-input"
                                />
                            )}
                            {lookup.status === 'success' && !manualOverride && (
                                <p className="text-xs text-muted-foreground">
                                    {t('admin.mods.mod_id_auto_filled')}
                                </p>
                            )}
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="map-folder">{t('admin.mods.map_folder_label')}</Label>
                            {lookup.status === 'success' && lookup.mapFolders.length > 1 ? (
                                <Select value={mapFolder || '__none__'} onValueChange={(v) => setMapFolder(v === '__none__' ? '' : v)}>
                                    <SelectTrigger id="map-folder">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="__none__">{t('admin.mods.map_folder_none')}</SelectItem>
                                        {lookup.mapFolders.map((f) => (
                                            <SelectItem key={f} value={f}>
                                                {f}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : (
                                <Input
                                    id="map-folder"
                                    value={mapFolder}
                                    onChange={(e) => setMapFolder(e.target.value)}
                                    placeholder={t('admin.mods.map_folder_placeholder')}
                                />
                            )}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={closeAddDialog}>{t('common.cancel')}</Button>
                        <Button disabled={loading || !workshopId || !modId || lookup.status === 'loading'} onClick={addMod}>
                            {t('admin.mods.add_mod')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation Dialog */}
            <Dialog open={deleteTarget !== null} onOpenChange={() => setDeleteTarget(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('admin.mods.delete_dialog_title')}</DialogTitle>
                        <DialogDescription>
                            {t('admin.mods.delete_dialog_description', { mod_id: deleteTarget?.mod_id ?? '', workshop_id: deleteTarget?.workshop_id ?? '' })}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</Button>
                        <Button
                            variant="destructive"
                            disabled={loading}
                            onClick={() => deleteTarget && removeMod(deleteTarget)}
                        >
                            {t('admin.mods.delete_dialog_title')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </AppLayout>
    );
}
