import { Link, usePage } from '@inertiajs/react';
import {
    Activity,
    Archive,
    Bell,
    BookOpen,
    Coins,
    Crosshair,
    Timer,
    Gamepad2,
    LayoutGrid,
    MapPin,
    Package,
    ScrollText,
    Shield,
    ShieldAlert,
    ShoppingBag,
    Store,
    Terminal,
    Trophy,
    User,
    Users,
    Wallet,
    Wrench,
} from 'lucide-react';
import { NavFooter } from '@/components/nav-footer';
import { NavMain } from '@/components/nav-main';
import { NavUser } from '@/components/nav-user';
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from '@/components/ui/sidebar';
import type { Auth, NavItem } from '@/types';
import AppLogo from './app-logo';
import { dashboard } from '@/routes';

const adminNavItems: NavItem[] = [
    {
        title: 'Dashboard',
        href: dashboard(),
        icon: LayoutGrid,
    },
    {
        title: 'Players',
        href: '/admin/players',
        icon: Users,
    },
    {
        title: 'Player Map',
        href: '/admin/players/map',
        icon: MapPin,
    },
    {
        title: 'Config',
        href: '/admin/config',
        icon: Wrench,
    },
    {
        title: 'Mods',
        href: '/admin/mods',
        icon: Package,
    },
    {
        title: 'Backups',
        href: '/admin/backups',
        icon: Archive,
    },
    {
        title: 'Whitelist',
        href: '/admin/whitelist',
        icon: Shield,
    },
    {
        title: 'Audit Log',
        href: '/admin/audit',
        icon: ScrollText,
    },
    {
        title: 'Discord',
        href: '/admin/discord',
        icon: Bell,
    },
    {
        title: 'Auto Restart',
        href: '/admin/auto-restart',
        icon: Timer,
    },
    {
        title: 'RCON Console',
        href: '/admin/rcon',
        icon: Terminal,
    },
    {
        title: 'Moderation',
        href: '/admin/moderation',
        icon: Crosshair,
    },
    {
        title: 'Safe Zones',
        href: '/admin/safe-zones',
        icon: ShieldAlert,
    },
    {
        title: 'Server Logs',
        href: '/admin/logs',
        icon: Activity,
    },
    {
        title: 'Shop',
        href: '/admin/shop',
        icon: Store,
    },
    {
        title: 'Wallets',
        href: '/admin/wallets',
        icon: Wallet,
    },
    {
        title: 'Rankings',
        href: '/rankings',
        icon: Trophy,
    },
];

const playerNavItems: NavItem[] = [
    {
        title: 'Player Portal',
        href: '/portal',
        icon: Gamepad2,
    },
    {
        title: 'Shop',
        href: '/shop',
        icon: ShoppingBag,
    },
    {
        title: 'My Wallet',
        href: '/shop/my/wallet',
        icon: Coins,
    },
    {
        title: 'Rankings',
        href: '/rankings',
        icon: Trophy,
    },
];

const footerNavItems: NavItem[] = [
    {
        title: 'Server Status',
        href: '/status',
        icon: Activity,
    }
];

const adminRoles = ['super_admin', 'admin', 'moderator'];

export function AppSidebar() {
    const { auth } = usePage<{ auth: Auth }>().props;
    const isAdmin = adminRoles.includes(auth.user.role);

    const myStatsItem: NavItem = {
        title: 'My Stats',
        href: `/rankings/${auth.user.username}`,
        icon: User,
    };

    const navItems = isAdmin
        ? [...adminNavItems, myStatsItem]
        : [...playerNavItems, myStatsItem];

    return (
        <Sidebar collapsible="icon" variant="inset">
            <SidebarHeader>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton size="lg" asChild>
                            <Link href={isAdmin ? dashboard() : '/portal'} prefetch>
                                <AppLogo />
                            </Link>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>

            <SidebarContent>
                <NavMain items={navItems} />
            </SidebarContent>

            <SidebarFooter>
                <NavFooter items={footerNavItems} className="mt-auto" />
                <NavUser />
            </SidebarFooter>
        </Sidebar>
    );
}
