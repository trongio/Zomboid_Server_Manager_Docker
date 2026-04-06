import { Head } from '@inertiajs/react';
import { Activity, Pause, Play, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/use-translation';
import AppLayout from '@/layouts/app-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import type { BreadcrumbItem } from '@/types';

export default function Logs({ lines: initialLines }: { lines: string[] }) {
    const { t } = useTranslation();
    const breadcrumbs: BreadcrumbItem[] = [
        { title: t('nav.dashboard'), href: '/dashboard' },
        { title: t('admin.logs.title'), href: '/admin/logs' },
    ];
    const [lines, setLines] = useState(initialLines);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [tail, setTail] = useState('100');
    const [refreshing, setRefreshing] = useState(false);
    const outputRef = useRef<HTMLDivElement>(null);

    function fetchLogs() {
        setRefreshing(true);
        fetch(`/admin/logs/fetch?tail=${tail}`)
            .then((r) => r.json())
            .then((data) => {
                if (data.lines) {
                    setLines(data.lines);
                }
            })
            .catch(() => {})
            .finally(() => setRefreshing(false));
    }

    useEffect(() => {
        if (!autoRefresh) return;

        const interval = setInterval(fetchLogs, 5000);
        return () => clearInterval(interval);
    }, [autoRefresh, tail]);

    useEffect(() => {
        if (outputRef.current) {
            outputRef.current.scrollTop = outputRef.current.scrollHeight;
        }
    }, [lines]);

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title={t('admin.logs.title')} />
            <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">{t('admin.logs.title')}</h1>
                        <p className="text-muted-foreground">
                            {t('admin.logs.description')}
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Select value={tail} onValueChange={(v) => { setTail(v); }}>
                            <SelectTrigger className="w-[120px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="50">{t('admin.logs.lines_label', { count: '50' })}</SelectItem>
                                <SelectItem value="100">{t('admin.logs.lines_label', { count: '100' })}</SelectItem>
                                <SelectItem value="200">{t('admin.logs.lines_label', { count: '200' })}</SelectItem>
                                <SelectItem value="500">{t('admin.logs.lines_label', { count: '500' })}</SelectItem>
                            </SelectContent>
                        </Select>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setAutoRefresh(!autoRefresh)}
                        >
                            {autoRefresh ? (
                                <><Pause className="mr-1.5 size-3.5" /> {t('admin.logs.pause')}</>
                            ) : (
                                <><Play className="mr-1.5 size-3.5" /> {t('admin.logs.resume')}</>
                            )}
                        </Button>
                        <Button variant="outline" size="sm" onClick={fetchLogs} disabled={refreshing}>
                            <RefreshCw className={`mr-1.5 size-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                            {t('admin.logs.refresh')}
                        </Button>
                    </div>
                </div>

                <Card className="flex flex-1 flex-col">
                    <CardHeader className="flex flex-row items-center justify-between">
                        <div>
                            <CardTitle className="flex items-center gap-2">
                                <Activity className="size-5" />
                                {t('admin.logs.card_title')}
                            </CardTitle>
                            <CardDescription>{t('admin.logs.line_count', { count: String(lines.length) })}</CardDescription>
                        </div>
                        {autoRefresh && (
                            <Badge variant="outline" className="text-xs">
                                <span className="mr-1.5 size-1.5 rounded-full bg-green-500 inline-block animate-pulse" />
                                {t('admin.logs.auto_refresh_badge')}
                            </Badge>
                        )}
                    </CardHeader>
                    <CardContent className="flex-1">
                        <div
                            ref={outputRef}
                            className="overflow-auto rounded-lg bg-zinc-950 p-4 font-mono text-xs leading-relaxed min-h-[500px] max-h-[70vh]"
                        >
                            {lines.length > 0 ? (
                                lines.map((line, i) => (
                                    <div key={i} className="text-zinc-300 hover:bg-zinc-900/50">
                                        <span className="mr-3 select-none text-zinc-600">{i + 1}</span>
                                        {line}
                                    </div>
                                ))
                            ) : (
                                <p className="text-zinc-500">{t('admin.logs.empty')}</p>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </AppLayout>
    );
}
