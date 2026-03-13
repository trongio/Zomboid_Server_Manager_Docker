import { Head, router } from '@inertiajs/react';
import { Package, Plus, Search, Tag, ToggleLeft, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
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
import type { ItemCatalogEntry, ShopCategory, ShopItem } from '@/types/server';

type Props = {
    categories: ShopCategory[];
    items: ShopItem[];
    catalog: ItemCatalogEntry[];
};

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Dashboard', href: '/dashboard' },
    { title: 'Shop', href: '/admin/shop' },
];

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

export default function ShopAdmin({ categories, items, catalog }: Props) {
    const [tab, setTab] = useState<'items' | 'categories'>('items');
    const [filter, setFilter] = useState('');
    const [itemDialogOpen, setItemDialogOpen] = useState(false);
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
    const [itemCategoryId, setItemCategoryId] = useState('');
    const [itemMaxPerPlayer, setItemMaxPerPlayer] = useState('');
    const [itemStock, setItemStock] = useState('');
    const [itemSearch, setItemSearch] = useState('');

    // Category form state
    const [catName, setCatName] = useState('');
    const [catDescription, setCatDescription] = useState('');
    const [catIcon, setCatIcon] = useState('');
    const [catSortOrder, setCatSortOrder] = useState(0);

    const filteredItems = useMemo(() => {
        if (!filter) return items;
        const q = filter.toLowerCase();
        return items.filter(
            (i) =>
                i.name.toLowerCase().includes(q) ||
                i.item_type.toLowerCase().includes(q) ||
                i.category?.name?.toLowerCase().includes(q),
        );
    }, [items, filter]);

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
        setItemCategoryId('');
        setItemMaxPerPlayer('');
        setItemStock('');
        setItemSearch('');
        setItemDialogOpen(true);
    }

    function openEditItem(item: ShopItem) {
        setEditItem(item);
        setItemName(item.name);
        setItemDescription(item.description || '');
        setItemType(item.item_type);
        setItemQuantity(item.quantity);
        setItemPrice(item.price);
        setItemCategoryId(item.category_id || '');
        setItemMaxPerPlayer(item.max_per_player?.toString() || '');
        setItemStock(item.stock?.toString() || '');
        setItemSearch('');
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
            price: parseFloat(itemPrice),
            category_id: itemCategoryId || null,
            max_per_player: itemMaxPerPlayer ? parseInt(itemMaxPerPlayer) : null,
            stock: itemStock ? parseInt(itemStock) : null,
        };

        if (editItem) {
            await fetchAction(`/admin/shop/items/${editItem.id}`, {
                method: 'PATCH',
                data,
                successMessage: 'Item updated',
            });
        } else {
            await fetchAction('/admin/shop/items', {
                data,
                successMessage: 'Item created',
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
                successMessage: 'Category updated',
            });
        } else {
            await fetchAction('/admin/shop/categories', {
                data,
                successMessage: 'Category created',
            });
        }
        setLoading(false);
        setCategoryDialogOpen(false);
        router.reload();
    }

    async function handleDeleteItem(item: ShopItem) {
        await fetchAction(`/admin/shop/items/${item.id}`, {
            method: 'DELETE',
            successMessage: 'Item deleted',
        });
        router.reload();
    }

    async function handleToggleItem(item: ShopItem) {
        await fetchAction(`/admin/shop/items/${item.id}/toggle`, {
            successMessage: item.is_active ? 'Item deactivated' : 'Item activated',
        });
        router.reload();
    }

    async function handleDeleteCategory(cat: ShopCategory) {
        await fetchAction(`/admin/shop/categories/${cat.id}`, {
            method: 'DELETE',
            successMessage: 'Category deleted',
        });
        router.reload();
    }

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="Shop Management" />
            <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Shop Management</h1>
                        <p className="text-muted-foreground text-sm">
                            Manage shop items and categories
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={openCreateCategory}>
                            <Tag className="mr-1.5 size-4" />
                            Add Category
                        </Button>
                        <Button onClick={openCreateItem}>
                            <Plus className="mr-1.5 size-4" />
                            Add Item
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
                        Items ({items.length})
                    </Button>
                    <Button
                        variant={tab === 'categories' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setTab('categories')}
                    >
                        Categories ({categories.length})
                    </Button>
                </div>

                {tab === 'items' && (
                    <Card>
                        <CardHeader>
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <CardTitle>Shop Items</CardTitle>
                                    <CardDescription>{filteredItems.length} items</CardDescription>
                                </div>
                                <div className="relative">
                                    <Search className="text-muted-foreground absolute left-2.5 top-2.5 size-4" />
                                    <Input
                                        placeholder="Filter items..."
                                        value={filter}
                                        onChange={(e) => setFilter(e.target.value)}
                                        className="pl-9 sm:w-[250px]"
                                    />
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            {filteredItems.length > 0 ? (
                                <div className="space-y-2">
                                    {filteredItems.map((item) => (
                                        <div
                                            key={item.id}
                                            className="flex items-center gap-4 rounded-lg border border-border/50 p-3"
                                        >
                                            <ItemIcon
                                                src={item.icon || '/images/items/placeholder.svg'}
                                                name={item.name}
                                            />
                                            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                                <span className="truncate text-sm font-medium">
                                                    {item.name}
                                                </span>
                                                <span className="text-muted-foreground truncate text-xs">
                                                    {item.item_type} &middot; x{item.quantity}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {item.category && (
                                                    <Badge variant="outline" className="text-xs">
                                                        {item.category.name}
                                                    </Badge>
                                                )}
                                                <Badge variant="secondary" className="tabular-nums text-xs">
                                                    {parseFloat(item.price).toFixed(2)}
                                                </Badge>
                                                {item.stock !== null && (
                                                    <Badge variant="outline" className="text-xs">
                                                        Stock: {item.stock}
                                                    </Badge>
                                                )}
                                                <Badge
                                                    variant={item.is_active ? 'default' : 'destructive'}
                                                    className="text-xs"
                                                >
                                                    {item.is_active ? 'Active' : 'Inactive'}
                                                </Badge>
                                                {item.is_featured && (
                                                    <Badge className="bg-amber-500 text-xs">Featured</Badge>
                                                )}
                                            </div>
                                            <div className="flex gap-1">
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
                                                    Edit
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => handleDeleteItem(item)}
                                                >
                                                    <Trash2 className="size-4 text-destructive" />
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-muted-foreground py-8 text-center">
                                    No shop items yet. Create one to get started.
                                </p>
                            )}
                        </CardContent>
                    </Card>
                )}

                {tab === 'categories' && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Categories</CardTitle>
                            <CardDescription>Organize shop items into categories</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {categories.length > 0 ? (
                                <div className="space-y-2">
                                    {categories.map((cat) => (
                                        <div
                                            key={cat.id}
                                            className="flex items-center justify-between rounded-lg border border-border/50 p-3"
                                        >
                                            <div className="flex items-center gap-3">
                                                <Package className="text-muted-foreground size-5" />
                                                <div>
                                                    <span className="text-sm font-medium">{cat.name}</span>
                                                    {cat.description && (
                                                        <p className="text-muted-foreground text-xs">
                                                            {cat.description}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Badge variant="secondary" className="text-xs">
                                                    {cat.items_count ?? 0} items
                                                </Badge>
                                                <Badge
                                                    variant={cat.is_active ? 'default' : 'destructive'}
                                                    className="text-xs"
                                                >
                                                    {cat.is_active ? 'Active' : 'Inactive'}
                                                </Badge>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => openEditCategory(cat)}
                                                >
                                                    Edit
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => handleDeleteCategory(cat)}
                                                >
                                                    <Trash2 className="size-4 text-destructive" />
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-muted-foreground py-8 text-center">
                                    No categories yet.
                                </p>
                            )}
                        </CardContent>
                    </Card>
                )}
            </div>

            {/* Create/Edit Item Dialog */}
            <Dialog open={itemDialogOpen} onOpenChange={setItemDialogOpen}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{editItem ? 'Edit Item' : 'Create Item'}</DialogTitle>
                        <DialogDescription>
                            {editItem ? 'Update shop item details.' : 'Add a new item to the shop.'}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
                        <div className="space-y-2">
                            <Label>Name</Label>
                            <Input value={itemName} onChange={(e) => setItemName(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label>Description</Label>
                            <Textarea value={itemDescription} onChange={(e) => setItemDescription(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label>PZ Item Type</Label>
                            <div className="relative">
                                <Search className="text-muted-foreground absolute left-2.5 top-2.5 size-4" />
                                <Input
                                    placeholder="Search catalog..."
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
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>PZ Quantity</Label>
                                <Input
                                    type="number"
                                    min={1}
                                    value={itemQuantity}
                                    onChange={(e) => setItemQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Price</Label>
                                <Input
                                    type="number"
                                    step="0.01"
                                    min={0}
                                    value={itemPrice}
                                    onChange={(e) => setItemPrice(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Category</Label>
                            <Select value={itemCategoryId} onValueChange={setItemCategoryId}>
                                <SelectTrigger>
                                    <SelectValue placeholder="No category" />
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
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Max Per Player</Label>
                                <Input
                                    type="number"
                                    min={1}
                                    placeholder="Unlimited"
                                    value={itemMaxPerPlayer}
                                    onChange={(e) => setItemMaxPerPlayer(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Stock</Label>
                                <Input
                                    type="number"
                                    min={0}
                                    placeholder="Unlimited"
                                    value={itemStock}
                                    onChange={(e) => setItemStock(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setItemDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            disabled={!itemName || !itemType || !itemPrice || loading}
                            onClick={handleSaveItem}
                        >
                            {editItem ? 'Update' : 'Create'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Create/Edit Category Dialog */}
            <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editCategory ? 'Edit Category' : 'Create Category'}</DialogTitle>
                        <DialogDescription>
                            {editCategory ? 'Update category details.' : 'Add a new category.'}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>Name</Label>
                            <Input value={catName} onChange={(e) => setCatName(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label>Description</Label>
                            <Textarea value={catDescription} onChange={(e) => setCatDescription(e.target.value)} />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Icon (Lucide name)</Label>
                                <Input
                                    placeholder="e.g. Package"
                                    value={catIcon}
                                    onChange={(e) => setCatIcon(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Sort Order</Label>
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
                            Cancel
                        </Button>
                        <Button disabled={!catName || loading} onClick={handleSaveCategory}>
                            {editCategory ? 'Update' : 'Create'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </AppLayout>
    );
}
