#!/bin/bash
# Wrapper entrypoint for the AMD64 game server image (renegademaster).
# Patches run_server.sh to run configure-server.sh AFTER SteamCMD validate
# but BEFORE start_server.
#
# ZomboidManager is loaded as a proper PZ mod (added to Mods= line by
# configure-server.sh). This ensures both server and client Lua files are
# distributed to connecting players. DoLuaChecksum=false prevents checksum
# errors. Source files are mounted at /home/steam/Zomboid/mods/ZomboidManager/.

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

# Prevent renegademaster image from overwriting Mods=/WorkshopItems= with empty values.
# When these env vars are set to "" the image clears mods added via the web UI.
if [ -z "${MOD_NAMES:-}" ]; then
    unset MOD_NAMES
fi
if [ -z "${MOD_WORKSHOP_IDS:-}" ]; then
    unset MOD_WORKSHOP_IDS
fi

exec /home/steam/run_server.sh
