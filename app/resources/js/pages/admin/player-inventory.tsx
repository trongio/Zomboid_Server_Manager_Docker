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
import { SortableHeader } from '@/components/sortable-header';
import { useTableSort } from '@/hooks/use-table-sort';
import { useTranslation } from '@/hooks/use-translation';
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

const ITEMS_PER_PAGE = 20;

export default function PlayerInventory({ username, inventory, catalog, deliveries }: Props) {
    const { t } = useTranslation();
    const [filter, setFilter] = useState('');
    const { sortKey: sortBy, sortDir, toggleSort } = useTableSort<'name' | 'category' | 'condition' | 'totalCount'>('name', 'asc');
    const [page, setPage] = useState(1);
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
        { title: t('nav.dashboard'), href: '/dashboard' },
        { title: t('nav.players'), href: '/admin/players' },
        { title: t('admin.player_inventory.breadcrumb', { username }), href: `/admin/players/${username}/inventory` },
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

        const sorted = [...result];
        sorted.sort((a, b) => {
            let cmp = 0;
            if (sortBy === 'name') cmp = a.name.localeCompare(b.name);
            else if (sortBy === 'category') cmp = a.category.localeCompare(b.category) || a.name.localeCompare(b.name);
            else if (sortBy === 'condition') cmp = (a.condition ?? 0) - (b.condition ?? 0);
            else if (sortBy === 'totalCount') cmp = a.totalCount - b.totalCount;
            return sortDir === 'desc' ? -cmp : cmp;
        });

        return sorted;
    }, [stackedItems, filter, sortBy, sortDir]);

    const categories = useMemo(() => [...new Set(items.map((i) => i.category))], [items]);
    const totalItemCount = useMemo(() => items.reduce((sum, i) => sum + i.count, 0), [items]);

    const lastPage = Math.max(1, Math.ceil(filteredItems.length / ITEMS_PER_PAGE));
    const currentPage = Math.min(page, lastPage);
    const paginatedItems = useMemo(
        () => filteredItems.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE),
        [filteredItems, currentPage],
    );

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
            setError(t('admin.player_inventory.action_failed'));
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
            <Head title={t('admin.player_inventory.title', { username })} />
            <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">
                            {t('admin.player_inventory.heading', { username })}
                        </h1>
                        {inventory ? (
                            <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
                                {t('admin.player_inventory.last_updated', { time: formatRelativeTime(inventory.timestamp) })}
                                <RefreshCw className="size-3 animate-spin" />
                            </p>
                        ) : (
                            <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
                                {t('admin.player_inventory.waiting')}
                                <RefreshCw className="size-3 animate-spin" />
                            </p>
                        )}
                    </div>
                    <Button onClick={() => setGiveOpen(true)}>
                        <Plus className="mr-1.5 size-4" />
                        {t('admin.player_inventory.give_item')}
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
                                    <p className="font-medium">{t('admin.player_inventory.requesting_data')}</p>
                                    <p className="text-muted-foreground text-sm">
                                        {t('admin.player_inventory.player_needs_online')}
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
                                                {' '}({t('admin.player_inventory.unique', { count: String(stackedItems.length) })})
                                            </span>
                                        </p>
                                        <p className="text-muted-foreground text-xs">
                                            {t('admin.player_inventory.total_items')}
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
                                        <p className="text-muted-foreground text-xs">{t('common.weight')}</p>
                                    </div>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardContent className="flex items-center gap-3 pt-6">
                                    <Package className="text-muted-foreground size-5" />
                                    <div>
                                        <p className="text-2xl font-bold">{categories.length}</p>
                                        <p className="text-muted-foreground text-xs">{t('admin.player_inventory.categories')}</p>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        {/* Inventory Table */}
                        <Card>
                            <CardHeader>
                                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                        <CardTitle>{t('admin.player_inventory.items')}</CardTitle>
                                        <CardDescription>
                                            {t('admin.player_inventory.items_count', { filtered: String(filteredItems.length), total: String(stackedItems.length) })}
                                        </CardDescription>
                                    </div>
                                    <div className="relative">
                                        <Search className="text-muted-foreground absolute left-2.5 top-2.5 size-4" />
                                        <Input
                                            placeholder={t('admin.player_inventory.filter_items')}
                                            value={filter}
                                            onChange={(e) => { setFilter(e.target.value); setPage(1); }}
                                            className="pl-9 sm:w-[200px]"
                                        />
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="overflow-x-auto">
                                {filteredItems.length > 0 ? (
                                    <>
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead className="w-[50px]" />
                                                <TableHead>
                                                    <SortableHeader column="name" label={t('admin.player_inventory.item')} sortKey={sortBy} sortDir={sortDir} onSort={toggleSort} />
                                                </TableHead>
                                                <TableHead>
                                                    <SortableHeader column="category" label={t('common.category')} sortKey={sortBy} sortDir={sortDir} onSort={toggleSort} />
                                                </TableHead>
                                                <TableHead className="text-center">
                                                    <SortableHeader column="totalCount" label={t('admin.player_inventory.qty')} sortKey={sortBy} sortDir={sortDir} onSort={toggleSort} />
                                                </TableHead>
                                                <TableHead className="w-[120px]">
                                                    <SortableHeader column="condition" label={t('admin.player_inventory.condition')} sortKey={sortBy} sortDir={sortDir} onSort={toggleSort} />
                                                </TableHead>
                                                <TableHead>{t('common.actions')}</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {paginatedItems.map((item) => (
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
                                                                    {t('common.equipped')}
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

                                    {/* Pagination */}
                                    {lastPage > 1 && (
                                        <div className="mt-4 flex items-center justify-between">
                                            <p className="text-muted-foreground text-sm">
                                                {t('admin.player_inventory.of_items', { start: String((currentPage - 1) * ITEMS_PER_PAGE + 1), end: String(Math.min(currentPage * ITEMS_PER_PAGE, filteredItems.length)), total: String(filteredItems.length) })}
                                            </p>
                                            <div className="flex items-center gap-1">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={currentPage <= 1}
                                                    onClick={() => setPage(currentPage - 1)}
                                                >
                                                    {t('common.previous')}
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={currentPage >= lastPage}
                                                    onClick={() => setPage(currentPage + 1)}
                                                >
                                                    {t('common.next')}
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                    </>
                                ) : (
                                    <p className="text-muted-foreground py-8 text-center">
                                        {filter
                                            ? t('admin.player_inventory.no_items_filter')
                                            : t('admin.player_inventory.no_items_empty')}
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
                                        <CardTitle>{t('admin.player_inventory.delivery_queue')}</CardTitle>
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
                                    {t('admin.player_inventory.delivery_desc')}
                                </CardDescription>
                            </CardHeader>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                            <CardContent className="overflow-x-auto">
                                {totalDeliveries > 0 ? (
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead className="w-[30px]" />
                                                <TableHead>{t('admin.player_inventory.action')}</TableHead>
                                                <TableHead>{t('admin.player_inventory.item')}</TableHead>
                                                <TableHead className="text-center">{t('admin.player_inventory.qty')}</TableHead>
                                                <TableHead>{t('common.status')}</TableHead>
                                                <TableHead>{t('admin.player_inventory.time')}</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {deliveries.pending.map((entry) => (
                                                <TableRow key={entry.id}>
                                                    <TableCell>
                                                        <Circle className="size-2 fill-yellow-500 text-yellow-500" />
                                                    </TableCell>
                                                    <TableCell>
                                                        <span className="text-sm font-medium capitalize">
                                                            {entry.action}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell>
                                                        <span className="text-muted-foreground text-sm">
                                                            {entry.item_type}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="text-center">
                                                        <span className="tabular-nums">{entry.count}</span>
                                                    </TableCell>
                                                    <TableCell>
                                                        <Badge variant="secondary" className="text-xs">
                                                            {t('common.pending')}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell>
                                                        <span className="text-muted-foreground text-xs">
                                                            {formatRelativeTime(entry.created_at)}
                                                        </span>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                            {deliveries.results.map((result) => (
                                                <TableRow key={result.id}>
                                                    <TableCell>
                                                        <Circle
                                                            className={`size-2 ${
                                                                result.status === 'delivered'
                                                                    ? 'fill-green-500 text-green-500'
                                                                    : 'fill-red-500 text-red-500'
                                                            }`}
                                                        />
                                                    </TableCell>
                                                    <TableCell colSpan={3}>
                                                        <span className="text-sm">
                                                            {result.message ?? result.status}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell>
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
                                                    </TableCell>
                                                    <TableCell>
                                                        <span className="text-muted-foreground text-xs">
                                                            {formatRelativeTime(result.processed_at)}
                                                        </span>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                ) : (
                                    <p className="text-muted-foreground py-4 text-center text-sm">
                                        {t('admin.player_inventory.no_deliveries')}
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
                        <DialogTitle>{t('admin.player_inventory.give_item_title', { username })}</DialogTitle>
                        <DialogDescription>
                            {t('admin.player_inventory.give_item_desc')}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="give-search">{t('admin.player_inventory.search_items')}</Label>
                            <div className="relative">
                                <Search className="text-muted-foreground absolute left-2.5 top-2.5 size-4" />
                                <Input
                                    id="give-search"
                                    placeholder={t('admin.player_inventory.search_placeholder')}
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
                                    {t('admin.player_inventory.no_items_found')}
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
                            <Label htmlFor="give-count">{t('common.count')}</Label>
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
                            {t('common.cancel')}
                        </Button>
                        <Button disabled={!giveSelected || loading} onClick={handleGive}>
                            {t('admin.player_inventory.give_item')}
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
                        <DialogTitle>{t('admin.player_inventory.remove_item')}</DialogTitle>
                        <DialogDescription>
                            {t('admin.player_inventory.remove_item_desc', { username })}
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
                                    {t('admin.player_inventory.count_max', { max: String(removeTarget.count) })}
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
                            {t('common.cancel')}
                        </Button>
                        <Button
                            variant="destructive"
                            disabled={loading}
                            onClick={handleRemove}
                        >
                            {t('admin.player_inventory.remove_item')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </AppLayout>
    );
}
