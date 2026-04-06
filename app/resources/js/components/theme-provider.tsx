import { usePage } from '@inertiajs/react';
import { useEffect, type PropsWithChildren } from 'react';
import { autoForeground, hexToOklch } from '@/lib/color-utils';

/**
 * Applies admin-configured theme color overrides as CSS custom properties
 * on the document root element. Cleans up on unmount or when colors change.
 */
export function ThemeProvider({ children }: PropsWithChildren) {
    const { site } = usePage().props;
    const colors = site?.theme_colors;

    useEffect(() => {
        if (!colors || Object.keys(colors).length === 0) return;

        const root = document.documentElement;
        const applied: string[] = [];

        const set = (prop: string, value: string) => {
            root.style.setProperty(prop, value);
            applied.push(prop);
        };

        if (colors.primary) {
            set('--primary', hexToOklch(colors.primary));
            set('--primary-foreground', autoForeground(colors.primary));
            set('--ring', hexToOklch(colors.primary));
        }

        if (colors.accent) {
            set('--accent', hexToOklch(colors.accent));
            set('--accent-foreground', autoForeground(colors.accent));
        }

        if (colors.destructive) {
            set('--destructive', hexToOklch(colors.destructive));
            set('--destructive-foreground', autoForeground(colors.destructive));
        }

        if (colors.sidebar_primary) {
            set('--sidebar-primary', hexToOklch(colors.sidebar_primary));
            set('--sidebar-primary-foreground', autoForeground(colors.sidebar_primary));
        }

        return () => {
            for (const prop of applied) {
                root.style.removeProperty(prop);
            }
        };
    }, [colors]);

    return <>{children}</>;
}
