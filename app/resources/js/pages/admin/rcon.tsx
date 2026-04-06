import { Head } from '@inertiajs/react';
import { Send, Terminal } from 'lucide-react';
import { formatTime } from '@/lib/dates';
import { useEffect, useRef, useState } from 'react';
import AppLayout from '@/layouts/app-layout';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useTranslation } from '@/hooks/use-translation';
import type { BreadcrumbItem } from '@/types';

type HistoryEntry = {
    type: 'command' | 'response' | 'error';
    text: string;
    timestamp: string;
};

export default function Rcon() {
    const { t } = useTranslation();

    const breadcrumbs: BreadcrumbItem[] = [
        { title: t('nav.dashboard'), href: '/dashboard' },
        { title: t('admin.rcon.title'), href: '/admin/rcon' },
    ];
    const [command, setCommand] = useState('');
    const [history, setHistory] = useState<HistoryEntry[]>([]);
    const [commandHistory, setCommandHistory] = useState<string[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [loading, setLoading] = useState(false);
    const outputRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const csrfToken = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '';

    useEffect(() => {
        if (outputRef.current) {
            outputRef.current.scrollTop = outputRef.current.scrollHeight;
        }
    }, [history]);

    function addEntry(type: HistoryEntry['type'], text: string) {
        setHistory((prev) => [...prev, { type, text, timestamp: formatTime() }]);
    }

    function executeCommand() {
        if (!command.trim() || loading) return;

        const cmd = command.trim();
        addEntry('command', cmd);
        setCommandHistory((prev) => [cmd, ...prev]);
        setHistoryIndex(-1);
        setCommand('');
        setLoading(true);

        fetch('/admin/rcon', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrfToken },
            body: JSON.stringify({ command: cmd }),
        })
            .then((r) => r.json())
            .then((data) => {
                if (data.error) {
                    addEntry('error', data.error);
                } else {
                    addEntry('response', data.response || t('common.no_output'));
                }
            })
            .catch((err) => {
                const msg = `Request failed: ${err.message}`;
                addEntry('error', msg);
                toast.error(msg);
            })
            .finally(() => setLoading(false));
    }

    function handleKeyDown(e: React.KeyboardEvent) {
        if (e.key === 'Enter') {
            executeCommand();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (commandHistory.length > 0) {
                const newIndex = Math.min(historyIndex + 1, commandHistory.length - 1);
                setHistoryIndex(newIndex);
                setCommand(commandHistory[newIndex]);
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (historyIndex > 0) {
                const newIndex = historyIndex - 1;
                setHistoryIndex(newIndex);
                setCommand(commandHistory[newIndex]);
            } else {
                setHistoryIndex(-1);
                setCommand('');
            }
        }
    }

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title={t('admin.rcon.title')} />
            <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">{t('admin.rcon.title')}</h1>
                    <p className="text-muted-foreground">
                        {t('admin.rcon.description')}
                    </p>
                </div>

                <Card className="flex flex-1 flex-col">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Terminal className="size-5" />
                            {t('admin.rcon.console')}
                        </CardTitle>
                        <CardDescription>
                            {t('admin.rcon.commands_hint')}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-1 flex-col">
                        {/* Output */}
                        <div
                            ref={outputRef}
                            className="flex-1 overflow-auto rounded-t-lg bg-zinc-950 p-4 font-mono text-sm min-h-[400px]"
                        >
                            {history.length === 0 ? (
                                <p className="text-zinc-500">
                                    {t('admin.rcon.empty_prompt')}
                                </p>
                            ) : (
                                history.map((entry, i) => (
                                    <div key={i} className="mb-1">
                                        <span className="text-zinc-500 text-xs mr-2">[{entry.timestamp}]</span>
                                        {entry.type === 'command' && (
                                            <span className="text-green-400">&gt; {entry.text}</span>
                                        )}
                                        {entry.type === 'response' && (
                                            <span className="whitespace-pre-wrap text-zinc-300">{entry.text}</span>
                                        )}
                                        {entry.type === 'error' && (
                                            <span className="text-red-400">{entry.text}</span>
                                        )}
                                    </div>
                                ))
                            )}
                            {loading && (
                                <div className="text-zinc-500 animate-pulse">{t('admin.rcon.executing')}</div>
                            )}
                        </div>

                        {/* Input */}
                        <div className="flex gap-2 rounded-b-lg border-t border-zinc-800 bg-zinc-950 p-2">
                            <Input
                                ref={inputRef}
                                value={command}
                                onChange={(e) => setCommand(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder={t('admin.rcon.input_placeholder')}
                                className="border-zinc-700 bg-zinc-900 font-mono text-sm text-zinc-100 placeholder:text-zinc-600"
                                disabled={loading}
                                autoFocus
                            />
                            <Button
                                size="sm"
                                onClick={executeCommand}
                                disabled={loading || !command.trim()}
                            >
                                <Send className="size-4" />
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </AppLayout>
    );
}
