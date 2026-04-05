import { router } from '@inertiajs/react';
import { FileUp, Loader2, Upload } from 'lucide-react';
import { type ChangeEvent, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { fetchAction } from '@/lib/fetch-action';

type ChangedEntry = { current: string; new: string };
type SkippedEntry = { value: string; reason: string };

type PreviewData = {
    changed: Record<string, ChangedEntry>;
    added: Record<string, string>;
    skipped: Record<string, SkippedEntry>;
    unchanged: number;
};

type DialogStep = 'input' | 'preview' | 'applying';

export function ImportConfigDialog({
    open,
    onOpenChange,
    onImportComplete,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onImportComplete?: () => void;
}) {
    const [step, setStep] = useState<DialogStep>('input');
    const [type, setType] = useState<string>('server');
    const [content, setContent] = useState('');
    const [preview, setPreview] = useState<PreviewData | null>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    function reset() {
        setStep('input');
        setType('server');
        setContent('');
        setPreview(null);
        setSelected(new Set());
        setLoading(false);
    }

    function handleClose(open: boolean) {
        if (!open) {
            reset();
        }
        onOpenChange(open);
    }

    function handleFileLoad(e: ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            setContent(reader.result as string);
        };
        reader.readAsText(file);

        // Reset input so the same file can be loaded again
        e.target.value = '';
    }

    async function handlePreview() {
        setLoading(true);
        const result = await fetchAction('/admin/config/import/preview', {
            data: { type, content },
        });
        setLoading(false);

        if (!result) return;

        const data = result as unknown as PreviewData;
        setPreview(data);

        const allChangeable = new Set([
            ...Object.keys(data.changed),
            ...Object.keys(data.added),
        ]);
        setSelected(allChangeable);
        setStep('preview');
    }

    async function handleApply() {
        if (!preview || selected.size === 0) return;

        const settings: Record<string, string> = {};
        for (const key of selected) {
            if (key in preview.changed) {
                settings[key] = preview.changed[key].new;
            } else if (key in preview.added) {
                settings[key] = preview.added[key];
            }
        }

        setStep('applying');
        const result = await fetchAction('/admin/config/import/apply', {
            data: { type, settings },
            successMessage: `Imported ${Object.keys(settings).length} setting(s)`,
        });

        if (result) {
            handleClose(false);
            router.reload({ only: ['server_config', 'sandbox_config'] });
            onImportComplete?.();
        } else {
            setStep('preview');
        }
    }

    function toggleKey(key: string) {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
    }

    function toggleAll() {
        if (!preview) return;
        const allKeys = [
            ...Object.keys(preview.changed),
            ...Object.keys(preview.added),
        ];
        if (selected.size === allKeys.length) {
            setSelected(new Set());
        } else {
            setSelected(new Set(allKeys));
        }
    }

    const totalChangeable = preview
        ? Object.keys(preview.changed).length + Object.keys(preview.added).length
        : 0;

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Import Configuration</DialogTitle>
                    <DialogDescription>
                        {step === 'input' && 'Paste or load a configuration file to preview changes before applying.'}
                        {step === 'preview' && 'Review the changes below and select which settings to import.'}
                        {step === 'applying' && 'Applying configuration changes...'}
                    </DialogDescription>
                </DialogHeader>

                {step === 'input' && (
                    <div className="grid gap-4 py-2">
                        <div className="grid gap-2">
                            <Label>Configuration Type</Label>
                            <Select value={type} onValueChange={setType}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="server">server.ini</SelectItem>
                                    <SelectItem value="sandbox">SandboxVars.lua</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid gap-2">
                            <div className="flex items-center justify-between">
                                <Label>Configuration Content</Label>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => fileRef.current?.click()}
                                >
                                    <FileUp className="mr-1.5 size-3.5" />
                                    Load File
                                </Button>
                                <input
                                    ref={fileRef}
                                    type="file"
                                    accept=".ini,.lua,.txt"
                                    className="hidden"
                                    onChange={handleFileLoad}
                                />
                            </div>
                            <Textarea
                                value={content}
                                onChange={(e) => setContent(e.target.value)}
                                placeholder={
                                    type === 'server'
                                        ? 'DefaultPort=16261\nMaxPlayers=16\nPublic=true\n...'
                                        : 'SandboxVars = {\n    Zombies = 4,\n    ...\n}'
                                }
                                rows={12}
                                className="font-mono text-xs"
                            />
                        </div>
                    </div>
                )}

                {step === 'preview' && preview && (
                    <div className="flex-1 overflow-y-auto space-y-3 py-2">
                        {totalChangeable > 0 && (
                            <div className="flex items-center gap-2 pb-1">
                                <Checkbox
                                    checked={selected.size === totalChangeable}
                                    onCheckedChange={toggleAll}
                                    id="select-all"
                                />
                                <Label htmlFor="select-all" className="text-sm cursor-pointer">
                                    Select all ({totalChangeable})
                                </Label>
                            </div>
                        )}

                        {Object.keys(preview.changed).length > 0 && (
                            <div className="space-y-1.5">
                                <h4 className="text-sm font-medium">
                                    Changed
                                    <Badge variant="secondary" className="ml-2">
                                        {Object.keys(preview.changed).length}
                                    </Badge>
                                </h4>
                                <div className="rounded-lg border divide-y">
                                    {Object.entries(preview.changed).map(([key, entry]) => (
                                        <div key={key} className="flex items-start gap-3 px-3 py-2">
                                            <Checkbox
                                                checked={selected.has(key)}
                                                onCheckedChange={() => toggleKey(key)}
                                                className="mt-0.5"
                                            />
                                            <div className="flex-1 min-w-0">
                                                <span className="text-sm font-mono font-medium">{key}</span>
                                                <div className="flex gap-2 mt-0.5 text-xs">
                                                    <span className="text-red-500 line-through truncate max-w-[200px]" title={entry.current}>
                                                        {entry.current || '(empty)'}
                                                    </span>
                                                    <span className="text-muted-foreground">&rarr;</span>
                                                    <span className="text-green-500 truncate max-w-[200px]" title={entry.new}>
                                                        {entry.new || '(empty)'}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {Object.keys(preview.added).length > 0 && (
                            <div className="space-y-1.5">
                                <h4 className="text-sm font-medium">
                                    New Settings
                                    <Badge variant="secondary" className="ml-2">
                                        {Object.keys(preview.added).length}
                                    </Badge>
                                </h4>
                                <div className="rounded-lg border divide-y">
                                    {Object.entries(preview.added).map(([key, value]) => (
                                        <div key={key} className="flex items-start gap-3 px-3 py-2">
                                            <Checkbox
                                                checked={selected.has(key)}
                                                onCheckedChange={() => toggleKey(key)}
                                                className="mt-0.5"
                                            />
                                            <div className="flex-1 min-w-0">
                                                <span className="text-sm font-mono font-medium">{key}</span>
                                                <div className="text-xs text-green-500 mt-0.5 truncate" title={value}>
                                                    {value || '(empty)'}
                                                </div>
                                            </div>
                                            <Badge variant="outline" className="text-xs shrink-0">New</Badge>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {Object.keys(preview.skipped).length > 0 && (
                            <div className="space-y-1.5">
                                <h4 className="text-sm font-medium text-muted-foreground">
                                    Skipped
                                    <Badge variant="secondary" className="ml-2">
                                        {Object.keys(preview.skipped).length}
                                    </Badge>
                                </h4>
                                <div className="rounded-lg border divide-y opacity-60">
                                    {Object.entries(preview.skipped).map(([key, entry]) => (
                                        <div key={key} className="flex items-center gap-3 px-3 py-2">
                                            <div className="flex-1 min-w-0">
                                                <span className="text-sm font-mono">{key}</span>
                                                <div className="text-xs text-muted-foreground mt-0.5">
                                                    {entry.reason}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {preview.unchanged > 0 && (
                            <p className="text-xs text-muted-foreground">
                                {preview.unchanged} setting(s) unchanged.
                            </p>
                        )}

                        {totalChangeable === 0 && Object.keys(preview.skipped).length === 0 && (
                            <p className="py-4 text-center text-sm text-muted-foreground">
                                No differences found. Your configuration is already up to date.
                            </p>
                        )}
                    </div>
                )}

                {step === 'applying' && (
                    <div className="flex items-center justify-center py-8">
                        <Loader2 className="size-6 animate-spin text-muted-foreground" />
                    </div>
                )}

                <DialogFooter>
                    {step === 'input' && (
                        <>
                            <Button variant="outline" onClick={() => handleClose(false)}>
                                Cancel
                            </Button>
                            <Button onClick={handlePreview} disabled={!content.trim() || loading}>
                                {loading ? (
                                    <>
                                        <Loader2 className="mr-2 size-4 animate-spin" />
                                        Analyzing...
                                    </>
                                ) : (
                                    'Preview Changes'
                                )}
                            </Button>
                        </>
                    )}
                    {step === 'preview' && (
                        <>
                            <Button variant="outline" onClick={() => setStep('input')}>
                                Back
                            </Button>
                            <Button onClick={handleApply} disabled={selected.size === 0}>
                                <Upload className="mr-2 size-4" />
                                Apply {selected.size} Change{selected.size !== 1 ? 's' : ''}
                            </Button>
                        </>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
