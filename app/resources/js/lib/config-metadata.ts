export type SettingMeta = {
    type: 'boolean' | 'number' | 'string' | 'enum' | 'list';
    /**
     * Display category. Optional — when missing, callers compute one with
     * `inferServerCategory()` for server.ini fields or fall back to
     * `defaultGroup`. Lets us keep a single source of truth (the inferred
     * map below) instead of hand-categorising every option.
     */
    group?: string;
    /**
     * Human-readable description. Optional — for sandbox / mod options it
     * comes from the live catalog (PZ `Sandbox.json`, mod `Sandbox_<LANG>.txt`,
     * or inline `_SandboxVars.lua` comments), so the hard-coded SETTING_META
     * fields don't have to duplicate it.
     */
    description?: string;
    /**
     * Optional human-readable label that overrides the raw key.
     * Populated from mod-supplied `Sandbox_<LANG>.txt` files or,
     * when missing, from a camelCase humaniser at render time.
     */
    label?: string;
    default?: string | number | boolean;
    sensitive?: boolean;
    readOnly?: boolean;
    options?: { value: string; label: string }[];
    min?: number;
    max?: number;
    /**
     * `true` when the field accepts decimal values. Driven by the
     * server-ini parser when the `Min:`/`Max:`/`Default:` hint string
     * contained a decimal point. Used by the slider to switch to
     * 0.1 step granularity.
     */
    float?: boolean;
    /**
     * Conditional display: this field is shown disabled with a tooltip until
     * another setting matches the given value. Inspired by pz-admin's
     * Requirements: enables natural pairs like "PublicName needs Public=true".
     */
    requires?: { key: string; value: string | number | boolean };
};

/**
 * Turn a raw camelCase key (`AddFitXPWhileRun`) into a human-readable label
 * (`Add Fit XP While Run`). Used as a fallback when the catalog hasn't
 * supplied an explicit label for a mod-supplied option.
 */
export function humaniseKey(key: string): string {
    // Strip a leading `Namespace.` for mod-prefixed keys.
    const local = key.includes('.') ? (key.split('.').pop() ?? key) : key;
    return local
        .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase → space
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // ACRONYMSplit
        .replace(/_/g, ' ')
        .trim();
}

/**
 * Server.ini option categories ported from
 * https://github.com/beyenilmez/pz-admin/blob/main/frontend/src/assets/options.ts
 * — that project has spent significant time grouping PZ's 150+ server
 * options into clear sections, and we reuse their taxonomy verbatim so
 * `<NAME>.ini` keys always land in a sensible tab without us having to
 * hand-curate every entry.
 */
