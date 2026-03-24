#!/usr/bin/env bash
set -euo pipefail

# ══════════════════════════════════════════════════════════════════════════════
# Zomboid Manager — First-Time Setup
# Interactive wizard that configures both .env files, creates the database
# volume, starts containers, and provisions the admin account.
# ══════════════════════════════════════════════════════════════════════════════

# ── Colors & helpers ──────────────────────────────────────────────────────────
BOLD='\033[1m'
DIM='\033[2m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m' # No Color

banner() {
    echo ""
    echo -e "${CYAN}${BOLD}══════════════════════════════════════════════${NC}"
    echo -e "${CYAN}${BOLD}  Zomboid Manager — First-Time Setup${NC}"
    echo -e "${CYAN}${BOLD}══════════════════════════════════════════════${NC}"
    echo ""
}

section() {
    echo ""
    echo -e "${BOLD}── $1 ──${NC}"
}

prompt() {
    local var_name="$1"
    local label="$2"
    local default="$3"
    local is_secret="${4:-false}"
    local value

    if [ "$is_secret" = "true" ]; then
        echo -ne "  ${label} ${DIM}[hidden]${NC}: "
        read -rs value || true
        echo ""
    elif [ -n "$default" ]; then
        echo -ne "  ${label} ${DIM}[${default}]${NC}: "
        read -r value || true
    else
        echo -ne "  ${label}: "
        read -r value || true
    fi

    value="${value:-$default}"
    eval "$var_name='$value'"
}

generate_secret() {
    openssl rand -base64 "$1" | tr -dc 'A-Za-z0-9' | head -c "$2"
}

# ── Detect architecture ──────────────────────────────────────────────────────
ARCH=$(uname -m)
if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
    ARCH_LABEL="aarch64 (ARM64)"
else
    ARCH_LABEL="x86_64 (AMD64)"
fi

# ── Guard: existing .env ─────────────────────────────────────────────────────
if [ -f .env ] || [ -f app/.env ]; then
    echo ""
    echo -e "${YELLOW}Existing .env file(s) detected.${NC}"
    echo -ne "  Overwrite and reconfigure? ${DIM}[y/N]${NC}: "
    read -r overwrite || true
    if [ "${overwrite,,}" != "y" ]; then
        echo "Cancelled."
        exit 0
    fi
    echo ""
fi

# ══════════════════════════════════════════════════════════════════════════════
# Interactive prompts
# ══════════════════════════════════════════════════════════════════════════════
banner

# ── Environment ───────────────────────────────────────────────────────────────
section "Environment"
echo "  1) Production  (recommended for real servers)"
echo "  2) Development (debug mode, Vite dev server)"
echo -ne "  ${DIM}[1]${NC}: "
read -r env_choice || true
env_choice="${env_choice:-1}"

if [ "$env_choice" = "2" ]; then
    APP_ENV="local"
    APP_DEBUG="true"
    LOG_LEVEL="debug"
    SESSION_ENCRYPT="false"
    ROOT_TEMPLATE=".env.example"
    APP_TEMPLATE="app/.env.example"
else
    APP_ENV="production"
    APP_DEBUG="false"
    LOG_LEVEL="warning"
    SESSION_ENCRYPT="true"
    ROOT_TEMPLATE=".env.production.example"
    APP_TEMPLATE="app/.env.production.example"
fi

# ── Web Admin Account ────────────────────────────────────────────────────────
section "Web Admin Account"
prompt ADMIN_USERNAME "Username" "admin"

# Generate a random password as default
DEFAULT_ADMIN_PASS=$(generate_secret 18 16)
echo -ne "  Password ${DIM}[auto-generated]${NC}: "
read -rs ADMIN_PASSWORD || true
echo ""
if [ -z "$ADMIN_PASSWORD" ]; then
    ADMIN_PASSWORD="$DEFAULT_ADMIN_PASS"
    ADMIN_PASS_GENERATED=true
else
    ADMIN_PASS_GENERATED=false
fi

prompt ADMIN_EMAIL "Email (optional, press Enter to skip)" ""

# ── Game Server ───────────────────────────────────────────────────────────────
section "Game Server"
prompt PZ_SERVER_NAME "Server name" "ZomboidServer"
prompt PZ_MAX_PLAYERS "Max players" "16"
prompt PZ_MAX_RAM "Max RAM" "4096m"

echo "  Steam branch:"
echo "    1) public  — Stable release (recommended)"
echo "    2) b42     — Build 42 beta"
echo -ne "  ${DIM}[1]${NC}: "
read -r branch_choice || true
branch_choice="${branch_choice:-1}"
if [ "$branch_choice" = "2" ]; then
    PZ_STEAM_BRANCH="b42"
else
    PZ_STEAM_BRANCH="public"
fi

prompt PZ_SERVER_PASSWORD "Server password (empty = open)" ""

