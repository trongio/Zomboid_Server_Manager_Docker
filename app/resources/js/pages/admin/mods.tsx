import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Head, router } from '@inertiajs/react';
import { AlertTriangle, GripVertical, Package, Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { fetchAction } from '@/lib/fetch-action';
import AppLayout from '@/layouts/app-layout';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useTranslation } from '@/hooks/use-translation';
import type { BreadcrumbItem, ModEntry } from '@/types';

const PROTECTED_WORKSHOP_IDS = new Set(['3685323705']);

function SortableModRow({
    mod,
    index,
    onDelete,
    isDragDisabled,
}: {
    mod: ModEntry;
    index: number;
    onDelete: (mod: ModEntry) => void;
    isDragDisabled: boolean;
}) {
    const { t } = useTranslation();
    const isProtected = PROTECTED_WORKSHOP_IDS.has(mod.workshop_id);
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

export default function Mods({ mods }: { mods: ModEntry[] }) {
    const { t } = useTranslation();

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
    const [search, setSearch] = useState('');
    const [orderedMods, setOrderedMods] = useState(mods);
    const [restartRequired, setRestartRequired] = useState(false);

    const isFiltering = search.length > 0;

    useEffect(() => {
        setOrderedMods(mods);
    }, [mods]);

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

        const result = await fetchAction('/admin/mods/order', {
            method: 'PUT',
            data: {
                mods: reordered.map((m) => ({ workshop_id: m.workshop_id, mod_id: m.mod_id })),
            },
            successMessage: t('admin.mods.toast_order_updated'),
        });

        setRestartRequired(Boolean(result?.restart_required));

        router.reload({ only: ['mods'] });
    }

    async function addMod() {
        setLoading(true);
        await fetchAction('/admin/mods', {
            data: { workshop_id: workshopId, mod_id: modId, map_folder: mapFolder || null },
            successMessage: t('admin.mods.toast_added', { mod_id: modId }),
        });
        setLoading(false);
        setShowAdd(false);
        setWorkshopId('');
        setModId('');
        setMapFolder('');
        router.reload({ only: ['mods'] });
    }

    async function removeMod(mod: ModEntry) {
        setLoading(true);
        await fetchAction(`/admin/mods/${mod.workshop_id}`, {
            method: 'DELETE',
            successMessage: t('admin.mods.toast_removed', { mod_id: mod.mod_id }),
        });
        setLoading(false);
        setDeleteTarget(null);
        router.reload({ only: ['mods'] });
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
                        {restartRequired && (
                            <Alert className="mb-4">
                                <AlertTriangle className="size-4" />
                                <AlertDescription>
                                    {t('admin.mods.restart_required')}
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
            <Dialog open={showAdd} onOpenChange={setShowAdd}>
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
                            <Input
                                id="workshop-id"
                                value={workshopId}
                                onChange={(e) => setWorkshopId(e.target.value)}
                                placeholder={t('admin.mods.workshop_id_placeholder')}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="mod-id">{t('admin.mods.table_mod_id')}</Label>
                            <Input
                                id="mod-id"
                                value={modId}
                                onChange={(e) => setModId(e.target.value)}
                                placeholder={t('admin.mods.mod_id_placeholder')}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="map-folder">{t('admin.mods.map_folder_label')}</Label>
                            <Input
                                id="map-folder"
                                value={mapFolder}
                                onChange={(e) => setMapFolder(e.target.value)}
                                placeholder={t('admin.mods.map_folder_placeholder')}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowAdd(false)}>{t('common.cancel')}</Button>
                        <Button disabled={loading || !workshopId || !modId} onClick={addMod}>
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
