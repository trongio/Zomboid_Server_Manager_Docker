import { Head, router } from '@inertiajs/react';
import { Download, Globe, Languages, Plus, Search, Trash2, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { fetchAction } from '@/lib/fetch-action';
import AppLayout from '@/layouts/app-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { BreadcrumbItem } from '@/types';

type LanguageEntry = {
    id: number;
    code: string;
    name: string;
    native_name: string;
    is_default: boolean;
    is_active: boolean;
};

type Props = {
    languages: LanguageEntry[];
    keys: string[];
    defaults: Record<string, string>;
    locale_defaults: Record<string, Record<string, string>>;
    overrides: Record<string, Record<string, string>>;
    search: string;
};

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Dashboard', href: '/dashboard' },
    { title: 'Translations', href: '/admin/translations' },
];

export default function Translations({ languages, keys, defaults, locale_defaults, overrides, search }: Props) {
    const [searchValue, setSearchValue] = useState(search);
    const [editingCell, setEditingCell] = useState<{ key: string; locale: string } | null>(null);
    const [editValue, setEditValue] = useState('');

    // New language form
    const [newLangCode, setNewLangCode] = useState('');
    const [newLangName, setNewLangName] = useState('');
    const [newLangNative, setNewLangNative] = useState('');

    const importInputRef = useRef<HTMLInputElement>(null);
    const [importLocale, setImportLocale] = useState('');

    const activeLocales = languages.filter((l) => l.is_active);

    function handleSearch() {
        router.get('/admin/translations', { search: searchValue || undefined }, { preserveState: true });
    }

    function startEdit(key: string, locale: string) {
        const current = overrides[locale]?.[key] ?? locale_defaults[locale]?.[key] ?? defaults[key] ?? '';
        setEditValue(current);
        setEditingCell({ key, locale });
    }

    async function saveEdit() {
        if (!editingCell) return;

        await fetchAction('/admin/translations', {
            method: 'PATCH',
            data: {
                locale: editingCell.locale,
                key: editingCell.key,
                value: editValue,
            },
            successMessage: 'Translation saved',
        });

        setEditingCell(null);
        router.reload({ only: ['overrides'] });
    }

    async function removeOverride(key: string, locale: string) {
        await fetchAction('/admin/translations', {
            method: 'DELETE',
            data: { locale, key },
            successMessage: 'Override removed',
        });
        router.reload({ only: ['overrides'] });
    }

    async function addLanguage() {
        const result = await fetchAction('/admin/languages', {
            data: { code: newLangCode, name: newLangName, native_name: newLangNative },
            successMessage: 'Language added',
        });
        if (result) {
            setNewLangCode('');
            setNewLangName('');
            setNewLangNative('');
            router.reload();
        }
    }

    async function toggleLanguageActive(language: LanguageEntry) {
        await fetchAction(`/admin/languages/${language.id}`, {
            method: 'PATCH',
            data: { is_active: !language.is_active },
            successMessage: `${language.name} ${language.is_active ? 'disabled' : 'enabled'}`,
        });
        router.reload();
    }

    async function setDefault(language: LanguageEntry) {
        await fetchAction(`/admin/languages/${language.id}`, {
            method: 'PATCH',
            data: { is_default: true },
            successMessage: `${language.name} set as default`,
        });
        router.reload();
    }

    async function deleteLanguage(language: LanguageEntry) {
        await fetchAction(`/admin/languages/${language.id}`, {
            method: 'DELETE',
            successMessage: `${language.name} deleted`,
        });
        router.reload();
    }

    function downloadLocale(code: string) {
        window.location.href = `/admin/translations/export/${code}`;
    }

    function triggerImport(code: string) {
        setImportLocale(code);
        importInputRef.current?.click();
    }

    async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file || !importLocale) return;

        const csrfToken = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '';
        const formData = new FormData();
        formData.append('locale', importLocale);
        formData.append('file', file);

        try {
            const res = await fetch('/admin/translations/import', {
                method: 'POST',
                headers: { 'X-CSRF-TOKEN': csrfToken, 'Accept': 'application/json' },
                body: formData,
            });
            const json = await res.json().catch(() => ({}));
            if (res.ok) {
                toast.success(json.message || 'Translations imported');
                router.reload();
            } else {
                toast.error(json.message || `Import failed (${res.status})`);
            }
        } catch {
            toast.error('Network error — could not reach the server');
        }

        // Reset the input so the same file can be re-selected
        e.target.value = '';
        setImportLocale('');
    }

    function getCellValue(key: string, locale: string): string {
        return overrides[locale]?.[key] ?? locale_defaults[locale]?.[key] ?? defaults[key] ?? '';
    }

    function hasOverride(key: string, locale: string): boolean {
        return !!overrides[locale]?.[key] || !!locale_defaults[locale]?.[key];
    }

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="Translations" />
            <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Translations</h1>
                    <p className="text-muted-foreground">
                        Manage languages and override translation strings.
                    </p>
                </div>

                {/* Languages Card */}
                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="flex items-center gap-2">
                                    <Globe className="size-5" />
                                    Languages
                                </CardTitle>
                                <CardDescription>
                                    Active languages appear in the language switcher on public pages.
                                </CardDescription>
                            </div>
                            <Dialog>
                                <DialogTrigger asChild>
                                    <Button variant="outline" size="sm">
                                        <Plus className="mr-1.5 size-3.5" />
                                        Add Language
                                    </Button>
                                </DialogTrigger>
                                <DialogContent>
                                    <DialogHeader>
                                        <DialogTitle>Add Language</DialogTitle>
                                        <DialogDescription>
                                            Add a new language for translation. Use ISO 639-1 codes (e.g. ka, ru, de).
                                        </DialogDescription>
                                    </DialogHeader>
                                    <div className="space-y-3 py-2">
                                        <div className="space-y-1">
                                            <Label>Language Code</Label>
                                            <Input
                                                value={newLangCode}
                                                onChange={(e) => setNewLangCode(e.target.value)}
                                                placeholder="ka"
                                                maxLength={10}
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label>Name (English)</Label>
                                            <Input
                                                value={newLangName}
                                                onChange={(e) => setNewLangName(e.target.value)}
                                                placeholder="Georgian"
                                                maxLength={100}
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label>Native Name</Label>
                                            <Input
                                                value={newLangNative}
                                                onChange={(e) => setNewLangNative(e.target.value)}
                                                placeholder="ქართული"
                                                maxLength={100}
                                            />
                                        </div>
                                    </div>
                                    <DialogFooter>
                                        <DialogClose asChild>
                                            <Button variant="outline">Cancel</Button>
                                        </DialogClose>
                                        <Button onClick={addLanguage} disabled={!newLangCode || !newLangName || !newLangNative}>
                                            Add
                                        </Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        {languages.map((lang) => (
                            <div
                                key={lang.id}
                                className="flex items-center justify-between rounded-lg border border-border/50 px-4 py-3"
                            >
                                <div className="flex items-center gap-3">
                                    <span className="font-mono text-sm font-medium text-muted-foreground w-8">
                                        {lang.code}
                                    </span>
                                    <span className="text-sm font-medium">{lang.native_name}</span>
                                    <span className="text-sm text-muted-foreground">({lang.name})</span>
                                    {lang.is_default && (
                                        <Badge variant="secondary">Default</Badge>
                                    )}
                                </div>
                                <div className="flex items-center gap-3">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => downloadLocale(lang.code)}
                                        title="Download translations as JSON"
                                    >
                                        <Download className="size-4" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => triggerImport(lang.code)}
                                        title="Upload translated JSON"
                                    >
                                        <Upload className="size-4" />
                                    </Button>
                                    {!lang.is_default && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setDefault(lang)}
                                            className="text-xs"
                                        >
                                            Set Default
                                        </Button>
                                    )}
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-muted-foreground">
                                            {lang.is_active ? 'Active' : 'Inactive'}
                                        </span>
                                        <Switch
                                            checked={lang.is_active}
                                            onCheckedChange={() => toggleLanguageActive(lang)}
                                        />
                                    </div>
                                    {!lang.is_default && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => deleteLanguage(lang)}
                                        >
                                            <Trash2 className="size-4 text-destructive" />
                                        </Button>
                                    )}
                                </div>
                            </div>
                        ))}
                        {languages.length === 0 && (
                            <p className="py-4 text-center text-sm text-muted-foreground">
                                No languages configured. Add English as the default to get started.
                            </p>
                        )}
                    </CardContent>
                </Card>

                {/* Translation Editor Card */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Languages className="size-5" />
                            Translation Strings
                        </CardTitle>
                        <CardDescription>
                            Click a cell to override. Overrides are highlighted. Clear an override to revert to the default.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {/* Search */}
                        <div className="flex items-center gap-2">
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    value={searchValue}
                                    onChange={(e) => setSearchValue(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                                    placeholder="Filter keys... (e.g. nav, landing, common)"
                                    className="pl-9"
                                />
                            </div>
                            <Button variant="outline" onClick={handleSearch}>
                                Search
                            </Button>
                            {search && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                        setSearchValue('');
                                        router.get('/admin/translations', {}, { preserveState: true });
                                    }}
                                >
                                    <X className="size-4" />
                                </Button>
                            )}
                        </div>

                        {/* Translation table */}
                        <div className="overflow-x-auto rounded-lg border">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b bg-muted/50">
                                        <th className="px-3 py-2 text-left font-medium text-muted-foreground w-[250px]">
                                            Key
                                        </th>
                                        {activeLocales.map((lang) => (
                                            <th key={lang.code} className="px-3 py-2 text-left font-medium text-muted-foreground min-w-[200px]">
                                                {lang.native_name}
                                                <span className="ml-1 text-xs">({lang.code})</span>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {keys.map((key) => (
                                        <tr key={key} className="border-b last:border-0 hover:bg-muted/20">
                                            <td className="px-3 py-2 font-mono text-xs text-muted-foreground align-top">
                                                {key}
                                            </td>
                                            {activeLocales.map((lang) => {
                                                const isEditing =
                                                    editingCell?.key === key && editingCell?.locale === lang.code;
                                                const isOverridden = hasOverride(key, lang.code);

                                                return (
                                                    <td
                                                        key={lang.code}
                                                        className={`px-3 py-2 align-top ${isOverridden ? 'bg-blue-500/5' : ''}`}
                                                    >
                                                        {isEditing ? (
                                                            <div className="flex items-start gap-1">
                                                                <Input
                                                                    value={editValue}
                                                                    onChange={(e) => setEditValue(e.target.value)}
                                                                    onKeyDown={(e) => {
                                                                        if (e.key === 'Enter') saveEdit();
                                                                        if (e.key === 'Escape') setEditingCell(null);
                                                                    }}
                                                                    className="text-sm"
                                                                    autoFocus
                                                                />
                                                                <Button size="sm" onClick={saveEdit}>
                                                                    Save
                                                                </Button>
                                                                <Button
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    onClick={() => setEditingCell(null)}
                                                                >
                                                                    <X className="size-3.5" />
                                                                </Button>
                                                            </div>
                                                        ) : (
                                                            <div
                                                                className="group flex items-start gap-1 cursor-pointer rounded px-1 py-0.5 -mx-1 hover:bg-muted/50"
                                                                onClick={() => startEdit(key, lang.code)}
                                                            >
                                                                <span className="flex-1 text-sm break-words">
                                                                    {getCellValue(key, lang.code) || (
                                                                        <span className="italic text-muted-foreground/50">
                                                                            empty
                                                                        </span>
                                                                    )}
                                                                </span>
                                                                {isOverridden && (
                                                                    <button
                                                                        className="mt-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            removeOverride(key, lang.code);
                                                                        }}
                                                                        title="Remove override"
                                                                    >
                                                                        <X className="size-3 text-muted-foreground hover:text-destructive" />
                                                                    </button>
                                                                )}
                                                            </div>
                                                        )}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {keys.length === 0 && (
                                <p className="py-8 text-center text-sm text-muted-foreground">
                                    {search ? 'No keys match your search.' : 'No translation keys found. Check that lang/en.json exists.'}
                                </p>
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Showing {keys.length} key{keys.length !== 1 ? 's' : ''}.
                            Overrides are saved per-language in the database and take priority over JSON file defaults.
                        </p>
                    </CardContent>
                </Card>
            </div>

            {/* Hidden file input for JSON import */}
            <input
                ref={importInputRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={handleImportFile}
            />
        </AppLayout>
    );
}
