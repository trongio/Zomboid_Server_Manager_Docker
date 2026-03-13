import { Head } from '@inertiajs/react';
import { ArrowDownLeft, ArrowUpRight, Coins, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import AppLayout from '@/layouts/app-layout';
import type { BreadcrumbItem } from '@/types';
import type { WalletTransaction } from '@/types/server';

type Props = {
    balance: number;
    transactions: {
        data: WalletTransaction[];
        current_page: number;
        last_page: number;
    };
};

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Shop', href: '/shop' },
    { title: 'My Wallet', href: '/shop/my/wallet' },
];

function TransactionIcon({ type }: { type: string }) {
    switch (type) {
        case 'credit':
            return <ArrowDownLeft className="size-4 text-green-500" />;
        case 'debit':
            return <ArrowUpRight className="size-4 text-red-500" />;
        case 'refund':
            return <RotateCcw className="size-4 text-blue-500" />;
        default:
            return <Coins className="size-4" />;
    }
}

export default function MyWallet({ balance, transactions }: Props) {
    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="My Wallet" />
            <div className="mx-auto max-w-2xl space-y-6 p-6">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">My Wallet</h1>
                    <p className="text-muted-foreground text-sm">Your currency balance and transaction history</p>
                </div>

                {/* Balance card */}
                <Card>
                    <CardContent className="flex flex-col items-center gap-2 py-8">
                        <Coins className="size-10 text-amber-500" />
                        <span className="text-4xl font-bold tabular-nums">{balance.toFixed(2)}</span>
                        <span className="text-muted-foreground text-sm">Current Balance</span>
                    </CardContent>
                </Card>

                {/* Transaction history */}
                <Card>
                    <CardHeader>
                        <CardTitle>Transaction History</CardTitle>
                        <CardDescription>Recent transactions</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {transactions.data.length > 0 ? (
                            <div className="space-y-2">
                                {transactions.data.map((tx) => (
                                    <div
                                        key={tx.id}
                                        className="flex items-center justify-between rounded-md border border-border/50 px-3 py-2.5"
                                    >
                                        <div className="flex items-center gap-3">
                                            <TransactionIcon type={tx.type} />
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm font-medium capitalize">{tx.type}</span>
                                                    <Badge variant="outline" className="text-xs">
                                                        {tx.source.replace('_', ' ')}
                                                    </Badge>
                                                </div>
                                                {tx.description && (
                                                    <p className="text-muted-foreground text-xs">{tx.description}</p>
                                                )}
                                                <p className="text-muted-foreground text-xs">
                                                    {new Date(tx.created_at).toLocaleString()}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <span
                                                className={`text-sm font-semibold tabular-nums ${
                                                    tx.type === 'credit' || tx.type === 'refund'
                                                        ? 'text-green-600'
                                                        : 'text-red-600'
                                                }`}
                                            >
                                                {tx.type === 'debit' ? '-' : '+'}
                                                {parseFloat(tx.amount).toFixed(2)}
                                            </span>
                                            <p className="text-muted-foreground text-xs tabular-nums">
                                                {parseFloat(tx.balance_after).toFixed(2)}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-muted-foreground py-8 text-center text-sm">
                                No transactions yet.
                            </p>
                        )}
                    </CardContent>
                </Card>
            </div>
        </AppLayout>
    );
}