# ── Web Panel (HTTPS via Caddy) ───────────────────────────────────────────────
section "Web Panel (HTTPS)"
echo "  How will you access the panel?"
echo "  1) Domain name  (e.g., zomboid.example.com — auto Let's Encrypt)"
echo "  2) Public IP     (e.g., 203.0.113.50 — self-signed cert)"
echo "  3) Localhost only (local dev — self-signed cert)"
echo -ne "  ${DIM}[3]${NC}: "
read -r access_choice || true
access_choice="${access_choice:-3}"

APP_PORT=8000
CADDY_HTTP_PORT=80
CADDY_HTTPS_PORT=443

case "$access_choice" in
    1)
        while true; do
            prompt SITE_HOST "Domain name" ""
            if [ -n "$SITE_HOST" ] && [[ "$SITE_HOST" =~ ^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?$ ]]; then
                break
            fi
            echo -e "  ${RED}Invalid domain name. Try again.${NC}"
        done
        APP_URL="https://${SITE_HOST}"
        CADDY_SITE="${SITE_HOST}"
        CADDY_TLS=""
        ;;
    2)
        while true; do
            prompt SITE_HOST "Server IP address" ""
            if [ -n "$SITE_HOST" ] && [[ "$SITE_HOST" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
                break
            fi
            echo -e "  ${RED}Invalid IP address. Try again.${NC}"
        done
        APP_URL="https://${SITE_HOST}"
        CADDY_SITE="${SITE_HOST}"
        CADDY_TLS=$'\ttls internal'
        ;;
    *)
        SITE_HOST="localhost"
        APP_URL="https://localhost"
        CADDY_SITE="localhost"
        CADDY_TLS=$'\ttls internal'
        ;;
esac

# ══════════════════════════════════════════════════════════════════════════════
# Summary
# ══════════════════════════════════════════════════════════════════════════════
section "Summary"
echo ""
echo -e "  Environment:  ${GREEN}${APP_ENV}${NC}"
echo -e "  Admin:        ${GREEN}${ADMIN_USERNAME}${NC}"
echo -e "  Server:       ${GREEN}${PZ_SERVER_NAME}${NC}"
echo -e "  Players:      ${GREEN}${PZ_MAX_PLAYERS}${NC} / RAM: ${GREEN}${PZ_MAX_RAM}${NC}"
echo -e "  Branch:       ${GREEN}${PZ_STEAM_BRANCH}${NC}"
echo -e "  Panel:        ${GREEN}${APP_URL}${NC} (HTTPS via Caddy)"
echo -e "  Architecture: ${GREEN}${ARCH_LABEL}${NC}"
echo ""
echo -ne "  Proceed? ${DIM}[Y/n]${NC}: "
read -r proceed || true
if [ "${proceed,,}" = "n" ]; then
    echo "Cancelled."
    exit 0
fi

# ══════════════════════════════════════════════════════════════════════════════
# Generate secrets
# ══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}Generating secrets...${NC}"

DB_PASS=$(generate_secret 18 24)
RCON_PASS=$(generate_secret 18 16)
PZ_ADMIN_PASS=$(generate_secret 18 16)
API_SECRET=$(generate_secret 32 48)
APP_SECRET=$(openssl rand -base64 32)
REDIS_PASS=$(generate_secret 18 20)

# ══════════════════════════════════════════════════════════════════════════════
# Generate Caddyfile
# ══════════════════════════════════════════════════════════════════════════════
echo "Creating caddy/Caddyfile..."
mkdir -p caddy
cat > caddy/Caddyfile <<CADDYEOF
{
	# Managed by setup.sh — edit freely or re-run make init
}

${CADDY_SITE} {
${CADDY_TLS}
	reverse_proxy app:8000
}

http://${CADDY_SITE} {
	redir https://${CADDY_SITE}{uri} permanent
}
CADDYEOF

# ══════════════════════════════════════════════════════════════════════════════
# Generate root .env
# ══════════════════════════════════════════════════════════════════════════════
echo "Creating .env from ${ROOT_TEMPLATE}..."

