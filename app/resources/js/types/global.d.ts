import type { Auth } from '@/types/auth';

export type SiteSettings = {
    name: string;
    logo_url: string | null;
    favicon_url: string | null;
    footer_text: string;
    theme_colors: Record<string, string> | null;
    default_locale: string;
};

export type AvailableLocale = {
    code: string;
    name: string;
    native_name: string;
};

declare module '@inertiajs/core' {
    export interface InertiaConfig {
        sharedPageProps: {
            name: string;
            auth: Auth;
            sidebarOpen: boolean;
            site: SiteSettings;
            locale: string;
            translations: Record<string, string>;
            available_locales: AvailableLocale[];
            [key: string]: unknown;
        };
    }
}
