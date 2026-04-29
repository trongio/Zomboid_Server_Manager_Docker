#!/bin/bash
# Pre-configure PZ server settings before first launch.
# This script is run by the entrypoint wrapper to set up RCON, admin password,
# and other settings that the joyfui ARM64 image doesn't handle via env vars.

set -e

SERVER_NAME="${SERVERNAME:-ZomboidServer}"
INI_DIR="/home/steam/Zomboid/Server"
INI_FILE="${INI_DIR}/${SERVER_NAME}.ini"
SANDBOX_FILE="${INI_DIR}/${SERVER_NAME}_SandboxVars.lua"

# Wait for the INI file to exist (created on first PZ server boot)
# If it doesn't exist yet, create a minimal one so the server can start
if [ ! -f "$INI_FILE" ]; then
    echo "[configure-server] INI file not found, creating initial config..."
    mkdir -p "$INI_DIR"
    cat > "$INI_FILE" << 'EOINI'
DefaultPort=16261
UDPPort=16262
ResetID=0
Map=Muldraugh, KY
Mods=
WorkshopItems=
RCONPort=27015
RCONPassword=changeme
Password=
MaxPlayers=16
Public=true
PauseEmpty=true
Open=true
AutoCreateUserInWhiteList=true
AutoSave=true
SaveWorldEveryMinutes=15
AdminPassword=changeme
SteamVAC=true
EOINI
    chmod 666 "$INI_FILE" 2>/dev/null || true
    echo "[configure-server] Initial INI created."
fi

# Apply settings from environment variables (with web UI overrides)
echo "[configure-server] Applying configuration..."

# Web UI persistence file — written by Laravel when config is saved via dashboard/API.
# Values here take priority over env var defaults so web UI changes survive restarts.
CONFIG_STATE_FILE="/home/steam/Zomboid/.config_state"

# Read a value from .config_state, or return empty string.
read_config_state() {
    local key="$1"
    if [ -r "$CONFIG_STATE_FILE" ]; then
        grep "^${key}=" "$CONFIG_STATE_FILE" 2>/dev/null | sed "s/^${key}=//" | tail -1
    fi
}

apply_setting() {
    local key="$1"
    local value="$2"
    local file="$3"

    if [ -z "$value" ]; then
        return
    fi

    # Escape sed metacharacters in replacement value (\ | &)
    local escaped_value
    escaped_value=$(printf '%s' "$value" | sed 's/[\\|&]/\\&/g')

    if grep -q "^${key}=" "$file" 2>/dev/null; then
        sed -i "s|^${key}=.*|${key}=${escaped_value}|" "$file"
    else
        echo "${key}=${value}" >> "$file"
    fi
}

# Like apply_setting, but writes empty values too. Used for mod lists where
# the user removing every mod via the UI must actually clear the INI.
apply_setting_force() {
    local key="$1"
    local value="$2"
    local file="$3"

    local escaped_value
    escaped_value=$(printf '%s' "$value" | sed 's/[\\|&]/\\&/g')

    if grep -q "^${key}=" "$file" 2>/dev/null; then
        sed -i "s|^${key}=.*|${key}=${escaped_value}|" "$file"
    else
        echo "${key}=${value}" >> "$file"
    fi
}