export const SERVER_INI_CATEGORY_MAP: Record<string, string> = {
    // General
    PublicName: 'General',
    PublicDescription: 'General',
    ServerWelcomeMessage: 'General',
    Open: 'General',
    Public: 'General',
    DenyLoginOnOverloadedServer: 'General',
    SaveWorldEveryMinutes: 'General',
    SpawnItems: 'General',
    SpawnPoint: 'General',
    MaxPlayers: 'General',
    PauseEmpty: 'General',
    AllowCoop: 'General',
    AllowNonAsciiUsername: 'General',
    AnnounceDeath: 'General',
    BanKickGlobalSound: 'General',
    Mods: 'General',
    WorkshopItems: 'General',
    Map: 'General',
    DefaultPort: 'General',
    UDPPort: 'General',
    UPnP: 'General',
    ClientCommandFilter: 'General',
    ClientActionLogs: 'General',
    PerkLogs: 'General',

    // Gameplay & Mechanics
    MinutesPerPage: 'Gameplay & Mechanics',
    CarEngineAttractionModifier: 'Gameplay & Mechanics',
    SpeedLimit: 'Gameplay & Mechanics',
    ItemNumbersLimitPerContainer: 'Gameplay & Mechanics',
    AllowDestructionBySledgehammer: 'Gameplay & Mechanics',
    SledgehammerOnlyInSafehouse: 'Gameplay & Mechanics',
    ConstructionPreventsLootRespawn: 'Gameplay & Mechanics',
    HoursForLootRespawn: 'Gameplay & Mechanics',
    MaxItemsForLootRespawn: 'Gameplay & Mechanics',
    NoFire: 'Gameplay & Mechanics',
    BloodSplatLifespanDays: 'Gameplay & Mechanics',
    SleepAllowed: 'Gameplay & Mechanics',
    SleepNeeded: 'Gameplay & Mechanics',
    FastForwardMultiplier: 'Gameplay & Mechanics',
    MapRemotePlayerVisibility: 'Gameplay & Mechanics',
    HidePlayersBehindYou: 'Gameplay & Mechanics',
    PlayerBumpPlayer: 'Gameplay & Mechanics',
    KnockedDownAllowed: 'Gameplay & Mechanics',
    SneakModeHideFromOtherPlayers: 'Gameplay & Mechanics',
    PlayerRespawnWithOther: 'Gameplay & Mechanics',
    PlayerRespawnWithSelf: 'Gameplay & Mechanics',
    RemovePlayerCorpsesOnCorpseRemoval: 'Gameplay & Mechanics',
    TrashDeleteAll: 'Gameplay & Mechanics',

    // Safehouse
    PlayerSafehouse: 'Safehouse',
    AdminSafehouse: 'Safehouse',
    SafehouseDaySurvivedToClaim: 'Safehouse',
    SafeHouseRemovalTime: 'Safehouse',
    DisableSafehouseWhenPlayerConnected: 'Safehouse',
    SafehouseAllowNonResidential: 'Safehouse',
    SafehouseAllowRespawn: 'Safehouse',
    SafehouseAllowFire: 'Safehouse',
    SafehouseAllowTrepass: 'Safehouse',
    SafehouseAllowLoot: 'Safehouse',

    // Faction
    Faction: 'Faction',
    FactionDaySurvivedToCreate: 'Faction',
    FactionPlayersRequiredForTag: 'Faction',

    // Player
    DisplayUserName: 'Player',
    ShowFirstAndLastName: 'Player',
    MouseOverToSeeDisplayName: 'Player',
    LoginQueueEnabled: 'Player',
    LoginQueueConnectTimeout: 'Player',
    AutoCreateUserInWhiteList: 'Player',
    DropOffWhiteListAfterDeath: 'Player',
    MaxAccountsPerUser: 'Player',
    PingLimit: 'Player',
    SteamScoreboard: 'Player',
    Password: 'Player',

    // PVP
    PVP: 'PVP',
    SafetySystem: 'PVP',
    ShowSafety: 'PVP',
    SafetyCooldownTimer: 'PVP',
    SafetyToggleTimer: 'PVP',
    PVPFirearmDamageModifier: 'PVP',
    PVPMeleeDamageModifier: 'PVP',
    PVPMeleeWhileHitReaction: 'PVP',
    PVPLogToolChat: 'PVP',
    PVPLogToolFile: 'PVP',

    // VOIP & Chat
    GlobalChat: 'VOIP & Chat',
    ChatStreams: 'VOIP & Chat',
    DisableRadioInvisible: 'VOIP & Chat',
    DisableRadioStaff: 'VOIP & Chat',
    DisableRadioAdmin: 'VOIP & Chat',
    DisableRadioModerator: 'VOIP & Chat',
    DisableRadioOverseer: 'VOIP & Chat',
    DisableRadioGM: 'VOIP & Chat',
    VoiceEnable: 'VOIP & Chat',
    Voice3D: 'VOIP & Chat',
    VoiceMinDistance: 'VOIP & Chat',
    VoiceMaxDistance: 'VOIP & Chat',

    // Discord
    DiscordEnable: 'Discord',
    DiscordToken: 'Discord',
    DiscordChannel: 'Discord',
    DiscordChannelID: 'Discord',

    // Backup
    BackupsOnStart: 'Backup',
    BackupsOnVersionChange: 'Backup',
    BackupsPeriod: 'Backup',
    BackupsCount: 'Backup',

    // Anti-Cheat
    SteamVAC: 'Anti-Cheat',
    DoLuaChecksum: 'Anti-Cheat',
    KickFastPlayers: 'Anti-Cheat',
    AntiCheatProtectionType2ThresholdMultiplier: 'Anti-Cheat',
    AntiCheatProtectionType3ThresholdMultiplier: 'Anti-Cheat',
    AntiCheatProtectionType4ThresholdMultiplier: 'Anti-Cheat',
    AntiCheatProtectionType9ThresholdMultiplier: 'Anti-Cheat',
    AntiCheatProtectionType15ThresholdMultiplier: 'Anti-Cheat',
    AntiCheatProtectionType20ThresholdMultiplier: 'Anti-Cheat',
    AntiCheatProtectionType22ThresholdMultiplier: 'Anti-Cheat',
    AntiCheatProtectionType24ThresholdMultiplier: 'Anti-Cheat',

    // Miscellaneous
    ResetID: 'Miscellaneous',
    ServerPlayerID: 'Miscellaneous',
    RCONPort: 'Miscellaneous',
    RCONPassword: 'Miscellaneous',
};

