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
AutoSave=true
SaveWorldEveryMinutes=15
AdminPassword=changeme
SteamVAC=true
EOINI
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

    if grep -q "^${key}=" "$file" 2>/dev/null; then
        sed -i "s|^${key}=.*|${key}=${value}|" "$file"
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

# Passwords
apply_setting "Password"             "${PZ_SERVER_PASSWORD:-}"      "$INI_FILE"
apply_setting "AdminPassword"        "${PZ_ADMIN_PASSWORD:-admin}"  "$INI_FILE"

# RCON — critical for Laravel API
apply_setting "RCONPort"             "${PZ_RCON_PORT:-27015}"       "$INI_FILE"
apply_setting "RCONPassword"         "${PZ_RCON_PASSWORD:-changeme}" "$INI_FILE"

# Mods
if [ -n "${PZ_MOD_IDS:-}" ]; then
    apply_setting "Mods"             "${PZ_MOD_IDS}"                "$INI_FILE"
fi
if [ -n "${PZ_WORKSHOP_IDS:-}" ]; then
    apply_setting "WorkshopItems"    "${PZ_WORKSHOP_IDS}"           "$INI_FILE"
fi

echo "[configure-server] Configuration applied:"
echo "  Port: ${PZ_GAME_PORT:-16261}/udp"
echo "  RCON: ${PZ_RCON_PORT:-27015}/tcp"
echo "  MaxPlayers: ${PZ_MAX_PLAYERS:-16}"
echo "  Public: ${PZ_PUBLIC_SERVER:-true}"
echo "[configure-server] Done."
