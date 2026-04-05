import type { Auth } from '@/types/auth';

export type SiteSettings = {
    name: string;
    logo_url: string | null;
    favicon_url: string | null;
    footer_text: string;
    theme_colors: Record<string, string> | null;
    default_locale: string;
};

declare module '@inertiajs/core' {
    export interface InertiaConfig {
        sharedPageProps: {
            name: string;
            auth: Auth;
            sidebarOpen: boolean;
            site: SiteSettings;
            [key: string]: unknown;
        };
    }
}