/**
 * Stable display order for server.ini categories. Anything not listed
 * falls under "Other" at the end.
 */
export const SERVER_INI_CATEGORY_ORDER: string[] = [
    'General',
    'Player',
    'PVP',
    'Safehouse',
    'Faction',
    'Gameplay & Mechanics',
    'VOIP & Chat',
    'Anti-Cheat',
    'Backup',
    'Discord',
    'Miscellaneous',
];

/**
 * Returns the category a server.ini key belongs to. Numbered AntiCheat
 * protections (1..24) collapse to the single "Anti-Cheat" category via
 * regex so we don't have to enumerate all 24 by hand.
 */
export function inferServerCategory(key: string): string {
    if (SERVER_INI_CATEGORY_MAP[key]) {
        return SERVER_INI_CATEGORY_MAP[key];
    }
    if (/^AntiCheatProtectionType\d+/i.test(key)) {
        return 'Anti-Cheat';
    }
    if (/Backup/i.test(key)) {
        return 'Backup';
    }
    if (/^Discord/i.test(key)) {
        return 'Discord';
    }
    if (/^Voice|^Chat|^Disable(Radio|GlobalChat)/i.test(key)) {
        return 'VOIP & Chat';
    }
    if (/^Safehouse|Safehouse/i.test(key)) {
        return 'Safehouse';
    }
    if (/^Faction/i.test(key)) {
        return 'Faction';
    }
    if (/^PVP|Safety/i.test(key)) {
        return 'PVP';
    }
    return 'Other';
}

/**
 * Sandbox option categories. Same idea as `SERVER_INI_CATEGORY_MAP` —
 * a hand-curated mapping of vanilla sandbox keys (top-level entries
 * inside PZ's `SandboxVars` table) to UI groups. Taxonomy mirrors
 * what pz-admin uses, so users coming from that tool see familiar
 * sections. Unknown keys fall through to `inferSandboxCategory` regex
 * heuristics or the catch-all "Other" bucket.
 */
