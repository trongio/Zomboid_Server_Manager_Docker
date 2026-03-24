#!/bin/sh
set -e

# ── Docker socket permissions ────────────────────────────────────────
# Give www-data access to the Docker socket (GID varies by host)
if [ -S /var/run/docker.sock ]; then
    DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)
    if ! getent group "$DOCKER_GID" > /dev/null 2>&1; then
        addgroup -g "$DOCKER_GID" -S docker
    fi
    DOCKER_GROUP=$(getent group "$DOCKER_GID" | cut -d: -f1)
    addgroup www-data "$DOCKER_GROUP" 2>/dev/null || true
fi

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
    chmod 775 "$PZ_DATA/Server" 2>/dev/null || true
    chmod 664 "$PZ_DATA/Server/${PZ_SERVER_NAME_VAL}.ini" 2>/dev/null || true
    chmod 664 "$PZ_DATA/Server/${PZ_SERVER_NAME_VAL}_SandboxVars.lua" 2>/dev/null || true
    chown www-data:www-data "$PZ_DATA/Server/${PZ_SERVER_NAME_VAL}.ini" 2>/dev/null || true
    chown www-data:www-data "$PZ_DATA/Server/${PZ_SERVER_NAME_VAL}_SandboxVars.lua" 2>/dev/null || true
fi
# Saves and db directories need to be writable for backup rollback
for dir in "$PZ_DATA/Saves" "$PZ_DATA/db"; do
    if [ -d "$dir" ]; then
        chgrp -R www-data "$dir" 2>/dev/null || true
        chmod -R g+w "$dir" 2>/dev/null || true
    fi
done

# ── Lua bridge permissions ────────────────────────────────────────────
# Shared volume between game server and app — www-data needs write access
LUA_BRIDGE_DIR="${LUA_BRIDGE_PATH:-/lua-bridge}"
if [ -d "$LUA_BRIDGE_DIR" ]; then
    chown -R www-data:www-data "$LUA_BRIDGE_DIR" 2>/dev/null || true
    chmod -R 775 "$LUA_BRIDGE_DIR" 2>/dev/null || true
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
        PGPASSWORD="${DB_PASSWORD}" pg_dump -h "${DB_HOST:-db}" -U "${DB_USERNAME:-zomboid}" \
            -d "${DB_DATABASE:-zomboid}" --no-owner > "$BACKUP_FILE" 2>/dev/null \
            && echo "[entrypoint] Backup saved to $BACKUP_FILE" \
            || echo "[entrypoint] Backup skipped (pg_dump not available or DB empty)"
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

    # Start Vite dev server only in non-production environments
    if [ "$APP_ENV" != "production" ]; then
        echo "[entrypoint] Starting Vite dev server (APP_ENV=$APP_ENV)..."
        supervisorctl start vite 2>/dev/null || true
    fi

    echo "[entrypoint] Ready."
fi

exec "$@"
