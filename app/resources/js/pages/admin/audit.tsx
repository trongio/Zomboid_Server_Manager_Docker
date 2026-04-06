import { Deferred, Head, router } from '@inertiajs/react';
import { ChevronDown, ChevronRight, Filter, ScrollText } from 'lucide-react';
import { formatDateTime } from '@/lib/dates';
import { Fragment, useState } from 'react';
import { SortableHeader } from '@/components/sortable-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useServerSort } from '@/hooks/use-server-sort';
import { useTranslation } from '@/hooks/use-translation';
import AppLayout from '@/layouts/app-layout';
import type { AuditEntry, BreadcrumbItem } from '@/types';

type PaginatedLogs = {
    data: AuditEntry[];
    current_page: number;
    last_page: number;
    total: number;
};

type Filters = {
    action: string;
    actor: string;
    from: string;
    to: string;
    sort: string;
    direction: string;
};

type SortKey = 'action' | 'actor' | 'created_at';

export default function Audit({
    logs,
    filters,
    available_actions,
}: {
    logs: PaginatedLogs;
    filters: Filters;
    available_actions: string[];
}) {
    const { t } = useTranslation();
    const breadcrumbs: BreadcrumbItem[] = [
        { title: t('nav.dashboard'), href: '/dashboard' },
        { title: t('admin.audit.title'), href: '/admin/audit' },
    ];
    const [localFilters, setLocalFilters] = useState(filters);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const { sortKey, sortDir, toggleSort } = useServerSort<SortKey>({
        url: '/admin/audit',
        filters,
        defaultSort: 'created_at',
        defaultDir: 'desc',
    });

    function applyFilters() {
        const params: Record<string, string> = {};
        if (localFilters.action) params.action = localFilters.action;
        if (localFilters.actor) params.actor = localFilters.actor;
        if (localFilters.from) params.from = localFilters.from;
        if (localFilters.to) params.to = localFilters.to;
        if (filters.sort) params.sort = filters.sort;
        if (filters.direction) params.direction = filters.direction;

        router.get('/admin/audit', params, { preserveState: true });
    }

    function clearFilters() {
        setLocalFilters({ action: '', actor: '', from: '', to: '', sort: filters.sort, direction: filters.direction });
        const params: Record<string, string> = {};
        if (filters.sort) params.sort = filters.sort;
        if (filters.direction) params.direction = filters.direction;
        router.get('/admin/audit', params, { preserveState: true });
    }

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title={t('admin.audit.title')} />
            <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">{t('admin.audit.title')}</h1>
                    <p className="text-muted-foreground">
                        {logs ? t('admin.audit.event_count', { count: String(logs.total) }) : t('common.loading')}
                    </p>
                </div>

                {/* Filters */}
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Filter className="size-4" />
                            {t('admin.audit.filters_title')}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-2 lg:grid-cols-5">
                            <div className="space-y-1.5">
                                <Label className="text-xs">{t('admin.audit.filter_action')}</Label>
                                <Select
                                    value={localFilters.action || '__all__'}
                                    onValueChange={(v) =>
                                        setLocalFilters((f) => ({ ...f, action: v === '__all__' ? '' : v }))
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder={t('admin.audit.filter_all_actions')} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="__all__">{t('admin.audit.filter_all_actions')}</SelectItem>
                                        {available_actions.map((a) => (
                                            <SelectItem key={a} value={a}>{a}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">{t('admin.audit.filter_actor')}</Label>
                                <Input
                                    value={localFilters.actor}
                                    onChange={(e) => setLocalFilters((f) => ({ ...f, actor: e.target.value }))}
                                    placeholder={t('admin.audit.filter_all_actors')}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">{t('admin.audit.filter_from')}</Label>
                                <Input
                                    type="date"
                                    value={localFilters.from}
                                    onChange={(e) => setLocalFilters((f) => ({ ...f, from: e.target.value }))}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">{t('admin.audit.filter_to')}</Label>
                                <Input
                                    type="date"
                                    value={localFilters.to}
                                    onChange={(e) => setLocalFilters((f) => ({ ...f, to: e.target.value }))}
                                />
                            </div>
                            <div className="flex gap-2">
                                <Button size="sm" onClick={applyFilters}>{t('common.apply')}</Button>
                                <Button size="sm" variant="outline" onClick={clearFilters}>{t('common.clear')}</Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Log Table */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <ScrollText className="size-5" />
                            {t('admin.audit.events_title')}
                        </CardTitle>
                        <CardDescription>{t('admin.audit.events_description')}</CardDescription>
                    </CardHeader>
                    <CardContent className="overflow-x-auto">
                        <Deferred data="logs" fallback={
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>{t('admin.audit.table_action')}</TableHead>
                                        <TableHead>{t('admin.audit.table_target')}</TableHead>
                                        <TableHead className="hidden sm:table-cell">{t('admin.audit.table_actor')}</TableHead>
                                        <TableHead>{t('admin.audit.table_date')}</TableHead>
                                        <TableHead className="hidden md:table-cell">{t('admin.audit.table_ip')}</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {Array.from({ length: 6 }).map((_, i) => (
                                        <TableRow key={i}>
                                            <TableCell><Skeleton className="h-5 w-24 rounded-full" /></TableCell>
                                            <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                                            <TableCell className="hidden sm:table-cell"><Skeleton className="h-4 w-20" /></TableCell>
                                            <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                                            <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        }>
                            {logs?.data.length > 0 ? (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>
                                                <SortableHeader column="action" label={t('admin.audit.table_action')} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                                            </TableHead>
                                            <TableHead>{t('admin.audit.table_target')}</TableHead>
                                            <TableHead className="hidden sm:table-cell">
                                                <SortableHeader column="actor" label={t('admin.audit.table_actor')} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                                            </TableHead>
                                            <TableHead>
                                                <SortableHeader column="created_at" label={t('admin.audit.table_date')} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                                            </TableHead>
                                            <TableHead className="hidden md:table-cell">{t('admin.audit.table_ip')}</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {logs.data.map((entry) => {
                                            const hasDetails = entry.details && Object.keys(entry.details).length > 0;
                                            const isExpanded = expandedId === entry.id;

                                            return (
                                                <Fragment key={entry.id}>
                                                    <TableRow
                                                        className={hasDetails ? 'cursor-pointer' : ''}
                                                        onClick={() => hasDetails && setExpandedId(isExpanded ? null : entry.id)}
                                                    >
                                                        <TableCell>
                                                            <div className="flex items-center gap-1.5">
                                                                {hasDetails && (
                                                                    isExpanded
                                                                        ? <ChevronDown className="size-3.5 text-muted-foreground" />
                                                                        : <ChevronRight className="size-3.5 text-muted-foreground" />
                                                                )}
                                                                <Badge variant="outline" className="text-xs font-mono">
                                                                    {entry.action}
                                                                </Badge>
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="text-sm text-muted-foreground">
                                                            {entry.target ?? '-'}
                                                        </TableCell>
                                                        <TableCell className="hidden sm:table-cell">
                                                            {entry.actor}
                                                        </TableCell>
                                                        <TableCell>
                                                            {entry.created_at
                                                                ? formatDateTime(entry.created_at)
                                                                : ''}
                                                        </TableCell>
                                                        <TableCell className="hidden md:table-cell">
                                                            {entry.ip_address ?? '-'}
                                                        </TableCell>
                                                    </TableRow>
                                                    {isExpanded && hasDetails && (
                                                        <TableRow key={`${entry.id}-details`}>
                                                            <TableCell colSpan={5} className="bg-muted/30 p-0">
                                                                <pre className="max-h-48 overflow-auto p-3 text-xs font-mono">
                                                                    {JSON.stringify(entry.details, null, 2)}
                                                                </pre>
                                                            </TableCell>
                                                        </TableRow>
                                                    )}
                                                </Fragment>
                                            );
                                        })}
                                    </TableBody>
                                </Table>
                            ) : (
                                <p className="py-8 text-center text-muted-foreground">{t('admin.audit.empty')}</p>
                            )}

                            {/* Pagination */}
                            {logs?.last_page > 1 && (
                                <div className="mt-4 flex items-center justify-center gap-2">
                                    {Array.from({ length: logs.last_page }, (_, i) => i + 1).map((page) => (
                                        <Button
                                            key={page}
                                            variant={page === logs.current_page ? 'default' : 'outline'}
                                            size="sm"
                                            onClick={() => {
                                                const params: Record<string, string | number> = { ...localFilters, page };
                                                router.get('/admin/audit', params, { preserveState: true });
                                            }}
                                        >
                                            {page}
                                        </Button>
                                    ))}
                                </div>
                            )}
                        </Deferred>
                    </CardContent>
                </Card>
            </div>
        </AppLayout>
    );
}
