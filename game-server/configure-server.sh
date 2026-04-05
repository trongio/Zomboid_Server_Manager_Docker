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

# Apply settings from environment variables
echo "[configure-server] Applying configuration from environment..."

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

# Core settings
apply_setting "DefaultPort"          "${PZ_GAME_PORT:-16261}"       "$INI_FILE"
apply_setting "UDPPort"              "${PZ_DIRECT_PORT:-16262}"     "$INI_FILE"
apply_setting "MaxPlayers"           "${PZ_MAX_PLAYERS:-16}"        "$INI_FILE"
apply_setting "Map"                  "${PZ_MAP_NAMES:-Muldraugh, KY}" "$INI_FILE"
apply_setting "Public"               "${PZ_PUBLIC_SERVER:-true}"    "$INI_FILE"
apply_setting "PauseEmpty"           "${PZ_PAUSE_ON_EMPTY:-true}"   "$INI_FILE"
apply_setting "SaveWorldEveryMinutes" "${PZ_AUTOSAVE_INTERVAL:-15}" "$INI_FILE"
apply_setting "SteamVAC"             "${PZ_STEAM_VAC:-true}"        "$INI_FILE"
apply_setting "Open"                 "${PZ_OPEN:-true}"             "$INI_FILE"
apply_setting "AutoCreateUserInWhiteList" "${PZ_AUTO_CREATE_WHITELIST:-true}" "$INI_FILE"

# Passwords
apply_setting "Password"             "${PZ_SERVER_PASSWORD:-}"      "$INI_FILE"
apply_setting "AdminPassword"        "${PZ_ADMIN_PASSWORD:-admin}"  "$INI_FILE"

# RCON — critical for Laravel API
# PZ_RCON_PASSWORD is used by the ARM64 image; RCON_PASSWORD by the AMD64 renegademaster image.
apply_setting "RCONPort"             "${PZ_RCON_PORT:-${RCON_PORT:-27015}}"         "$INI_FILE"
apply_setting "RCONPassword"         "${PZ_RCON_PASSWORD:-${RCON_PASSWORD:-changeme}}" "$INI_FILE"

# Mods — env vars take priority; fall back to .mod_state written by web UI.
MOD_STATE_FILE="/home/steam/Zomboid/.mod_state"
MOD_STATE_BACKUP="/home/steam/Zomboid/.mod_state_backup"

if [ -n "${PZ_MOD_IDS:-}" ] || [ -n "${PZ_WORKSHOP_IDS:-}" ]; then
    # Env vars explicitly set — apply them (operator intent)
    apply_setting "Mods"          "${PZ_MOD_IDS:-}"        "$INI_FILE"
    apply_setting "WorkshopItems" "${PZ_WORKSHOP_IDS:-}"   "$INI_FILE"
    echo "[configure-server] Applied mods from environment variables"
elif [ -r "$MOD_STATE_FILE" ]; then
    # No env vars — restore from web UI's last-known mod state
    STATE_MODS=$(grep "^Mods=" "$MOD_STATE_FILE" | sed 's/^Mods=//')
    STATE_WORKSHOP=$(grep "^WorkshopItems=" "$MOD_STATE_FILE" | sed 's/^WorkshopItems=//')
    if [ -n "$STATE_MODS" ] || [ -n "$STATE_WORKSHOP" ]; then
        apply_setting "Mods"          "$STATE_MODS"          "$INI_FILE"
        apply_setting "WorkshopItems" "$STATE_WORKSHOP"      "$INI_FILE"
        echo "[configure-server] Restored mods from .mod_state (web UI)"
    else
        echo "[configure-server] .mod_state exists but is empty — no mods to restore"
    fi
elif [ -r "$MOD_STATE_BACKUP" ]; then
    # Fallback — restore from INI snapshot taken before image config ran
    STATE_MODS=$(grep "^Mods=" "$MOD_STATE_BACKUP" | sed 's/^Mods=//')
    STATE_WORKSHOP=$(grep "^WorkshopItems=" "$MOD_STATE_BACKUP" | sed 's/^WorkshopItems=//')
    if [ -n "$STATE_MODS" ] || [ -n "$STATE_WORKSHOP" ]; then
        apply_setting "Mods"          "$STATE_MODS"          "$INI_FILE"
        apply_setting "WorkshopItems" "$STATE_WORKSHOP"      "$INI_FILE"
        echo "[configure-server] Restored mods from .mod_state_backup (INI snapshot)"
    fi
else
    echo "[configure-server] No mod env vars or state files — keeping INI mods as-is"
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
CURRENT_MODS=$(grep "^Mods=" "$INI_FILE" | sed 's/^Mods=//')
if ! echo "$CURRENT_MODS" | grep -q "ZomboidManager"; then
    if [ -n "$CURRENT_MODS" ]; then
        apply_setting "Mods" "${CURRENT_MODS};ZomboidManager" "$INI_FILE"
    else
        apply_setting "Mods" "ZomboidManager" "$INI_FILE"
    fi
    echo "[configure-server] Added ZomboidManager to Mods list"
fi

# Ensure ZomboidManager workshop ID is in WorkshopItems= list.
CURRENT_WORKSHOP=$(grep "^WorkshopItems=" "$INI_FILE" | sed 's/^WorkshopItems=//')
if ! echo "$CURRENT_WORKSHOP" | grep -q "$ZM_WORKSHOP_ID"; then
    if [ -n "$CURRENT_WORKSHOP" ]; then
        apply_setting "WorkshopItems" "${CURRENT_WORKSHOP};${ZM_WORKSHOP_ID}" "$INI_FILE"
    else
        apply_setting "WorkshopItems" "${ZM_WORKSHOP_ID}" "$INI_FILE"
    fi
    echo "[configure-server] Added ZomboidManager workshop ID $ZM_WORKSHOP_ID"
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

echo "[configure-server] Configuration applied:"
echo "  Port: ${PZ_GAME_PORT:-16261}/udp"
echo "  RCON: ${PZ_RCON_PORT:-27015}/tcp"
echo "  MaxPlayers: ${PZ_MAX_PLAYERS:-16}"
echo "  Public: ${PZ_PUBLIC_SERVER:-true}"
echo "[configure-server] Done."
