export type OnlinePlayer = {
    username: string;
    zombie_kills?: number | null;
    hours_survived?: number | null;
    profession?: string | null;
};

export type ServerStatus = {
    online: boolean;
    status: 'offline' | 'starting' | 'online';
    container_status?: string;
    player_count: number;
    players: OnlinePlayer[];
    uptime: string | null;
    map: string | null;
    max_players: number | null;
    game_version: string | null;
    steam_branch: string | null;
};

export type WelcomeServerStatus = {
    online: boolean;
    status: 'offline' | 'starting' | 'online';
    player_count: number;
    players: string[];
    map: string | null;
};

export type ServerStats = {
    total_players: number;
    total_zombie_kills: number;
    total_hours_survived: number;
    total_deaths: number;
    total_pvp_kills: number;
    most_popular_profession: string | null;
};

export type ModEntry = {
    workshop_id: string;
    mod_id: string;
    position: number;
};

export type AuditEntry = {
    id: string;
    actor: string;
    action: string;
    target: string | null;
    details: Record<string, unknown> | null;
    ip_address: string | null;
    created_at: string;
};

export type BackupEntry = {
    id: string;
    filename: string;
    size_bytes: number;
    size_human: string;
    type: 'manual' | 'scheduled' | 'daily' | 'pre_rollback' | 'pre_update' | 'pre_import';
    game_version: string | null;
    steam_branch: string | null;
    notes: string | null;
    created_at: string;
};

export type BackupSummary = {
    total_count: number;
    last_backup: BackupEntry | null;
    total_size_human: string;
};

export type GameState = {
    time: {
        year: number;
        month: number;
        day: number;
        hour: number;
        minute: number;
        day_of_year: number;
        is_night: boolean;
        formatted: string;
        date: string;
    };
    season: 'spring' | 'summer' | 'autumn' | 'winter';
    weather: {
        temperature: number;
        rain_intensity: number;
        fog_intensity: number;
        wind_intensity: number;
        snow_intensity: number;
        is_raining: boolean;
        is_foggy: boolean;
        is_snowing: boolean;
        condition: 'clear' | 'rain' | 'heavy_rain' | 'fog' | 'snow' | 'night';
    } | null;
    exported_at: string;
};

export type PlayerStatEntry = {
    username: string;
    zombie_kills: number;
    hours_survived: number;
    profession: string | null;
};

export type Leaderboard = {
    kills: PlayerStatEntry[];
    survival: PlayerStatEntry[];
    deaths: DeathLeaderboardEntry[];
};

export type GameEventEntry = {
    id: number;
    event_type: 'death' | 'pvp_hit' | 'pvp_kill' | 'craft' | 'connect' | 'disconnect';
    player: string;
    target: string | null;
    details: Record<string, unknown> | null;
    x: number | null;
    y: number | null;
    game_time: string | null;
    created_at: string;
};

export type AutoRestartInfo = {
    enabled: boolean;
    next_restart_at: string | null;
    schedule: string[];
    timezone: string;
};

export type ConnectionInfo = {
    server_ip: string;
    server_port: string;
};

export type DashboardData = {
    server: ServerStatus;
    auto_restart: AutoRestartInfo;
    game_state: GameState | null;
    recent_audit: AuditEntry[];
    backup_summary: BackupSummary;
    leaderboard: Leaderboard;
    game_events: GameEventEntry[];
    server_totals: ServerStats;
    connection: ConnectionInfo;
};

export type LeaderboardEntry = {
    rank: number;
    username: string;
    zombie_kills: number;
    hours_survived: number;
    profession: string | null;
    is_dead: boolean;
};

export type DeathLeaderboardEntry = {
    rank: number;
    username: string;
    death_count: number;
};

export type PlayerProfile = {
    username: string;
    zombie_kills: number;
    hours_survived: number;
    profession: string | null;
    skills: Record<string, number> | null;
    is_dead: boolean;
    ranks: {
        kills: number;
        survival: number;
        deaths: number;
    };
    event_counts: {
        death: number;
        pvp_hit: number;
        craft: number;
        connect: number;
    };
    recent_events: GameEventEntry[];
};

export type RatioLeaderboardEntry = {
    rank: number;
    username: string;
    ratio: number;
    numerator: number;
    death_count: number;
};

export type WalletLeaderboardEntry = {
    rank: number;
    username: string;
    balance: number;
    total_spent: number;
};

export type RankingsPageData = {
    server_stats: ServerStats;
    leaderboard_kills: LeaderboardEntry[];
    leaderboard_survival: LeaderboardEntry[];
    leaderboard_deaths: DeathLeaderboardEntry[];
    leaderboard_kd: RatioLeaderboardEntry[];
    leaderboard_hd: RatioLeaderboardEntry[];
    leaderboard_pvpd: RatioLeaderboardEntry[];
    leaderboard_spent: WalletLeaderboardEntry[];
    leaderboard_balance: WalletLeaderboardEntry[];
    server_name: string;
};

export type PlayerProfilePageData = {
    player: PlayerProfile;
    recent_events: GameEventEntry[];
    is_admin: boolean;
};

export type HeroContent = {
    badge: string;
    title: string;
    subtitle: string;
    description: string;
    button_text: string;
};

export type FeatureEntry = {
    icon: string;
    title: string;
    description: string;
};

export type LandingSection = {
    id: string;
    enabled: boolean;
    order: number;
};

