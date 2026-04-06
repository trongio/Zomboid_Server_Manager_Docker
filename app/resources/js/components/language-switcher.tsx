import { router, usePage } from '@inertiajs/react';
import { Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function LanguageSwitcher() {
    const { locale, available_locales } = usePage().props;

    if (!available_locales || available_locales.length <= 1) {
        return null;
    }

    function switchLocale(code: string) {
        // Navigate with ?lang= so SetLocale middleware picks it up and sets the cookie server-side
        const url = new URL(window.location.href);
        url.searchParams.set('lang', code);
        router.visit(url.toString());
    }

    const current = available_locales.find((l) => l.code === locale);

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1.5">
                    <Globe className="size-4" />
                    <span className="text-sm">{current?.native_name ?? locale}</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                {available_locales.map((lang) => (
                    <DropdownMenuItem
                        key={lang.code}
                        onClick={() => switchLocale(lang.code)}
                        className={locale === lang.code ? 'font-semibold' : ''}
                    >
                        {lang.native_name}
                        {lang.native_name !== lang.name && (
                            <span className="ml-1.5 text-muted-foreground">({lang.name})</span>
                        )}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
