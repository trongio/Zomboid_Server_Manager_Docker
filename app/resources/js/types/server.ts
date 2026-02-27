export type ServerStatus = {
    online: boolean;
    player_count: number;
    players: string[];
    uptime: string | null;
    map: string | null;
    max_players: number | null;
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
    type: 'manual' | 'scheduled' | 'daily' | 'pre_rollback' | 'pre_update';
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
};

export type DashboardData = {
    server: ServerStatus;
    game_state: GameState | null;
    recent_audit: AuditEntry[];
    backup_summary: BackupSummary;
    leaderboard: Leaderboard;
};

export type StatusPageData = {
    server: ServerStatus;
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
