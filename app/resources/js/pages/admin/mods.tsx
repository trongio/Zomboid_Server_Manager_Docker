import { Head, router } from '@inertiajs/react';
import { Package, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import AppLayout from '@/layouts/app-layout';
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
import type { BreadcrumbItem, ModEntry } from '@/types';

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Dashboard', href: '/dashboard' },
    { title: 'Mods', href: '/admin/mods' },
];

export default function Mods({ mods }: { mods: ModEntry[] }) {
    const [showAdd, setShowAdd] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<ModEntry | null>(null);
    const [workshopId, setWorkshopId] = useState('');
    const [modId, setModId] = useState('');
    const [mapFolder, setMapFolder] = useState('');
    const [loading, setLoading] = useState(false);

    const csrfToken = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '';

    function addMod() {
        setLoading(true);
        fetch('/admin/mods', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrfToken },
            body: JSON.stringify({ workshop_id: workshopId, mod_id: modId, map_folder: mapFolder || null }),
        }).finally(() => {
            setLoading(false);
            setShowAdd(false);
            setWorkshopId('');
            setModId('');
            setMapFolder('');
            router.reload({ only: ['mods'] });
        });
    }

    function removeMod(mod: ModEntry) {
        setLoading(true);
        fetch(`/admin/mods/${mod.workshop_id}`, {
            method: 'DELETE',
            headers: { 'X-CSRF-TOKEN': csrfToken },
        }).finally(() => {
            setLoading(false);
            setDeleteTarget(null);
            router.reload({ only: ['mods'] });
        });
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
                        <CardTitle className="flex items-center gap-2">
                            <Package className="size-5" />
                            Installed Mods
                        </CardTitle>
                        <CardDescription>
                            Steam Workshop mods synced to server.ini. Changes require a server restart.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {mods.length > 0 ? (
                            <div className="space-y-2">
                                {mods.map((mod) => (
                                    <div
                                        key={mod.workshop_id}
                                        className="flex items-center justify-between rounded-lg border border-border/50 px-4 py-3"
                                    >
                                        <div className="flex items-center gap-3">
                                            <span className="text-xs font-mono text-muted-foreground w-6">
                                                #{mod.position + 1}
                                            </span>
                                            <div>
                                                <span className="font-medium">{mod.mod_id}</span>
                                                <Badge variant="secondary" className="ml-2 text-xs">
                                                    {mod.workshop_id}
                                                </Badge>
                                            </div>
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="text-destructive hover:text-destructive"
                                            onClick={() => setDeleteTarget(mod)}
                                        >
                                            <Trash2 className="size-4" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="py-8 text-center text-muted-foreground">No mods installed</p>
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
