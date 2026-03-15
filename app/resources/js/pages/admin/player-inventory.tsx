import { Head, Link, router, usePoll } from '@inertiajs/react';
import {
    Backpack,
    ChevronDown,
    Circle,
    Loader2,
    Package,
    Plus,
    RefreshCw,
    Search,
    Swords,
    Trash2,
    X,
    Weight,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
import AppLayout from '@/layouts/app-layout';
import { fetchAction } from '@/lib/fetch-action';
import type { BreadcrumbItem } from '@/types';
import type {
    DeliveryEntry,
    DeliveryResult,
    InventoryItem,
    InventorySnapshot,
    ItemCatalogEntry,
} from '@/types/server';

type StackedItem = {
    full_type: string;
    name: string;
    category: string;
    icon: string;
    totalCount: number;
    condition: number | null;
    equipped: boolean;
    containers: string[];
};

type Props = {
    username: string;
    inventory: InventorySnapshot | null;
    catalog: ItemCatalogEntry[];
    deliveries: {
        pending: DeliveryEntry[];
        results: DeliveryResult[];
    };
};

function ItemIcon({ src, name, size = 48 }: { src: string; name: string; size?: number }) {
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

function ConditionBar({ condition }: { condition: number | null }) {
    if (condition === null) return null;

    const percent = Math.round(condition * 100);
    let colorClass = 'bg-green-500';
    if (percent < 30) colorClass = 'bg-red-500';
    else if (percent < 60) colorClass = 'bg-yellow-500';

    return (
        <div className="flex items-center gap-2">
            <div className="h-1.5 w-full rounded-full bg-muted">
                <div
                    className={`h-1.5 rounded-full ${colorClass}`}
                    style={{ width: `${percent}%` }}
                />
            </div>
            <span className="text-muted-foreground text-xs tabular-nums">{percent}%</span>
        </div>
    );
}

function formatRelativeTime(dateStr: string): string {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diffMs = now - then;
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return `${Math.floor(diffHr / 24)}d ago`;
}

export default function PlayerInventory({ username, inventory, catalog, deliveries }: Props) {
    const [filter, setFilter] = useState('');
    const [sortBy, setSortBy] = useState<'name' | 'category' | 'condition'>('name');
    const [giveOpen, setGiveOpen] = useState(false);
    const [removeTarget, setRemoveTarget] = useState<InventoryItem | null>(null);
    const [giveSearch, setGiveSearch] = useState('');
    const [giveSelected, setGiveSelected] = useState<ItemCatalogEntry | null>(null);
    const [giveCount, setGiveCount] = useState(1);
    const [removeCount, setRemoveCount] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [deliveryOpen, setDeliveryOpen] = useState(true);

    usePoll(5000, { only: ['inventory', 'deliveries'] });

    const breadcrumbs: BreadcrumbItem[] = [
        { title: 'Dashboard', href: '/dashboard' },
        { title: 'Players', href: '/admin/players' },
        { title: `${username} Inventory`, href: `/admin/players/${username}/inventory` },
    ];

    const items = inventory?.items ?? [];

    const stackedItems = useMemo(() => {
        const map = new Map<string, StackedItem>();
        for (const item of items) {
            const existing = map.get(item.full_type);
            if (existing) {
                existing.totalCount += item.count;
                if (item.equipped) existing.equipped = true;
                if (item.condition !== null) {
                    existing.condition = existing.condition !== null
                        ? Math.min(existing.condition, item.condition)
                        : item.condition;
                }
                if (!existing.containers.includes(item.container)) {
                    existing.containers.push(item.container);
                }
            } else {
                map.set(item.full_type, {
                    full_type: item.full_type,
                    name: item.name,
                    category: item.category,
                    icon: item.icon,
                    totalCount: item.count,
                    condition: item.condition,
                    equipped: item.equipped,
                    containers: [item.container],
                });
            }
        }
        return [...map.values()];
    }, [items]);

    const filteredItems = useMemo(() => {
        const result = stackedItems.filter(
            (item) =>
                item.name.toLowerCase().includes(filter.toLowerCase()) ||
                item.full_type.toLowerCase().includes(filter.toLowerCase()) ||
                item.category.toLowerCase().includes(filter.toLowerCase()),
        );

        result.sort((a, b) => {
            if (sortBy === 'name') return a.name.localeCompare(b.name);
            if (sortBy === 'category') return a.category.localeCompare(b.category) || a.name.localeCompare(b.name);
            if (sortBy === 'condition') return (b.condition ?? 0) - (a.condition ?? 0);
            return 0;
        });

        return result;
    }, [stackedItems, filter, sortBy]);

    const categories = useMemo(() => [...new Set(items.map((i) => i.category))], [items]);
    const totalItemCount = useMemo(() => items.reduce((sum, i) => sum + i.count, 0), [items]);

    const filteredCatalog = useMemo(() => {
        if (!giveSearch) return catalog.slice(0, 50);
        const q = giveSearch.toLowerCase();
        return catalog
            .filter(
                (item) =>
                    item.name.toLowerCase().includes(q) || item.full_type.toLowerCase().includes(q),
            )
            .slice(0, 50);
    }, [catalog, giveSearch]);

    async function postAction(url: string, data: Record<string, unknown>, onDone: () => void) {
        setLoading(true);
        setError(null);
        const result = await fetchAction(url, { data });
        if (result) {
            onDone();
        } else {
            setError('Action failed');
        }
        setLoading(false);
        router.reload({ only: ['inventory', 'deliveries'] });
    }

    function handleGive() {
        if (!giveSelected) return;
        postAction(
            `/admin/players/${username}/inventory/give`,
            { item_type: giveSelected.full_type, count: giveCount },
            () => {
                setGiveOpen(false);
                setGiveSelected(null);
                setGiveSearch('');
                setGiveCount(1);
            },
        );
    }

    function handleRemove() {
        if (!removeTarget) return;
        postAction(
            `/admin/players/${username}/inventory/remove`,
            { item_type: removeTarget.full_type, count: removeCount },
            () => {
                setRemoveTarget(null);
                setRemoveCount(1);
            },
        );
    }

    const pendingCount = deliveries.pending.length;
    const resultCount = deliveries.results.length;
    const totalDeliveries = pendingCount + resultCount;

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title={`${username} - Inventory`} />
            <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">
                            Inventory: {username}
                        </h1>
                        {inventory ? (
                            <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
                                Last updated {formatRelativeTime(inventory.timestamp)}
                                <RefreshCw className="size-3 animate-spin" />
                            </p>
                        ) : (
                            <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
                                Waiting for data...
                                <RefreshCw className="size-3 animate-spin" />
                            </p>
                        )}
                    </div>
                    <Button onClick={() => setGiveOpen(true)}>
                        <Plus className="mr-1.5 size-4" />
                        Give Item
                    </Button>
                </div>

                {error && (
                    <div className="flex items-center justify-between rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                        <span>{error}</span>
                        <button onClick={() => setError(null)}>
                            <X className="size-4" />
                        </button>
                    </div>
                )}

                {!inventory ? (
                    <Card>
                        <CardContent className="py-12">
                            <div className="flex flex-col items-center gap-3 text-center">
                                <Loader2 className="text-muted-foreground size-8 animate-spin" />
                                <div>
                                    <p className="font-medium">Requesting inventory data...</p>
                                    <p className="text-muted-foreground text-sm">
                                        The player may need to be online for inventory to appear.
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ) : (
                    <>
                        {/* Stats Row */}
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                            <Card>
                                <CardContent className="flex items-center gap-3 pt-6">
                                    <Backpack className="text-muted-foreground size-5" />
                                    <div>
                                        <p className="text-2xl font-bold">
                                            {totalItemCount}
                                            <span className="text-muted-foreground text-sm font-normal">
                                                {' '}({stackedItems.length} unique)
                                            </span>
                                        </p>
                                        <p className="text-muted-foreground text-xs">
                                            Total Items
                                        </p>
                                    </div>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardContent className="flex items-center gap-3 pt-6">
                                    <Weight className="text-muted-foreground size-5" />
                                    <div>
                                        <p className="text-2xl font-bold">
                                            {inventory.weight.toFixed(1)}
                                            <span className="text-muted-foreground text-sm font-normal">
                                                {' '}
                                                / {inventory.max_weight.toFixed(1)}
                                            </span>
                                        </p>
                                        <p className="text-muted-foreground text-xs">Weight</p>
                                    </div>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardContent className="flex items-center gap-3 pt-6">
                                    <Package className="text-muted-foreground size-5" />
                                    <div>
                                        <p className="text-2xl font-bold">{categories.length}</p>
                                        <p className="text-muted-foreground text-xs">Categories</p>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        {/* Inventory Table */}
                        <Card>
                            <CardHeader>
                                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                        <CardTitle>Items</CardTitle>
                                        <CardDescription>
                                            {filteredItems.length} of {stackedItems.length} unique items
                                        </CardDescription>
                                    </div>
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                        <div className="relative">
                                            <Search className="text-muted-foreground absolute left-2.5 top-2.5 size-4" />
                                            <Input
                                                placeholder="Filter items..."
                                                value={filter}
                                                onChange={(e) => setFilter(e.target.value)}
                                                className="pl-9 sm:w-[200px]"
                                            />
                                        </div>
                                        <Select
                                            value={sortBy}
                                            onValueChange={(v) =>
                                                setSortBy(v as 'name' | 'category' | 'condition')
                                            }
                                        >
                                            <SelectTrigger className="w-full sm:w-[140px]">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="name">Name</SelectItem>
                                                <SelectItem value="category">Category</SelectItem>
                                                <SelectItem value="condition">
                                                    Condition
                                                </SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="overflow-x-auto">
                                {filteredItems.length > 0 ? (
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead className="w-[50px]" />
                                                <TableHead>Item</TableHead>
                                                <TableHead>Category</TableHead>
                                                <TableHead className="text-center">Qty</TableHead>
                                                <TableHead className="w-[120px]">Condition</TableHead>
                                                <TableHead>Actions</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {filteredItems.map((item) => (
                                                <TableRow key={item.full_type}>
                                                    <TableCell>
                                                        <ItemIcon
                                                            src={item.icon}
                                                            name={item.name}
                                                            size={32}
                                                        />
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex min-w-0 flex-col">
                                                            <span className="text-sm font-medium">
                                                                {item.name}
                                                            </span>
                                                            <span className="text-muted-foreground text-xs">
                                                                {item.full_type}
                                                            </span>
                                                            {item.equipped && (
                                                                <span className="text-muted-foreground flex items-center gap-1 text-xs">
                                                                    <Swords className="size-3" />
                                                                    Equipped
                                                                </span>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <Badge variant="outline" className="text-xs">
                                                            {item.category}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-center">
                                                        <span className="font-medium tabular-nums">
                                                            {item.totalCount}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell>
                                                        <ConditionBar condition={item.condition} />
                                                    </TableCell>
                                                    <TableCell>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="size-8 p-0"
                                                            onClick={() => {
                                                                setRemoveCount(1);
                                                                setRemoveTarget({
                                                                    full_type: item.full_type,
                                                                    name: item.name,
                                                                    category: item.category,
                                                                    count: item.totalCount,
                                                                    condition: item.condition,
                                                                    equipped: item.equipped,
                                                                    container: item.containers[0],
                                                                    icon: item.icon,
                                                                });
                                                            }}
                                                        >
                                                            <Trash2 className="size-4 text-destructive" />
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                ) : (
                                    <p className="text-muted-foreground py-8 text-center">
                                        {filter
                                            ? 'No items match your filter'
                                            : 'No items in inventory'}
                                    </p>
                                )}
                            </CardContent>
                        </Card>
                    </>
                )}

                {/* Delivery Status Panel — always visible */}
                <Collapsible open={deliveryOpen} onOpenChange={setDeliveryOpen}>
                    <Card>
                        <CollapsibleTrigger asChild>
                            <CardHeader className="cursor-pointer">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <CardTitle>Delivery Queue</CardTitle>
                                        {totalDeliveries > 0 && (
                                            <Badge variant="secondary">
                                                {totalDeliveries}
                                            </Badge>
                                        )}
                                    </div>
                                    <ChevronDown
                                        className={`text-muted-foreground size-4 transition-transform ${deliveryOpen ? 'rotate-180' : ''}`}
                                    />
                                </div>
                                <CardDescription>
                                    Pending and completed item deliveries
                                </CardDescription>
                            </CardHeader>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                            <CardContent>
                                {totalDeliveries > 0 ? (
                                    <div className="space-y-2">
                                        {deliveries.pending.map((entry) => (
                                            <div
                                                key={entry.id}
                                                className="flex flex-col gap-1.5 rounded-lg border border-border/50 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <Circle className="size-2 shrink-0 fill-yellow-500 text-yellow-500" />
                                                    <span className="text-sm font-medium">
                                                        {entry.action === 'give'
                                                            ? 'Give'
                                                            : 'Remove'}{' '}
                                                        {entry.item_type}
                                                    </span>
                                                    <Badge variant="outline" className="text-xs">
                                                        x{entry.count}
                                                    </Badge>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Badge variant="secondary" className="text-xs">
                                                        pending
                                                    </Badge>
                                                    <span className="text-muted-foreground text-xs">
                                                        {formatRelativeTime(entry.created_at)}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                        {deliveries.results.map((result) => (
                                            <div
                                                key={result.id}
                                                className="flex flex-col gap-1.5 rounded-lg border border-border/50 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <Circle
                                                        className={`size-2 shrink-0 ${
                                                            result.status === 'delivered'
                                                                ? 'fill-green-500 text-green-500'
                                                                : 'fill-red-500 text-red-500'
                                                        }`}
                                                    />
                                                    <span className="text-sm">
                                                        {result.message ?? result.status}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Badge
                                                        variant={
                                                            result.status === 'delivered'
                                                                ? 'secondary'
                                                                : 'destructive'
                                                        }
                                                        className="text-xs"
                                                    >
                                                        {result.status}
                                                    </Badge>
                                                    <span className="text-muted-foreground text-xs">
                                                        {formatRelativeTime(
                                                            result.processed_at,
                                                        )}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-muted-foreground py-4 text-center text-sm">
                                        No delivery entries for this player
                                    </p>
                                )}
                            </CardContent>
                        </CollapsibleContent>
                    </Card>
                </Collapsible>
            </div>

            {/* Give Item Dialog */}
            <Dialog
                open={giveOpen}
                onOpenChange={(open) => {
                    if (!open) {
                        setGiveOpen(false);
                        setGiveSelected(null);
                        setGiveSearch('');
                        setGiveCount(1);
                    }
                }}
            >
                <DialogContent className="overflow-hidden sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Give Item to {username}</DialogTitle>
                        <DialogDescription>
                            Search the item catalog and select an item to give.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="give-search">Search Items</Label>
                            <div className="relative">
                                <Search className="text-muted-foreground absolute left-2.5 top-2.5 size-4" />
                                <Input
                                    id="give-search"
                                    placeholder="Type to search items..."
                                    value={giveSearch}
                                    onChange={(e) => {
                                        setGiveSearch(e.target.value);
                                        setGiveSelected(null);
                                    }}
                                    className="pl-9"
                                />
                            </div>
                        </div>

                        <div className="max-h-[200px] overflow-y-auto rounded-md border">
                            {filteredCatalog.length > 0 ? (
                                filteredCatalog.map((item) => (
                                    <button
                                        key={item.full_type}
                                        type="button"
                                        className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-accent ${
                                            giveSelected?.full_type === item.full_type
                                                ? 'bg-accent'
                                                : ''
                                        }`}
                                        onClick={() => setGiveSelected(item)}
                                    >
                                        <ItemIcon src={item.icon} name={item.name} size={24} />
                                        <div className="min-w-0 flex-1 overflow-hidden">
                                            <span className="truncate font-medium">{item.name}</span>
                                            <p className="text-muted-foreground truncate text-xs">
                                                {item.full_type}
                                            </p>
                                        </div>
                                    </button>
                                ))
                            ) : (
                                <p className="text-muted-foreground py-4 text-center text-sm">
                                    No items found
                                </p>
                            )}
                        </div>

                        {giveSelected && (
                            <div className="flex items-center gap-3 rounded-md bg-muted p-3">
                                <ItemIcon
                                    src={giveSelected.icon}
                                    name={giveSelected.name}
                                    size={32}
                                />
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium">{giveSelected.name}</p>
                                    <p className="text-muted-foreground truncate text-xs">
                                        {giveSelected.full_type}
                                    </p>
                                </div>
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label htmlFor="give-count">Count</Label>
                            <Input
                                id="give-count"
                                type="number"
                                min={1}
                                max={100}
                                value={giveCount}
                                onChange={(e) =>
                                    setGiveCount(
                                        Math.max(1, Math.min(100, parseInt(e.target.value) || 1)),
                                    )
                                }
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setGiveOpen(false)}>
                            Cancel
                        </Button>
                        <Button disabled={!giveSelected || loading} onClick={handleGive}>
                            Give Item
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Remove Item Dialog */}
            <Dialog
                open={removeTarget !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setRemoveTarget(null);
                        setRemoveCount(1);
                    }
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Remove Item</DialogTitle>
                        <DialogDescription>
                            Remove this item from {username}'s inventory.
                        </DialogDescription>
                    </DialogHeader>
                    {removeTarget && (
                        <div className="space-y-4">
                            <div className="flex items-center gap-3 rounded-md bg-muted p-3">
                                <ItemIcon
                                    src={removeTarget.icon}
                                    name={removeTarget.name}
                                    size={32}
                                />
                                <div className="flex-1">
                                    <p className="text-sm font-medium">{removeTarget.name}</p>
                                    <p className="text-muted-foreground text-xs">
                                        {removeTarget.full_type}
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="remove-count">
                                    Count (max: {removeTarget.count})
                                </Label>
                                <Input
                                    id="remove-count"
                                    type="number"
                                    min={1}
                                    max={removeTarget.count}
                                    value={removeCount}
                                    onChange={(e) =>
                                        setRemoveCount(
                                            Math.max(
                                                1,
                                                Math.min(
                                                    removeTarget.count,
                                                    parseInt(e.target.value) || 1,
                                                ),
                                            ),
                                        )
                                    }
                                />
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setRemoveTarget(null)}>
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            disabled={loading}
                            onClick={handleRemove}
                        >
                            Remove Item
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </AppLayout>
    );
}
