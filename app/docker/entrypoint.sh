#!/bin/sh
set -e

# ── Required env vars ─────────────────────────────────────────────
for var in DB_PASSWORD PZ_RCON_PASSWORD ADMIN_PASSWORD PZ_ADMIN_PASSWORD; do
    val=$(printenv "$var" 2>/dev/null || true)
    if [ -z "$val" ]; then
        echo "[entrypoint] FATAL: $var is not set. Set it in .env before starting."
        exit 1
    fi
done

# ── Storage permissions ──────────────────────────────────────────────
# Bind mounts override Dockerfile permissions — fix at runtime
# Only target directories and runtime files, skip .gitignore to avoid git noise
find /var/www/html/storage /var/www/html/bootstrap/cache -not -name '.gitignore' \( -type d -o -type f \) -exec chown www-data:www-data {} + 2>/dev/null || true
find /var/www/html/storage /var/www/html/bootstrap/cache -type d -exec chmod 775 {} + 2>/dev/null || true
find /var/www/html/storage /var/www/html/bootstrap/cache -type f -not -name '.gitignore' -exec chmod 664 {} + 2>/dev/null || true

# ── PZ data permissions ──────────────────────────────────────────────
# Game server creates config files as root — make them writable by www-data
# so the Laravel app can update server.ini and SandboxVars.lua from the web UI.
# Also grant write access to Saves/ and db/ for backup rollback extraction.
PZ_DATA="${PZ_DATA_PATH:-/pz-data}"
PZ_SERVER_NAME_VAL="${PZ_SERVER_NAME:-ZomboidServer}"
if [ -d "$PZ_DATA/Server" ]; then
    chmod 777 "$PZ_DATA/Server" 2>/dev/null || true
    chmod 666 "$PZ_DATA/Server/${PZ_SERVER_NAME_VAL}.ini" 2>/dev/null || true
    chmod 666 "$PZ_DATA/Server/${PZ_SERVER_NAME_VAL}_SandboxVars.lua" 2>/dev/null || true
fi
# Saves and db directories need to be writable for backup rollback
for dir in "$PZ_DATA/Saves" "$PZ_DATA/db"; do
    if [ -d "$dir" ]; then
        chgrp -R www-data "$dir" 2>/dev/null || true
        chmod -R g+w "$dir" 2>/dev/null || true
    fi
done

# ── Lua bridge permissions ────────────────────────────────────────────
# Shared volume between game server and app — both www-data and steam (UID 1001)
# need write access. Using world-writable with sticky bit (1777) so either
# container can write regardless of who created the files. chown doesn't work
# here because the game server recreates files as UID 1001 after app startup.
LUA_BRIDGE_DIR="${LUA_BRIDGE_PATH:-/lua-bridge}"
if [ -d "$LUA_BRIDGE_DIR" ]; then
    chmod -R 1777 "$LUA_BRIDGE_DIR" 2>/dev/null || true
fi

# ── Backup directory permissions ─────────────────────────────────────
BACKUP_DIR="${BACKUP_PATH:-/backups}"
if [ -d "$BACKUP_DIR" ]; then
    chgrp www-data "$BACKUP_DIR" 2>/dev/null || true
    chmod 775 "$BACKUP_DIR" 2>/dev/null || true
fi

# ── APP_KEY generation ───────────────────────────────────────────────
if [ -z "$APP_KEY" ] || [ "$APP_KEY" = "base64:" ]; then
    echo "[entrypoint] Generating APP_KEY..."
    APP_KEY=$(php artisan key:generate --show --no-interaction)
    export APP_KEY
    echo "[entrypoint] APP_KEY=$APP_KEY"
    echo "[entrypoint] Add this to your .env to persist across restarts."
fi

# ── Package discovery ──────────────────────────────────────────────
# Host bind-mount may contain stale bootstrap/cache from dev deps — purge and regenerate
rm -f /var/www/html/bootstrap/cache/packages.php /var/www/html/bootstrap/cache/services.php
php artisan package:discover --no-interaction 2>/dev/null || true

# ── Only run setup tasks for the main app (not queue worker) ─────────
if echo "$@" | grep -q "supervisord"; then

    # Storage link
    if [ ! -L /var/www/html/public/storage ]; then
        php artisan storage:link --no-interaction 2>/dev/null || true
    fi

    # Pre-migration database backup
    if php artisan migrate:status --no-interaction 2>/dev/null | grep -q "Ran"; then
        BACKUP_FILE="/backups/db-pre-migrate-$(date +%Y%m%d-%H%M%S).sql"
        echo "[entrypoint] Backing up database before migrations..."
        PGPASSFILE="$(mktemp)"
        echo "*:*:${DB_DATABASE:-zomboid}:${DB_USERNAME:-zomboid}:${DB_PASSWORD}" > "$PGPASSFILE"
        chmod 600 "$PGPASSFILE"
        export PGPASSFILE
        pg_dump -h "${DB_HOST:-db}" -U "${DB_USERNAME:-zomboid}" \
            -d "${DB_DATABASE:-zomboid}" --no-owner > "$BACKUP_FILE" 2>/dev/null \
            && echo "[entrypoint] Backup saved to $BACKUP_FILE" \
            || echo "[entrypoint] Backup skipped (pg_dump not available or DB empty)"
        rm -f "$PGPASSFILE"
        unset PGPASSFILE
    fi

    # Database migrations
    echo "[entrypoint] Running database migrations..."
    php artisan migrate --force --no-interaction 2>&1 || {
        echo "[entrypoint] WARNING: Migrations failed — run 'make migrate' manually."
    }

    # Admin user — create if env vars are set and no super admin exists
    if [ -n "${ADMIN_USERNAME:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ]; then
        echo "[entrypoint] Ensuring admin user exists..."
        php artisan zomboid:create-admin --no-interaction 2>&1 || true
    fi

    # Map tiles — generate in background if missing
    if [ ! -d "${PZ_MAP_TILES_PATH:-/map-tiles}/html/map_data/base/layer0_files" ] && [ -d "${PZ_SERVER_PATH:-/pz-server}" ]; then
        echo "[entrypoint] Map tiles not found — generating in background..."
        php artisan zomboid:generate-map-tiles \
            >> /var/www/html/storage/logs/map-tiles.log 2>&1 &
    fi

    # Item icons — download in background if catalog exists but icons are missing
    ICON_DIR="/var/www/html/public/images/items"
    CATALOG="${LUA_BRIDGE_DIR}/items_catalog.json"
    if [ -f "$CATALOG" ]; then
        ICON_COUNT=$(find "$ICON_DIR" -name '*.png' 2>/dev/null | head -1 | wc -l)
        if [ "$ICON_COUNT" -eq 0 ]; then
            echo "[entrypoint] Item icons not found — downloading in background..."
            php artisan zomboid:download-item-icons \
                >> /var/www/html/storage/logs/item-icons.log 2>&1 &
        fi
    fi

    # Start Vite dev server only in non-production environments
    if [ "$APP_ENV" != "production" ]; then
        echo "[entrypoint] Starting Vite dev server (APP_ENV=$APP_ENV)..."
        supervisorctl start vite 2>/dev/null || true
    fi

    echo "[entrypoint] Ready."
fi

exec "$@"
