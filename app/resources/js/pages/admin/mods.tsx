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
import type { BreadcrumbItem, ModEntry } from '@/types';

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Dashboard', href: '/dashboard' },
    { title: 'Mods', href: '/admin/mods' },
];

function SortableModRow({
    mod,
    onDelete,
    isDragDisabled,
}: {
    mod: ModEntry;
    onDelete: (mod: ModEntry) => void;
    isDragDisabled: boolean;
}) {
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
                        className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
                        {...attributes}
                        {...listeners}
                    >
                        <GripVertical className="size-4" />
                    </button>
                ) : (
                    <span className="font-mono text-xs text-muted-foreground">{mod.position + 1}</span>
                )}
            </TableCell>
            <TableCell className="font-medium">{mod.mod_id}</TableCell>
            <TableCell className="hidden sm:table-cell">
                <Badge variant="secondary" className="text-xs">
                    {mod.workshop_id}
                </Badge>
            </TableCell>
            <TableCell className="text-right">
                <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => onDelete(mod)}
                >
                    <Trash2 className="size-4" />
                </Button>
            </TableCell>
        </TableRow>
    );
}

export default function Mods({ mods }: { mods: ModEntry[] }) {
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
            successMessage: 'Mod load order updated',
        });

        if (result?.restart_required) {
            setRestartRequired(true);
        }

        router.reload({ only: ['mods'] });
    }

    async function addMod() {
        setLoading(true);
        await fetchAction('/admin/mods', {
            data: { workshop_id: workshopId, mod_id: modId, map_folder: mapFolder || null },
            successMessage: `Added mod ${modId}`,
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
            successMessage: `Removed mod ${mod.mod_id}`,
        });
        setLoading(false);
        setDeleteTarget(null);
        router.reload({ only: ['mods'] });
    }

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="Mod Manager" />
            <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Mod Manager</h1>
                        <p className="text-muted-foreground">
                            {mods.length} mod{mods.length !== 1 ? 's' : ''} installed
                        </p>
                    </div>
                    <Button onClick={() => setShowAdd(true)}>
                        <Plus className="mr-1.5 size-4" />
                        Add Mod
                    </Button>
                </div>

                <Card>
                    <CardHeader>
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <CardTitle className="flex items-center gap-2">
                                    <Package className="size-5" />
                                    Installed Mods
                                </CardTitle>
                                <CardDescription>
                                    {filteredMods.length} of {mods.length} mods &middot; Drag to reorder load order
                                </CardDescription>
                            </div>
                            <div className="relative">
                                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                                <Input
                                    placeholder="Search mods..."
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
                                    Mod load order changed. A server restart is required for changes to take effect.
                                </AlertDescription>
                            </Alert>
                        )}
                        {filteredMods.length > 0 ? (
                            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-[50px]">{isFiltering ? '#' : ''}</TableHead>
                                            <TableHead>Mod ID</TableHead>
                                            <TableHead className="hidden sm:table-cell">Workshop ID</TableHead>
                                            <TableHead className="text-right">Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <SortableContext
                                        items={filteredMods.map((m) => m.workshop_id)}
                                        strategy={verticalListSortingStrategy}
                                    >
                                        <TableBody>
                                            {filteredMods.map((mod) => (
                                                <SortableModRow
                                                    key={mod.workshop_id}
                                                    mod={mod}
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
                                {search ? 'No mods match your search' : 'No mods installed'}
                            </p>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Add Mod Dialog */}
            <Dialog open={showAdd} onOpenChange={setShowAdd}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Add Mod</DialogTitle>
                        <DialogDescription>
                            Add a Steam Workshop mod. Both Workshop ID and Mod ID are required.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="workshop-id">Workshop ID</Label>
                            <Input
                                id="workshop-id"
                                value={workshopId}
                                onChange={(e) => setWorkshopId(e.target.value)}
                                placeholder="e.g. 2313387159"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="mod-id">Mod ID</Label>
                            <Input
                                id="mod-id"
                                value={modId}
                                onChange={(e) => setModId(e.target.value)}
                                placeholder="e.g. Arsenal(26)GunFighter"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="map-folder">Map Folder (optional)</Label>
                            <Input
                                id="map-folder"
                                value={mapFolder}
                                onChange={(e) => setMapFolder(e.target.value)}
                                placeholder="Only for map mods"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
                        <Button disabled={loading || !workshopId || !modId} onClick={addMod}>
                            Add Mod
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation Dialog */}
            <Dialog open={deleteTarget !== null} onOpenChange={() => setDeleteTarget(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Remove Mod</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to remove <strong>{deleteTarget?.mod_id}</strong> ({deleteTarget?.workshop_id})?
                            A server restart will be required.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
                        <Button
                            variant="destructive"
                            disabled={loading}
                            onClick={() => deleteTarget && removeMod(deleteTarget)}
                        >
                            Remove Mod
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </AppLayout>
    );
}