export const SANDBOX_CATEGORY_MAP: Record<string, string> = {
    // Time & Climate
    DayLength: 'Time & Climate',
    StartYear: 'Time & Climate',
    StartMonth: 'Time & Climate',
    StartDay: 'Time & Climate',
    StartTime: 'Time & Climate',
    TimeSinceApo: 'Time & Climate',
    TemperatureShift: 'Time & Climate',
    SnowOn: 'Time & Climate',
    RainOn: 'Time & Climate',
    ErosionSpeed: 'Time & Climate',
    ErosionDays: 'Time & Climate',

    // Zombie Population
    PopulationMultiplier: 'Zombie Population',
    PopulationStartMultiplier: 'Zombie Population',
    PopulationPeakMultiplier: 'Zombie Population',
    PopulationPeakDay: 'Zombie Population',
    RespawnHours: 'Zombie Population',
    RespawnUnseenHours: 'Zombie Population',
    RespawnMultiplier: 'Zombie Population',
    RedistributeHours: 'Zombie Population',

    // Zombie Lore
    Speed: 'Zombie Lore',
    Strength: 'Zombie Lore',
    Toughness: 'Zombie Lore',
    Transmission: 'Zombie Lore',
    Mortality: 'Zombie Lore',
    Reanimate: 'Zombie Lore',
    Cognition: 'Zombie Lore',
    CrawlUnderVehicle: 'Zombie Lore',
    Memory: 'Zombie Lore',
    Sight: 'Zombie Lore',
    Hearing: 'Zombie Lore',
    ThumpNoChasing: 'Zombie Lore',
    ThumpOnConstruction: 'Zombie Lore',
    ActiveOnly: 'Zombie Lore',
    TriggerHouseAlarm: 'Zombie Lore',
    ZombiesDragDown: 'Zombie Lore',
    ZombiesFenceLunge: 'Zombie Lore',
    DisableFakeDead: 'Zombie Lore',

    // Loot
    DistributionBonus: 'Loot',
    Loot: 'Loot',
    LootRespawn: 'Loot',
    SeenHoursPreventLootRespawn: 'Loot',
    WorldItemRemovalList: 'Loot',
    HoursForWorldItemRemoval: 'Loot',
    ItemRemovalListIsBlacklist: 'Loot',
    TimeBeforeRandomAttackSounds: 'Loot',

    // Survival
    NatureAbundance: 'Survival',
    Nutrition: 'Survival',
    FoodRotSpeed: 'Survival',
    FridgeFactor: 'Survival',
    Farming: 'Survival',
    StatsDecrease: 'Survival',
    InjurySeverity: 'Survival',
    BoneFracture: 'Survival',
    EnableVehicles: 'Survival',
    CarSpawnRate: 'Survival',
    ChanceHasGas: 'Survival',
    InitialGas: 'Survival',
    FuelConsumption: 'Survival',
    LockedHouses: 'Survival',
    StarterKit: 'Survival',
    Nutritionist: 'Survival',
    BuildingHealth: 'Survival',
    SmokerEffect: 'Survival',

    // World
    Electricity: 'World',
    ElecShutModifier: 'World',
    Water: 'World',
    WaterShutModifier: 'World',
    HouseAlarm: 'World',
    GeneratorSpawning: 'World',
    GeneratorFuelConsumption: 'World',
    LightSwitches: 'World',

    // Building
    BarricadeBoardingHealth: 'Building',
    WoodWallHealth: 'Building',
    MetalWallHealth: 'Building',

    // Corpses & Gore
    CorpseRemovalTime: 'Corpses & Gore',
    DecayingCorpseHealthImpact: 'Corpses & Gore',
    BloodLevel: 'Corpses & Gore',
    ClothingDegradation: 'Corpses & Gore',

    // Multipliers
    XpMultiplier: 'Multipliers',
    HealthMultiplier: 'Multipliers',
    DamageMultiplier: 'Multipliers',
};

/**
 * Stable display order for sandbox categories. Anything not listed
 * gets appended after this list (eg vanilla nested groups picked up
 * via `VANILLA_NESTED_LABELS`, or the "Other" catch-all).
 */
export const SANDBOX_CATEGORY_ORDER: string[] = [
    'Zombie Lore',
    'Zombie Population',
    'Time & Climate',
    'Loot',
    'World',
    'Survival',
    'Building',
    'Corpses & Gore',
    'Multipliers',
];

/**
 * Returns the category a sandbox key belongs to. Looks up an explicit
 * mapping first; falls through to a few regex heuristics so keys we
 * haven't enumerated still land somewhere sensible.
 */
