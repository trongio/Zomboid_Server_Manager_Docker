#!/usr/bin/env bash
#
# Fast test lane: runs Pest on the host against an in-memory SQLite database,
# with no containers involved. The whole suite takes under a minute and a focused
# run well under a second, which makes it usable as a save-and-run loop.
#
# Everything the app normally gets from a container — the writable storage tree,
# the /pz-data and /backups volumes, built frontend assets — is redirected to a
# scratch directory or stubbed out below.
#
# The containerised run (`make test`) stays authoritative: it uses PostgreSQL,
# the production PHP build, the real volume layout, and the real Vite manifest.
# Anything touching Postgres-specific SQL, the Docker socket, RCON, or actual
# game-server files must be verified there before the work is called done.
#
# Usage:
#   scripts/test-fast.sh                      # whole suite
#   scripts/test-fast.sh tests/Unit           # a directory or file
#   scripts/test-fast.sh --filter=ModManager  # any Pest flags
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../app" && pwd)"
cd "$APP_DIR"

if [[ ! -x vendor/bin/pest ]]; then
    echo "vendor/bin/pest is missing — run 'composer install' in app/ first." >&2
    exit 1
fi

# app/storage is owned by the container's www-data, so the host user cannot compile
# Blade views or write uploads into it. Redirect the whole writable tree to a
# scratch copy instead of loosening permissions on the real one.
STORAGE_DIR="${TMPDIR:-/tmp}/pz-test-storage-$(id -u)"
mkdir -p \
    "$STORAGE_DIR/framework/views" \
    "$STORAGE_DIR/framework/cache/data" \
    "$STORAGE_DIR/framework/sessions" \
    "$STORAGE_DIR/framework/testing/disks" \
    "$STORAGE_DIR/app/public" \
    "$STORAGE_DIR/logs"
export LARAVEL_STORAGE_PATH="$STORAGE_DIR"
export VIEW_COMPILED_PATH="$STORAGE_DIR/framework/views"

# The game-server volumes (/pz-data, /backups) only exist inside the containers.
# Point them at the scratch tree so tests that merely need the directories to be
# writable can run here; what those paths actually contain at runtime is still
# only verifiable in the containerised run.
mkdir -p "$STORAGE_DIR/pz-data/Server" "$STORAGE_DIR/backups"
export PZ_DATA_PATH="$STORAGE_DIR/pz-data"
export BACKUP_PATH="$STORAGE_DIR/backups"

# A throwaway key: the fast lane never touches real encrypted data, and reading
# the developer's .env here would tie test runs to a configured environment.
APP_KEY="${APP_KEY:-base64:$(head -c 32 /dev/urandom | base64)}"
export APP_KEY
export APP_ENV=testing
export DB_CONNECTION=sqlite
export DB_DATABASE=:memory:
export LOG_CHANNEL=null
export CACHE_STORE=array
export QUEUE_CONNECTION=sync
export SESSION_DRIVER=array
export TEST_WITHOUT_VITE=1

exec vendor/bin/pest "$@"
