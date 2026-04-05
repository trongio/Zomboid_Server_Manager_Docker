import { Head, router } from '@inertiajs/react';
import { ImageIcon, Palette, Trash2, Type, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { fetchAction } from '@/lib/fetch-action';
import AppLayout from '@/layouts/app-layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import type { BreadcrumbItem } from '@/types';

type Settings = {
    site_name: string;
    logo_url: string | null;
    favicon_url: string | null;
    footer_text: string;
    hero_badge: string;
    hero_title: string;
    hero_subtitle: string;
    hero_description: string;
    hero_button_text: string;
    features: Feature[];
    landing_sections: LandingSection[];
    theme_colors: Record<string, string> | null;
    default_locale: string;
};

type Feature = {
    icon: string;
    title: string;
    description: string;
};

type LandingSection = {
    id: string;
    enabled: boolean;
    order: number;
};

type Props = {
    settings: Settings;
    available_icons: string[];
    available_sections: { id: string; label: string }[];
};

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Dashboard', href: '/dashboard' },
    { title: 'Site Settings', href: '/admin/site-settings' },
];

export default function SiteSettings({ settings, available_icons, available_sections }: Props) {
    const [siteName, setSiteName] = useState(settings.site_name);
    const [footerText, setFooterText] = useState(settings.footer_text);
    const [heroBadge, setHeroBadge] = useState(settings.hero_badge);
    const [heroTitle, setHeroTitle] = useState(settings.hero_title);
    const [heroSubtitle, setHeroSubtitle] = useState(settings.hero_subtitle);
    const [heroDescription, setHeroDescription] = useState(settings.hero_description);
    const [heroButtonText, setHeroButtonText] = useState(settings.hero_button_text);
    const [features, setFeatures] = useState<Feature[]>(settings.features);
    const [landingSections, setLandingSections] = useState<LandingSection[]>(settings.landing_sections);

    const [logoFile, setLogoFile] = useState<File | null>(null);
    const [faviconFile, setFaviconFile] = useState<File | null>(null);
    const [saving, setSaving] = useState(false);

    const logoInputRef = useRef<HTMLInputElement>(null);
    const faviconInputRef = useRef<HTMLInputElement>(null);

    async function save() {
        setSaving(true);
        const csrfToken = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '';
        const formData = new FormData();

        formData.append('site_name', siteName);
        formData.append('footer_text', footerText);
        formData.append('hero_badge', heroBadge);
        formData.append('hero_title', heroTitle);
        formData.append('hero_subtitle', heroSubtitle);
        formData.append('hero_description', heroDescription);
        formData.append('hero_button_text', heroButtonText);

        if (logoFile) formData.append('logo', logoFile);
        if (faviconFile) formData.append('favicon', faviconFile);

        // Append features as JSON-encoded fields
        features.forEach((feature, i) => {
            formData.append(`features[${i}][icon]`, feature.icon);
            formData.append(`features[${i}][title]`, feature.title);
            formData.append(`features[${i}][description]`, feature.description);
        });

        // Append landing sections
        landingSections.forEach((section, i) => {
            formData.append(`landing_sections[${i}][id]`, section.id);
            formData.append(`landing_sections[${i}][enabled]`, section.enabled ? '1' : '0');
            formData.append(`landing_sections[${i}][order]`, String(section.order));
        });

        try {
            const res = await fetch('/admin/site-settings', {
                method: 'POST',
                headers: { 'X-CSRF-TOKEN': csrfToken, 'Accept': 'application/json' },
                body: formData,
            });
            const json = await res.json().catch(() => ({}));
            if (res.ok) {
                toast.success(json.message || 'Settings saved');
                setLogoFile(null);
                setFaviconFile(null);
                router.reload();
            } else {
                toast.error(json.message || `Save failed (${res.status})`);
            }
        } catch {
            toast.error('Network error — could not reach the server');
        }
        setSaving(false);
    }

    async function removeLogo() {
        await fetchAction('/admin/site-settings/logo', {
            method: 'DELETE',
            successMessage: 'Logo removed',
        });
        router.reload();
    }

    async function removeFavicon() {
        await fetchAction('/admin/site-settings/favicon', {
            method: 'DELETE',
            successMessage: 'Favicon removed',
        });
        router.reload();
    }

    function addFeature() {
        if (features.length >= 8) return;
        setFeatures([...features, { icon: 'Star', title: '', description: '' }]);
    }

    function removeFeature(index: number) {
        setFeatures(features.filter((_, i) => i !== index));
    }

    function updateFeature(index: number, field: keyof Feature, value: string) {
        setFeatures(features.map((f, i) => (i === index ? { ...f, [field]: value } : f)));
    }

    function toggleSection(id: string) {
        setLandingSections(
            landingSections.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)),
        );
    }

    function moveSectionUp(index: number) {
        if (index === 0) return;
        const updated = [...landingSections];
        [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
        setLandingSections(updated.map((s, i) => ({ ...s, order: i })));
    }

    function moveSectionDown(index: number) {
        if (index === landingSections.length - 1) return;
        const updated = [...landingSections];
        [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
        setLandingSections(updated.map((s, i) => ({ ...s, order: i })));
    }

    function getSectionLabel(id: string) {
        return available_sections.find((s) => s.id === id)?.label ?? id;
    }

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="Site Settings" />
            <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Site Settings</h1>
                    <p className="text-muted-foreground">
                        Customize your site's branding, landing page content, and layout.
                    </p>
                </div>

                {/* Branding Card */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Palette className="size-5" />
                            Branding
                        </CardTitle>
                        <CardDescription>
                            Site name, logo, and favicon shown across all pages.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="site-name">Site Name</Label>
                            <Input
                                id="site-name"
                                value={siteName}
                                onChange={(e) => setSiteName(e.target.value)}
                                maxLength={100}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="footer-text">Footer Text</Label>
                            <Input
                                id="footer-text"
                                value={footerText}
                                onChange={(e) => setFooterText(e.target.value)}
                                maxLength={200}
                            />
                        </div>

                        <Separator />

                        {/* Logo upload */}
                        <div className="space-y-2">
                            <Label>Logo</Label>
                            <div className="flex items-center gap-4">
                                {settings.logo_url && !logoFile ? (
                                    <div className="flex items-center gap-3">
                                        <img
                                            src={settings.logo_url}
                                            alt="Current logo"
                                            className="size-10 rounded-md border object-contain"
                                        />
                                        <Button variant="outline" size="sm" onClick={removeLogo}>
                                            <Trash2 className="mr-1.5 size-3.5" />
                                            Remove
                                        </Button>
                                    </div>
                                ) : logoFile ? (
                                    <div className="flex items-center gap-3">
                                        <img
                                            src={URL.createObjectURL(logoFile)}
                                            alt="New logo preview"
                                            className="size-10 rounded-md border object-contain"
                                        />
                                        <span className="text-sm text-muted-foreground">{logoFile.name}</span>
                                        <Button variant="outline" size="sm" onClick={() => setLogoFile(null)}>
                                            Clear
                                        </Button>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <ImageIcon className="size-4" />
                                        No logo uploaded — using default icon
                                    </div>
                                )}
                                <input
                                    ref={logoInputRef}
                                    type="file"
                                    accept="image/png,image/jpeg,image/svg+xml,image/webp"
                                    className="hidden"
                                    onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
                                />
                                <Button variant="outline" size="sm" onClick={() => logoInputRef.current?.click()}>
                                    <Upload className="mr-1.5 size-3.5" />
                                    Upload
                                </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">PNG, JPG, SVG, or WebP. Max 2 MB.</p>
                        </div>

                        {/* Favicon upload */}
                        <div className="space-y-2">
                            <Label>Favicon</Label>
                            <div className="flex items-center gap-4">
                                {settings.favicon_url && !faviconFile ? (
                                    <div className="flex items-center gap-3">
                                        <img
                                            src={settings.favicon_url}
                                            alt="Current favicon"
                                            className="size-8 rounded border object-contain"
                                        />
                                        <Button variant="outline" size="sm" onClick={removeFavicon}>
                                            <Trash2 className="mr-1.5 size-3.5" />
                                            Remove
                                        </Button>
                                    </div>
                                ) : faviconFile ? (
                                    <div className="flex items-center gap-3">
                                        <img
                                            src={URL.createObjectURL(faviconFile)}
                                            alt="New favicon preview"
                                            className="size-8 rounded border object-contain"
                                        />
                                        <span className="text-sm text-muted-foreground">{faviconFile.name}</span>
                                        <Button variant="outline" size="sm" onClick={() => setFaviconFile(null)}>
                                            Clear
                                        </Button>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <ImageIcon className="size-4" />
                                        No custom favicon — using default
                                    </div>
                                )}
                                <input
                                    ref={faviconInputRef}
                                    type="file"
                                    accept=".ico,image/png,image/svg+xml"
                                    className="hidden"
                                    onChange={(e) => setFaviconFile(e.target.files?.[0] ?? null)}
                                />
                                <Button variant="outline" size="sm" onClick={() => faviconInputRef.current?.click()}>
                                    <Upload className="mr-1.5 size-3.5" />
                                    Upload
                                </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">ICO, PNG, or SVG. Max 512 KB.</p>
                        </div>
                    </CardContent>
                </Card>

                {/* Hero Section Card */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Type className="size-5" />
                            Hero Section
                        </CardTitle>
                        <CardDescription>
                            The main hero area at the top of the landing page.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="hero-badge">Badge Text</Label>
                                <Input
                                    id="hero-badge"
                                    value={heroBadge}
                                    onChange={(e) => setHeroBadge(e.target.value)}
                                    placeholder="Georgian Gaming Community"
                                    maxLength={100}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="hero-button">Button Text</Label>
                                <Input
                                    id="hero-button"
                                    value={heroButtonText}
                                    onChange={(e) => setHeroButtonText(e.target.value)}
                                    placeholder="Join Server"
                                    maxLength={50}
                                />
                            </div>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="hero-title">Title</Label>
                                <Input
                                    id="hero-title"
                                    value={heroTitle}
                                    onChange={(e) => setHeroTitle(e.target.value)}
                                    placeholder="Project Zomboid"
                                    maxLength={100}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="hero-subtitle">Subtitle</Label>
                                <Input
                                    id="hero-subtitle"
                                    value={heroSubtitle}
                                    onChange={(e) => setHeroSubtitle(e.target.value)}
                                    placeholder="Dedicated Server"
                                    maxLength={100}
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="hero-description">Description</Label>
                            <Textarea
                                id="hero-description"
                                value={heroDescription}
                                onChange={(e) => setHeroDescription(e.target.value)}
                                rows={3}
                                maxLength={1000}
                            />
                        </div>
                    </CardContent>
                </Card>

                {/* Feature Cards */}
                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle>Feature Cards</CardTitle>
                                <CardDescription>
                                    Feature highlights shown on the landing page ({features.length}/8).
                                </CardDescription>
                            </div>
                            <Button variant="outline" size="sm" onClick={addFeature} disabled={features.length >= 8}>
                                Add Feature
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {features.map((feature, index) => (
                            <div key={index} className="rounded-lg border border-border/50 p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium text-muted-foreground">Feature {index + 1}</span>
                                    <Button variant="ghost" size="sm" onClick={() => removeFeature(index)}>
                                        <Trash2 className="size-4 text-destructive" />
                                    </Button>
                                </div>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <div className="space-y-1">
                                        <Label>Icon</Label>
                                        <select
                                            value={feature.icon}
                                            onChange={(e) => updateFeature(index, 'icon', e.target.value)}
                                            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none"
                                        >
                                            {available_icons.map((icon) => (
                                                <option key={icon} value={icon}>{icon}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="space-y-1">
                                        <Label>Title</Label>
                                        <Input
                                            value={feature.title}
                                            onChange={(e) => updateFeature(index, 'title', e.target.value)}
                                            placeholder="Feature title"
                                            maxLength={100}
                                        />
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <Label>Description</Label>
                                    <Textarea
                                        value={feature.description}
                                        onChange={(e) => updateFeature(index, 'description', e.target.value)}
                                        rows={2}
                                        maxLength={300}
                                    />
                                </div>
                            </div>
                        ))}
                        {features.length === 0 && (
                            <p className="py-4 text-center text-sm text-muted-foreground">
                                No features configured. Click "Add Feature" to get started.
                            </p>
                        )}
                    </CardContent>
                </Card>

                {/* Landing Page Sections */}
                <Card>
                    <CardHeader>
                        <CardTitle>Landing Page Sections</CardTitle>
                        <CardDescription>
                            Toggle sections on/off and reorder them.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        {landingSections
                            .sort((a, b) => a.order - b.order)
                            .map((section, index) => (
                                <div
                                    key={section.id}
                                    className="flex items-center justify-between rounded-lg border border-border/50 px-4 py-3"
                                >
                                    <div className="flex items-center gap-3">
                                        <button
                                            type="button"
                                            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
                                            disabled={index === 0}
                                            onClick={() => moveSectionUp(index)}
                                        >
                                            ▲
                                        </button>
                                        <button
                                            type="button"
                                            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
                                            disabled={index === landingSections.length - 1}
                                            onClick={() => moveSectionDown(index)}
                                        >
                                            ▼
                                        </button>
                                        <span className="text-sm font-medium">
                                            {getSectionLabel(section.id)}
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => toggleSection(section.id)}
                                        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                                            section.enabled
                                                ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                                                : 'bg-muted text-muted-foreground'
                                        }`}
                                    >
                                        {section.enabled ? 'Visible' : 'Hidden'}
                                    </button>
                                </div>
                            ))}
                    </CardContent>
                </Card>

                {/* Save button */}
                <div className="flex items-center gap-2">
                    <Button onClick={save} disabled={saving}>
                        {saving ? 'Saving...' : 'Save All Settings'}
                    </Button>
                </div>
            </div>
        </AppLayout>
    );
}