export function inferSandboxCategory(key: string): string {
    if (SANDBOX_CATEGORY_MAP[key]) {
        return SANDBOX_CATEGORY_MAP[key];
    }
    if (/Zomb|Reanim|Crawler|Sprint|Shamb/i.test(key)) {
        return 'Zombie Lore';
    }
    if (/Population|Respawn|Redistribute/i.test(key)) {
        return 'Zombie Population';
    }
    if (/Loot|Item|Distribution/i.test(key)) {
        return 'Loot';
    }
    if (/Multiplier|XP|Xp/.test(key)) {
        return 'Multipliers';
    }
    if (/Wall|Barricade|Construction|Building/i.test(key)) {
        return 'Building';
    }
    if (/Corpse|Blood|Decay|Wound/i.test(key)) {
        return 'Corpses & Gore';
    }
    if (/Rain|Snow|Erosion|Time|Year|Month|Day|Temperature/i.test(key)) {
        return 'Time & Climate';
    }
    if (/Electric|Water|Generator|Alarm|Light/i.test(key)) {
        return 'World';
    }
    return 'Other';
}

/**
 * Vanilla nested namespaces inside `SandboxVars` that PZ itself ships.
 * These are not mods — they're sub-tables in the engine's SandboxVars
 * structure (Basement, Map, ZombieLore, ...). Any sandbox namespace that
 * is NOT in this whitelist gets surfaced under the "Mod Settings" tab.
 * Add new entries here when PZ introduces additional vanilla sub-tables.
 */
export const VANILLA_NESTED_LABELS: Record<string, string> = {
    Basement: 'Basements',
    Map: 'World Map',
    ZombieLore: 'Zombie Lore',
    ZombieConfig: 'Zombie Population',
    MultiplierConfig: 'Multipliers',
    BarricadedWorld: 'Barricaded World',
    // ZuperCarts, ReadWalking, CommonSense, FWOFitness, SOTO, ... = mods,
    // *intentionally* not listed.
};

/**
 * Shape of a single field's catalog entry produced by
 * `php artisan zomboid:sync-config-catalog` (parsed from
 * `<NAME>_SandboxVars.lua` comments).
 */
export type CatalogEntry = {
    type?: 'boolean' | 'number' | 'string' | 'enum';
    /** Human-readable name harvested from mod's `Sandbox_<LANG>.txt`. */
    label?: string;
    description?: string;
    default?: boolean | number | string;
    default_label?: string;
    min?: number;
    max?: number;
    /** Set by the server-ini parser when the field accepts decimals. */
    float?: boolean;
    options?: { value: number; label: string }[];
};

/**
 * Merge backend-supplied catalog metadata onto the hard-coded `SettingMeta`
 * map. The hard-coded `type` and `group` stay authoritative (they drive UI
 * dispatching and section placement); the catalog enriches description,
 * min/max, default, and enum labels with values harvested directly from
 * PZ-generated SandboxVars comments.
 */
export function mergeCatalog(
    meta: Record<string, SettingMeta>,
    catalog: Record<string, CatalogEntry> | undefined | null,
): Record<string, SettingMeta> {
    if (!catalog) return meta;

    const merged: Record<string, SettingMeta> = { ...meta };

    for (const [key, entry] of Object.entries(catalog)) {
        const existing = meta[key];

        if (existing) {
            const next: SettingMeta = { ...existing };
            if (entry.label) next.label = entry.label;
            if (entry.description) next.description = entry.description;
            if (typeof entry.default !== 'undefined') next.default = entry.default;
            if (typeof entry.min === 'number') next.min = entry.min;
            if (typeof entry.max === 'number') next.max = entry.max;
            if (entry.float) next.float = true;
            if (entry.options && entry.options.length > 0) {
                next.options = entry.options.map((o) => ({
                    value: String(o.value),
                    label: o.label,
                }));
            }
            merged[key] = next;
            continue;
        }

        // Catalog-only key — synthesise from catalog. Leave `group`
        // undefined so the caller's `inferGroup` callback can place it
        // in the right tab.
        const type: SettingMeta['type'] = entry.type === 'enum' ? 'enum'
            : entry.type === 'boolean' ? 'boolean'
            : entry.type === 'number' ? 'number'
            : 'string';
        merged[key] = {
            type,
            label: entry.label,
            description: entry.description ?? '',
            default: entry.default,
            min: entry.min,
            max: entry.max,
            float: entry.float,
            options: entry.options && entry.options.length > 0
                ? entry.options.map((o) => ({ value: String(o.value), label: o.label }))
                : undefined,
        };
    }

    return merged;
}

