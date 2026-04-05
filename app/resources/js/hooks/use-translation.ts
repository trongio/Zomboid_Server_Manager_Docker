import { usePage } from '@inertiajs/react';

/**
 * Lightweight translation hook that reads from Inertia shared props.
 * Uses the server-resolved locale and merged translations (JSON defaults + DB overrides).
 */
export function useTranslation() {
    const { translations, locale } = usePage().props;

    function t(key: string, replacements?: Record<string, string>): string {
        let value = translations?.[key] ?? key;

        if (replacements) {
            for (const [k, v] of Object.entries(replacements)) {
                value = value.replace(`:${k}`, v);
            }
        }

        return value;
    }

    return { t, locale };
}
