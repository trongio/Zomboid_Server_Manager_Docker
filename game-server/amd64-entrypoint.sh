#!/bin/bash
# Wrapper entrypoint for the AMD64 game server image (renegademaster).
# Patches run_server.sh to run configure-server.sh AFTER SteamCMD validate
# but BEFORE start_server.
#
# ZomboidManager is loaded as a proper PZ mod (added to Mods= line by
# configure-server.sh). This ensures both server and client Lua files are
# distributed to connecting players. DoLuaChecksum=false prevents checksum
# errors. Source files are mounted at /home/steam/Zomboid/mods/ZomboidManager/.

# --- Root-only init: fix volume permissions ---
# The renegademaster image has no 'steam' user — it runs as root natively.
# Just ensure volume directories are writable (for shared lua-bridge volume).
if [ "$(id -u)" = "0" ]; then
    echo "[entrypoint] Fixing volume permissions..."
    chmod -R 1777 /home/steam/Zomboid/Lua 2>/dev/null || true
    chmod 777 /home/steam/Zomboid/Server 2>/dev/null || true
    chmod 777 /home/steam/Zomboid/db 2>/dev/null || true
    chmod 777 /home/steam/Zomboid/Saves 2>/dev/null || true
fi

CONFIGURE_SCRIPT="/home/steam/configure-server.sh"

# Clean up previously injected ZM files and empty mod directory from base game.
# ZomboidManager is loaded from Zomboid/mods/, not the base game directory.
# An empty ZomboidManager dir in the base game mods shadows the real mod.
for dir in /home/steam/ZomboidDedicatedServer/media/lua/server /home/steam/ZomboidDedicatedServer/media/lua/client; do
    if ls "$dir"/ZM_*.lua 1>/dev/null 2>&1; then
        rm -f "$dir"/ZM_*.lua
        echo "[entrypoint] Cleaned up old injected ZM files from $dir"
    fi
done
# Note: ZomboidManager Workshop cache at steamapps/workshop/content/108600/3685323705
# is populated by configure-server.sh — do NOT delete it here.

if [ -f "$CONFIGURE_SCRIPT" ] && ! grep -q "configure-server.sh" /home/steam/run_server.sh; then
    sed -i '/^start_server$/i bash '"$CONFIGURE_SCRIPT" /home/steam/run_server.sh
    echo "[entrypoint] Patched run_server.sh to run configure-server.sh before start"
fi

# Branch override from shared volume (written by web UI)
OVERRIDE_FILE="/home/steam/Zomboid/.steam_branch"
if [ -f "$OVERRIDE_FILE" ]; then
    GAME_VERSION=$(cat "$OVERRIDE_FILE")
    export GAME_VERSION
    echo "[entrypoint] Branch override: $GAME_VERSION"
fi

# Force update flag from shared volume (written by web UI)
FORCE_FILE="/home/steam/Zomboid/.force_update"
if [ -f "$FORCE_FILE" ]; then
    echo "[entrypoint] Force update flag detected"
    rm -f "$FORCE_FILE"
    # Remove server binary to force SteamCMD re-download
    rm -f /home/steam/ZomboidDedicatedServer/ProjectZomboid64
fi

# configure-server.sh owns mod state via .mod_state. Strip the renegademaster
# image's MOD_NAMES/MOD_WORKSHOP_IDS env vars unconditionally so its
# start_server cannot overwrite our INI after configure-server.sh has run.
# First-boot seeding now happens via PZ_MOD_IDS/PZ_WORKSHOP_IDS in
# configure-server.sh, the same path ARM64 uses.
unset MOD_NAMES
unset MOD_WORKSHOP_IDS

# Snapshot current Mods/WorkshopItems from INI before handing off to
# run_server.sh (which may overwrite them). configure-server.sh uses this
# as a last-resort fallback when no .mod_state file exists yet.
INI_FILE="/home/steam/Zomboid/Server/${SERVERNAME:-${SERVER_NAME:-ZomboidServer}}.ini"
MOD_STATE_BACKUP="/home/steam/Zomboid/Server/.mod_state_backup"
if [ -f "$INI_FILE" ]; then
    CURRENT_MODS=$(grep "^Mods=" "$INI_FILE" | head -1)
    CURRENT_WORKSHOP=$(grep "^WorkshopItems=" "$INI_FILE" | head -1)
    CURRENT_MODS_VALUE="${CURRENT_MODS#Mods=}"
    CURRENT_WORKSHOP_VALUE="${CURRENT_WORKSHOP#WorkshopItems=}"
    if [ -n "$CURRENT_MODS_VALUE" ] || [ -n "$CURRENT_WORKSHOP_VALUE" ]; then
        printf '%s\n%s\n' "$CURRENT_MODS" "$CURRENT_WORKSHOP" > "$MOD_STATE_BACKUP"
        echo "[entrypoint] Saved INI mod state to .mod_state_backup"
    fi
fi

exec /home/steam/run_server.sh
