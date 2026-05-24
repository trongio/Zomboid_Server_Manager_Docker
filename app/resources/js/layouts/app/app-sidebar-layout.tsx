import { AppContent } from '@/components/app-content';
import { AppShell } from '@/components/app-shell';
import { AppSidebar } from '@/components/app-sidebar';
import { AppSidebarHeader } from '@/components/app-sidebar-header';
import { BuildVersionBadge } from '@/components/build-version-badge';
import { ErrorBoundary } from '@/components/error-boundary';
import { useFlashToast } from '@/hooks/use-flash-toast';
import type { AppLayoutProps } from '@/types';
import { Toaster } from 'sonner';

export default function AppSidebarLayout({
    children,
    breadcrumbs = [],
}: AppLayoutProps) {
    useFlashToast();

    return (
        <AppShell variant="sidebar">
            <AppSidebar />
            <AppContent variant="sidebar" className="overflow-x-hidden">
                <AppSidebarHeader breadcrumbs={breadcrumbs} />
                <ErrorBoundary>{children}</ErrorBoundary>
            </AppContent>
            <Toaster position="bottom-right" richColors closeButton />
            <BuildVersionBadge />
        </AppShell>
    );
}
