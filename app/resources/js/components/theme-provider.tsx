import { usePage } from '@inertiajs/react';
import { useMemo, type PropsWithChildren } from 'react';
import { autoForeground, hexToOklch } from '@/lib/color-utils';

/**
 * Injects CSS custom property overrides from admin-configured theme colors.
 * Wraps the app to apply the custom theme globally.
 */
export function ThemeProvider({ children }: PropsWithChildren) {
    const { site } = usePage().props;
    const colors = site?.theme_colors;

    const styleContent = useMemo(() => {
        if (!colors || Object.keys(colors).length === 0) return null;

        const overrides: string[] = [];

        if (colors.primary) {
            overrides.push(`--primary: ${hexToOklch(colors.primary)};`);
            overrides.push(`--primary-foreground: ${autoForeground(colors.primary)};`);
            overrides.push(`--ring: ${hexToOklch(colors.primary)};`);
        }

        if (colors.accent) {
            overrides.push(`--accent: ${hexToOklch(colors.accent)};`);
            overrides.push(`--accent-foreground: ${autoForeground(colors.accent)};`);
        }

        if (colors.destructive) {
            overrides.push(`--destructive: ${hexToOklch(colors.destructive)};`);
            overrides.push(`--destructive-foreground: ${autoForeground(colors.destructive)};`);
        }

        if (colors.sidebar_primary) {
            overrides.push(`--sidebar-primary: ${hexToOklch(colors.sidebar_primary)};`);
            overrides.push(`--sidebar-primary-foreground: ${autoForeground(colors.sidebar_primary)};`);
        }

        if (overrides.length === 0) return null;

        // Apply to both light and dark mode root
        return `:root, .dark { ${overrides.join(' ')} }`;
    }, [colors]);

    return (
        <>
            {styleContent && <style dangerouslySetInnerHTML={{ __html: styleContent }} />}
            {children}
        </>
    );
}
