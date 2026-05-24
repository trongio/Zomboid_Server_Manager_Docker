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

# ── Nginx config rendering ───────────────────────────────────────────
# WebGL cell-binary endpoints bypass PHP via nginx alias, which needs the
# actual PZ map name and server name baked into the config. PZ_MAP_NAMES can
# carry several maps separated by ";"; we use the first one as the primary
# (which is also the one cell binaries live under on disk).
NGINX_TEMPLATE="/etc/nginx/http.d/default.conf.template"
NGINX_CONF="/etc/nginx/http.d/default.conf"
if [ -f "$NGINX_TEMPLATE" ]; then
    PZ_MAP_NAME_PRIMARY=$(printf '%s' "${PZ_MAP_NAMES:-Muldraugh, KY}" | cut -d';' -f1)
    PZ_SERVER_NAME_VAR="${PZ_SERVER_NAME:-ZomboidServer}"
    sed -e "s|@@PZ_MAP_NAME@@|${PZ_MAP_NAME_PRIMARY}|g" \
        -e "s|@@PZ_SERVER_NAME@@|${PZ_SERVER_NAME_VAR}|g" \
        "$NGINX_TEMPLATE" > "$NGINX_CONF"
    echo "[entrypoint] Rendered nginx config (map='$PZ_MAP_NAME_PRIMARY', server='$PZ_SERVER_NAME_VAR')."
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

# Texturepacks upload target — www-data must be able to write here from
# the admin UI before any base map render can succeed.
TEXTUREPACKS_DIR="${PZ_MAP_TEXTUREPACKS_PATH:-$PZ_DATA/texturepacks}"
mkdir -p "$TEXTUREPACKS_DIR" 2>/dev/null || true
chown -R www-data:www-data "$TEXTUREPACKS_DIR" 2>/dev/null || true

# /map-tiles — shared volume для WebGL atlas (web/), pre-packed cell archives
# (cell-data/), pzdataspec parser library (lib/), save cache (save-cache/),
# pzmap2dzi output (html/). Все эти операции запускаются от www-data
# (php-fpm) — нужны права на запись. Volume может быть owned by root по
# default mount; делаем явный chown.
TILES_DIR="${PZ_MAP_TILES_PATH:-/map-tiles}"
mkdir -p "$TILES_DIR/web" "$TILES_DIR/cell-data" "$TILES_DIR/lib" "$TILES_DIR/save-cache" 2>/dev/null || true
chown -R www-data:www-data "$TILES_DIR" 2>/dev/null || true

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

    # Map tiles are no longer auto-generated. Admins opt in via the
    # "Map render engine" panel on /admin/players/map, which dispatches
    # a queued job after explicit confirmation.

    # WebGL atlas — на fresh инсталляции скачиваем prebuilt tarball с
    # GitHub releases (см. PZ_MAP_ATLAS_DOWNLOAD_URL в config). Без этого
    # /pz-atlas/manifest.json возвращает 404 и карта не загружается.
    # Если файл уже есть — skip. Download синхронный (~80 MB), но это
    # one-time на первый старт; следующие boots — instant.
    if [ ! -f /map-tiles/web/manifest.json ]; then
        echo "[entrypoint] WebGL atlas missing — downloading prebuilt tarball..."
        php artisan zomboid:download-atlas \
            >> /var/www/html/storage/logs/atlas-download.log 2>&1 \
            && echo "[entrypoint] Atlas downloaded successfully." \
            || echo "[entrypoint] Atlas download failed — see logs/atlas-download.log. Admin может попробовать вручную через 'Map' страницу в UI."
    fi

    # Pre-packed cell archives — опционально, ускоряют первый load карты
    # для админ-страницы. Если нет, frontend fallback на per-cell endpoint
    # через PHP-FPM. Создание дёшево (~10s), делаем automatically.
    if [ ! -f /map-tiles/cell-data/index.json ] && [ -f /pz-server/media/maps/Muldraugh,\ KY/0_0.lotheader ]; then
        echo "[entrypoint] Building pre-packed cell archives in background..."
        php artisan zomboid:build-cell-archives \
            >> /var/www/html/storage/logs/cell-archives-build.log 2>&1 &
    fi

    # pzdataspec parser library — fetched once on first boot, kept in the
    # shared /map-tiles/lib volume. Used by rebuild_save_cache.py to parse
    # B42 save chunks into packed Uint32Array files for the WebGL renderer.
    if [ ! -d "/map-tiles/lib/pzdataspec" ] && [ -f /opt/pzmap2dzi/main.py ]; then
        echo "[entrypoint] Installing pzdataspec parser library..."
        PZDATASPEC_LIB_PATH=/map-tiles/lib \
            python3 /var/www/html/docker/scripts/install_pzdataspec.py \
            >> /var/www/html/storage/logs/pzdataspec-install.log 2>&1 || \
            echo "[entrypoint] pzdataspec install failed — see logs/pzdataspec-install.log"
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