// ── Server.ini overrides ────────────────────────────────────────────
//
// Type/description/min/max/default for server.ini fields now come from
// the catalog (`storage/app/private/config-catalog/catalog.json`, built
// by `php artisan zomboid:sync-config-catalog` from the live
// `<NAME>.ini` template PZ writes after first boot). This map only
// carries things the catalog can't know: which fields are secrets,
// and which are owned by another page (Mods/WorkshopItems live on the
// Mods admin page).
export const SERVER_INI_META: Record<string, SettingMeta> = {
    Password: { type: 'string', sensitive: true },
    AdminPassword: { type: 'string', sensitive: true },
    RCONPassword: { type: 'string', sensitive: true },
    DiscordToken: { type: 'string', sensitive: true },
    Mods: { type: 'list', readOnly: true },
    WorkshopItems: { type: 'list', readOnly: true },
    // PZ stores `MapRemotePlayerVisibility` as a numeric code (1-4) but
    // the in-game UI exposes it as a four-choice dropdown. Force the
    // enum type here so the dropdown wins over the catalog's `number`
    // inference; labels mirror the live comment in
    // `<NAME>.ini`: "1=Hidden 2=Friends 3=Friends and nearby players
    // 4=Everyone".
    MapRemotePlayerVisibility: {
        type: 'enum',
        options: [
            { value: '1', label: 'Hidden' },
            { value: '2', label: 'Friends' },
            { value: '3', label: 'Friends and nearby players' },
            { value: '4', label: 'Everyone' },
        ],
    },
};

/**
 * Sandbox overrides — see comment on `SERVER_INI_META`. Sandbox catalog
 * is comprehensive on its own (every option in `<NAME>_SandboxVars.lua`
 * carries description, Min/Max/Default, and enum labels), so this map
 * stays empty until we discover an override we want to force.
 */
export const SANDBOX_META: Record<string, SettingMeta> = {};

/** @deprecated Use SERVER_INI_CATEGORY_ORDER + inferServerCategory. */
export const SERVER_INI_GROUP_ORDER = SERVER_INI_CATEGORY_ORDER;

/** @deprecated Use SANDBOX_CATEGORY_ORDER + inferSandboxCategory. */
export const SANDBOX_GROUP_ORDER = SANDBOX_CATEGORY_ORDER;

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Group settings by their metadata group.
 * Unknown keys (not in metadata) are placed in an "Other" group.
 */
export function groupSettings(
    settings: Record<string, string>,
    meta: Record<string, SettingMeta>,
    groupOrder: string[],
    inferGroup?: (key: string) => string,
): { group: string; entries: { key: string; value: string; meta?: SettingMeta }[] }[] {
    const groups = new Map<string, { key: string; value: string; meta?: SettingMeta }[]>();

    for (const g of groupOrder) {
        groups.set(g, []);
    }

    for (const [key, value] of Object.entries(settings)) {
        const m = meta[key];
        // Resolution order: hard-coded `meta.group` -> caller-supplied
        // inference (eg `inferServerCategory`) -> the catch-all "Other"
        // bucket. This lets us drop hand-coded `group` fields from
        // `SERVER_INI_META` and still land every key in the right tab.
        const group = m?.group ?? inferGroup?.(key) ?? 'Other';
        if (!groups.has(group)) {
            groups.set(group, []);
        }
        groups.get(group)!.push({ key, value, meta: m });
    }

    const result: { group: string; entries: { key: string; value: string; meta?: SettingMeta }[] }[] = [];
    for (const g of groupOrder) {
        const entries = groups.get(g);
        if (entries && entries.length > 0) {
            result.push({ group: g, entries });
        }
    }

    // Append any groups that landed outside the explicit order (eg "Other",
    // or a fallback from `inferGroup` that the caller didn't list).
    for (const [g, entries] of groups) {
        if (groupOrder.includes(g) || entries.length === 0) continue;
        result.push({ group: g, entries });
    }

    return result;
}