# Core settings — .config_state (web UI) takes priority over env var defaults
STATE_VAL=$(read_config_state "DefaultPort")
apply_setting "DefaultPort"          "${STATE_VAL:-${PZ_GAME_PORT:-16261}}"       "$INI_FILE"
STATE_VAL=$(read_config_state "UDPPort")
apply_setting "UDPPort"              "${STATE_VAL:-${PZ_DIRECT_PORT:-16262}}"     "$INI_FILE"
STATE_VAL=$(read_config_state "MaxPlayers")
apply_setting "MaxPlayers"           "${STATE_VAL:-${PZ_MAX_PLAYERS:-16}}"        "$INI_FILE"
STATE_VAL=$(read_config_state "Map")
apply_setting "Map"                  "${STATE_VAL:-${PZ_MAP_NAMES:-Muldraugh, KY}}" "$INI_FILE"
STATE_VAL=$(read_config_state "Public")
apply_setting "Public"               "${STATE_VAL:-${PZ_PUBLIC_SERVER:-true}}"    "$INI_FILE"
STATE_VAL=$(read_config_state "PauseEmpty")
apply_setting "PauseEmpty"           "${STATE_VAL:-${PZ_PAUSE_ON_EMPTY:-true}}"   "$INI_FILE"
STATE_VAL=$(read_config_state "SaveWorldEveryMinutes")
apply_setting "SaveWorldEveryMinutes" "${STATE_VAL:-${PZ_AUTOSAVE_INTERVAL:-15}}" "$INI_FILE"
STATE_VAL=$(read_config_state "SteamVAC")
apply_setting "SteamVAC"             "${STATE_VAL:-${PZ_STEAM_VAC:-true}}"        "$INI_FILE"
STATE_VAL=$(read_config_state "Open")
apply_setting "Open"                 "${STATE_VAL:-${PZ_OPEN:-true}}"             "$INI_FILE"
STATE_VAL=$(read_config_state "AutoCreateUserInWhiteList")
apply_setting "AutoCreateUserInWhiteList" "${STATE_VAL:-${PZ_AUTO_CREATE_WHITELIST:-true}}" "$INI_FILE"

# Passwords — .config_state takes priority over env var defaults
STATE_VAL=$(read_config_state "Password")
apply_setting "Password"             "${STATE_VAL:-${PZ_SERVER_PASSWORD:-}}"      "$INI_FILE"
STATE_VAL=$(read_config_state "AdminPassword")
apply_setting "AdminPassword"        "${STATE_VAL:-${PZ_ADMIN_PASSWORD:-admin}}"  "$INI_FILE"

if [ -r "$CONFIG_STATE_FILE" ]; then
    echo "[configure-server] Applied web UI overrides from .config_state"
fi

# RCON — critical for Laravel API
# PZ_RCON_PASSWORD is used by the ARM64 image; RCON_PASSWORD by the AMD64 renegademaster image.
apply_setting "RCONPort"             "${PZ_RCON_PORT:-${RCON_PORT:-27015}}"         "$INI_FILE"
apply_setting "RCONPassword"         "${PZ_RCON_PASSWORD:-${RCON_PASSWORD:-changeme}}" "$INI_FILE"

# Mods — .mod_state (web UI) is authoritative. Env vars only seed the INI on
# the very first boot when no state file exists yet. PZ rewrites the .ini on
# shutdown and may prune entries it didn't load, so we cannot trust the .ini
# alone across restarts.
MOD_STATE_FILE="${INI_DIR}/.mod_state"
MOD_STATE_BACKUP="${INI_DIR}/.mod_state_backup"

if [ -r "$MOD_STATE_FILE" ]; then
    # `|| true` keeps the script alive under `set -e` if the state file is
    # truncated or missing one of the expected lines.
    STATE_MODS=$(grep -m1 "^Mods=" "$MOD_STATE_FILE" | sed 's/^Mods=//' || true)
    STATE_WORKSHOP=$(grep -m1 "^WorkshopItems=" "$MOD_STATE_FILE" | sed 's/^WorkshopItems=//' || true)
    # Force-write so an empty state file (user removed all mods) actually
    # clears the INI instead of letting stale entries reappear.
    apply_setting_force "Mods"          "$STATE_MODS"     "$INI_FILE"
    apply_setting_force "WorkshopItems" "$STATE_WORKSHOP" "$INI_FILE"
    echo "[configure-server] Restored mods from .mod_state (web UI)"
elif [ -n "${PZ_MOD_IDS:-}" ] || [ -n "${PZ_WORKSHOP_IDS:-}" ]; then
    # First-boot seed from .env — subsequent UI changes will own .mod_state.
    apply_setting "Mods"          "${PZ_MOD_IDS:-}"        "$INI_FILE"
    apply_setting "WorkshopItems" "${PZ_WORKSHOP_IDS:-}"   "$INI_FILE"
    echo "[configure-server] Seeded mods from environment variables (first boot)"
