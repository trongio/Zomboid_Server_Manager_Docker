import { Head, router } from '@inertiajs/react';
import { MoreHorizontal, Pencil, Plus, Power, Trash2 } from 'lucide-react';
import { formatShortDate } from '@/lib/dates';
import { useMemo, useState } from 'react';
import { SortableHeader } from '@/components/sortable-header';
import { useTranslation } from '@/hooks/use-translation';
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
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { useTableSort } from '@/hooks/use-table-sort';
import AppLayout from '@/layouts/app-layout';
import { fetchAction } from '@/lib/fetch-action';
import type { BreadcrumbItem } from '@/types';
import type { ShopPromotion } from '@/types/server';

type Props = {
    promotions: ShopPromotion[];
};

type StatusLabel = 'Active' | 'Scheduled' | 'Inactive' | 'Expired';
const statusOrder: Record<StatusLabel, number> = { Active: 0, Scheduled: 1, Inactive: 2, Expired: 3 };

function getPromotionStatus(promo: ShopPromotion): { label: StatusLabel; variant: 'default' | 'secondary' | 'destructive' | 'outline' } {
    if (!promo.is_active) return { label: 'Inactive', variant: 'destructive' };
    const now = new Date();
    if (new Date(promo.starts_at) > now) return { label: 'Scheduled', variant: 'outline' };
    if (promo.ends_at && new Date(promo.ends_at) < now) return { label: 'Expired', variant: 'secondary' };
    return { label: 'Active', variant: 'default' };
}


type SortKey = 'name' | 'type' | 'value' | 'usage_count' | 'starts_at' | 'status';

const statusLabelKey: Record<StatusLabel, string> = {
    Active: 'common.active',
    Scheduled: 'admin.shop_promotions.scheduled',
    Inactive: 'common.inactive',
    Expired: 'admin.shop_promotions.expired',
};

