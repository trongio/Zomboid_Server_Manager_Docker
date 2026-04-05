import { Link, usePage } from '@inertiajs/react';
import {
    Activity,
    Archive,
    Bell,
    Coins,
    Crosshair,
    Languages,
    Timer,
    Gamepad2,
    LayoutGrid,
    MapPin,
    Package,
    Palette,
    ScrollText,
    Shield,
    ShieldAlert,
    ShoppingBag,
    Store,
    Tag,
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
import type { Auth, NavGroup, NavItem } from '@/types';
import AppLogo from './app-logo';
import { dashboard } from '@/routes';

const adminNavGroups: NavGroup[] = [
    {
        label: 'Server',
        items: [
            { title: 'Dashboard', href: dashboard(), icon: LayoutGrid },
            { title: 'Players', href: '/admin/players', icon: Users },
            { title: 'Player Map', href: '/admin/players/map', icon: MapPin },
            { title: 'Config', href: '/admin/config', icon: Wrench },
            { title: 'Mods', href: '/admin/mods', icon: Package },
            { title: 'Backups', href: '/admin/backups', icon: Archive },
            { title: 'Auto Restart', href: '/admin/auto-restart', icon: Timer },
            { title: 'RCON Console', href: '/admin/rcon', icon: Terminal },
            { title: 'Server Logs', href: '/admin/logs', icon: Activity },
        ],
    },
    {
        label: 'Security',
        items: [
            { title: 'Whitelist', href: '/admin/whitelist', icon: Shield },
            { title: 'Moderation', href: '/admin/moderation', icon: Crosshair },
            { title: 'Safe Zones', href: '/admin/safe-zones', icon: ShieldAlert },
        ],
    },
    {
        label: 'Shop',
        items: [
            { title: 'Items & Categories', href: '/admin/shop', icon: Store },
            { title: 'Bundles', href: '/admin/shop/bundles', icon: Package },
            { title: 'Promotions', href: '/admin/shop/promotions', icon: Tag },
            { title: 'Purchases', href: '/admin/shop/purchases', icon: ShoppingBag },
            { title: 'Wallets', href: '/admin/wallets', icon: Wallet },
        ],
    },
];

const playerNavGroups: NavGroup[] = [
    {
        label: 'Menu',
        items: [
            { title: 'Player Portal', href: '/portal', icon: Gamepad2 },
            { title: 'My Wallet', href: '/shop/my/wallet', icon: Coins },
            { title: 'Shop', href: '/shop', icon: ShoppingBag },
            { title: 'Rankings', href: '/rankings', icon: Trophy },
        ],
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

    const communityGroup: NavGroup = {
        label: 'Community',
        items: [
            { title: 'Discord', href: '/admin/discord', icon: Bell },
            { title: 'Audit Log', href: '/admin/audit', icon: ScrollText },
            { title: 'Site Settings', href: '/admin/site-settings', icon: Palette },
            { title: 'Translations', href: '/admin/translations', icon: Languages },
            { title: 'Rankings', href: '/rankings', icon: Trophy },
            myStatsItem,
        ],
    };

    const navGroups = isAdmin
        ? [...adminNavGroups, communityGroup]
        : playerNavGroups.map((group) => ({
              ...group,
              items: [...group.items, myStatsItem],
          }));

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
                <NavMain groups={navGroups} />
            </SidebarContent>

            <SidebarFooter>
                <NavFooter items={footerNavItems} className="mt-auto" />
                <NavUser />
            </SidebarFooter>
        </Sidebar>
    );
}