elif [ -r "$MOD_STATE_BACKUP" ]; then
    STATE_MODS=$(grep -m1 "^Mods=" "$MOD_STATE_BACKUP" | sed 's/^Mods=//' || true)
    STATE_WORKSHOP=$(grep -m1 "^WorkshopItems=" "$MOD_STATE_BACKUP" | sed 's/^WorkshopItems=//' || true)
    if [ -n "$STATE_MODS" ] || [ -n "$STATE_WORKSHOP" ]; then
        apply_setting "Mods"          "$STATE_MODS"          "$INI_FILE"
        apply_setting "WorkshopItems" "$STATE_WORKSHOP"      "$INI_FILE"
        echo "[configure-server] Restored mods from .mod_state_backup (INI snapshot)"
    fi
fi

# Disable Lua checksum — required for ZomboidManager mod.
# Without this, PZ checksums mod Lua files and clients that don't have matching
# checksums get errors. This does NOT disable anti-cheat (Steam VAC).
apply_setting "DoLuaChecksum" "false" "$INI_FILE"
echo "[configure-server] Set DoLuaChecksum=false (required for ZomboidManager mod)"

# ZomboidManager Workshop integration.
# PZ B42 dedicated servers only load mods registered via Workshop (WorkshopItems= line).
# Local mods in Zomboid/mods/ or ZomboidDedicatedServer/mods/ are NOT scanned.
# We create a fake Workshop cache entry so PZ discovers our mod through its Workshop scanner.
ZM_WORKSHOP_ID="3685323705"
ZM_SOURCE="/home/steam/Zomboid/mods/ZomboidManager"
WORKSHOP_MOD_DIR="/home/steam/ZomboidDedicatedServer/steamapps/workshop/content/108600/${ZM_WORKSHOP_ID}/mods/ZomboidManager"