export default function ShopPromotions({ promotions }: Props) {
    const { t } = useTranslation();
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editPromo, setEditPromo] = useState<ShopPromotion | null>(null);
    const [loading, setLoading] = useState(false);
    const { sortKey, sortDir, toggleSort } = useTableSort<SortKey>('name', 'asc');

    const [name, setName] = useState('');
    const [code, setCode] = useState('');
    const [type, setType] = useState<'percentage' | 'fixed_amount'>('percentage');
    const [value, setValue] = useState('');
    const [minPurchase, setMinPurchase] = useState('');
    const [maxDiscount, setMaxDiscount] = useState('');
    const [appliesTo, setAppliesTo] = useState<'all' | 'category' | 'item' | 'bundle'>('all');
    const [usageLimit, setUsageLimit] = useState('');
    const [perUserLimit, setPerUserLimit] = useState('');
    const [startsAt, setStartsAt] = useState('');
    const [endsAt, setEndsAt] = useState('');

    const sortedPromotions = useMemo(() => {
        const sorted = [...promotions];
        sorted.sort((a, b) => {
            let cmp = 0;
            if (sortKey === 'name') {
                cmp = a.name.localeCompare(b.name);
            } else if (sortKey === 'type') {
                cmp = a.type.localeCompare(b.type);
            } else if (sortKey === 'value') {
                cmp = parseFloat(a.value) - parseFloat(b.value);
            } else if (sortKey === 'usage_count') {
                cmp = a.usage_count - b.usage_count;
            } else if (sortKey === 'starts_at') {
                cmp = new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime();
            } else if (sortKey === 'status') {
                const aLabel = getPromotionStatus(a).label;
                const bLabel = getPromotionStatus(b).label;
                cmp = (statusOrder[aLabel] ?? 99) - (statusOrder[bLabel] ?? 99);
            }
            return sortDir === 'desc' ? -cmp : cmp;
        });
        return sorted;
    }, [promotions, sortKey, sortDir]);

    function openCreate() {
        setEditPromo(null);
        setName('');
        setCode('');
        setType('percentage');
        setValue('');
        setMinPurchase('');
        setMaxDiscount('');
        setAppliesTo('all');
        setUsageLimit('');
        setPerUserLimit('');
        setStartsAt(new Date().toISOString().slice(0, 16));
        setEndsAt('');
        setDialogOpen(true);
    }

    function openEdit(promo: ShopPromotion) {
        setEditPromo(promo);
        setName(promo.name);
        setCode(promo.code || '');
        setType(promo.type);
        setValue(promo.value);
        setMinPurchase(promo.min_purchase || '');
        setMaxDiscount(promo.max_discount || '');
        setAppliesTo(promo.applies_to);
        setUsageLimit(promo.usage_limit?.toString() || '');
        setPerUserLimit(promo.per_user_limit?.toString() || '');
        setStartsAt(promo.starts_at ? new Date(promo.starts_at).toISOString().slice(0, 16) : '');
        setEndsAt(promo.ends_at ? new Date(promo.ends_at).toISOString().slice(0, 16) : '');
        setDialogOpen(true);
    }

    async function handleSave() {
        setLoading(true);
        const data: Record<string, unknown> = {
            name,
            code: code || null,
            type,
            value: parseFloat(value),
            min_purchase: minPurchase ? parseFloat(minPurchase) : null,
            max_discount: maxDiscount ? parseFloat(maxDiscount) : null,
            applies_to: appliesTo,
            usage_limit: usageLimit ? parseInt(usageLimit) : null,
            per_user_limit: perUserLimit ? parseInt(perUserLimit) : null,
            starts_at: startsAt,
            ends_at: endsAt || null,
        };

        if (editPromo) {
            await fetchAction(`/admin/shop/promotions/${editPromo.id}`, {
                method: 'PATCH',
                data,
                successMessage: t('admin.shop_promotions.promotion_updated'),
            });
        } else {
            await fetchAction('/admin/shop/promotions', {
                data,
                successMessage: t('admin.shop_promotions.promotion_created'),
            });
        }
        setLoading(false);
        setDialogOpen(false);
        router.reload();
    }

    async function handleDelete(promo: ShopPromotion) {
        await fetchAction(`/admin/shop/promotions/${promo.id}`, {
            method: 'DELETE',
            successMessage: t('admin.shop_promotions.promotion_deleted'),
        });
        router.reload();
    }

    async function handleToggle(promo: ShopPromotion) {
        await fetchAction(`/admin/shop/promotions/${promo.id}/toggle`, {
            successMessage: promo.is_active ? t('admin.shop_promotions.promotion_deactivated') : t('admin.shop_promotions.promotion_activated'),
        });
        router.reload();
    }

    const breadcrumbs: BreadcrumbItem[] = [
        { title: t('nav.dashboard'), href: '/dashboard' },
        { title: t('admin.shop.breadcrumb'), href: '/admin/shop' },
        { title: t('admin.shop_promotions.breadcrumb'), href: '/admin/shop/promotions' },
    ];

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title={t('admin.shop_promotions.title')} />
            <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">{t('admin.shop_promotions.title')}</h1>
                        <p className="text-muted-foreground text-sm">
                            {t('admin.shop_promotions.description')}
                        </p>
                    </div>
                    <Button onClick={openCreate}>
                        <Plus className="mr-1.5 size-4" />
                        {t('admin.shop_promotions.create_promotion')}
                    </Button>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>{t('admin.shop_promotions.all_promotions')}</CardTitle>
                        <CardDescription>{t('admin.shop_promotions.promotions_count', { count: String(promotions.length) })}</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {sortedPromotions.length > 0 ? (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>
                                            <SortableHeader column="name" label={t('common.name')} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                                        </TableHead>
                                        <TableHead>{t('common.code')}</TableHead>
                                        <TableHead>
                                            <SortableHeader column="type" label={t('common.type')} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                                        </TableHead>
                                        <TableHead>
                                            <SortableHeader column="value" label={t('common.value')} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                                        </TableHead>
                                        <TableHead>{t('admin.shop_promotions.applies_to')}</TableHead>
                                        <TableHead>
                                            <SortableHeader column="usage_count" label={t('admin.shop_promotions.usage')} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                                        </TableHead>
                                        <TableHead>
                                            <SortableHeader column="starts_at" label={t('admin.shop_promotions.date_range')} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                                        </TableHead>
                                        <TableHead>
                                            <SortableHeader column="status" label={t('common.status')} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                                        </TableHead>
                                        <TableHead className="w-[50px]">
                                            <span className="sr-only">{t('common.actions')}</span>
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {sortedPromotions.map((promo) => {
                                        const status = getPromotionStatus(promo);
                                        return (
                                            <TableRow key={promo.id}>
                                                <TableCell className="font-medium">
                                                    {promo.name}
                                                </TableCell>
                                                <TableCell>
                                                    {promo.code ? (
                                                        <Badge variant="outline" className="font-mono text-xs">
                                                            {promo.code}
                                                        </Badge>
                                                    ) : (
                                                        <span className="text-muted-foreground">&mdash;</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="capitalize">
                                                    {promo.type === 'percentage' ? t('admin.shop_promotions.percentage_type') : t('admin.shop_promotions.fixed_amount_type')}
                                                </TableCell>
                                                <TableCell className="tabular-nums">
                                                    {promo.type === 'percentage'
                                                        ? `${parseFloat(promo.value)}%`
                                                        : `${Math.round(parseFloat(promo.value))}`}
                                                </TableCell>
                                                <TableCell className="capitalize">
                                                    {promo.applies_to}
                                                </TableCell>
                                                <TableCell className="tabular-nums">
                                                    {promo.usage_count} / {promo.usage_limit || '\u221E'}
                                                </TableCell>
                                                <TableCell className="text-muted-foreground text-xs">
                                                    <div>{formatShortDate(promo.starts_at)}</div>
                                                    {promo.ends_at ? (
                                                        <div>{formatShortDate(promo.ends_at)}</div>
                                                    ) : (
                                                        <div>{t('admin.shop_promotions.no_end')}</div>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant={status.variant} className="text-xs">
                                                        {t(statusLabelKey[status.label])}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="size-8">
                                                                <MoreHorizontal className="size-4" />
                                                                <span className="sr-only">{t('common.actions')}</span>
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end">
                                                            <DropdownMenuItem onClick={() => handleToggle(promo)}>
                                                                <Power className="mr-2 size-4" />
                                                                {promo.is_active ? t('admin.shop_promotions.deactivate') : t('admin.shop_promotions.activate')}
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem onClick={() => openEdit(promo)}>
                                                                <Pencil className="mr-2 size-4" />
                                                                {t('common.edit')}
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem
                                                                variant="destructive"
                                                                onClick={() => handleDelete(promo)}
                                                            >
                                                                <Trash2 className="mr-2 size-4" />
                                                                {t('common.delete')}
                                                            </DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        ) : (
                            <p className="text-muted-foreground py-8 text-center">
                                {t('admin.shop_promotions.no_promotions')}
                            </p>
                        )}
                    </CardContent>
                </Card>
            </div>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{editPromo ? t('admin.shop_promotions.edit_title') : t('admin.shop_promotions.create_title')}</DialogTitle>
                        <DialogDescription>
                            {editPromo ? t('admin.shop_promotions.edit_desc') : t('admin.shop_promotions.create_desc')}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>{t('common.name')}</Label>
                                <Input value={name} onChange={(e) => setName(e.target.value)} />
                            </div>
                            <div className="space-y-2">
                                <Label>{t('admin.shop_promotions.code_optional')}</Label>
                                <Input
                                    placeholder={t('admin.shop_promotions.code_placeholder')}
                                    value={code}
                                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>{t('common.type')}</Label>
                                <Select value={type} onValueChange={(v) => setType(v as 'percentage' | 'fixed_amount')}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="percentage">{t('admin.shop_promotions.percentage')}</SelectItem>
                                        <SelectItem value="fixed_amount">{t('admin.shop_promotions.fixed_amount')}</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>{t('common.value')}</Label>
                                <Input
                                    type="number"
                                    step="0.01"
                                    min={0.01}
                                    value={value}
                                    onChange={(e) => setValue(e.target.value)}
                                    placeholder={type === 'percentage' ? 'e.g. 20' : 'e.g. 50.00'}
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>{t('admin.shop_promotions.applies_to')}</Label>
                            <Select value={appliesTo} onValueChange={(v) => setAppliesTo(v as typeof appliesTo)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">{t('admin.shop_promotions.all_items')}</SelectItem>
                                    <SelectItem value="category">{t('admin.shop_promotions.category')}</SelectItem>
                                    <SelectItem value="item">{t('admin.shop_promotions.specific_item')}</SelectItem>
                                    <SelectItem value="bundle">{t('admin.shop_promotions.bundle')}</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>{t('admin.shop_promotions.min_purchase')}</Label>
                                <Input
                                    type="number"
                                    step="0.01"
                                    min={0}
                                    placeholder={t('common.none')}
                                    value={minPurchase}
                                    onChange={(e) => setMinPurchase(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>{t('admin.shop_promotions.max_discount')}</Label>
                                <Input
                                    type="number"
                                    step="0.01"
                                    min={0}
                                    placeholder={t('common.none')}
                                    value={maxDiscount}
                                    onChange={(e) => setMaxDiscount(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>{t('admin.shop_promotions.usage_limit')}</Label>
                                <Input
                                    type="number"
                                    min={1}
                                    placeholder={t('common.unlimited')}
                                    value={usageLimit}
                                    onChange={(e) => setUsageLimit(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>{t('admin.shop_promotions.per_user_limit')}</Label>
                                <Input
                                    type="number"
                                    min={1}
                                    placeholder={t('common.unlimited')}
                                    value={perUserLimit}
                                    onChange={(e) => setPerUserLimit(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>{t('admin.shop_promotions.starts_at')}</Label>
                                <Input
                                    type="datetime-local"
                                    value={startsAt}
                                    onChange={(e) => setStartsAt(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>{t('admin.shop_promotions.ends_at')}</Label>
                                <Input
                                    type="datetime-local"
                                    value={endsAt}
                                    onChange={(e) => setEndsAt(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>
                            {t('common.cancel')}
                        </Button>
                        <Button disabled={!name || !value || !startsAt || loading} onClick={handleSave}>
                            {editPromo ? t('common.update') : t('common.create')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </AppLayout>
    );
}
