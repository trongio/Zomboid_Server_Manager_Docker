import { Head, router } from '@inertiajs/react';
import { Coins, MoreHorizontal, Search } from 'lucide-react';
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
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useTableSort } from '@/hooks/use-table-sort';
import AppLayout from '@/layouts/app-layout';
import { fetchAction } from '@/lib/fetch-action';
import type { BreadcrumbItem } from '@/types';
import type { WalletTransaction, WalletUser } from '@/types/server';

type Props = {
    users: WalletUser[];
};

function coin(v: string | number): number {
    return Math.round(typeof v === 'string' ? parseFloat(v) : v);
}

type SortKey = 'username' | 'balance' | 'total_earned' | 'total_spent';

export default function Wallets({ users }: Props) {
    const { t } = useTranslation();
    const [filter, setFilter] = useState('');
    const [creditOpen, setCreditOpen] = useState(false);
    const [selectedUser, setSelectedUser] = useState<WalletUser | null>(null);
    const [amount, setAmount] = useState('');
    const [description, setDescription] = useState('');
    const [loading, setLoading] = useState(false);
    const [txOpen, setTxOpen] = useState(false);
    const [txUser, setTxUser] = useState<WalletUser | null>(null);
    const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
    const [resetOpen, setResetOpen] = useState(false);
    const [resetUser, setResetUser] = useState<WalletUser | null>(null);
    const [resetLoading, setResetLoading] = useState(false);
    const { sortKey, sortDir, toggleSort } = useTableSort<SortKey>('username', 'asc');

    const filteredUsers = useMemo(() => {
        let result = users;
        if (filter) {
            const q = filter.toLowerCase();
            result = result.filter(
                (u) => u.username.toLowerCase().includes(q) || u.name?.toLowerCase().includes(q),
            );
        }
        const sorted = [...result];
        sorted.sort((a, b) => {
            let cmp = 0;
            if (sortKey === 'username') {
                cmp = a.username.localeCompare(b.username);
            } else if (sortKey === 'balance') {
                cmp = a.balance - b.balance;
            } else if (sortKey === 'total_earned') {
                cmp = a.total_earned - b.total_earned;
            } else if (sortKey === 'total_spent') {
                cmp = a.total_spent - b.total_spent;
            }
            return sortDir === 'desc' ? -cmp : cmp;
        });
        return sorted;
    }, [users, filter, sortKey, sortDir]);

    const totalBalance = useMemo(() => users.reduce((sum, u) => sum + u.balance, 0), [users]);

    function openCredit(user: WalletUser) {
        setSelectedUser(user);
        setAmount('');
        setDescription('');
        setCreditOpen(true);
    }

    async function handleCredit() {
        if (!selectedUser) return;
        setLoading(true);
        await fetchAction(`/admin/wallets/${selectedUser.id}/credit`, {
            data: {
                amount: parseFloat(amount),
                description: description || null,
            },
            successMessage: t('admin.wallets.awarded_success', { amount, username: selectedUser.username }),
        });
        setLoading(false);
        setCreditOpen(false);
        router.reload();
    }

    function openReset(user: WalletUser) {
        setResetUser(user);
        setResetOpen(true);
    }

    async function handleReset() {
        if (!resetUser) return;
        setResetLoading(true);
        await fetchAction(`/admin/wallets/${resetUser.id}/reset`, {
            successMessage: t('admin.wallets.reset_success', { username: resetUser.username }),
        });
        setResetLoading(false);
        setResetOpen(false);
        router.reload();
    }

    async function viewTransactions(user: WalletUser) {
        setTxUser(user);
        setTxOpen(true);
        try {
            const res = await fetch(`/admin/wallets/${user.id}/transactions`, {
                headers: { Accept: 'application/json' },
            });
            const data = await res.json();
            setTransactions(data.transactions?.data || []);
        } catch {
            setTransactions([]);
        }
    }

    const breadcrumbs: BreadcrumbItem[] = [
        { title: t('nav.dashboard'), href: '/dashboard' },
        { title: t('admin.wallets.breadcrumb'), href: '/admin/wallets' },
    ];

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title={t('admin.wallets.title')} />
            <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">{t('admin.wallets.title')}</h1>
                    <p className="text-muted-foreground text-sm">
                        {t('admin.wallets.description')}
                    </p>
                </div>

                {/* Summary */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <Card>
                        <CardContent className="flex items-center gap-3 pt-6">
                            <Coins className="text-muted-foreground size-5" />
                            <div>
                                <p className="text-2xl font-bold tabular-nums">{coin(totalBalance)}</p>
                                <p className="text-muted-foreground text-xs">{t('admin.wallets.total_in_circulation')}</p>
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="flex items-center gap-3 pt-6">
                            <Coins className="text-muted-foreground size-5" />
                            <div>
                                <p className="text-2xl font-bold">{users.length}</p>
                                <p className="text-muted-foreground text-xs">{t('admin.wallets.total_players')}</p>
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="flex items-center gap-3 pt-6">
                            <Coins className="text-muted-foreground size-5" />
                            <div>
                                <p className="text-2xl font-bold tabular-nums">
                                    {users.length > 0 ? coin(totalBalance / users.length) : 0}
                                </p>
                                <p className="text-muted-foreground text-xs">{t('admin.wallets.average_balance')}</p>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <Card>
                    <CardHeader>
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <CardTitle>{t('admin.wallets.all_players')}</CardTitle>
                                <CardDescription>{t('admin.wallets.players_count', { count: String(filteredUsers.length) })}</CardDescription>
                            </div>
                            <div className="relative">
                                <Search className="text-muted-foreground absolute left-2.5 top-2.5 size-4" />
                                <Input
                                    placeholder={t('admin.wallets.search_players')}
                                    value={filter}
                                    onChange={(e) => setFilter(e.target.value)}
                                    className="pl-9 sm:w-[250px]"
                                />
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {filteredUsers.length > 0 ? (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>
                                            <SortableHeader column="username" label={t('common.username')} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                                        </TableHead>
                                        <TableHead className="text-right">
                                            <SortableHeader column="balance" label={t('common.balance')} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                                        </TableHead>
                                        <TableHead className="text-right">
                                            <SortableHeader column="total_earned" label={t('admin.wallets.total_earned')} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                                        </TableHead>
                                        <TableHead className="text-right">
                                            <SortableHeader column="total_spent" label={t('admin.wallets.total_spent')} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                                        </TableHead>
                                        <TableHead className="w-[60px]" />
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredUsers.map((user) => (
                                        <TableRow key={user.id}>
                                            <TableCell>
                                                <span className="font-medium">{user.username}</span>
                                                {user.name && user.name !== user.username && (
                                                    <p className="text-muted-foreground text-xs">{user.name}</p>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {coin(user.balance)}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums text-green-600">
                                                {coin(user.total_earned)}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums text-red-600">
                                                {coin(user.total_spent)}
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
                                                        <DropdownMenuItem onClick={() => openCredit(user)}>
                                                            {t('admin.wallets.award')}
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => viewTransactions(user)}>
                                                            {t('admin.wallets.history')}
                                                        </DropdownMenuItem>
                                                        {user.balance > 0 && (
                                                            <>
                                                                <DropdownMenuSeparator />
                                                                <DropdownMenuItem
                                                                    variant="destructive"
                                                                    onClick={() => openReset(user)}
                                                                >
                                                                    {t('admin.wallets.reset_balance')}
                                                                </DropdownMenuItem>
                                                            </>
                                                        )}
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        ) : (
                            <p className="text-muted-foreground py-8 text-center">
                                {t('admin.wallets.no_players')}
                            </p>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Award Currency Dialog */}
            <Dialog open={creditOpen} onOpenChange={setCreditOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('admin.wallets.award_currency')}</DialogTitle>
                        <DialogDescription>
                            {t('admin.wallets.award_currency_desc', { username: selectedUser?.username ?? '' })}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>{t('common.amount')}</Label>
                            <Input
                                type="number"
                                step="1"
                                min={1}
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>{t('admin.wallets.description_optional')}</Label>
                            <Textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder={t('admin.wallets.description_placeholder')}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCreditOpen(false)}>
                            {t('common.cancel')}
                        </Button>
                        <Button disabled={!amount || parseFloat(amount) <= 0 || loading} onClick={handleCredit}>
                            {t('admin.wallets.award')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Reset Balance Dialog */}
            <Dialog open={resetOpen} onOpenChange={setResetOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('admin.wallets.reset_title')}</DialogTitle>
                        <DialogDescription>
                            {t('admin.wallets.reset_desc', { username: resetUser?.username ?? '', balance: String(resetUser ? coin(resetUser.balance) : 0) })}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setResetOpen(false)}>
                            {t('common.cancel')}
                        </Button>
                        <Button variant="destructive" disabled={resetLoading} onClick={handleReset}>
                            {t('admin.wallets.reset_to_zero')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Transaction History Dialog */}
            <Dialog open={txOpen} onOpenChange={setTxOpen}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{t('admin.wallets.tx_history')}</DialogTitle>
                        <DialogDescription>{txUser?.username}</DialogDescription>
                    </DialogHeader>
                    <div className="max-h-[400px] overflow-y-auto">
                        {transactions.length > 0 ? (
                            <div className="space-y-2">
                                {transactions.map((tx) => (
                                    <div
                                        key={tx.id}
                                        className="flex items-center justify-between rounded-md border border-border/50 px-3 py-2"
                                    >
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <Badge
                                                    variant={tx.type === 'credit' ? 'default' : tx.type === 'refund' ? 'outline' : 'destructive'}
                                                    className="text-xs"
                                                >
                                                    {tx.type}
                                                </Badge>
                                                <span className="text-muted-foreground text-xs">{tx.source}</span>
                                            </div>
                                            {tx.description && (
                                                <p className="text-muted-foreground mt-0.5 text-xs">{tx.description}</p>
                                            )}
                                        </div>
                                        <div className="text-right">
                                            <span
                                                className={`text-sm font-medium tabular-nums ${
                                                    tx.type === 'credit' || tx.type === 'refund'
                                                        ? 'text-green-600'
                                                        : 'text-red-600'
                                                }`}
                                            >
                                                {tx.type === 'debit' ? '-' : '+'}
                                                {coin(tx.amount)}
                                            </span>
                                            <p className="text-muted-foreground text-xs tabular-nums">
                                                {t('admin.wallets.balance_after', { balance: String(coin(tx.balance_after)) })}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-muted-foreground py-8 text-center text-sm">
                                {t('admin.wallets.no_transactions')}
                            </p>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </AppLayout>
    );
}
