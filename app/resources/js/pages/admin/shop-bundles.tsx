import { Head, router } from '@inertiajs/react';
import { Package, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import AppLayout from '@/layouts/app-layout';
import { fetchAction } from '@/lib/fetch-action';
import type { BreadcrumbItem } from '@/types';
import type { ShopBundle, ShopItem } from '@/types/server';

type Props = {
    bundles: ShopBundle[];
    shopItems: ShopItem[];
};

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Dashboard', href: '/dashboard' },
    { title: 'Shop', href: '/admin/shop' },
    { title: 'Bundles', href: '/admin/shop/bundles' },
];

type BundleItemEntry = { shop_item_id: string; quantity: number };

export default function ShopBundles({ bundles, shopItems }: Props) {
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editBundle, setEditBundle] = useState<ShopBundle | null>(null);
    const [loading, setLoading] = useState(false);

    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [price, setPrice] = useState('');
    const [maxPerPlayer, setMaxPerPlayer] = useState('');
    const [bundleItems, setBundleItems] = useState<BundleItemEntry[]>([]);

    function openCreate() {
        setEditBundle(null);
        setName('');
        setDescription('');
        setPrice('');
        setMaxPerPlayer('');
        setBundleItems([{ shop_item_id: '', quantity: 1 }]);
        setDialogOpen(true);
    }

    function openEdit(bundle: ShopBundle) {
        setEditBundle(bundle);
        setName(bundle.name);
        setDescription(bundle.description || '');
        setPrice(bundle.price);
        setMaxPerPlayer(bundle.max_per_player?.toString() || '');
        setBundleItems(
            bundle.items.map((i) => ({
                shop_item_id: i.id,
                quantity: i.pivot.quantity,
            })),
        );
        setDialogOpen(true);
    }

    function addBundleItem() {
        setBundleItems([...bundleItems, { shop_item_id: '', quantity: 1 }]);
    }

    function removeBundleItem(idx: number) {
        setBundleItems(bundleItems.filter((_, i) => i !== idx));
    }

    function updateBundleItem(idx: number, field: keyof BundleItemEntry, value: string | number) {
        const updated = [...bundleItems];
        updated[idx] = { ...updated[idx], [field]: value };
        setBundleItems(updated);
    }

    async function handleSave() {
        setLoading(true);
        const data: Record<string, unknown> = {
            name,
            description: description || null,
            price: parseFloat(price),
            max_per_player: maxPerPlayer ? parseInt(maxPerPlayer) : null,
            items: bundleItems.filter((i) => i.shop_item_id),
        };

        if (editBundle) {
            await fetchAction(`/admin/shop/bundles/${editBundle.id}`, {
                method: 'PATCH',
                data,
                successMessage: 'Bundle updated',
            });
        } else {
            await fetchAction('/admin/shop/bundles', {
                data,
                successMessage: 'Bundle created',
            });
        }
        setLoading(false);
        setDialogOpen(false);
        router.reload();
    }

    async function handleDelete(bundle: ShopBundle) {
        await fetchAction(`/admin/shop/bundles/${bundle.id}`, {
            method: 'DELETE',
            successMessage: 'Bundle deleted',
        });
        router.reload();
    }

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="Shop Bundles" />
            <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Bundles</h1>
                        <p className="text-muted-foreground text-sm">
                            Manage item bundles for the shop
                        </p>
                    </div>
                    <Button onClick={openCreate}>
                        <Plus className="mr-1.5 size-4" />
                        Create Bundle
                    </Button>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>All Bundles</CardTitle>
                        <CardDescription>{bundles.length} bundles</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {bundles.length > 0 ? (
                            <div className="space-y-3">
                                {bundles.map((bundle) => (
                                    <div
                                        key={bundle.id}
                                        className="rounded-lg border border-border/50 p-4"
                                    >
                                        <div className="flex items-start justify-between">
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <span className="font-medium">{bundle.name}</span>
                                                    <Badge variant="secondary" className="tabular-nums text-xs">
                                                        {parseFloat(bundle.price).toFixed(2)}
                                                    </Badge>
                                                    <Badge
                                                        variant={bundle.is_active ? 'default' : 'destructive'}
                                                        className="text-xs"
                                                    >
                                                        {bundle.is_active ? 'Active' : 'Inactive'}
                                                    </Badge>
                                                </div>
                                                {bundle.description && (
                                                    <p className="text-muted-foreground mt-1 text-sm">
                                                        {bundle.description}
                                                    </p>
                                                )}
                                            </div>
                                            <div className="flex gap-1">
                                                <Button variant="ghost" size="sm" onClick={() => openEdit(bundle)}>
                                                    Edit
                                                </Button>
                                                <Button variant="ghost" size="sm" onClick={() => handleDelete(bundle)}>
                                                    <Trash2 className="size-4 text-destructive" />
                                                </Button>
                                            </div>
                                        </div>
                                        <div className="mt-3 flex flex-wrap gap-2">
                                            {bundle.items.map((item) => (
                                                <div
                                                    key={item.id}
                                                    className="flex items-center gap-2 rounded-md bg-muted px-2 py-1 text-xs"
                                                >
                                                    <img
                                                        src={item.icon || '/images/items/placeholder.svg'}
                                                        alt={item.name}
                                                        width={16}
                                                        height={16}
                                                        className="rounded object-contain"
                                                    />
                                                    <span>{item.name}</span>
                                                    <Badge variant="outline" className="text-xs">
                                                        x{item.pivot.quantity}
                                                    </Badge>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-muted-foreground py-8 text-center">
                                No bundles yet. Create one to get started.
                            </p>
                        )}
                    </CardContent>
                </Card>
            </div>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{editBundle ? 'Edit Bundle' : 'Create Bundle'}</DialogTitle>
                        <DialogDescription>
                            {editBundle ? 'Update bundle details.' : 'Create a new item bundle.'}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
                        <div className="space-y-2">
                            <Label>Name</Label>
                            <Input value={name} onChange={(e) => setName(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label>Description</Label>
                            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Price</Label>
                                <Input
                                    type="number"
                                    step="0.01"
                                    min={0}
                                    value={price}
                                    onChange={(e) => setPrice(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Max Per Player</Label>
                                <Input
                                    type="number"
                                    min={1}
                                    placeholder="Unlimited"
                                    value={maxPerPlayer}
                                    onChange={(e) => setMaxPerPlayer(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label>Bundle Items</Label>
                                <Button variant="outline" size="sm" onClick={addBundleItem}>
                                    <Plus className="mr-1 size-3" />
                                    Add
                                </Button>
                            </div>
                            {bundleItems.map((entry, idx) => (
                                <div key={idx} className="flex items-center gap-2">
                                    <Select
                                        value={entry.shop_item_id}
                                        onValueChange={(v) => updateBundleItem(idx, 'shop_item_id', v)}
                                    >
                                        <SelectTrigger className="flex-1">
                                            <SelectValue placeholder="Select item..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {shopItems.map((si) => (
                                                <SelectItem key={si.id} value={si.id}>
                                                    {si.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <Input
                                        type="number"
                                        min={1}
                                        className="w-20"
                                        value={entry.quantity}
                                        onChange={(e) =>
                                            updateBundleItem(idx, 'quantity', Math.max(1, parseInt(e.target.value) || 1))
                                        }
                                    />
                                    <Button variant="ghost" size="sm" onClick={() => removeBundleItem(idx)}>
                                        <Trash2 className="size-3.5 text-destructive" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            disabled={!name || !price || bundleItems.filter((i) => i.shop_item_id).length === 0 || loading}
                            onClick={handleSave}
                        >
                            {editBundle ? 'Update' : 'Create'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </AppLayout>
    );
}
