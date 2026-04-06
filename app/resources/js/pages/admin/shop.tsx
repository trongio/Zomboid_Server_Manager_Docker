import { Head, router } from '@inertiajs/react';
import { Package, Plus, Search, Tag, ToggleLeft, Trash2 } from 'lucide-react';
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
import type { ItemCatalogEntry, ShopCategory, ShopItem } from '@/types/server';

function coin(value: string | number): number {
    return Math.round(typeof value === 'string' ? parseFloat(value) : value);
}

type Props = {
    categories: ShopCategory[];
    items: ShopItem[];
    catalog: ItemCatalogEntry[];
};

function ItemIcon({ src, name, size = 32 }: { src: string; name: string; size?: number }) {
    return (
        <img
            src={src}
            alt={name}
            width={size}
            height={size}
            className="rounded object-contain"
            onError={(e) => {
                (e.target as HTMLImageElement).src = '/images/items/placeholder.svg';
            }}
        />
    );
}

type ItemSortKey = 'name' | 'item_type' | 'price' | 'quantity' | 'is_active';
type CatSortKey = 'name' | 'sort_order' | 'is_active';

export default function ShopAdmin({ categories, items, catalog }: Props) {
    const { t } = useTranslation();
    const [tab, setTab] = useState<'items' | 'categories'>('items');
    const [filter, setFilter] = useState('');
    const [itemDialogOpen, setItemDialogOpen] = useState(false);
    const { sortKey: itemSortKey, sortDir: itemSortDir, toggleSort: toggleItemSort } = useTableSort<ItemSortKey>('name', 'asc');
    const { sortKey: catSortKey, sortDir: catSortDir, toggleSort: toggleCatSort } = useTableSort<CatSortKey>('sort_order', 'asc');
    const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
    const [editItem, setEditItem] = useState<ShopItem | null>(null);
    const [editCategory, setEditCategory] = useState<ShopCategory | null>(null);
    const [loading, setLoading] = useState(false);

    // Item form state
    const [itemName, setItemName] = useState('');
    const [itemDescription, setItemDescription] = useState('');
    const [itemType, setItemType] = useState('');
    const [itemQuantity, setItemQuantity] = useState(1);
    const [itemPrice, setItemPrice] = useState('');
    const [itemWeight, setItemWeight] = useState('');
    const [itemCategoryId, setItemCategoryId] = useState('');
    const [itemMaxPerPlayer, setItemMaxPerPlayer] = useState('');
    const [itemStock, setItemStock] = useState('');
    const [itemSearch, setItemSearch] = useState('');
    const [itemFeatured, setItemFeatured] = useState(false);

    // Category form state
    const [catName, setCatName] = useState('');
    const [catDescription, setCatDescription] = useState('');
    const [catIcon, setCatIcon] = useState('');
    const [catSortOrder, setCatSortOrder] = useState(0);

    const filteredItems = useMemo(() => {
        let result = items;
        if (filter) {
            const q = filter.toLowerCase();
            result = result.filter(
                (i) =>
                    i.name.toLowerCase().includes(q) ||
                    i.item_type.toLowerCase().includes(q) ||
                    i.category?.name?.toLowerCase().includes(q),
            );
        }
        const sorted = [...result];
        sorted.sort((a, b) => {
            let cmp = 0;
            if (itemSortKey === 'name') cmp = a.name.localeCompare(b.name);
            else if (itemSortKey === 'item_type') cmp = a.item_type.localeCompare(b.item_type);
            else if (itemSortKey === 'price') cmp = parseFloat(a.price) - parseFloat(b.price);
            else if (itemSortKey === 'quantity') cmp = a.quantity - b.quantity;
            else if (itemSortKey === 'is_active') cmp = Number(a.is_active) - Number(b.is_active);
            return itemSortDir === 'desc' ? -cmp : cmp;
        });
        return sorted;
    }, [items, filter, itemSortKey, itemSortDir]);

    const filteredCatalog = useMemo(() => {
        if (!itemSearch) return catalog.slice(0, 50);
        const q = itemSearch.toLowerCase();
        return catalog
            .filter((c) => c.name.toLowerCase().includes(q) || c.full_type.toLowerCase().includes(q))
            .slice(0, 50);
    }, [catalog, itemSearch]);

    function openCreateItem() {
        setEditItem(null);
        setItemName('');
        setItemDescription('');
        setItemType('');
        setItemQuantity(1);
        setItemPrice('');
        setItemWeight('');
        setItemCategoryId('');
        setItemMaxPerPlayer('');
        setItemStock('');
        setItemSearch('');
        setItemFeatured(false);
        setItemDialogOpen(true);
    }

    function openEditItem(item: ShopItem) {
        setEditItem(item);
        setItemName(item.name);
        setItemDescription(item.description || '');
        setItemType(item.item_type);
        setItemQuantity(item.quantity);
        setItemPrice(item.price);
        setItemWeight(item.weight?.toString() || '');
        setItemCategoryId(item.category_id || '');
        setItemMaxPerPlayer(item.max_per_player?.toString() || '');
        setItemStock(item.stock?.toString() || '');
        setItemSearch('');
        setItemFeatured(item.is_featured);
        setItemDialogOpen(true);
    }

    function openCreateCategory() {
        setEditCategory(null);
        setCatName('');
        setCatDescription('');
        setCatIcon('');
        setCatSortOrder(0);
        setCategoryDialogOpen(true);
    }

    function openEditCategory(cat: ShopCategory) {
        setEditCategory(cat);
        setCatName(cat.name);
        setCatDescription(cat.description || '');
        setCatIcon(cat.icon || '');
        setCatSortOrder(cat.sort_order);
        setCategoryDialogOpen(true);
    }

    async function handleSaveItem() {
        setLoading(true);
        const data: Record<string, unknown> = {
            name: itemName,
            description: itemDescription || null,
            item_type: itemType,
            quantity: itemQuantity,
            weight: itemWeight ? parseFloat(itemWeight) : null,
            price: parseInt(itemPrice) || 0,
            category_id: itemCategoryId || null,
            max_per_player: itemMaxPerPlayer ? parseInt(itemMaxPerPlayer) : null,
            stock: itemStock ? parseInt(itemStock) : null,
            is_featured: itemFeatured,
        };

        if (editItem) {
            await fetchAction(`/admin/shop/items/${editItem.id}`, {
                method: 'PATCH',
                data,
                successMessage: t('admin.shop.item_updated'),
            });
        } else {
            await fetchAction('/admin/shop/items', {
                data,
                successMessage: t('admin.shop.item_created'),
            });
        }
        setLoading(false);
        setItemDialogOpen(false);
        router.reload();
    }

    async function handleSaveCategory() {
        setLoading(true);
        const data: Record<string, unknown> = {
            name: catName,
            description: catDescription || null,
            icon: catIcon || null,
            sort_order: catSortOrder,
        };

        if (editCategory) {
            await fetchAction(`/admin/shop/categories/${editCategory.id}`, {
                method: 'PATCH',
                data,
                successMessage: t('admin.shop.category_updated'),
            });
        } else {
            await fetchAction('/admin/shop/categories', {
                data,
                successMessage: t('admin.shop.category_created'),
            });
        }
        setLoading(false);
        setCategoryDialogOpen(false);
        router.reload();
    }

    async function handleDeleteItem(item: ShopItem) {
        await fetchAction(`/admin/shop/items/${item.id}`, {
            method: 'DELETE',
            successMessage: t('admin.shop.item_deleted'),
        });
        router.reload();
    }

    async function handleToggleItem(item: ShopItem) {
        await fetchAction(`/admin/shop/items/${item.id}/toggle`, {
            successMessage: item.is_active ? t('admin.shop.item_deactivated') : t('admin.shop.item_activated'),
        });
        router.reload();
    }

    async function handleDeleteCategory(cat: ShopCategory) {
        await fetchAction(`/admin/shop/categories/${cat.id}`, {
            method: 'DELETE',
            successMessage: t('admin.shop.category_deleted'),
        });
        router.reload();
    }

    const breadcrumbs: BreadcrumbItem[] = [
        { title: t('nav.dashboard'), href: '/dashboard' },
        { title: t('admin.shop.breadcrumb'), href: '/admin/shop' },
    ];

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title={t('admin.shop.title')} />
            <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">{t('admin.shop.title')}</h1>
                        <p className="text-muted-foreground text-sm">
                            {t('admin.shop.description')}
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button variant="outline" onClick={openCreateCategory}>
                            <Tag className="mr-1.5 size-4" />
                            {t('admin.shop.add_category')}
                        </Button>
                        <Button onClick={openCreateItem}>
                            <Plus className="mr-1.5 size-4" />
                            {t('admin.shop.add_item')}
                        </Button>
                    </div>
                </div>

                {/* Tab toggle */}
                <div className="flex gap-2">
                    <Button
                        variant={tab === 'items' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setTab('items')}
                    >
                        {t('admin.shop.tab_items', { count: String(items.length) })}
                    </Button>
                    <Button
                        variant={tab === 'categories' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setTab('categories')}
                    >
                        {t('admin.shop.tab_categories', { count: String(categories.length) })}
                    </Button>
                </div>

                {tab === 'items' && (
                    <Card>
                        <CardHeader>
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <CardTitle>{t('admin.shop.shop_items')}</CardTitle>
                                    <CardDescription>{t('admin.shop.items_count', { count: String(filteredItems.length) })}</CardDescription>
                                </div>
                                <div className="relative">
                                    <Search className="text-muted-foreground absolute left-2.5 top-2.5 size-4" />
                                    <Input
                                        placeholder={t('admin.shop.filter_items')}
                                        value={filter}
                                        onChange={(e) => setFilter(e.target.value)}
                                        className="pl-9 sm:w-[250px]"
                                    />
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="overflow-x-auto">
                            {filteredItems.length > 0 ? (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-[40px]" />
                                            <TableHead>
                                                <SortableHeader column="name" label={t('common.name')} sortKey={itemSortKey} sortDir={itemSortDir} onSort={toggleItemSort} />
                                            </TableHead>
                                            <TableHead>
                                                <SortableHeader column="item_type" label={t('admin.shop.type')} sortKey={itemSortKey} sortDir={itemSortDir} onSort={toggleItemSort} />
                                            </TableHead>
                                            <TableHead>{t('common.category')}</TableHead>
                                            <TableHead className="text-right">
                                                <SortableHeader column="price" label={t('common.price')} sortKey={itemSortKey} sortDir={itemSortDir} onSort={toggleItemSort} />
                                            </TableHead>
                                            <TableHead className="text-center">
                                                <SortableHeader column="quantity" label={t('admin.shop.qty')} sortKey={itemSortKey} sortDir={itemSortDir} onSort={toggleItemSort} />
                                            </TableHead>
                                            <TableHead className="text-center">{t('common.stock')}</TableHead>
                                            <TableHead>
                                                <SortableHeader column="is_active" label={t('common.status')} sortKey={itemSortKey} sortDir={itemSortDir} onSort={toggleItemSort} />
                                            </TableHead>
                                            <TableHead className="text-right">{t('common.actions')}</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {filteredItems.map((item) => (
                                            <TableRow key={item.id}>
                                                <TableCell>
                                                    <ItemIcon
                                                        src={item.icon || '/images/items/placeholder.svg'}
                                                        name={item.name}
                                                    />
                                                </TableCell>
                                                <TableCell className="font-medium">
                                                    {item.name}
                                                    {item.is_featured && (
                                                        <Badge className="ml-2 bg-amber-500 text-xs">{t('common.featured')}</Badge>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-muted-foreground max-w-[200px] truncate text-xs">
                                                    {item.item_type}
                                                </TableCell>
                                                <TableCell>
                                                    {item.category && (
                                                        <Badge variant="outline" className="text-xs">
                                                            {item.category.name}
                                                        </Badge>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right tabular-nums">
                                                    {coin(item.price)}
                                                </TableCell>
                                                <TableCell className="text-center">{item.quantity}</TableCell>
                                                <TableCell className="text-center">
                                                    {item.stock !== null ? item.stock : <span className="text-muted-foreground">&infin;</span>}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge
                                                        variant={item.is_active ? 'default' : 'destructive'}
                                                        className="text-xs"
                                                    >
                                                        {item.is_active ? t('common.active') : t('common.inactive')}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex justify-end gap-1">
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => handleToggleItem(item)}
                                                        >
                                                            <ToggleLeft className="size-4" />
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => openEditItem(item)}
                                                        >
                                                            {t('common.edit')}
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => handleDeleteItem(item)}
                                                        >
                                                            <Trash2 className="size-4 text-destructive" />
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            ) : (
                                <p className="text-muted-foreground py-8 text-center">
                                    {t('admin.shop.no_items')}
                                </p>
                            )}
                        </CardContent>
                    </Card>
                )}

                {tab === 'categories' && (
                    <Card>
                        <CardHeader>
                            <CardTitle>{t('admin.shop.categories')}</CardTitle>
                            <CardDescription>{t('admin.shop.categories_desc')}</CardDescription>
                        </CardHeader>
                        <CardContent className="overflow-x-auto">
                            {categories.length > 0 ? (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-[40px]" />
                                            <TableHead>
                                                <SortableHeader column="name" label={t('common.name')} sortKey={catSortKey} sortDir={catSortDir} onSort={toggleCatSort} />
                                            </TableHead>
                                            <TableHead>{t('common.description')}</TableHead>
                                            <TableHead className="text-center">{t('common.items')}</TableHead>
                                            <TableHead className="text-center">
                                                <SortableHeader column="sort_order" label={t('admin.shop.sort_order')} sortKey={catSortKey} sortDir={catSortDir} onSort={toggleCatSort} />
                                            </TableHead>
                                            <TableHead>
                                                <SortableHeader column="is_active" label={t('common.status')} sortKey={catSortKey} sortDir={catSortDir} onSort={toggleCatSort} />
                                            </TableHead>
                                            <TableHead className="text-right">{t('common.actions')}</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {[...categories].sort((a, b) => {
                                            let cmp = 0;
                                            if (catSortKey === 'name') cmp = a.name.localeCompare(b.name);
                                            else if (catSortKey === 'sort_order') cmp = a.sort_order - b.sort_order;
                                            else if (catSortKey === 'is_active') cmp = Number(a.is_active) - Number(b.is_active);
                                            return catSortDir === 'desc' ? -cmp : cmp;
                                        }).map((cat) => (
                                            <TableRow key={cat.id}>
                                                <TableCell>
                                                    <Package className="text-muted-foreground size-5" />
                                                </TableCell>
                                                <TableCell className="font-medium">{cat.name}</TableCell>
                                                <TableCell className="text-muted-foreground max-w-[300px] truncate text-xs">
                                                    {cat.description || '—'}
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <Badge variant="secondary" className="text-xs">
                                                        {cat.items_count ?? 0}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-center">{cat.sort_order}</TableCell>
                                                <TableCell>
                                                    <Badge
                                                        variant={cat.is_active ? 'default' : 'destructive'}
                                                        className="text-xs"
                                                    >
                                                        {cat.is_active ? t('common.active') : t('common.inactive')}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex justify-end gap-1">
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => openEditCategory(cat)}
                                                        >
                                                            {t('common.edit')}
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => handleDeleteCategory(cat)}
                                                        >
                                                            <Trash2 className="size-4 text-destructive" />
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            ) : (
                                <p className="text-muted-foreground py-8 text-center">
                                    {t('admin.shop.no_categories')}
                                </p>
                            )}
                        </CardContent>
                    </Card>
                )}
            </div>

            {/* Create/Edit Item Dialog */}
            <Dialog open={itemDialogOpen} onOpenChange={setItemDialogOpen}>
                <DialogContent className="sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle>{editItem ? t('admin.shop.edit_item_title') : t('admin.shop.create_item_title')}</DialogTitle>
                        <DialogDescription>
                            {editItem ? t('admin.shop.edit_item_desc') : t('admin.shop.create_item_desc')}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="space-y-2">
                            <Label>{t('common.name')}</Label>
                            <Input value={itemName} onChange={(e) => setItemName(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label>{t('common.description')}</Label>
                            <Textarea value={itemDescription} onChange={(e) => setItemDescription(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label>{t('admin.shop.pz_item_type')}</Label>
                            <div className="relative">
                                <Search className="text-muted-foreground absolute left-2.5 top-2.5 size-4" />
                                <Input
                                    placeholder={t('admin.shop.search_catalog')}
                                    value={itemSearch || itemType}
                                    onChange={(e) => {
                                        setItemSearch(e.target.value);
                                        setItemType(e.target.value);
                                    }}
                                    className="pl-9"
                                />
                            </div>
                            {itemSearch && (
                                <div className="max-h-[150px] overflow-y-auto rounded-md border">
                                    {filteredCatalog.map((c) => (
                                        <button
                                            key={c.full_type}
                                            type="button"
                                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
                                            onClick={() => {
                                                setItemType(c.full_type);
                                                setItemSearch('');
                                                if (!itemName) setItemName(c.name);
                                            }}
                                        >
                                            <ItemIcon src={c.icon} name={c.name} size={20} />
                                            <span className="truncate">{c.name}</span>
                                            <span className="text-muted-foreground ml-auto truncate text-xs">{c.full_type}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                            <div className="space-y-2">
                                <Label>{t('admin.shop.pz_quantity')}</Label>
                                <Input
                                    type="number"
                                    min={1}
                                    value={itemQuantity}
                                    onChange={(e) => setItemQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>{t('admin.shop.weight_kg')}</Label>
                                <Input
                                    type="number"
                                    step="0.01"
                                    min={0}
                                    placeholder={t('admin.shop.optional')}
                                    value={itemWeight}
                                    onChange={(e) => setItemWeight(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>{t('common.price')}</Label>
                                <Input
                                    type="number"
                                    step="1"
                                    min={0}
                                    value={itemPrice}
                                    onChange={(e) => setItemPrice(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                            <div className="space-y-2">
                                <Label>{t('common.category')}</Label>
                                <Select value={itemCategoryId} onValueChange={setItemCategoryId}>
                                    <SelectTrigger>
                                        <SelectValue placeholder={t('common.none')} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {categories.filter((c) => c.is_active).map((cat) => (
                                            <SelectItem key={cat.id} value={cat.id}>
                                                {cat.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>{t('admin.shop.max_per_player')}</Label>
                                <Input
                                    type="number"
                                    min={1}
                                    placeholder={t('common.unlimited')}
                                    value={itemMaxPerPlayer}
                                    onChange={(e) => setItemMaxPerPlayer(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>{t('common.stock')}</Label>
                                <Input
                                    type="number"
                                    min={0}
                                    placeholder={t('common.unlimited')}
                                    value={itemStock}
                                    onChange={(e) => setItemStock(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <Checkbox
                                id="item-featured"
                                checked={itemFeatured}
                                onCheckedChange={(checked) => setItemFeatured(checked === true)}
                            />
                            <Label htmlFor="item-featured">{t('admin.shop.featured_item')}</Label>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setItemDialogOpen(false)}>
                            {t('common.cancel')}
                        </Button>
                        <Button
                            disabled={!itemName || !itemType || !itemPrice || loading}
                            onClick={handleSaveItem}
                        >
                            {editItem ? t('common.update') : t('common.create')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Create/Edit Category Dialog */}
            <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editCategory ? t('admin.shop.edit_category_title') : t('admin.shop.create_category_title')}</DialogTitle>
                        <DialogDescription>
                            {editCategory ? t('admin.shop.edit_category_desc') : t('admin.shop.create_category_desc')}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>{t('common.name')}</Label>
                            <Input value={catName} onChange={(e) => setCatName(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label>{t('common.description')}</Label>
                            <Textarea value={catDescription} onChange={(e) => setCatDescription(e.target.value)} />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>{t('admin.shop.icon_lucide')}</Label>
                                <Input
                                    placeholder="e.g. Package"
                                    value={catIcon}
                                    onChange={(e) => setCatIcon(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>{t('admin.shop.sort_order')}</Label>
                                <Input
                                    type="number"
                                    min={0}
                                    value={catSortOrder}
                                    onChange={(e) => setCatSortOrder(parseInt(e.target.value) || 0)}
                                />
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCategoryDialogOpen(false)}>
                            {t('common.cancel')}
                        </Button>
                        <Button disabled={!catName || loading} onClick={handleSaveCategory}>
                            {editCategory ? t('common.update') : t('common.create')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </AppLayout>
    );
}
