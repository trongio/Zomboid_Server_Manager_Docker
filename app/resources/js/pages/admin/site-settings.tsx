import { Head, router } from '@inertiajs/react';
import { ImageIcon, Palette, RotateCcw, Save, Trash2, Type, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { fetchAction } from '@/lib/fetch-action';
import AppLayout from '@/layouts/app-layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { useTranslation } from '@/hooks/use-translation';
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
    _id?: string;
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

const COLOR_KEYS = ['primary', 'accent', 'destructive', 'sidebar_primary'] as const;

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export default function SiteSettings({ settings, available_icons, available_sections }: Props) {
    const { t } = useTranslation();

    const breadcrumbs: BreadcrumbItem[] = [
        { title: t('nav.dashboard'), href: '/dashboard' },
        { title: t('admin.site_settings.title'), href: '/admin/site-settings' },
    ];

    const [siteName, setSiteName] = useState(settings.site_name);
    const [footerText, setFooterText] = useState(settings.footer_text);
    const [heroBadge, setHeroBadge] = useState(settings.hero_badge);
    const [heroTitle, setHeroTitle] = useState(settings.hero_title);
    const [heroSubtitle, setHeroSubtitle] = useState(settings.hero_subtitle);
    const [heroDescription, setHeroDescription] = useState(settings.hero_description);
    const [heroButtonText, setHeroButtonText] = useState(settings.hero_button_text);
    const [features, setFeatures] = useState<Feature[]>(
        settings.features.map((f, i) => ({ ...f, _id: f._id ?? `f-${i}-${Date.now()}` })),
    );
    const [landingSections, setLandingSections] = useState<LandingSection[]>(settings.landing_sections);
    const [themeColors, setThemeColors] = useState<Record<string, string>>(settings.theme_colors ?? {});

    const [logoFile, setLogoFile] = useState<File | null>(null);
    const [faviconFile, setFaviconFile] = useState<File | null>(null);
    const [saving, setSaving] = useState(false);

    const [logoPreview, setLogoPreview] = useState<string | null>(null);
    const [faviconPreview, setFaviconPreview] = useState<string | null>(null);

    useEffect(() => {
        if (logoFile) {
            const url = URL.createObjectURL(logoFile);
            setLogoPreview(url);
            return () => URL.revokeObjectURL(url);
        }
        setLogoPreview(null);
    }, [logoFile]);

    useEffect(() => {
        if (faviconFile) {
            const url = URL.createObjectURL(faviconFile);
            setFaviconPreview(url);
            return () => URL.revokeObjectURL(url);
        }
        setFaviconPreview(null);
    }, [faviconFile]);

    const logoInputRef = useRef<HTMLInputElement>(null);
    const faviconInputRef = useRef<HTMLInputElement>(null);

    // Track dirty state for floating save button
    const isDirty =
        siteName !== settings.site_name ||
        footerText !== settings.footer_text ||
        heroBadge !== settings.hero_badge ||
        heroTitle !== settings.hero_title ||
        heroSubtitle !== settings.hero_subtitle ||
        heroDescription !== settings.hero_description ||
        heroButtonText !== settings.hero_button_text ||
        JSON.stringify(features.map(({ _id, ...f }) => f)) !== JSON.stringify(settings.features.map(({ _id, ...f }) => f)) ||
        JSON.stringify(landingSections) !== JSON.stringify(settings.landing_sections) ||
        JSON.stringify(themeColors) !== JSON.stringify(settings.theme_colors ?? {}) ||
        logoFile !== null ||
        faviconFile !== null;

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

        if (features.length === 0) {
            formData.append('features_cleared', '1');
        } else {
            features.forEach((feature, i) => {
                formData.append(`features[${i}][icon]`, feature.icon);
                formData.append(`features[${i}][title]`, feature.title);
                formData.append(`features[${i}][description]`, feature.description);
            });
        }

        landingSections.forEach((section, i) => {
            formData.append(`landing_sections[${i}][id]`, section.id);
            formData.append(`landing_sections[${i}][enabled]`, section.enabled ? '1' : '0');
            formData.append(`landing_sections[${i}][order]`, String(section.order));
        });

        // Theme colors — send entries when set, or signal cleared via flag
        const activeColors = Object.entries(themeColors).filter(([, v]) => v);
        if (activeColors.length > 0) {
            activeColors.forEach(([key, value]) => {
                formData.append(`theme_colors[${key}]`, value);
            });
        } else {
            formData.append('theme_colors_cleared', '1');
        }

        try {
            const res = await fetch('/admin/site-settings', {
                method: 'POST',
                headers: { 'X-CSRF-TOKEN': csrfToken, 'Accept': 'application/json' },
                body: formData,
            });
            const json = await res.json().catch(() => ({}));
            if (res.ok) {
                toast.success(json.message || t('admin.site_settings.settings_saved'));
                setLogoFile(null);
                setFaviconFile(null);
                router.reload();
            } else {
                toast.error(json.message || t('admin.site_settings.save_failed', { status: String(res.status) }));
            }
        } catch {
            toast.error(t('common.network_error'));
        }
        setSaving(false);
    }

    async function removeLogo() {
        await fetchAction('/admin/site-settings/logo', {
            method: 'DELETE',
            successMessage: t('admin.site_settings.logo_removed'),
        });
        router.reload();
    }

    async function removeFavicon() {
        await fetchAction('/admin/site-settings/favicon', {
            method: 'DELETE',
            successMessage: t('admin.site_settings.favicon_removed'),
        });
        router.reload();
    }

    function addFeature() {
        if (features.length >= 8) return;
        setFeatures([...features, { _id: `f-${Date.now()}`, icon: 'Star', title: '', description: '' }]);
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

    function updateColor(key: string, value: string) {
        setThemeColors((prev) => ({ ...prev, [key]: value }));
    }

    function resetColors() {
        setThemeColors({});
    }

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title={t('admin.site_settings.title')} />
            <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">{t('admin.site_settings.title')}</h1>
                    <p className="text-muted-foreground">
                        {t('admin.site_settings.description')}
                    </p>
                </div>

                {/* Branding Card */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Palette className="size-5" />
                            {t('admin.site_settings.branding')}
                        </CardTitle>
                        <CardDescription>
                            {t('admin.site_settings.branding_description')}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="site-name">{t('admin.site_settings.site_name')}</Label>
                            <Input
                                id="site-name"
                                value={siteName}
                                onChange={(e) => setSiteName(e.target.value)}
                                maxLength={100}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="footer-text">{t('admin.site_settings.footer_text')}</Label>
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
                            <Label>{t('admin.site_settings.logo')}</Label>
                            <div className="flex items-center gap-4">
                                {settings.logo_url && !logoFile ? (
                                    <div className="flex items-center gap-3">
                                        <img
                                            src={settings.logo_url}
                                            alt={t('admin.site_settings.current_logo_alt')}
                                            className="size-10 rounded-md border object-contain"
                                        />
                                        <Button variant="outline" size="sm" onClick={removeLogo}>
                                            <Trash2 className="mr-1.5 size-3.5" />
                                            {t('common.remove')}
                                        </Button>
                                    </div>
                                ) : logoFile ? (
                                    <div className="flex items-center gap-3">
                                        <img
                                            src={logoPreview!}
                                            alt={t('admin.site_settings.new_logo_alt')}
                                            className="size-10 rounded-md border object-contain"
                                        />
                                        <span className="text-sm text-muted-foreground">{logoFile.name}</span>
                                        <Button variant="outline" size="sm" onClick={() => setLogoFile(null)}>
                                            {t('common.clear')}
                                        </Button>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <ImageIcon className="size-4" />
                                        {t('admin.site_settings.no_logo')}
                                    </div>
                                )}
                                <input
                                    ref={logoInputRef}
                                    type="file"
                                    accept="image/png,image/jpeg,image/webp"
                                    className="hidden"
                                    onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
                                />
                                <Button variant="outline" size="sm" onClick={() => logoInputRef.current?.click()}>
                                    <Upload className="mr-1.5 size-3.5" />
                                    {t('common.upload')}
                                </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">{t('admin.site_settings.logo_hint')}</p>
                        </div>

                        {/* Favicon upload */}
                        <div className="space-y-2">
                            <Label>{t('admin.site_settings.favicon')}</Label>
                            <div className="flex items-center gap-4">
                                {settings.favicon_url && !faviconFile ? (
                                    <div className="flex items-center gap-3">
                                        <img
                                            src={settings.favicon_url}
                                            alt={t('admin.site_settings.current_favicon_alt')}
                                            className="size-8 rounded border object-contain"
                                        />
                                        <Button variant="outline" size="sm" onClick={removeFavicon}>
                                            <Trash2 className="mr-1.5 size-3.5" />
                                            {t('common.remove')}
                                        </Button>
                                    </div>
                                ) : faviconFile ? (
                                    <div className="flex items-center gap-3">
                                        <img
                                            src={faviconPreview!}
                                            alt={t('admin.site_settings.new_favicon_alt')}
                                            className="size-8 rounded border object-contain"
                                        />
                                        <span className="text-sm text-muted-foreground">{faviconFile.name}</span>
                                        <Button variant="outline" size="sm" onClick={() => setFaviconFile(null)}>
                                            {t('common.clear')}
                                        </Button>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <ImageIcon className="size-4" />
                                        {t('admin.site_settings.no_favicon')}
                                    </div>
                                )}
                                <input
                                    ref={faviconInputRef}
                                    type="file"
                                    accept=".ico,image/png"
                                    className="hidden"
                                    onChange={(e) => setFaviconFile(e.target.files?.[0] ?? null)}
                                />
                                <Button variant="outline" size="sm" onClick={() => faviconInputRef.current?.click()}>
                                    <Upload className="mr-1.5 size-3.5" />
                                    {t('common.upload')}
                                </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">{t('admin.site_settings.favicon_hint')}</p>
                        </div>
                    </CardContent>
                </Card>

                {/* Theme Colors Card */}
                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="flex items-center gap-2">
                                    <Palette className="size-5" />
                                    {t('admin.site_settings.theme_colors')}
                                </CardTitle>
                                <CardDescription>
                                    {t('admin.site_settings.theme_colors_description')}
                                </CardDescription>
                            </div>
                            {Object.values(themeColors).some(Boolean) && (
                                <Button variant="outline" size="sm" onClick={resetColors}>
                                    <RotateCcw className="mr-1.5 size-3.5" />
                                    {t('admin.site_settings.reset_to_defaults')}
                                </Button>
                            )}
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="grid gap-4 sm:grid-cols-2">
                            {COLOR_KEYS.map((key) => (
                                <div key={key} className="space-y-2">
                                    <Label>{t(`admin.site_settings.color_${key}`)}</Label>
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="color"
                                            value={themeColors[key] || '#000000'}
                                            onChange={(e) => updateColor(key, e.target.value)}
                                            className="size-9 cursor-pointer rounded-md border border-input"
                                        />
                                        <Input
                                            value={themeColors[key] || ''}
                                            onChange={(e) => updateColor(key, e.target.value)}
                                            placeholder="#000000"
                                            className={`flex-1 font-mono text-sm ${themeColors[key] && !HEX_RE.test(themeColors[key]) ? 'border-destructive' : ''}`}
                                            maxLength={7}
                                            aria-invalid={!!(themeColors[key] && !HEX_RE.test(themeColors[key]))}
                                        />
                                        {themeColors[key] && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => updateColor(key, '')}
                                            >
                                                {t('common.clear')}
                                            </Button>
                                        )}
                                    </div>
                                    <p className="text-xs text-muted-foreground">{t(`admin.site_settings.color_${key}_description`)}</p>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                {/* Hero Section Card */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Type className="size-5" />
                            {t('admin.site_settings.hero_section')}
                        </CardTitle>
                        <CardDescription>
                            {t('admin.site_settings.hero_section_description')}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="hero-badge">{t('admin.site_settings.badge_text')}</Label>
                                <Input
                                    id="hero-badge"
                                    value={heroBadge}
                                    onChange={(e) => setHeroBadge(e.target.value)}
                                    placeholder={t('admin.site_settings.badge_placeholder')}
                                    maxLength={100}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="hero-button">{t('admin.site_settings.button_text')}</Label>
                                <Input
                                    id="hero-button"
                                    value={heroButtonText}
                                    onChange={(e) => setHeroButtonText(e.target.value)}
                                    placeholder={t('admin.site_settings.button_placeholder')}
                                    maxLength={50}
                                />
                            </div>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="hero-title">{t('admin.site_settings.hero_title')}</Label>
                                <Input
                                    id="hero-title"
                                    value={heroTitle}
                                    onChange={(e) => setHeroTitle(e.target.value)}
                                    placeholder={t('admin.site_settings.hero_title_placeholder')}
                                    maxLength={100}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="hero-subtitle">{t('admin.site_settings.hero_subtitle')}</Label>
                                <Input
                                    id="hero-subtitle"
                                    value={heroSubtitle}
                                    onChange={(e) => setHeroSubtitle(e.target.value)}
                                    placeholder={t('admin.site_settings.hero_subtitle_placeholder')}
                                    maxLength={100}
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="hero-description">{t('admin.site_settings.hero_description')}</Label>
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
                                <CardTitle>{t('admin.site_settings.feature_cards')}</CardTitle>
                                <CardDescription>
                                    {t('admin.site_settings.feature_cards_description', { count: String(features.length) })}
                                </CardDescription>
                            </div>
                            <Button variant="outline" size="sm" onClick={addFeature} disabled={features.length >= 8}>
                                {t('admin.site_settings.add_feature')}
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {features.map((feature, index) => (
                            <div key={feature._id} className="rounded-lg border border-border/50 p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium text-muted-foreground">{t('admin.site_settings.feature_label', { number: String(index + 1) })}</span>
                                    <Button variant="ghost" size="sm" onClick={() => removeFeature(index)}>
                                        <Trash2 className="size-4 text-destructive" />
                                    </Button>
                                </div>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <div className="space-y-1">
                                        <Label>{t('admin.site_settings.feature_icon')}</Label>
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
                                        <Label>{t('admin.site_settings.feature_title')}</Label>
                                        <Input
                                            value={feature.title}
                                            onChange={(e) => updateFeature(index, 'title', e.target.value)}
                                            placeholder={t('admin.site_settings.feature_title_placeholder')}
                                            maxLength={100}
                                        />
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <Label>{t('admin.site_settings.feature_description')}</Label>
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
                                {t('admin.site_settings.no_features')}
                            </p>
                        )}
                    </CardContent>
                </Card>

                {/* Landing Page Sections */}
                <Card>
                    <CardHeader>
                        <CardTitle>{t('admin.site_settings.landing_sections')}</CardTitle>
                        <CardDescription>
                            {t('admin.site_settings.landing_sections_description')}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        {[...landingSections]
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
                                            aria-label={`Move ${getSectionLabel(section.id)} up`}
                                        >
                                            ▲
                                        </button>
                                        <button
                                            type="button"
                                            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
                                            disabled={index === landingSections.length - 1}
                                            onClick={() => moveSectionDown(index)}
                                            aria-label={`Move ${getSectionLabel(section.id)} down`}
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
                                        {section.enabled ? t('admin.site_settings.section_visible') : t('admin.site_settings.section_hidden')}
                                    </button>
                                </div>
                            ))}
                    </CardContent>
                </Card>
            </div>

            {/* Floating save button */}
            <div
                className={`fixed bottom-6 right-6 z-50 transition-all duration-200 ${
                    isDirty
                        ? 'translate-y-0 opacity-100'
                        : 'pointer-events-none translate-y-4 opacity-0'
                }`}
            >
                <Button
                    size="lg"
                    onClick={save}
                    disabled={saving}
                    className="shadow-lg"
                >
                    <Save className="mr-2 size-4" />
                    {saving ? t('common.saving') : t('admin.site_settings.save_changes')}
                </Button>
            </div>
        </AppLayout>
    );
}