sed \
    -e "s|^PZ_SERVER_NAME=.*|PZ_SERVER_NAME=${PZ_SERVER_NAME}|" \
    -e "s|^PZ_ADMIN_PASSWORD=.*|PZ_ADMIN_PASSWORD=${PZ_ADMIN_PASS}|" \
    -e "s|^PZ_SERVER_PASSWORD=.*|PZ_SERVER_PASSWORD=${PZ_SERVER_PASSWORD}|" \
    -e "s|^PZ_MAX_PLAYERS=.*|PZ_MAX_PLAYERS=${PZ_MAX_PLAYERS}|" \
    -e "s|^PZ_MAX_RAM=.*|PZ_MAX_RAM=${PZ_MAX_RAM}|" \
    -e "s|^PZ_RCON_PASSWORD=.*|PZ_RCON_PASSWORD=${RCON_PASS}|" \
    -e "s|^PZ_STEAM_BRANCH=.*|PZ_STEAM_BRANCH=${PZ_STEAM_BRANCH}|" \
    -e "s|^APP_ENV=.*|APP_ENV=${APP_ENV}|" \
    -e "s|^APP_KEY=.*|APP_KEY=base64:${APP_SECRET}|" \
    -e "s|^APP_DEBUG=.*|APP_DEBUG=${APP_DEBUG}|" \
    -e "s|^APP_URL=.*|APP_URL=${APP_URL}|" \
    -e "s|^APP_PORT=.*|APP_PORT=${APP_PORT}|" \
    -e "s|^CADDY_HTTP_PORT=.*|CADDY_HTTP_PORT=${CADDY_HTTP_PORT}|" \
    -e "s|^CADDY_HTTPS_PORT=.*|CADDY_HTTPS_PORT=${CADDY_HTTPS_PORT}|" \
    -e "s|^DB_PASSWORD=.*|DB_PASSWORD=${DB_PASS}|" \
    -e "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=${REDIS_PASS}|" \
    -e "s|^API_KEY=.*|API_KEY=${API_SECRET}|" \
    -e "s|^ADMIN_USERNAME=.*|ADMIN_USERNAME=${ADMIN_USERNAME}|" \
    -e "s|^ADMIN_EMAIL=.*|ADMIN_EMAIL=${ADMIN_EMAIL}|" \
    -e "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${ADMIN_PASSWORD}|" \
    "$ROOT_TEMPLATE" > .env

# ══════════════════════════════════════════════════════════════════════════════
# Generate app/.env
# ══════════════════════════════════════════════════════════════════════════════
echo "Creating app/.env from ${APP_TEMPLATE}..."

sed \
    -e "s|^PZ_SERVER_NAME=.*|PZ_SERVER_NAME=${PZ_SERVER_NAME}|" \
    -e "s|^PZ_RCON_PASSWORD=.*|PZ_RCON_PASSWORD=${RCON_PASS}|" \
    -e "s|^APP_ENV=.*|APP_ENV=${APP_ENV}|" \
    -e "s|^APP_KEY=.*|APP_KEY=base64:${APP_SECRET}|" \
    -e "s|^APP_DEBUG=.*|APP_DEBUG=${APP_DEBUG}|" \
    -e "s|^APP_URL=.*|APP_URL=${APP_URL}|" \
    -e "s|^DB_PASSWORD=.*|DB_PASSWORD=${DB_PASS}|" \
    -e "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=${REDIS_PASS}|" \
    -e "s|^API_KEY=.*|API_KEY=${API_SECRET}|" \
    -e "s|^PZ_ADMIN_PASSWORD=.*|PZ_ADMIN_PASSWORD=${PZ_ADMIN_PASS}|" \
    -e "s|^ADMIN_USERNAME=.*|ADMIN_USERNAME=${ADMIN_USERNAME}|" \
    -e "s|^ADMIN_EMAIL=.*|ADMIN_EMAIL=${ADMIN_EMAIL}|" \
    -e "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${ADMIN_PASSWORD}|" \
    -e "s|^LOG_LEVEL=.*|LOG_LEVEL=${LOG_LEVEL}|" \
    "$APP_TEMPLATE" > app/.env

# Production-specific overrides for app/.env
if [ "$APP_ENV" = "production" ]; then
    sed -i "s|^SESSION_ENCRYPT=.*|SESSION_ENCRYPT=true|" app/.env 2>/dev/null || true
    sed -i "s|^SESSION_SECURE_COOKIE=.*|SESSION_SECURE_COOKIE=true|" app/.env 2>/dev/null || true
fi

# Always set LOG_STACK to daily
sed -i "s|^LOG_STACK=.*|LOG_STACK=daily|" app/.env 2>/dev/null || true

# ══════════════════════════════════════════════════════════════════════════════
# Ensure database volume exists
# ══════════════════════════════════════════════════════════════════════════════
if ! docker volume inspect pz-postgres >/dev/null 2>&1; then
    echo "Creating Postgres volume..."
    docker volume create pz-postgres >/dev/null
fi

# ══════════════════════════════════════════════════════════════════════════════
# Start services
# ══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}Starting services...${NC}"
make up

# ══════════════════════════════════════════════════════════════════════════════
# Done
# ══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${GREEN}${BOLD}══════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  Setup complete!${NC}"
echo -e "${GREEN}${BOLD}══════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}Web Panel:${NC}     ${APP_URL}  ${DIM}(HTTPS)${NC}"
echo -e "  ${BOLD}Admin User:${NC}    ${ADMIN_USERNAME}"
if [ "$ADMIN_PASS_GENERATED" = "true" ]; then
echo -e "  ${BOLD}Admin Pass:${NC}    ${YELLOW}${ADMIN_PASSWORD}${NC}"
echo ""
echo -e "  ${YELLOW}Save this password — it won't be shown again.${NC}"
else
echo -e "  ${BOLD}Admin Pass:${NC}    (as entered)"
fi
echo ""
echo -e "  ${BOLD}API Key:${NC}       ${DIM}${API_SECRET}${NC}"
echo ""
echo -e "  The admin account will be created automatically when"
echo -e "  the app container finishes starting (check ${DIM}make logs${NC})."
echo ""
