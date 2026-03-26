#!/bin/bash
# Custom entrypoint wrapper for the PZ game server.
# Runs configure-server.sh to apply .env settings, then optionally updates
# via SteamCMD, and starts the server.

# Apply server configuration from environment variables
bash /home/steam/configure-server.sh

# Branch override from shared volume (written by web UI)
OVERRIDE_FILE="/home/steam/Zomboid/.steam_branch"
if [ -f "$OVERRIDE_FILE" ]; then
    BRANCH=$(cat "$OVERRIDE_FILE")
    echo "[entrypoint] Branch override: $BRANCH"
else
    BRANCH="${PZ_STEAM_BRANCH:-public}"
fi

if [ "$BRANCH" = "public" ]; then
  BETA_FLAG=""
else
  BETA_FLAG="-beta $BRANCH"
fi

# Force update flag from shared volume (written by web UI)
FORCE_FILE="/home/steam/Zomboid/.force_update"
if [ -f "$FORCE_FILE" ]; then
    echo "[entrypoint] Force update flag detected"
    rm -f "$FORCE_FILE"
    PZ_FORCE_UPDATE=true
fi

# Only run SteamCMD if server files are missing or PZ_FORCE_UPDATE=true
if [ ! -f /home/steam/pzserver/start-server.sh ] || [ "${PZ_FORCE_UPDATE:-false}" = "true" ]; then
  echo "[entrypoint] Installing/updating PZ server (branch: $BRANCH)..."
  for attempt in 1 2 3; do
    FEXBash "/home/steam/Steam/steamcmd.sh +@sSteamCmdForcePlatformType linux +force_install_dir /home/steam/pzserver +login anonymous +app_update 380870 $BETA_FLAG validate +quit" && break
    echo "[entrypoint] SteamCMD failed (attempt $attempt/3), retrying in 10s..."
    sleep 10
  done
  if [ ! -f /home/steam/pzserver/start-server.sh ]; then
    echo "[entrypoint] FATAL: SteamCMD failed to install the server after 3 attempts."
    echo "[entrypoint] Check your internet connection and Steam service status."
    echo "[entrypoint] Container will stay alive for debugging — check logs with: docker logs pz-game-server"
    sleep infinity
    exit 1
  fi
else
  echo "[entrypoint] Server files found, skipping SteamCMD. Set PZ_FORCE_UPDATE=true to force update."
fi

# Launch the server in a screen session with auto-restart loop
screen -d -m -S zomboid /bin/bash -c " \
  while true; do \
    FEXBash \"/home/steam/pzserver/start-server.sh -servername \${SERVERNAME}\"; \
    echo 'The server will restart in 10 seconds. If you want to stop the server, press Ctrl+C.'; \
    for i in 10 9 8 7 6 5 4 3 2 1; do echo \"\$i...\"; sleep 1; done \
  done \
"
sleep infinity
