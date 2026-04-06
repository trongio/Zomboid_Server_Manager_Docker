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
import { useTranslation } from '@/hooks/use-translation';
import type { Auth, NavGroup, NavItem } from '@/types';
import AppLogo from './app-logo';
import { dashboard } from '@/routes';

const adminRoles = ['super_admin', 'admin', 'moderator'];

export function AppSidebar() {
    const { auth } = usePage<{ auth: Auth }>().props;
    const { t } = useTranslation();
    const isAdmin = adminRoles.includes(auth.user.role);

    const adminNavGroups: NavGroup[] = [
        {
            label: t('nav.group.server'),
            items: [
                { title: t('nav.dashboard'), href: dashboard(), icon: LayoutGrid },
                { title: t('nav.players'), href: '/admin/players', icon: Users },
                { title: t('nav.player_map'), href: '/admin/players/map', icon: MapPin },
                { title: t('nav.config'), href: '/admin/config', icon: Wrench },
                { title: t('nav.mods'), href: '/admin/mods', icon: Package },
                { title: t('nav.backups'), href: '/admin/backups', icon: Archive },
                { title: t('nav.auto_restart'), href: '/admin/auto-restart', icon: Timer },
                { title: t('nav.rcon_console'), href: '/admin/rcon', icon: Terminal },
                { title: t('nav.server_logs'), href: '/admin/logs', icon: Activity },
            ],
        },
        {
            label: t('nav.group.security'),
            items: [
                { title: t('nav.whitelist'), href: '/admin/whitelist', icon: Shield },
                { title: t('nav.moderation'), href: '/admin/moderation', icon: Crosshair },
                { title: t('nav.safe_zones'), href: '/admin/safe-zones', icon: ShieldAlert },
            ],
        },
        {
            label: t('nav.group.shop'),
            items: [
                { title: t('nav.items_categories'), href: '/admin/shop', icon: Store },
                { title: t('nav.bundles'), href: '/admin/shop/bundles', icon: Package },
                { title: t('nav.promotions'), href: '/admin/shop/promotions', icon: Tag },
                { title: t('nav.purchases'), href: '/admin/shop/purchases', icon: ShoppingBag },
                { title: t('nav.wallets'), href: '/admin/wallets', icon: Wallet },
            ],
        },
    ];

    const playerNavGroups: NavGroup[] = [
        {
            label: t('nav.group.menu'),
            items: [
                { title: t('nav.player_portal'), href: '/portal', icon: Gamepad2 },
                { title: t('nav.my_wallet'), href: '/shop/my/wallet', icon: Coins },
                { title: t('nav.shop'), href: '/shop', icon: ShoppingBag },
                { title: t('nav.rankings'), href: '/rankings', icon: Trophy },
            ],
        },
    ];

    const footerNavItems: NavItem[] = [
        {
            title: t('nav.server_status'),
            href: '/status',
            icon: Activity,
        }
    ];

    const myStatsItem: NavItem = {
        title: t('nav.my_stats'),
        href: `/rankings/${auth.user.username}`,
        icon: User,
    };

    const communityGroup: NavGroup = {
        label: t('nav.group.community'),
        items: [
            { title: t('nav.discord'), href: '/admin/discord', icon: Bell },
            { title: t('nav.audit_log'), href: '/admin/audit', icon: ScrollText },
            { title: t('nav.site_settings'), href: '/admin/site-settings', icon: Palette },
            { title: t('nav.translations'), href: '/admin/translations', icon: Languages },
            { title: t('nav.rankings'), href: '/rankings', icon: Trophy },
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
