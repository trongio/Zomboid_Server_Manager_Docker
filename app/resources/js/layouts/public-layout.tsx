import { Link, usePage } from '@inertiajs/react';
import { Skull } from 'lucide-react';
import type { PropsWithChildren } from 'react';
import { login, register } from '@/routes';

export default function PublicLayout({ children }: PropsWithChildren) {
    const { auth } = usePage().props;

    return (
        <div className="min-h-screen bg-background">
            <header className="sticky top-0 z-50 border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
                    <Link href="/" className="flex items-center gap-2">
                        <Skull className="size-6" />
                        <span className="text-lg font-semibold tracking-tight">Zomboid Manager</span>
                    </Link>
                    <nav className="flex items-center gap-3">
                        <Link
                            href="/status"
                            className="rounded-md px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                        >
                            Server Status
                        </Link>
                        <Link
                            href="/rankings"
                            className="rounded-md px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                        >
                            Rankings
                        </Link>
                        <Link
                            href="/shop"
                            className="rounded-md px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                        >
                            Shop
                        </Link>
                        {auth.user ? (
                            <Link
                                href="/dashboard"
                                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                            >
                                Dashboard
                            </Link>
                        ) : (
                            <>
                                <Link
                                    href={login()}
                                    className="rounded-md px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                                >
                                    Log in
                                </Link>
                                <Link
                                    href={register()}
                                    className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                                >
                                    Register
                                </Link>
                            </>
                        )}
                    </nav>
                </div>
            </header>

            {children}

            <footer className="border-t border-border/40 py-8">
                <div className="mx-auto max-w-5xl px-4 text-center text-sm text-muted-foreground">
                    Powered by Zomboid Manager
                </div>
            </footer>
        </div>
    );
}