if [ -f "$ZM_SOURCE/42/mod.info" ]; then
    # Create Workshop cache with both root-level and 42/ mod.info.
    # PZ B42 dedicated server discovers mods by scanning for mod.info at the
    # root of the mod directory, but loads Lua from the 42/ subdirectory.
    mkdir -p "$WORKSHOP_MOD_DIR/42/media"
    mkdir -p "$WORKSHOP_MOD_DIR/common"
    # Root-level mod.info + poster (required for PZ mod discovery)
    cp "$ZM_SOURCE"/42/mod.info "$WORKSHOP_MOD_DIR/mod.info"
    cp "$ZM_SOURCE"/42/poster.png "$WORKSHOP_MOD_DIR/poster.png" 2>/dev/null
    # B42 subdir with all mod files (required for Lua loading)
    cp -r "$ZM_SOURCE"/42/* "$WORKSHOP_MOD_DIR/42/"
    echo "[configure-server] Installed ZomboidManager into Workshop cache (ID: $ZM_WORKSHOP_ID)"
else
    echo "[configure-server] WARNING: ZomboidManager source not found at $ZM_SOURCE/42/mod.info"
fi

# Remove any stale ZomboidManager from install dir (shadows Workshop version)
rm -rf /home/steam/ZomboidDedicatedServer/mods/ZomboidManager

# Ensure ZomboidManager is in the Mods= list.
CURRENT_MODS=$(grep -m1 "^Mods=" "$INI_FILE" | sed 's/^Mods=//' || true)
if ! echo "$CURRENT_MODS" | grep -q "ZomboidManager"; then
    if [ -n "$CURRENT_MODS" ]; then
        apply_setting "Mods" "${CURRENT_MODS};ZomboidManager" "$INI_FILE"
    else
        apply_setting "Mods" "ZomboidManager" "$INI_FILE"
    fi
    echo "[configure-server] Added ZomboidManager to Mods list"
fi

# Ensure ZomboidManager workshop ID is in WorkshopItems= list.
CURRENT_WORKSHOP=$(grep -m1 "^WorkshopItems=" "$INI_FILE" | sed 's/^WorkshopItems=//' || true)
if ! echo "$CURRENT_WORKSHOP" | grep -q "$ZM_WORKSHOP_ID"; then
    if [ -n "$CURRENT_WORKSHOP" ]; then
        apply_setting "WorkshopItems" "${CURRENT_WORKSHOP};${ZM_WORKSHOP_ID}" "$INI_FILE"
    else
        apply_setting "WorkshopItems" "${ZM_WORKSHOP_ID}" "$INI_FILE"
    fi
    echo "[configure-server] Added ZomboidManager workshop ID $ZM_WORKSHOP_ID"
fi

# Snapshot the post-restore INI mods to .mod_state on first boot. PZ rewrites
# the .ini on shutdown and may prune mods it didn't load; without an initial
# snapshot, ZomboidManager could disappear after the next restart cycle.
if [ ! -f "$MOD_STATE_FILE" ]; then
    SNAPSHOT_MODS=$(grep -m1 "^Mods=" "$INI_FILE" | sed 's/^Mods=//' || true)
    SNAPSHOT_WORKSHOP=$(grep -m1 "^WorkshopItems=" "$INI_FILE" | sed 's/^WorkshopItems=//' || true)
    if printf 'Mods=%s\nWorkshopItems=%s\n' "$SNAPSHOT_MODS" "$SNAPSHOT_WORKSHOP" > "$MOD_STATE_FILE" 2>/dev/null; then
        chmod 666 "$MOD_STATE_FILE" 2>/dev/null || true
        echo "[configure-server] Initialized .mod_state from current INI"
    fi
fi

# Snapshot what we just applied to the INI as the "running config." Laravel
# diffs this against .mod_state to decide whether mod changes are awaiting a
# restart. Always written, every boot, so the dashboard's pending-restart
# indicator clears once the user actually restarts.
APPLIED_STATE_FILE="${INI_DIR}/.mod_state_applied"
APPLIED_MODS=$(grep -m1 "^Mods=" "$INI_FILE" | sed 's/^Mods=//' || true)
APPLIED_WORKSHOP=$(grep -m1 "^WorkshopItems=" "$INI_FILE" | sed 's/^WorkshopItems=//' || true)
if printf 'Mods=%s\nWorkshopItems=%s\n' "$APPLIED_MODS" "$APPLIED_WORKSHOP" > "$APPLIED_STATE_FILE" 2>/dev/null; then
    chmod 666 "$APPLIED_STATE_FILE" 2>/dev/null || true
    echo "[configure-server] Wrote .mod_state_applied snapshot"
fi

# Pre-create Lua bridge directories for inventory exports
mkdir -p /home/steam/Zomboid/Lua/inventory 2>/dev/null || echo "[configure-server] WARNING: Cannot create Lua/inventory directory (permission denied)"
if [ -d /home/steam/Zomboid/Lua/inventory ]; then
    echo "[configure-server] Lua bridge directories created"
fi

# Ensure config files are world-readable/writable so both steam (game server)
# and www-data (app container) can access them on the shared volume.
chmod 666 "$INI_FILE" 2>/dev/null || true
[ -f "$SANDBOX_FILE" ] && chmod 666 "$SANDBOX_FILE" 2>/dev/null || true

# Log effective values from the INI file (not env vars, which may have been overridden)
echo "[configure-server] Configuration applied:"
echo "  Port: $(grep '^DefaultPort=' "$INI_FILE" | sed 's/^DefaultPort=//')/udp"
echo "  RCON: $(grep '^RCONPort=' "$INI_FILE" | sed 's/^RCONPort=//')/tcp"
echo "  MaxPlayers: $(grep '^MaxPlayers=' "$INI_FILE" | sed 's/^MaxPlayers=//')"
echo "  Public: $(grep '^Public=' "$INI_FILE" | sed 's/^Public=//')"
echo "[configure-server] Done."
