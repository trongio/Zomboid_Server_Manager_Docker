import { Head, router } from '@inertiajs/react';
import { Plus, ToggleLeft, Trash2 } from 'lucide-react';
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
import AppLayout from '@/layouts/app-layout';
import { fetchAction } from '@/lib/fetch-action';
import type { BreadcrumbItem } from '@/types';
import type { ShopPromotion } from '@/types/server';

type Props = {
    promotions: ShopPromotion[];
};

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Dashboard', href: '/dashboard' },
    { title: 'Shop', href: '/admin/shop' },
    { title: 'Promotions', href: '/admin/shop/promotions' },
];

function getPromotionStatus(promo: ShopPromotion): { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' } {
    if (!promo.is_active) return { label: 'Inactive', variant: 'destructive' };
    const now = new Date();
    if (new Date(promo.starts_at) > now) return { label: 'Scheduled', variant: 'outline' };
    if (promo.ends_at && new Date(promo.ends_at) < now) return { label: 'Expired', variant: 'secondary' };
    return { label: 'Active', variant: 'default' };
}

export default function ShopPromotions({ promotions }: Props) {
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editPromo, setEditPromo] = useState<ShopPromotion | null>(null);
    const [loading, setLoading] = useState(false);

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
                successMessage: 'Promotion updated',
            });
        } else {
            await fetchAction('/admin/shop/promotions', {
                data,
                successMessage: 'Promotion created',
            });
        }
        setLoading(false);
        setDialogOpen(false);
        router.reload();
    }

    async function handleDelete(promo: ShopPromotion) {
        await fetchAction(`/admin/shop/promotions/${promo.id}`, {
            method: 'DELETE',
            successMessage: 'Promotion deleted',
        });
        router.reload();
    }

    async function handleToggle(promo: ShopPromotion) {
        await fetchAction(`/admin/shop/promotions/${promo.id}/toggle`, {
            successMessage: promo.is_active ? 'Promotion deactivated' : 'Promotion activated',
        });
        router.reload();
    }

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="Shop Promotions" />
            <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Promotions</h1>
                        <p className="text-muted-foreground text-sm">
                            Manage discount codes and automatic promotions
                        </p>
                    </div>
                    <Button onClick={openCreate}>
                        <Plus className="mr-1.5 size-4" />
                        Create Promotion
                    </Button>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>All Promotions</CardTitle>
                        <CardDescription>{promotions.length} promotions</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {promotions.length > 0 ? (
                            <div className="space-y-2">
                                {promotions.map((promo) => {
                                    const status = getPromotionStatus(promo);
                                    return (
                                        <div
                                            key={promo.id}
                                            className="flex items-center justify-between rounded-lg border border-border/50 p-3"
                                        >
                                            <div className="flex items-center gap-3">
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm font-medium">{promo.name}</span>
                                                        {promo.code && (
                                                            <Badge variant="outline" className="font-mono text-xs">
                                                                {promo.code}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    <p className="text-muted-foreground text-xs">
                                                        {promo.type === 'percentage'
                                                            ? `${parseFloat(promo.value)}% off`
                                                            : `${parseFloat(promo.value)} off`}
                                                        {' '}
                                                        &middot; Applies to: {promo.applies_to}
                                                        {' '}
                                                        &middot; Used: {promo.usage_count}
                                                        {promo.usage_limit !== null ? `/${promo.usage_limit}` : ''}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Badge variant={status.variant} className="text-xs">
                                                    {status.label}
                                                </Badge>
                                                <Button variant="ghost" size="sm" onClick={() => handleToggle(promo)}>
                                                    <ToggleLeft className="size-4" />
                                                </Button>
                                                <Button variant="ghost" size="sm" onClick={() => openEdit(promo)}>
                                                    Edit
                                                </Button>
                                                <Button variant="ghost" size="sm" onClick={() => handleDelete(promo)}>
                                                    <Trash2 className="size-4 text-destructive" />
                                                </Button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <p className="text-muted-foreground py-8 text-center">
                                No promotions yet.
                            </p>
                        )}
                    </CardContent>
                </Card>
            </div>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{editPromo ? 'Edit Promotion' : 'Create Promotion'}</DialogTitle>
                        <DialogDescription>
                            {editPromo ? 'Update promotion details.' : 'Create a new discount promotion.'}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Name</Label>
                                <Input value={name} onChange={(e) => setName(e.target.value)} />
                            </div>
                            <div className="space-y-2">
                                <Label>Code (optional)</Label>
                                <Input
                                    placeholder="e.g. SAVE20"
                                    value={code}
                                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Type</Label>
                                <Select value={type} onValueChange={(v) => setType(v as 'percentage' | 'fixed_amount')}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="percentage">Percentage</SelectItem>
                                        <SelectItem value="fixed_amount">Fixed Amount</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Value</Label>
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
                            <Label>Applies To</Label>
                            <Select value={appliesTo} onValueChange={(v) => setAppliesTo(v as typeof appliesTo)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Items</SelectItem>
                                    <SelectItem value="category">Category</SelectItem>
                                    <SelectItem value="item">Specific Item</SelectItem>
                                    <SelectItem value="bundle">Bundle</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Min Purchase</Label>
                                <Input
                                    type="number"
                                    step="0.01"
                                    min={0}
                                    placeholder="None"
                                    value={minPurchase}
                                    onChange={(e) => setMinPurchase(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Max Discount</Label>
                                <Input
                                    type="number"
                                    step="0.01"
                                    min={0}
                                    placeholder="None"
                                    value={maxDiscount}
                                    onChange={(e) => setMaxDiscount(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Usage Limit</Label>
                                <Input
                                    type="number"
                                    min={1}
                                    placeholder="Unlimited"
                                    value={usageLimit}
                                    onChange={(e) => setUsageLimit(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Per User Limit</Label>
                                <Input
                                    type="number"
                                    min={1}
                                    placeholder="Unlimited"
                                    value={perUserLimit}
                                    onChange={(e) => setPerUserLimit(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Starts At</Label>
                                <Input
                                    type="datetime-local"
                                    value={startsAt}
                                    onChange={(e) => setStartsAt(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Ends At (optional)</Label>
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
                            Cancel
                        </Button>
                        <Button disabled={!name || !value || !startsAt || loading} onClick={handleSave}>
                            {editPromo ? 'Update' : 'Create'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </AppLayout>
    );
}
