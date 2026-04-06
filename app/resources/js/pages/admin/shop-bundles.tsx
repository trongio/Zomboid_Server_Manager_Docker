import { Head, router } from '@inertiajs/react';
import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { SortableHeader } from '@/components/sortable-header';
import { useTableSort } from '@/hooks/use-table-sort';
import { useTranslation } from '@/hooks/use-translation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Textarea } from '@/components/ui/textarea';
import AppLayout from '@/layouts/app-layout';
import { fetchAction } from '@/lib/fetch-action';
import type { BreadcrumbItem } from '@/types';
import type { ShopBundle, ShopItem } from '@/types/server';

function coin(value: string | number): number {
    return Math.round(typeof value === 'string' ? parseFloat(value) : value);
}

type Props = {
    bundles: ShopBundle[];
    shopItems: ShopItem[];
};

type BundleItemEntry = { shop_item_id: string; quantity: number };
type SortKey = 'name' | 'discount_percent' | 'price' | 'is_active';

export default function ShopBundles({ bundles, shopItems }: Props) {
    const { t } = useTranslation();
    const [dialogOpen, setDialogOpen] = useState(false);
    const { sortKey, sortDir, toggleSort } = useTableSort<SortKey>('name', 'asc');
    const [editBundle, setEditBundle] = useState<ShopBundle | null>(null);
    const [loading, setLoading] = useState(false);

    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [discountPercent, setDiscountPercent] = useState('10');
    const [maxPerPlayer, setMaxPerPlayer] = useState('');
    const [bundleItems, setBundleItems] = useState<BundleItemEntry[]>([]);
    const [featured, setFeatured] = useState(false);

    const itemsTotal = useMemo(() => {
        return bundleItems.reduce((sum, entry) => {
            const item = shopItems.find((i) => i.id === entry.shop_item_id);
            return sum + (item ? parseFloat(item.price) * entry.quantity : 0);
        }, 0);
    }, [bundleItems, shopItems]);

    const calculatedPrice = useMemo(() => {
        const discount = parseFloat(discountPercent) || 0;
        return Math.round(itemsTotal * (1 - discount / 100));
    }, [itemsTotal, discountPercent]);

    function openCreate() {
        setEditBundle(null);
        setName('');
        setDescription('');
        setDiscountPercent('10');
        setMaxPerPlayer('');
        setBundleItems([{ shop_item_id: '', quantity: 1 }]);
        setFeatured(false);
        setDialogOpen(true);
    }

    function openEdit(bundle: ShopBundle) {
        setEditBundle(bundle);
        setName(bundle.name);
        setDescription(bundle.description || '');
        setDiscountPercent(bundle.discount_percent?.toString() || '10');
        setMaxPerPlayer(bundle.max_per_player?.toString() || '');
        setBundleItems(
            bundle.items.map((i) => ({
                shop_item_id: i.id,
                quantity: i.pivot.quantity,
            })),
        );
        setFeatured(bundle.is_featured);
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
            discount_percent: parseFloat(discountPercent) || 0,
            max_per_player: maxPerPlayer ? parseInt(maxPerPlayer) : null,
            items: bundleItems.filter((i) => i.shop_item_id),
            is_featured: featured,
        };

        if (editBundle) {
            await fetchAction(`/admin/shop/bundles/${editBundle.id}`, {
                method: 'PATCH',
                data,
                successMessage: t('admin.shop_bundles.bundle_updated'),
            });
        } else {
            await fetchAction('/admin/shop/bundles', {
                data,
                successMessage: t('admin.shop_bundles.bundle_created'),
            });
        }
        setLoading(false);
        setDialogOpen(false);
        router.reload();
    }

    async function handleDelete(bundle: ShopBundle) {
        await fetchAction(`/admin/shop/bundles/${bundle.id}`, {
            method: 'DELETE',
            successMessage: t('admin.shop_bundles.bundle_deleted'),
        });
        router.reload();
    }

    function getBundleItemsTotal(bundle: ShopBundle): number {
        return bundle.items.reduce((sum, item) => sum + coin(item.price) * item.pivot.quantity, 0);
    }

    const breadcrumbs: BreadcrumbItem[] = [
        { title: t('nav.dashboard'), href: '/dashboard' },
        { title: t('admin.shop.breadcrumb'), href: '/admin/shop' },
        { title: t('admin.shop_bundles.breadcrumb'), href: '/admin/shop/bundles' },
    ];

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title={t('admin.shop_bundles.title')} />
            <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">{t('admin.shop_bundles.title')}</h1>
                        <p className="text-muted-foreground text-sm">
                            {t('admin.shop_bundles.description')}
                        </p>
                    </div>
                    <Button onClick={openCreate}>
                        <Plus className="mr-1.5 size-4" />
                        {t('admin.shop_bundles.create_bundle')}
                    </Button>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>{t('admin.shop_bundles.all_bundles')}</CardTitle>
                        <CardDescription>{t('admin.shop_bundles.bundles_count', { count: String(bundles.length) })}</CardDescription>
                    </CardHeader>
                    <CardContent className="overflow-x-auto">
                        {bundles.length > 0 ? (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>
                                            <SortableHeader column="name" label={t('common.name')} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                                        </TableHead>
                                        <TableHead>{t('common.items')}</TableHead>
                                        <TableHead className="text-center">
                                            <SortableHeader column="discount_percent" label={t('admin.shop_bundles.discount_percent')} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                                        </TableHead>
                                        <TableHead className="text-right">
                                            <SortableHeader column="price" label={t('common.price')} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                                        </TableHead>
                                        <TableHead>
                                            <SortableHeader column="is_active" label={t('common.status')} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                                        </TableHead>
                                        <TableHead className="text-right">{t('common.actions')}</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {[...bundles].sort((a, b) => {
                                        let cmp = 0;
                                        if (sortKey === 'name') cmp = a.name.localeCompare(b.name);
                                        else if (sortKey === 'discount_percent') cmp = parseFloat(a.discount_percent ?? '0') - parseFloat(b.discount_percent ?? '0');
                                        else if (sortKey === 'price') cmp = parseFloat(a.price) - parseFloat(b.price);
                                        else if (sortKey === 'is_active') cmp = Number(a.is_active) - Number(b.is_active);
                                        return sortDir === 'desc' ? -cmp : cmp;
                                    }).map((bundle) => {
                                        const total = getBundleItemsTotal(bundle);
                                        const saving = total - coin(bundle.price);
                                        return (
                                            <TableRow key={bundle.id}>
                                                <TableCell>
                                                    <div>
                                                        <span className="font-medium">{bundle.name}</span>
                                                        {bundle.is_featured && (
                                                            <Badge className="ml-2 bg-amber-500 text-xs">{t('common.featured')}</Badge>
                                                        )}
                                                        {bundle.description && (
                                                            <p className="text-muted-foreground max-w-[250px] truncate text-xs">
                                                                {bundle.description}
                                                            </p>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex -space-x-2">
                                                        {bundle.items.slice(0, 4).map((item) => (
                                                            <img
                                                                key={item.id}
                                                                src={item.icon || '/images/items/placeholder.svg'}
                                                                alt={item.name}
                                                                width={24}
                                                                height={24}
                                                                className="size-6 rounded-full border-2 border-background bg-muted object-contain p-0.5"
                                                                title={`${item.name} x${item.pivot.quantity}`}
                                                            />
                                                        ))}
                                                        {bundle.items.length > 4 && (
                                                            <div className="flex size-6 items-center justify-center rounded-full border-2 border-background bg-muted text-[10px] font-medium">
                                                                +{bundle.items.length - 4}
                                                            </div>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    {parseFloat(bundle.discount_percent ?? '0')}%
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex items-center justify-end gap-2">
                                                        <span className="font-medium tabular-nums">
                                                            {coin(bundle.price)}
                                                        </span>
                                                        {saving > 0 && (
                                                            <Badge variant="outline" className="text-xs text-green-600 dark:text-green-400">
                                                                -{saving}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge
                                                        variant={bundle.is_active ? 'default' : 'destructive'}
                                                        className="text-xs"
                                                    >
                                                        {bundle.is_active ? t('common.active') : t('common.inactive')}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex justify-end gap-1">
                                                        <Button variant="ghost" size="sm" onClick={() => openEdit(bundle)}>
                                                            {t('common.edit')}
                                                        </Button>
                                                        <Button variant="ghost" size="sm" onClick={() => handleDelete(bundle)}>
                                                            <Trash2 className="size-4 text-destructive" />
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        ) : (
                            <p className="text-muted-foreground py-8 text-center">
                                {t('admin.shop_bundles.no_bundles')}
                            </p>
                        )}
                    </CardContent>
                </Card>
            </div>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{editBundle ? t('admin.shop_bundles.edit_title') : t('admin.shop_bundles.create_title')}</DialogTitle>
                        <DialogDescription>
                            {editBundle ? t('admin.shop_bundles.edit_desc') : t('admin.shop_bundles.create_desc')}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
                        <div className="space-y-2">
                            <Label>{t('common.name')}</Label>
                            <Input value={name} onChange={(e) => setName(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label>{t('common.description')}</Label>
                            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>{t('admin.shop_bundles.discount_percent')}</Label>
                                <Input
                                    type="number"
                                    step="1"
                                    min={0}
                                    max={99}
                                    value={discountPercent}
                                    onChange={(e) => setDiscountPercent(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>{t('admin.shop_bundles.max_per_player')}</Label>
                                <Input
                                    type="number"
                                    min={1}
                                    placeholder={t('common.unlimited')}
                                    value={maxPerPlayer}
                                    onChange={(e) => setMaxPerPlayer(e.target.value)}
                                />
                            </div>
                        </div>
                        {itemsTotal > 0 && (
                            <div className="rounded-md bg-muted p-3 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">{t('admin.shop_bundles.items_total')}</span>
                                    <span className="tabular-nums">{Math.round(itemsTotal)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">{t('admin.shop_bundles.discount_label', { percent: discountPercent || '0' })}</span>
                                    <span className="tabular-nums text-green-600">-{Math.round(itemsTotal) - calculatedPrice}</span>
                                </div>
                                <div className="mt-1 flex justify-between border-t pt-1 font-medium">
                                    <span>{t('admin.shop_bundles.bundle_price')}</span>
                                    <span className="tabular-nums">{calculatedPrice}</span>
                                </div>
                            </div>
                        )}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label>{t('admin.shop_bundles.bundle_items')}</Label>
                                <Button variant="outline" size="sm" onClick={addBundleItem}>
                                    <Plus className="mr-1 size-3" />
                                    {t('common.add')}
                                </Button>
                            </div>
                            {bundleItems.map((entry, idx) => (
                                <div key={idx} className="flex items-center gap-2">
                                    <Select
                                        value={entry.shop_item_id}
                                        onValueChange={(v) => updateBundleItem(idx, 'shop_item_id', v)}
                                    >
                                        <SelectTrigger className="flex-1">
                                            <SelectValue placeholder={t('admin.shop_bundles.select_item')} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {shopItems.map((si) => (
                                                <SelectItem key={si.id} value={si.id}>
                                                    {si.name} ({coin(si.price)})
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
                        <div className="flex items-center gap-2">
                            <Checkbox
                                id="bundle-featured"
                                checked={featured}
                                onCheckedChange={(checked) => setFeatured(checked === true)}
                            />
                            <Label htmlFor="bundle-featured">{t('admin.shop_bundles.featured_bundle')}</Label>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>
                            {t('common.cancel')}
                        </Button>
                        <Button
                            disabled={!name || bundleItems.filter((i) => i.shop_item_id).length === 0 || loading}
                            onClick={handleSave}
                        >
                            {editBundle ? t('common.update') : t('common.create')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </AppLayout>
    );
}
