import { Head, router } from '@inertiajs/react';
import { Filter, ScrollText } from 'lucide-react';
import { useState } from 'react';
import AppLayout from '@/layouts/app-layout';
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
};

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Dashboard', href: '/dashboard' },
    { title: 'Audit Log', href: '/admin/audit' },
];

export default function Audit({
    logs,
    filters,
    available_actions,
}: {
    logs: PaginatedLogs;
    filters: Filters;
    available_actions: string[];
}) {
    const [localFilters, setLocalFilters] = useState(filters);

    function applyFilters() {
        const params: Record<string, string> = {};
        if (localFilters.action) params.action = localFilters.action;
        if (localFilters.actor) params.actor = localFilters.actor;
        if (localFilters.from) params.from = localFilters.from;
        if (localFilters.to) params.to = localFilters.to;

        router.get('/admin/audit', params, { preserveState: true });
    }

    function clearFilters() {
        setLocalFilters({ action: '', actor: '', from: '', to: '' });
        router.get('/admin/audit', {}, { preserveState: true });
    }

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="Audit Log" />
            <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Audit Log</h1>
                    <p className="text-muted-foreground">
                        {logs.total} event{logs.total !== 1 ? 's' : ''} recorded
                    </p>
                </div>

                {/* Filters */}
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Filter className="size-4" />
                            Filters
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex flex-wrap items-end gap-4">
                            <div className="min-w-[160px] space-y-1.5">
                                <Label className="text-xs">Action</Label>
                                <Select
                                    value={localFilters.action || '__all__'}
                                    onValueChange={(v) =>
                                        setLocalFilters((f) => ({ ...f, action: v === '__all__' ? '' : v }))
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="All actions" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="__all__">All actions</SelectItem>
                                        {available_actions.map((a) => (
                                            <SelectItem key={a} value={a}>{a}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="min-w-[140px] space-y-1.5">
                                <Label className="text-xs">Actor</Label>
                                <Input
                                    value={localFilters.actor}
                                    onChange={(e) => setLocalFilters((f) => ({ ...f, actor: e.target.value }))}
                                    placeholder="All actors"
                                />
                            </div>
                            <div className="min-w-[140px] space-y-1.5">
                                <Label className="text-xs">From</Label>
                                <Input
                                    type="date"
                                    value={localFilters.from}
                                    onChange={(e) => setLocalFilters((f) => ({ ...f, from: e.target.value }))}
                                />
                            </div>
                            <div className="min-w-[140px] space-y-1.5">
                                <Label className="text-xs">To</Label>
                                <Input
                                    type="date"
                                    value={localFilters.to}
                                    onChange={(e) => setLocalFilters((f) => ({ ...f, to: e.target.value }))}
                                />
                            </div>
                            <div className="flex gap-2">
                                <Button size="sm" onClick={applyFilters}>Apply</Button>
                                <Button size="sm" variant="outline" onClick={clearFilters}>Clear</Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Log Table */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <ScrollText className="size-5" />
                            Events
                        </CardTitle>
                        <CardDescription>All admin actions logged with details</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {logs.data.length > 0 ? (
                            <div className="space-y-2">
                                {logs.data.map((entry) => (
                                    <div
                                        key={entry.id}
                                        className="rounded-lg border border-border/50 px-4 py-3"
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <Badge variant="outline" className="text-xs font-mono">
                                                    {entry.action}
                                                </Badge>
                                                {entry.target && (
                                                    <span className="text-sm text-muted-foreground">{entry.target}</span>
                                                )}
                                            </div>
                                            <span className="text-xs text-muted-foreground">
                                                {entry.created_at
                                                    ? new Date(entry.created_at).toLocaleString()
                                                    : ''}
                                            </span>
                                        </div>
                                        <div className="mt-1 flex items-center gap-4 text-xs text-muted-foreground">
                                            <span>by {entry.actor}</span>
                                            {entry.ip_address && <span>from {entry.ip_address}</span>}
                                        </div>
                                        {entry.details && Object.keys(entry.details).length > 0 && (
                                            <pre className="mt-2 max-h-32 overflow-auto rounded bg-muted/50 p-2 text-xs font-mono">
                                                {JSON.stringify(entry.details, null, 2)}
                                            </pre>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="py-8 text-center text-muted-foreground">No audit events found</p>
                        )}

                        {/* Pagination */}
                        {logs.last_page > 1 && (
                            <div className="mt-4 flex items-center justify-center gap-2">
                                {Array.from({ length: logs.last_page }, (_, i) => i + 1).map((page) => (
                                    <Button
                                        key={page}
                                        variant={page === logs.current_page ? 'default' : 'outline'}
                                        size="sm"
                                        onClick={() =>
                                            router.get(
                                                '/admin/audit',
                                                { ...localFilters, page },
                                                { preserveState: true },
                                            )
                                        }
                                    >
                                        {page}
                                    </Button>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </AppLayout>
    );
}
