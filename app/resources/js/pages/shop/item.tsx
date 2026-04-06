import { Head, router, usePage } from '@inertiajs/react';
import { ArrowLeft, Coins, ShoppingBag } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { useTranslation } from '@/hooks/use-translation';
import PublicLayout from '@/layouts/public-layout';
import { fetchAction } from '@/lib/fetch-action';
import type { ShopBundle, ShopItem } from '@/types/server';

type Props = {
    item?: ShopItem;
    bundle?: ShopBundle;
    balance: number | null;
};

export default function ShopItemDetail({ item, bundle, balance }: Props) {
    const { auth } = usePage().props;
    const { t } = useTranslation();
    const isAuthenticated = !!auth.user;
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [quantity, setQuantity] = useState(1);
    const [promoCode, setPromoCode] = useState('');
    const [loading, setLoading] = useState(false);

    const purchasable = item || bundle;
    const isBundle = !!bundle;
    const name = purchasable?.name || '';
    const price = parseFloat(purchasable?.price || '0');

    function handleBuyClick() {
        if (!isAuthenticated) {
            router.visit('/login');
            return;
        }
        setConfirmOpen(true);
    }

    async function handlePurchase() {
        setLoading(true);
        const url = isBundle
            ? `/shop/bundle/${bundle!.slug}/purchase`
            : `/shop/${item!.slug}/purchase`;

        const result = await fetchAction(url, {
            data: {
                quantity: isBundle ? undefined : quantity,
                promotion_code: promoCode || undefined,
            },
            successMessage: `Purchased ${isBundle ? name : `${quantity}x ${name}`}`,
        });
        setLoading(false);
        if (result) {
            setConfirmOpen(false);
            setQuantity(1);
            setPromoCode('');
            router.reload();
        }
    }

    const totalPrice = isBundle ? price : price * quantity;

    return (
        <PublicLayout>
            <Head title={name} />
            <div className="mx-auto max-w-2xl space-y-6 p-4 lg:p-6">
                <Button variant="ghost" size="sm" onClick={() => router.visit('/shop')}>
                    <ArrowLeft className="mr-1.5 size-4" />
                    {t('shop.back_to_shop')}
                </Button>

                <Card>
                    <CardHeader>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <CardTitle className="text-xl">{name}</CardTitle>
                            {balance !== null && (
                                <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5">
                                    <Coins className="size-4 text-amber-500" />
                                    <span className="font-bold tabular-nums">{Math.round(balance)}</span>
                                </div>
                            )}
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {item && (
                            <>
                                <div className="flex items-center gap-4">
                                    <img
                                        src={item.icon || '/images/items/placeholder.svg'}
                                        alt={item.name}
                                        width={64}
                                        height={64}
                                        className="rounded object-contain"
                                    />
                                    <div>
                                        <p className="text-muted-foreground text-sm">{item.item_type}</p>
                                        <div className="flex items-center gap-1.5">
                                            <Coins className="size-4 text-amber-500" />
                                            <span className="text-2xl font-bold tabular-nums">{Math.round(price)}</span>
                                        </div>
                                        {item.quantity > 1 && (
                                            <p className="text-muted-foreground text-sm">x{item.quantity} items per purchase</p>
                                        )}
                                    </div>
                                </div>
                                {item.description && <p className="text-muted-foreground">{item.description}</p>}
                                <div className="flex flex-wrap gap-2">
                                    {item.category && <Badge variant="outline">{item.category.name}</Badge>}
                                    {item.stock !== null && (
                                        <Badge variant={item.stock > 0 ? 'secondary' : 'destructive'}>
                                            {item.stock > 0 ? `${item.stock} in stock` : 'Out of stock'}
                                        </Badge>
                                    )}
                                    {item.max_per_player && (
                                        <Badge variant="outline">Max {item.max_per_player} per player</Badge>
                                    )}
                                </div>
                            </>
                        )}

                        {bundle && (
                            <>
                                {bundle.description && <p className="text-muted-foreground">{bundle.description}</p>}
                                <div className="flex items-center gap-1.5">
                                    <Coins className="size-4 text-amber-500" />
                                    <span className="text-2xl font-bold tabular-nums">{Math.round(price)}</span>
                                </div>
                                <div className="space-y-2">
                                    <Label>Bundle includes:</Label>
                                    {bundle.items.map((bi) => (
                                        <div key={bi.id} className="flex items-center gap-2 rounded-md bg-muted px-3 py-2">
                                            <img
                                                src={bi.icon || '/images/items/placeholder.svg'}
                                                alt={bi.name}
                                                width={24}
                                                height={24}
                                                className="rounded"
                                            />
                                            <span className="text-sm font-medium">{bi.name}</span>
                                            <Badge variant="outline" className="text-xs">x{bi.pivot.quantity}</Badge>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}

                        <Button
                            className="w-full"
                            size="lg"
                            disabled={(balance !== null && price > balance) || (item?.stock !== null && item?.stock === 0)}
                            onClick={handleBuyClick}
                        >
                            <ShoppingBag className="mr-2 size-5" />
                            {isAuthenticated ? t('shop.buy_now') : t('shop.login_to_buy')}
                        </Button>
                    </CardContent>
                </Card>
            </div>

            {/* Confirm Dialog */}
            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('shop.confirm_purchase')}</DialogTitle>
                        <DialogDescription>{t('shop.review_purchase')}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <p className="text-sm font-medium">{name}</p>
                        {!isBundle && (
                            <div className="space-y-2">
                                <Label>{t('shop.quantity')}</Label>
                                <Input
                                    type="number"
                                    min={1}
                                    max={item?.max_per_player || 100}
                                    value={quantity}
                                    onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                                />
                            </div>
                        )}
                        <div className="space-y-2">
                            <Label>{t('shop.promo_code')}</Label>
                            <Input
                                value={promoCode}
                                onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                                placeholder={t('shop.enter_code')}
                            />
                        </div>
                        <div className="flex items-center justify-between rounded-md bg-muted p-3">
                            <span className="font-medium">{t('shop.total')}</span>
                            <div className="flex items-center gap-1.5">
                                <Coins className="size-4 text-amber-500" />
                                <span className="text-lg font-bold tabular-nums">{Math.round(totalPrice)}</span>
                            </div>
                        </div>
                        {balance !== null && totalPrice > balance && (
                            <p className="text-sm text-destructive">{t('shop.insufficient_balance')}</p>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                            {t('common.cancel')}
                        </Button>
                        <Button disabled={(balance !== null && totalPrice > balance) || loading} onClick={handlePurchase}>
                            {t('shop.purchase_item')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </PublicLayout>
    );
}
