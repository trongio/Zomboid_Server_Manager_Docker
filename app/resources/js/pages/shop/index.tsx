import { Head, router, usePage } from '@inertiajs/react';
import { useTranslation } from '@/hooks/use-translation';
import { ArrowDownToLine, CheckCircle, Clock, Coins, Copy, Loader2, Package, Search, ShoppingBag, Star, Tag, X, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import PublicLayout from '@/layouts/public-layout';
import { fetchAction } from '@/lib/fetch-action';
import type { DepositResult, PurchaseStatusResponse, ShopBundle, ShopCategory, ShopItem, ShopPromotion } from '@/types/server';

// ── Helpers ──────────────────────────────────────────────────────────

type ActivePromotion = Pick<ShopPromotion, 'name' | 'code' | 'type' | 'value' | 'ends_at'>;

function coin(value: string | number): number {
    return Math.round(typeof value === 'string' ? parseFloat(value) : value);
}

function bundleItemsTotal(bundle: ShopBundle): number {
    return bundle.items.reduce((sum, i) => sum + coin(i.price) * i.pivot.quantity, 0);
}

// ── Shared Components ────────────────────────────────────────────────

function ItemIcon({ src, name, size = 48 }: { src: string; name: string; size?: number }) {
    return (
        <img
            src={src}
            alt={name}
            width={size}
            height={size}
            className="rounded object-contain"
            onError={(e) => { (e.target as HTMLImageElement).src = '/images/items/placeholder.svg'; }}
        />
    );
}

function CoinPrice({ amount, size = 'md', className = '' }: { amount: number; size?: 'sm' | 'md' | 'lg'; className?: string }) {
    const iconSize = size === 'lg' ? 'size-4' : size === 'md' ? 'size-3.5' : 'size-3';
    const textSize = size === 'lg' ? 'text-lg font-bold' : size === 'md' ? 'text-sm font-semibold' : 'text-xs font-medium';
    return (
        <span className={`inline-flex items-center gap-1 ${className}`}>
            <Coins className={`${iconSize} text-amber-500`} />
            <span className={`tabular-nums ${textSize}`}>{amount}</span>
        </span>
    );
}

function BundleIcons({ items, size = 28 }: { items: ShopBundle['items']; size?: number }) {
    const sorted = [...items].sort((a, b) => (a.icon ? 0 : 1) - (b.icon ? 0 : 1));
    const shown = sorted.slice(0, 4);
    const extra = items.length - 4;
    const px = size === 28 ? 'size-7' : 'size-9';
    const overlap = size === 28 ? '-space-x-2' : '-space-x-3';
    const borderW = size === 28 ? 'border-2' : 'border-2';
    return (
        <div className={`flex ${overlap}`}>
            {shown.map((item) => (
                <img
                    key={item.id}
                    src={item.icon || '/images/items/placeholder.svg'}
                    alt={item.name}
                    className={`${px} rounded-full ${borderW} border-background bg-muted object-contain p-0.5`}
                />
            ))}
            {extra > 0 && (
                <div className={`flex ${px} items-center justify-center rounded-full ${borderW} border-background bg-muted text-[10px] font-medium`}>
                    +{extra}
                </div>
            )}
        </div>
    );
}

function DiscountBadge({ percent, className = '' }: { percent: number; className?: string }) {
    if (percent <= 0) return null;
    return (
        <Badge variant="default" className={`bg-green-600 text-xs ${className}`}>
            -{percent}%
        </Badge>
    );
}

// ── Promo Ribbon ─────────────────────────────────────────────────────

function PromoRibbon({ promotions }: { promotions: ActivePromotion[] }) {
    if (promotions.length === 0) return null;
    return (
        <div className="space-y-2">
            {promotions.map((promo) => (
                <div
                    key={promo.code}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 dark:border-amber-700 dark:bg-amber-950/40"
                >
                    <div className="flex items-center gap-2">
                        <Tag className="size-4 text-amber-600 dark:text-amber-400" />
                        <span className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                            {promo.name} — {promo.type === 'percentage' ? `${parseFloat(promo.value)}% OFF` : `${coin(promo.value)} OFF`}
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={() => navigator.clipboard.writeText(promo.code!)}
                        className="flex items-center gap-1.5 rounded-md bg-amber-200/60 px-3 py-1 font-mono text-sm font-bold text-amber-900 transition-colors hover:bg-amber-200 dark:bg-amber-800/40 dark:text-amber-100 dark:hover:bg-amber-800/60"
                    >
                        {promo.code}
                        <Copy className="size-3.5" />
                    </button>
                </div>
            ))}
        </div>
    );
}

// ── Main Page ────────────────────────────────────────────────────────

type Props = {
    categories: ShopCategory[];
    items: ShopItem[];
    bundles: ShopBundle[];
    balance: number | null;
    availableBalance: number | null;
    activePromotions: ActivePromotion[];
    hasPzAccount: boolean;
    pendingDeposit: boolean;
    lastDepositResult: DepositResult | null;
};

export default function ShopIndex({
    categories,
    items,
    bundles,
    balance: initialBalance,
    availableBalance: initialAvailableBalance,
    activePromotions,
    hasPzAccount,
    pendingDeposit: initialPendingDeposit,
    lastDepositResult: initialLastDepositResult,
}: Props) {
    const { auth } = usePage().props;
    const isAuthenticated = !!auth.user;

    // ── State ────────────────────────────────────────────────────────
    const [filter, setFilter] = useState('');
    const [activeCategory, setActiveCategory] = useState<string | null>(null);
    const [buyItem, setBuyItem] = useState<ShopItem | null>(null);
    const [buyBundle, setBuyBundle] = useState<ShopBundle | null>(null);
    const [quantity, setQuantity] = useState(1);
    const [promoCode, setPromoCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [balance, setBalance] = useState(initialBalance);
    const [availableBalance, setAvailableBalance] = useState(initialAvailableBalance);
    const [pendingPurchaseId, setPendingPurchaseId] = useState<string | null>(null);

    // Deposit state
    const [depositLoading, setDepositLoading] = useState(false);
    const [pendingDeposit, setPendingDeposit] = useState(initialPendingDeposit);
    const [lastDepositResult, setLastDepositResult] = useState(initialLastDepositResult);
    const [depositCooldown, setDepositCooldown] = useState(0);
    const [depositError, setDepositError] = useState<string | null>(null);
    const dismissedResultIds = useRef<Set<string>>(new Set());
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const purchasePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const { t } = useTranslation();

    // ── Derived ──────────────────────────────────────────────────────
    const filteredItems = useMemo(() => {
        let result = items;
        if (activeCategory) result = result.filter((i) => i.category_id === activeCategory);
        if (filter) {
            const q = filter.toLowerCase();
            result = result.filter((i) => i.name.toLowerCase().includes(q) || i.item_type.toLowerCase().includes(q));
        }
        return result;
    }, [items, filter, activeCategory]);

    const featuredItems = useMemo(() => items.filter((i) => i.is_featured), [items]);
    const featuredBundles = useMemo(() => bundles.filter((b) => b.is_featured), [bundles]);

    // ── Sync & Effects ───────────────────────────────────────────────
    function dismissDepositResult() {
        if (lastDepositResult?.id) dismissedResultIds.current.add(lastDepositResult.id);
        setLastDepositResult(null);
    }

    useEffect(() => {
        setPendingDeposit(initialPendingDeposit);
        if (initialLastDepositResult && !dismissedResultIds.current.has(initialLastDepositResult.id)) {
            setLastDepositResult(initialLastDepositResult);
        }
        setBalance(initialBalance);
        setAvailableBalance(initialAvailableBalance);
    }, [initialPendingDeposit, initialLastDepositResult, initialBalance, initialAvailableBalance]);

    useEffect(() => {
        if (!lastDepositResult) return;
        const timer = setTimeout(dismissDepositResult, 8000);
        return () => clearTimeout(timer);
    }, [lastDepositResult]);

    useEffect(() => {
        if (!depositError || depositCooldown > 0) return;
        const timer = setTimeout(() => setDepositError(null), 8000);
        return () => clearTimeout(timer);
    }, [depositError, depositCooldown]);

    useEffect(() => () => { if (cooldownRef.current) clearInterval(cooldownRef.current); }, []);

    // ── Deposit Polling ──────────────────────────────────────────────
    const pollDepositStatus = useCallback(async () => {
        try {
            const res = await fetch('/shop/deposit/status', {
                headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
                credentials: 'same-origin',
            });
            if (!res.ok) return;
            const data = await res.json();
            setPendingDeposit(data.pendingDeposit);
            if (data.lastDepositResult && !dismissedResultIds.current.has(data.lastDepositResult.id)) {
                setLastDepositResult(data.lastDepositResult);
            }
            if (data.balance != null) setBalance(data.balance);
        } catch { /* ignore */ }
    }, []);

    useEffect(() => {
        if (!pendingDeposit) { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } return; }
        pollRef.current = setInterval(pollDepositStatus, 5000);
        return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }, [pendingDeposit, pollDepositStatus]);

    // ── Purchase Polling ─────────────────────────────────────────────
    const pollPurchaseStatus = useCallback(async () => {
        if (!pendingPurchaseId) return;
        try {
            const res = await fetch(`/shop/purchase/${pendingPurchaseId}/status`, {
                headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
                credentials: 'same-origin',
            });
            if (!res.ok) return;
            const data: PurchaseStatusResponse = await res.json();
            if (data.balance !== undefined) setBalance(data.balance);
            if (data.availableBalance !== undefined) setAvailableBalance(data.availableBalance);
            if (data.is_complete) {
                setPendingPurchaseId(null);
                if (data.delivery_status === 'delivered') toast.success(t('shop.items_delivered'));
                else if (data.delivery_status === 'failed') toast.error(t('shop.delivery_failed'));
                else toast.warning(t('shop.delivery_partial'));
                router.reload();
            }
        } catch { /* ignore */ }
    }, [pendingPurchaseId]);

    useEffect(() => {
        if (!pendingPurchaseId) { if (purchasePollRef.current) { clearInterval(purchasePollRef.current); purchasePollRef.current = null; } return; }
        purchasePollRef.current = setInterval(pollPurchaseStatus, 5000);
        return () => { if (purchasePollRef.current) clearInterval(purchasePollRef.current); };
    }, [pendingPurchaseId, pollPurchaseStatus]);

    // ── Handlers ─────────────────────────────────────────────────────
    function requireAuth() {
        if (!isAuthenticated) { router.visit('/login?redirect=/shop'); return true; }
        return false;
    }

    async function handleBuyItem() {
        if (!buyItem) return;
        setLoading(true);
        const result = await fetchAction(`/shop/${buyItem.slug}/purchase`, {
            data: { quantity, promotion_code: promoCode || undefined },
            successMessage: t('shop.delivering_item', { count: String(quantity), name: buyItem.name }),
        });
        setLoading(false);
        if (result) {
            setBuyItem(null);
            setQuantity(1);
            setPromoCode('');
            if (result.purchase_id) setPendingPurchaseId(result.purchase_id);
            if (result.availableBalance !== undefined) setAvailableBalance(result.availableBalance);
            if (result.balance !== undefined) setBalance(result.balance);
        }
    }

    async function handleBuyBundle() {
        if (!buyBundle) return;
        setLoading(true);
        const result = await fetchAction(`/shop/bundle/${buyBundle.slug}/purchase`, {
            data: { promotion_code: promoCode || undefined },
            successMessage: t('shop.delivering_bundle', { name: buyBundle.name }),
        });
        setLoading(false);
        if (result) {
            setBuyBundle(null);
            setPromoCode('');
            if (result.purchase_id) setPendingPurchaseId(result.purchase_id);
            if (result.availableBalance !== undefined) setAvailableBalance(result.availableBalance);
            if (result.balance !== undefined) setBalance(result.balance);
        }
    }

    function startCooldown(seconds: number) {
        if (cooldownRef.current) clearInterval(cooldownRef.current);
        setDepositCooldown(seconds);
        cooldownRef.current = setInterval(() => {
            setDepositCooldown((prev) => {
                if (prev <= 1) { if (cooldownRef.current) clearInterval(cooldownRef.current); cooldownRef.current = null; return 0; }
                return prev - 1;
            });
        }, 1000);
    }

    async function handleDeposit() {
        setDepositLoading(true);
        setDepositError(null);
        const csrfToken = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '';
        try {
            const res = await fetch('/shop/deposit', { method: 'POST', headers: { 'X-CSRF-TOKEN': csrfToken, Accept: 'application/json' } });
            const json = await res.json().catch(() => ({}));
            if (res.ok) { toast.success(t('shop.deposit_request_sent')); setPendingDeposit(true); setLastDepositResult(null); }
            else if (res.status === 429) { startCooldown(parseInt(res.headers.get('Retry-After') || '60', 10)); setDepositError(t('shop.too_many_requests')); }
            else { setDepositError(json.error || json.message || `Request failed (${res.status})`); }
        } catch { setDepositError(t('shop.network_error')); }
        setDepositLoading(false);
    }

    // ── Render ────────────────────────────────────────────────────────
    const itemTotal = buyItem ? coin(buyItem.price) * quantity : 0;
    const canAffordItem = availableBalance === null || itemTotal <= availableBalance;
    const canAffordBundle = buyBundle ? (availableBalance === null || coin(buyBundle.price) <= availableBalance) : true;

    return (
        <PublicLayout>
            <Head title={t('shop.title')} />
            <div className="mx-auto max-w-7xl space-y-6 p-4 lg:p-6">
                {/* Header */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">{t('shop.title')}</h1>
                        <p className="text-muted-foreground text-sm">{t('shop.description')}</p>
                    </div>
                    {balance !== null && (
                        <div className="flex items-center gap-2 rounded-lg bg-muted px-4 py-2">
                            <Coins className="size-5 text-amber-500" />
                            <div className="flex flex-col items-end">
                                <span className="text-lg font-bold tabular-nums">{coin(balance)}</span>
                                {availableBalance !== null && availableBalance < balance && (
                                    <span className="text-muted-foreground text-xs tabular-nums">{t('shop.available', { count: String(coin(availableBalance)) })}</span>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <PromoRibbon promotions={activePromotions} />

                {/* Deposit */}
                <Card>
                    <CardHeader>
                        <div className="flex items-center gap-2">
                            <ArrowDownToLine className="size-5 text-green-600 dark:text-green-400" />
                            <CardTitle>{t('shop.deposit_title')}</CardTitle>
                        </div>
                        <CardDescription>{t('shop.deposit_description')}</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                                <p className="text-sm font-medium">{t('shop.how_it_works')}</p>
                                <ol className="text-muted-foreground space-y-1 text-sm">
                                    <li>{t('shop.deposit_step_1')}</li>
                                    <li>{t('shop.deposit_step_2')}</li>
                                    <li>{t('shop.deposit_step_3')}</li>
                                    <li>{t('shop.deposit_step_4')}</li>
                                </ol>
                                <div className="flex gap-3 pt-1">
                                    <Badge variant="outline" className="text-xs"><Coins className="mr-1 size-3 text-amber-500" />{t('shop.money_rate')}</Badge>
                                    <Badge variant="outline" className="text-xs"><Coins className="mr-1 size-3 text-amber-500" />{t('shop.bundle_rate')}</Badge>
                                </div>
                            </div>
                            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-4">
                                {!isAuthenticated ? (
                                    <>
                                        <p className="text-muted-foreground text-center text-sm">{t('shop.login_to_deposit')}</p>
                                        <Button size="sm" onClick={() => router.visit('/login?redirect=/shop')}>{t('auth.login')}</Button>
                                    </>
                                ) : !hasPzAccount ? (
                                    <p className="text-muted-foreground text-center text-sm">{t('shop.link_pz_account')}</p>
                                ) : pendingDeposit ? (
                                    <>
                                        <Loader2 className="size-6 animate-spin text-amber-500" />
                                        <p className="text-sm font-medium">{t('shop.deposit_in_progress')}</p>
                                        <p className="text-muted-foreground text-center text-xs">{t('shop.stay_online')}</p>
                                    </>
                                ) : (
                                    <Button onClick={handleDeposit} disabled={depositLoading || depositCooldown > 0}>
                                        {depositLoading ? <Loader2 className="mr-1.5 size-4 animate-spin" />
                                            : depositCooldown > 0 ? <Clock className="mr-1.5 size-4" />
                                            : <ArrowDownToLine className="mr-1.5 size-4" />}
                                        {depositCooldown > 0 ? t('shop.wait_seconds', { seconds: String(depositCooldown) }) : t('shop.deposit_money')}
                                    </Button>
                                )}
                                {depositError && !pendingDeposit && (
                                    <div className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
                                        <XCircle className="size-3.5 shrink-0" />
                                        <span className="flex-1">{depositError}</span>
                                        <button type="button" onClick={() => setDepositError(null)} className="shrink-0 rounded p-0.5 hover:bg-black/10 dark:hover:bg-white/10" aria-label="Dismiss"><X className="size-3.5" /></button>
                                    </div>
                                )}
                                {lastDepositResult && !pendingDeposit && (
                                    <div className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs ${lastDepositResult.status === 'success' ? 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300' : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'}`}>
                                        {lastDepositResult.status === 'success' ? <CheckCircle className="size-3.5 shrink-0" /> : <XCircle className="size-3.5 shrink-0" />}
                                        <span className="flex-1">
                                            {lastDepositResult.status === 'success'
                                                ? t('shop.deposit_success', { coins: String(lastDepositResult.total_coins), money: String(lastDepositResult.money_count), bundles: String(lastDepositResult.bundle_count ?? 0) })
                                                : lastDepositResult.message || t('shop.deposit_failed')}
                                        </span>
                                        <button type="button" onClick={dismissDepositResult} className="shrink-0 rounded p-0.5 hover:bg-black/10 dark:hover:bg-white/10" aria-label="Dismiss"><X className="size-3.5" /></button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Pending purchase */}
                {pendingPurchaseId && (
                    <div className="flex items-center gap-3 rounded-lg border border-blue-300 bg-blue-50 px-4 py-3 dark:border-blue-700 dark:bg-blue-950/40">
                        <Loader2 className="size-5 animate-spin text-blue-500" />
                        <div>
                            <p className="text-sm font-medium text-blue-800 dark:text-blue-200">{t('shop.delivering_items')}</p>
                            <p className="text-xs text-blue-600 dark:text-blue-400">{t('shop.payment_on_delivery')}</p>
                        </div>
                    </div>
                )}

                {/* Featured */}
                {(featuredItems.length > 0 || featuredBundles.length > 0) && (
                    <Card>
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <Star className="size-5 text-amber-500" />
                                <CardTitle>{t('shop.featured')}</CardTitle>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                                {featuredItems.map((item) => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        className="flex flex-col items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/50 p-4 text-center transition-colors hover:bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20 dark:hover:bg-amber-950/40"
                                        onClick={() => { if (!requireAuth()) setBuyItem(item); setQuantity(1); }}
                                    >
                                        <ItemIcon src={item.icon || '/images/items/placeholder.svg'} name={item.name} />
                                        <span className="text-sm font-medium">{item.name}</span>
                                        <CoinPrice amount={coin(item.price)} />
                                    </button>
                                ))}
                                {featuredBundles.map((bundle) => {
                                    const discount = parseFloat(bundle.discount_percent ?? '0');
                                    return (
                                        <button
                                            key={bundle.id}
                                            type="button"
                                            className="flex flex-col items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/50 p-4 text-center transition-colors hover:bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20 dark:hover:bg-amber-950/40"
                                            onClick={() => { if (!requireAuth()) setBuyBundle(bundle); }}
                                        >
                                            <BundleIcons items={bundle.items} size={36} />
                                            <span className="text-sm font-medium">{bundle.name}</span>
                                            <div className="flex items-center gap-1.5">
                                                <CoinPrice amount={coin(bundle.price)} />
                                                <DiscountBadge percent={discount} />
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Category tabs + search */}
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
                        <Button variant={activeCategory === null ? 'default' : 'outline'} size="sm" onClick={() => setActiveCategory(null)}>{t('shop.all')}</Button>
                        {categories.map((cat) => (
                            <Button key={cat.id} variant={activeCategory === cat.id ? 'default' : 'outline'} size="sm" onClick={() => setActiveCategory(cat.id)}>
                                {cat.name}
                            </Button>
                        ))}
                    </div>
                    <div className="relative">
                        <Search className="text-muted-foreground absolute left-2.5 top-2.5 size-4" />
                        <Input placeholder={t('shop.search_items')} value={filter} onChange={(e) => setFilter(e.target.value)} className="pl-9 sm:w-[250px]" />
                    </div>
                </div>

                {/* Items grid */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {filteredItems.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            className="flex flex-col items-center gap-2 rounded-lg border border-border/50 p-4 text-center transition-colors hover:bg-accent"
                            onClick={() => { if (!requireAuth()) { setBuyItem(item); setQuantity(1); } }}
                        >
                            <ItemIcon src={item.icon || '/images/items/placeholder.svg'} name={item.name} />
                            <span className="truncate text-sm font-medium">{item.name}</span>
                            {item.description && <span className="text-muted-foreground line-clamp-2 text-xs">{item.description}</span>}
                            <CoinPrice amount={coin(item.price)} />
                            {item.quantity > 1 && <span className="text-muted-foreground text-xs">{t('shop.per_purchase', { count: String(item.quantity) })}</span>}
                            {item.stock !== null && item.stock <= 5 && (
                                <Badge variant="destructive" className="text-xs">{item.stock === 0 ? t('shop.out_of_stock') : t('shop.only_left', { count: String(item.stock) })}</Badge>
                            )}
                        </button>
                    ))}
                </div>
                {filteredItems.length === 0 && <p className="text-muted-foreground py-12 text-center">{t('shop.no_items_found')}</p>}

                {/* Bundles */}
                {bundles.length > 0 && (
                    <Card>
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <Package className="size-5" />
                                <CardTitle>{t('shop.bundles')}</CardTitle>
                            </div>
                            <CardDescription>{t('shop.save_with_bundles')}</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                {bundles.map((bundle) => {
                                    const total = bundleItemsTotal(bundle);
                                    const discount = parseFloat(bundle.discount_percent ?? '0');
                                    return (
                                        <button
                                            key={bundle.id}
                                            type="button"
                                            className="rounded-lg border border-border/50 p-4 text-left transition-colors hover:bg-accent"
                                            onClick={() => { if (!requireAuth()) setBuyBundle(bundle); }}
                                        >
                                            <div className="flex items-center justify-between">
                                                <span className="font-medium">{bundle.name}</span>
                                                <div className="flex items-center gap-2">
                                                    {discount > 0 && <span className="text-muted-foreground text-xs tabular-nums line-through">{total}</span>}
                                                    <CoinPrice amount={coin(bundle.price)} />
                                                    <DiscountBadge percent={discount} />
                                                </div>
                                            </div>
                                            {bundle.description && <p className="text-muted-foreground mt-1 text-sm">{bundle.description}</p>}
                                            <div className="mt-3 flex items-center gap-3">
                                                <BundleIcons items={bundle.items} />
                                                <span className="text-muted-foreground text-xs">{t('shop.items_count', { count: String(bundle.items.length) })}</span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </CardContent>
                    </Card>
                )}
            </div>

            {/* ── Buy Item Dialog ──────────────────────────────────────── */}
            <Dialog open={buyItem !== null} onOpenChange={(open) => { if (!open) { setBuyItem(null); setQuantity(1); setPromoCode(''); } }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('shop.purchase_item')}</DialogTitle>
                        <DialogDescription>{t('shop.confirm_purchase')}</DialogDescription>
                    </DialogHeader>
                    {buyItem && (
                        <div className="space-y-4">
                            <div className="flex items-center gap-3 rounded-md bg-muted p-3">
                                <ItemIcon src={buyItem.icon || '/images/items/placeholder.svg'} name={buyItem.name} size={40} />
                                <div className="flex-1">
                                    <p className="font-medium">{buyItem.name}</p>
                                    <p className="text-muted-foreground text-sm">
                                        <CoinPrice amount={coin(buyItem.price)} size="sm" /> {t('shop.each')} {buyItem.quantity > 1 && <span>· {t('shop.items_per_unit', { count: String(buyItem.quantity) })}</span>}
                                    </p>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <div className="space-y-2">
                                    <Label>{t('shop.quantity')}</Label>
                                    <Input type="number" min={1} max={buyItem.max_per_player || 100} value={quantity} onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))} />
                                </div>
                                <div className="space-y-2">
                                    <Label>{t('shop.promo_code')}</Label>
                                    <Input placeholder={t('shop.optional')} value={promoCode} onChange={(e) => setPromoCode(e.target.value.toUpperCase())} />
                                </div>
                            </div>
                            <div className="flex items-center justify-between rounded-md bg-muted p-3">
                                <span className="text-sm font-medium">{t('shop.total')}</span>
                                <CoinPrice amount={itemTotal} size="lg" />
                            </div>
                            {!canAffordItem && (
                                <p className="text-sm text-destructive">
                                    {t('shop.insufficient_balance', { amount: String(itemTotal - coin(availableBalance!)) })}
                                    {availableBalance! < (balance ?? 0) && ` ${t('shop.pending_deliveries_note')}`}
                                </p>
                            )}
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setBuyItem(null)}>{t('common.cancel')}</Button>
                        <Button disabled={!buyItem || loading || pendingPurchaseId !== null || !canAffordItem} onClick={handleBuyItem}>
                            <ShoppingBag className="mr-1.5 size-4" />{t('shop.buy_now')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Buy Bundle Dialog ────────────────────────────────────── */}
            <Dialog open={buyBundle !== null} onOpenChange={(open) => { if (!open) { setBuyBundle(null); setPromoCode(''); } }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('shop.purchase_bundle')}</DialogTitle>
                        <DialogDescription>{t('shop.confirm_bundle')}</DialogDescription>
                    </DialogHeader>
                    {buyBundle && (() => {
                        const total = bundleItemsTotal(buyBundle);
                        const discount = parseFloat(buyBundle.discount_percent ?? '0');
                        const saving = total - coin(buyBundle.price);
                        return (
                            <div className="space-y-4">
                                <div className="rounded-md bg-muted p-3">
                                    <div className="flex items-center justify-between">
                                        <p className="font-medium">{buyBundle.name}</p>
                                        <DiscountBadge percent={discount} />
                                    </div>
                                    {buyBundle.description && <p className="text-muted-foreground mt-1 text-sm">{buyBundle.description}</p>}
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-sm">{t('shop.includes')}</Label>
                                    {buyBundle.items.map((item) => (
                                        <div key={item.id} className="flex items-center justify-between text-sm">
                                            <div className="flex items-center gap-2">
                                                <ItemIcon src={item.icon || '/images/items/placeholder.svg'} name={item.name} size={24} />
                                                <span>{item.name}</span>
                                                {item.pivot.quantity > 1 && <Badge variant="outline" className="text-xs">x{item.pivot.quantity}</Badge>}
                                            </div>
                                            <span className="text-muted-foreground tabular-nums text-xs">{coin(item.price) * item.pivot.quantity}</span>
                                        </div>
                                    ))}
                                </div>
                                <div className="space-y-2">
                                    <Label>{t('shop.promo_code')}</Label>
                                    <Input placeholder={t('shop.optional')} value={promoCode} onChange={(e) => setPromoCode(e.target.value.toUpperCase())} />
                                </div>
                                <div className="space-y-1 rounded-md bg-muted p-3 text-sm">
                                    {discount > 0 && (
                                        <>
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">{t('shop.items_total')}</span>
                                                <span className="tabular-nums">{total}</span>
                                            </div>
                                            <div className="flex justify-between text-green-600 dark:text-green-400">
                                                <span>{t('shop.bundle_discount', { percent: String(discount) })}:</span>
                                                <span className="tabular-nums">-{saving}</span>
                                            </div>
                                        </>
                                    )}
                                    <div className={`flex items-center justify-between ${discount > 0 ? 'border-t pt-1 font-medium' : 'font-medium'}`}>
                                        <span>{t('shop.total')}</span>
                                        <CoinPrice amount={coin(buyBundle.price)} size="lg" />
                                    </div>
                                </div>
                                {!canAffordBundle && (
                                    <p className="text-sm text-destructive">
                                        {t('shop.insufficient_balance', { amount: String(coin(buyBundle.price) - coin(availableBalance!)) })}
                                        {availableBalance! < (balance ?? 0) && ` ${t('shop.pending_deliveries_note')}`}
                                    </p>
                                )}
                            </div>
                        );
                    })()}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setBuyBundle(null)}>{t('common.cancel')}</Button>
                        <Button disabled={!buyBundle || loading || pendingPurchaseId !== null || !canAffordBundle} onClick={handleBuyBundle}>
                            <ShoppingBag className="mr-1.5 size-4" />{t('shop.buy_now')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </PublicLayout>
    );
}