export type WelcomePageData = {
    canRegister: boolean;
    server: WelcomeServerStatus;
    server_stats: ServerStats;
    top_players: PlayerStatEntry[];
    server_name: string;
    connection: { ip: string; port: string };
    hero: HeroContent;
    features: FeatureEntry[];
    landing_sections: LandingSection[];
};

export type StatusServerStatus = {
    online: boolean;
    status: 'offline' | 'starting' | 'online';
    player_count: number;
    players: string[];
    uptime: string | null;
    map: string | null;
    max_players: number | null;
};

export type StatusPageData = {
    server: StatusServerStatus;
    game_state: GameState | null;
    mods: ModEntry[];
    server_name: string;
};

export type PlayerMarker = {
    username: string;
    name: string;
    x: number;
    y: number;
    z: number;
    status: 'online' | 'offline' | 'dead';
    is_online: boolean;
};

export type DziInfo = {
    width: number;
    height: number;
    x0: number;
    y0: number;
    sqr: number;
    maxNativeZoom: number;
    isometric: boolean;
};

export type MapConfig = {
    tileUrl: string | null;
    tileSize: number;
    minZoom: number;
    maxZoom: number;
    defaultZoom: number;
    center: { x: number; y: number };
    dzi: DziInfo | null;
};

export type InventoryItem = {
    full_type: string;
    name: string;
    category: string;
    count: number;
    condition: number | null;
    equipped: boolean;
    container: string;
    icon: string;
};

export type InventorySnapshot = {
    username: string;
    timestamp: string;
    items: InventoryItem[];
    weight: number;
    max_weight: number;
};

export type ItemCatalogEntry = {
    full_type: string;
    name: string;
    category: string;
    icon_name: string;
    icon: string;
};

export type DeliveryEntry = {
    id: string;
    action: 'give' | 'remove';
    username: string;
    item_type: string;
    count: number;
    status: string;
    created_at: string;
};

export type DeliveryResult = {
    id: string;
    status: 'delivered' | 'failed' | 'partial';
    processed_at: string;
    message: string | null;
};

// Shop types
export type ShopCategory = {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    icon: string | null;
    sort_order: number;
    is_active: boolean;
    items_count?: number;
    created_at: string;
    updated_at: string;
};

export type ShopItem = {
    id: string;
    category_id: string | null;
    category?: ShopCategory | null;
    name: string;
    slug: string;
    description: string | null;
    item_type: string;
    quantity: number;
    weight: string | null;
    price: string;
    is_active: boolean;
    is_featured: boolean;
    max_per_player: number | null;
    stock: number | null;
    metadata: Record<string, unknown> | null;
    icon?: string;
    created_at: string;
    updated_at: string;
};

export type ShopBundle = {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    price: string;
    discount_percent?: string;
    is_active: boolean;
    is_featured: boolean;
    max_per_player: number | null;
    items: (ShopItem & { pivot: { quantity: number } })[];
    created_at: string;
    updated_at: string;
};

export type ShopPromotion = {
    id: string;
    name: string;
    code: string | null;
    type: 'percentage' | 'fixed_amount';
    value: string;
    min_purchase: string | null;
    max_discount: string | null;
    applies_to: 'all' | 'category' | 'item' | 'bundle';
    target_ids: string[] | null;
    usage_limit: number | null;
    per_user_limit: number | null;
    usage_count: number;
    starts_at: string;
    ends_at: string | null;
    is_active: boolean;
    created_at: string;
    updated_at: string;
};

export type WalletTransaction = {
    id: string;
    wallet_id: string;
    type: 'credit' | 'debit' | 'refund';
    amount: string;
    balance_after: string;
    source: 'admin_award' | 'purchase' | 'refund' | 'system' | 'payment' | 'in_game_deposit' | 'admin_reset';
    description: string | null;
    created_at: string;
};

export type ShopPurchase = {
    id: string;
    user_id: number;
    purchasable_type: string;
    purchasable_id: string;
    purchasable?: ShopItem | ShopBundle;
    quantity_bought: number;
    total_price: string;
    discount_amount: string;
    delivery_status: 'pending' | 'queued' | 'delivered' | 'partially_delivered' | 'failed';
    delivered_at: string | null;
    metadata: Record<string, unknown> | null;
    deliveries?: ShopDelivery[];
    created_at: string;
    updated_at: string;
};

export type ShopDelivery = {
    id: string;
    shop_purchase_id: string;
    username: string;
    item_type: string;
    quantity: number;
    status: 'pending' | 'queued' | 'delivered' | 'failed';
    attempts: number;
    delivered_at: string | null;
    error_message: string | null;
    created_at: string;
};

export type PurchaseStatusResponse = {
    purchase_id: string;
    delivery_status: 'pending' | 'queued' | 'delivered' | 'partially_delivered' | 'failed';
    is_complete: boolean;
    is_debited: boolean;
    total_price: number;
    balance: number;
    availableBalance: number;
    deliveries: {
        item_type: string;
        quantity: number;
        status: 'pending' | 'queued' | 'delivered' | 'failed';
        error_message: string | null;
    }[];
};

export type DepositResult = {
    id: string;
    username: string;
    status: 'success' | 'failed';
    money_count: number;
    bundle_count?: number;
    total_coins: number;
    message: string | null;
    processed_at: string;
};

export type WalletUser = {
    id: number;
    username: string;
    name: string;
    role: string;
    balance: number;
    total_earned: number;
    total_spent: number;
};
