import { Link, usePage } from '@inertiajs/react';
import { Menu, Skull } from 'lucide-react';
import { useMemo, useState, type PropsWithChildren } from 'react';
import { Button } from '@/components/ui/button';
import { LanguageSwitcher } from '@/components/language-switcher';
import { ThemeProvider } from '@/components/theme-provider';
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet';
import { useTranslation } from '@/hooks/use-translation';
import { login, register } from '@/routes';

const adminRoles = ['super_admin', 'admin', 'moderator'];

function NavLink({ href, children, onClick }: { href: string; children: React.ReactNode; onClick?: () => void }) {
    const { url } = usePage();
    const isActive = useMemo(() => url.startsWith(href), [url, href]);
    return (
        <Link
            href={href}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                isActive
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={onClick}
        >
            {children}
        </Link>
    );
}

function NavLinks({ className, onClick }: { className?: string; onClick?: () => void }) {
    const { auth } = usePage().props;
    const { t } = useTranslation();
    const isAdmin = auth.user && adminRoles.includes((auth.user as { role: string }).role);

    return (
        <nav className={className}>
            <NavLink href="/status" onClick={onClick}>
                {t('nav.server_status')}
            </NavLink>
            <NavLink href="/rankings" onClick={onClick}>
                {t('nav.rankings')}
            </NavLink>
            <NavLink href="/shop" onClick={onClick}>
                {t('nav.shop')}
            </NavLink>
            {auth.user ? (
                <Link
                    href={isAdmin ? '/dashboard' : '/portal'}
                    className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                    onClick={onClick}
                >
                    {isAdmin ? t('nav.dashboard') : t('nav.my_account')}
                </Link>
            ) : (
                <>
                    <Link
                        href={login()}
                        className="rounded-md px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                        onClick={onClick}
                    >
                        {t('nav.login')}
                    </Link>
                    <Link
                        href={register()}
                        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                        onClick={onClick}
                    >
                        {t('nav.register')}
                    </Link>
                </>
            )}
        </nav>
    );
}

export default function PublicLayout({ children }: PropsWithChildren) {
    const { site } = usePage().props;
    const [mobileOpen, setMobileOpen] = useState(false);

    return (
        <ThemeProvider>
        <div className="min-h-screen bg-background">
            <header className="sticky top-0 z-50 border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
                    <Link href="/" className="flex items-center gap-2">
                        {site.logo_url ? (
                            <img src={site.logo_url} alt={site.name} className="size-6 object-contain" />
                        ) : (
                            <Skull className="size-6" />
                        )}
                        <span className="text-lg font-semibold tracking-tight">{site.name}</span>
                    </Link>

                    {/* Desktop nav */}
                    <div className="hidden items-center gap-3 md:flex">
                        <NavLinks className="flex items-center gap-3" />
                        <LanguageSwitcher />
                    </div>

                    {/* Mobile hamburger */}
                    <Button
                        variant="ghost"
                        size="sm"
                        className="md:hidden"
                        onClick={() => setMobileOpen(true)}
                    >
                        <Menu className="size-5" />
                        <span className="sr-only">Menu</span>
                    </Button>
                </div>
            </header>

            {/* Mobile slide-out menu */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetContent side="right" className="w-[280px]">
                    <SheetHeader>
                        <SheetTitle>
                            <Link href="/" className="flex items-center gap-2" onClick={() => setMobileOpen(false)}>
                                {site.logo_url ? (
                                    <img src={site.logo_url} alt={site.name} className="size-5 object-contain" />
                                ) : (
                                    <Skull className="size-5" />
                                )}
                                <span className="font-semibold">{site.name}</span>
                            </Link>
                        </SheetTitle>
                    </SheetHeader>
                    <NavLinks
                        className="flex flex-col gap-1 px-4"
                        onClick={() => setMobileOpen(false)}
                    />
                    <div className="px-4 pt-2">
                        <LanguageSwitcher />
                    </div>
                </SheetContent>
            </Sheet>

            {children}

            <footer className="border-t border-border/40 py-8">
                <div className="mx-auto max-w-7xl px-4 text-center text-sm text-muted-foreground">
                    {site.footer_text}
                </div>
            </footer>
        </div>
        </ThemeProvider>
    );
}
