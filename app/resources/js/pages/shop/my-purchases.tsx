import { Head } from '@inertiajs/react';
import { Coins, Package } from 'lucide-react';
import { formatDateTime } from '@/lib/dates';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useTranslation } from '@/hooks/use-translation';
import AppLayout from '@/layouts/app-layout';
import type { BreadcrumbItem } from '@/types';
import type { ShopPurchase } from '@/types/server';

type Props = {
    purchases: {
        data: ShopPurchase[];
        current_page: number;
        last_page: number;
    };
    balance: number;
};

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Shop', href: '/shop' },
    { title: 'My Purchases', href: '/shop/my/purchases' },
];

const statusColors: Record<string, string> = {
    pending: 'bg-yellow-500',
    queued: 'bg-blue-500',
    delivered: 'bg-green-500',
    partially_delivered: 'bg-orange-500',
    failed: 'bg-red-500',
};

export default function MyPurchases({ purchases, balance }: Props) {
    const { t } = useTranslation();

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title={t('purchases.title')} />
            <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">{t('purchases.title')}</h1>
                        <p className="text-muted-foreground text-sm">{t('purchases.description')}</p>
                    </div>
                    <div className="flex items-center gap-2 rounded-lg bg-muted px-4 py-2">
                        <Coins className="size-5 text-amber-500" />
                        <span className="text-lg font-bold tabular-nums">{Math.round(balance)}</span>
                    </div>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>{t('purchases.history')}</CardTitle>
                        <CardDescription>{t('purchases.count', { count: String(purchases.data.length) })}</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {purchases.data.length > 0 ? (
                            <div className="space-y-3">
                                {purchases.data.map((purchase) => (
                                    <div
                                        key={purchase.id}
                                        className="rounded-lg border border-border/50 p-4"
                                    >
                                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <Package className="text-muted-foreground size-4" />
                                                    <span className="text-sm font-medium">
                                                        {purchase.metadata?.item_name ||
                                                            purchase.metadata?.items
                                                                ? t('purchases.bundle')
                                                                : t('purchases.item')}
                                                        {purchase.quantity_bought > 1 && ` x${purchase.quantity_bought}`}
                                                    </span>
                                                </div>
                                                <p className="text-muted-foreground mt-1 text-xs">
                                                    {formatDateTime(purchase.created_at)}
                                                </p>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <div className="flex items-center gap-1">
                                                    <Coins className="size-3.5 text-amber-500" />
                                                    <span className="text-sm font-semibold tabular-nums">
                                                        {Math.round(parseFloat(purchase.total_price))}
                                                    </span>
                                                </div>
                                                {parseFloat(purchase.discount_amount) > 0 && (
                                                    <Badge variant="outline" className="text-xs text-green-600">
                                                        -{Math.round(parseFloat(purchase.discount_amount))}
                                                    </Badge>
                                                )}
                                                <Badge
                                                    className={`text-xs text-white ${statusColors[purchase.delivery_status] || 'bg-gray-500'}`}
                                                >
                                                    {purchase.delivery_status.replace('_', ' ')}
                                                </Badge>
                                            </div>
                                        </div>

                                        {/* Delivery details */}
                                        {purchase.deliveries && purchase.deliveries.length > 0 && (
                                            <div className="mt-2 space-y-1">
                                                {purchase.deliveries.map((delivery) => (
                                                    <div
                                                        key={delivery.id}
                                                        className="flex items-center justify-between text-xs"
                                                    >
                                                        <span className="text-muted-foreground">
                                                            {delivery.item_type} x{delivery.quantity}
                                                        </span>
                                                        <div className="flex items-center gap-2">
                                                            <Badge
                                                                variant="outline"
                                                                className={`text-xs ${
                                                                    delivery.status === 'delivered'
                                                                        ? 'border-green-300 text-green-600'
                                                                        : delivery.status === 'failed'
                                                                          ? 'border-red-300 text-red-600'
                                                                          : ''
                                                                }`}
                                                            >
                                                                {delivery.status}
                                                            </Badge>
                                                            {delivery.error_message && (
                                                                <span className="text-destructive">{delivery.error_message}</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-muted-foreground py-8 text-center">
                                {t('purchases.no_purchases')}
                            </p>
                        )}
                    </CardContent>
                </Card>
            </div>
        </AppLayout>
    );
}
