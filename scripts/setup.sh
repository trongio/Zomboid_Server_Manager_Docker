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

GENERATE_SELF_SIGNED=false

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
while true; do
    echo "  1) Production  (recommended for real servers)"
    echo "  2) Development (debug mode, Vite dev server)"
    echo -ne "  ${DIM}[1]${NC}: "
    read -r env_choice || true
    env_choice="${env_choice:-1}"
    [[ "$env_choice" =~ ^[12]$ ]] && break
    echo -e "  ${RED}Invalid choice. Enter 1 or 2.${NC}"
done

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
while true; do
    echo "    1) public   — Stable release (recommended)"
    echo "    2) unstable — Latest unstable/experimental"
    echo "    3) Custom   — Enter a branch name manually"
    echo -ne "  ${DIM}[1]${NC}: "
    read -r branch_choice || true
    branch_choice="${branch_choice:-1}"
    [[ "$branch_choice" =~ ^[123]$ ]] && break
    echo -e "  ${RED}Invalid choice. Enter 1, 2, or 3.${NC}"
done
case "$branch_choice" in
    1) PZ_STEAM_BRANCH="public" ;;
    2) PZ_STEAM_BRANCH="unstable" ;;
    3)
        echo -ne "  Branch name: "
        read -r PZ_STEAM_BRANCH || true
        PZ_STEAM_BRANCH="${PZ_STEAM_BRANCH:-public}"
        ;;
esac

prompt PZ_SERVER_PASSWORD "Server password (empty = open)" ""

# ── Web Panel (HTTPS via Caddy) ───────────────────────────────────────────────
section "Web Panel (HTTPS)"

# Detect public IP once (used by domain and IP validation)
echo -e "  ${DIM}Detecting server public IP...${NC}"
SERVER_IP=$(curl -s --max-time 5 https://api.ipify.org 2>/dev/null || true)
if [ -n "$SERVER_IP" ]; then
    echo -e "  ${DIM}Detected: ${SERVER_IP}${NC}"
else
    echo -e "  ${YELLOW}Could not detect public IP (no internet or behind NAT).${NC}"
fi

APP_PORT=8000
CADDY_HTTP_PORT=80
CADDY_HTTPS_PORT=443

while true; do
    echo ""
    echo "  How will you access the panel?"
    echo "  1) Domain name  (e.g., zomboid.example.com — auto Let's Encrypt)"
    echo "  2) IP address    (public or LAN — self-signed cert)"
    echo "  3) Localhost only (local dev — self-signed cert)"
    echo -ne "  ${DIM}[3]${NC}: "
    read -r access_choice || true
    access_choice="${access_choice:-3}"
    if ! [[ "$access_choice" =~ ^[123]$ ]]; then
        echo -e "  ${RED}Invalid choice. Enter 1, 2, or 3.${NC}"
        continue
    fi

    case "$access_choice" in
        1)
            while true; do
                prompt SITE_HOST "Domain name" ""
                if [ -n "$SITE_HOST" ] && [[ "$SITE_HOST" =~ ^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?$ ]]; then
                    break
                fi
                echo -e "  ${RED}Invalid domain name. Try again.${NC}"
            done
            # DNS pre-check: verify domain resolves to this server
            DOMAIN_IP=$(dig +short "$SITE_HOST" 2>/dev/null | tail -1)
            if [ -z "$DOMAIN_IP" ]; then
                echo -e "  ${RED}${SITE_HOST} does not resolve to any IP address.${NC}"
                echo -e "  ${RED}Let's Encrypt requires DNS to be configured first.${NC}"
                continue
            elif [ -n "$SERVER_IP" ] && [ "$DOMAIN_IP" != "$SERVER_IP" ]; then
                echo -e "  ${RED}${SITE_HOST} resolves to ${DOMAIN_IP}, but this server's public IP is ${SERVER_IP}.${NC}"
                echo -e "  ${RED}Let's Encrypt will fail unless the domain points to this server.${NC}"
                continue
            else
                echo -e "  ${GREEN}✓ ${SITE_HOST} resolves to ${DOMAIN_IP}${NC}"
            fi
            APP_URL="https://${SITE_HOST}"
            CADDY_SITE="${SITE_HOST}"
            CADDY_TLS=""
            break
            ;;
        2)
            while true; do
                prompt SITE_HOST "Server IP address" ""
                if [ -n "$SITE_HOST" ] && [[ "$SITE_HOST" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
                    break
                fi
                echo -e "  ${RED}Invalid IP address. Try again.${NC}"
            done
            # Verify IP belongs to this server (public or LAN)
            LOCAL_IPS=$(hostname -I 2>/dev/null || true)
            IP_VALID=false
            if [ -n "$SERVER_IP" ] && [ "$SITE_HOST" = "$SERVER_IP" ]; then
                IP_VALID=true
                echo -e "  ${GREEN}✓ Matches server public IP${NC}"
            elif echo "$LOCAL_IPS" | grep -qw "$SITE_HOST"; then
                IP_VALID=true
                echo -e "  ${GREEN}✓ Matches local network interface${NC}"
            fi
            if [ "$IP_VALID" = "false" ]; then
                echo -e "  ${RED}${SITE_HOST} is not assigned to this server.${NC}"
                if [ -n "$SERVER_IP" ]; then
                    echo -e "  ${RED}Public IP: ${SERVER_IP} | Local IPs: ${LOCAL_IPS}${NC}"
                else
                    echo -e "  ${RED}Local IPs: ${LOCAL_IPS}${NC}"
                fi
                continue
            fi
            APP_URL="https://${SITE_HOST}"
            CADDY_SITE=":443"
            CADDY_TLS=$'\ttls /etc/caddy/certs/cert.pem /etc/caddy/certs/key.pem'
            GENERATE_SELF_SIGNED=true
            break
            ;;
        3)
            SITE_HOST="localhost"
            APP_URL="https://localhost"
            CADDY_SITE="localhost"
            CADDY_TLS=$'\ttls internal'
            break
            ;;
    esac
done

# ── Firewall Backend ──────────────────────────────────────────────────────────
# Detect or prompt for firewall backend, generates .firewall.conf
bash scripts/firewall/detect.sh .firewall.conf

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
if [ -f .firewall.conf ]; then
    . .firewall.conf
    echo -e "  Firewall:     ${GREEN}${FIREWALL_BACKEND}${NC}"
fi
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
# Generate self-signed certificate (IP mode only)
# ══════════════════════════════════════════════════════════════════════════════
mkdir -p caddy/certs
if [ "$GENERATE_SELF_SIGNED" = "true" ]; then
    echo "Generating self-signed certificate for ${SITE_HOST}..."
    openssl req -x509 -newkey rsa:2048 \
        -keyout caddy/certs/key.pem -out caddy/certs/cert.pem \
        -days 3650 -nodes \
        -subj "/CN=${SITE_HOST}" \
        -addext "subjectAltName=IP:${SITE_HOST}" 2>/dev/null
else
    # Clean up certs from a previous IP-mode run
    rm -f caddy/certs/cert.pem caddy/certs/key.pem
fi

# ══════════════════════════════════════════════════════════════════════════════
# Generate Caddyfile
# ══════════════════════════════════════════════════════════════════════════════
echo "Creating caddy/Caddyfile..."
if [ "$GENERATE_SELF_SIGNED" = "true" ]; then
    # IP mode: listen on all interfaces, use generated cert, add HTTP→HTTPS redirect
    cat > caddy/Caddyfile <<CADDYEOF
{
	# Managed by setup.sh — edit freely or re-run make init
}

${CADDY_SITE} {
${CADDY_TLS}
	reverse_proxy app:8000
}

:80 {
	redir https://{host}{uri} permanent
}
CADDYEOF
else
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
fi

# Update .firewall.conf now that Caddyfile exists
if [ -f .firewall.conf ]; then
    sed -i 's/^CADDY_ENABLED=.*/CADDY_ENABLED=true/' .firewall.conf
fi

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
# Stop existing services and clean stale state
# ══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}Starting services...${NC}"
make down 2>/dev/null || true

# Remove build/cache volumes that may have stale state from a previous run
# (game data, DB, and backups are intentionally preserved)
for vol in pz-caddy-data pz-caddy-config pz-app-vendor pz-app-node-modules pz-app-build; do
    docker volume rm "$vol" 2>/dev/null || true
done

# Verify no stale pz- volumes are stuck (Docker can leave ghosts after down -v)
STALE=$(docker volume ls -q --filter name=pz-caddy --filter name=pz-app-vendor --filter name=pz-app-node --filter name=pz-app-build 2>/dev/null || true)
if [ -n "$STALE" ]; then
    echo -e "${YELLOW}Cleaning leftover volumes...${NC}"
    echo "$STALE" | xargs docker volume rm 2>/dev/null || true
fi

make up

# ══════════════════════════════════════════════════════════════════════════════
# Sync passwords into existing volumes (re-run safe)
# ══════════════════════════════════════════════════════════════════════════════
# PostgreSQL: volume retains the password from the first initdb — sync it
echo "Syncing database password..."
docker exec pz-db psql -U "${DB_USERNAME:-zomboid}" -d "${DB_DATABASE:-zomboid}" \
    -c "ALTER USER ${DB_USERNAME:-zomboid} PASSWORD '${DB_PASS}';" >/dev/null 2>&1 || true

# Redis: update requirepass to match new password
echo "Syncing Redis password..."
if [ -n "$REDIS_PASS" ]; then
    # Try authenticating with old password first (may fail on first run — that's OK)
    docker exec pz-redis redis-cli CONFIG SET requirepass "$REDIS_PASS" >/dev/null 2>&1 || \
    docker exec pz-redis redis-cli -a "$REDIS_PASS" CONFIG SET requirepass "$REDIS_PASS" >/dev/null 2>&1 || true
fi

# Clear stale config/route cache (APP_URL or other settings may have changed)
echo "Clearing application cache..."
docker exec pz-app php artisan config:clear --no-interaction >/dev/null 2>&1 || true
docker exec pz-app php artisan route:clear --no-interaction >/dev/null 2>&1 || true
docker exec pz-app php artisan view:clear --no-interaction >/dev/null 2>&1 || true

# Admin user: update or create via artisan (entrypoint may not have run yet)
echo "Syncing admin account..."
for attempt in 1 2 3; do
    if docker exec pz-app php artisan zomboid:create-admin --no-interaction 2>&1 | grep -qE "created|updated|exists"; then
        break
    fi
    sleep 3
done

# ══════════════════════════════════════════════════════════════════════════════
# Health check — verify the panel is reachable
# ══════════════════════════════════════════════════════════════════════════════
echo "Verifying web panel..."
HEALTH_OK=false
for attempt in 1 2 3 4 5; do
    HTTP_CODE=$(curl -sk -o /dev/null -w "%{http_code}" "${APP_URL}/" 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 400 ]; then
        HEALTH_OK=true
        break
    fi
    sleep 3
done

# ══════════════════════════════════════════════════════════════════════════════
# Done
# ══════════════════════════════════════════════════════════════════════════════
echo ""
if [ "$HEALTH_OK" = "true" ]; then
    echo -e "${GREEN}${BOLD}══════════════════════════════════════════════${NC}"
    echo -e "${GREEN}${BOLD}  Setup complete!${NC}"
    echo -e "${GREEN}${BOLD}══════════════════════════════════════════════${NC}"
else
    echo -e "${YELLOW}${BOLD}══════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}${BOLD}  Setup complete — but panel not reachable!${NC}"
    echo -e "${YELLOW}${BOLD}══════════════════════════════════════════════${NC}"
    echo ""
    if [ "$access_choice" = "1" ]; then
        echo -e "  ${YELLOW}Let's Encrypt may still be issuing a certificate.${NC}"
        echo -e "  ${YELLOW}Check: make logs | grep caddy${NC}"
        echo -e "  ${YELLOW}Ensure ports 80 and 443 are open in your firewall.${NC}"
    else
        echo -e "  ${YELLOW}Ensure ports 80 and 443 are open in your firewall.${NC}"
        echo -e "  ${YELLOW}Check: make logs${NC}"
    fi
fi
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

# Game server status — check if SteamCMD failed and restart if needed
GS_RUNNING=false
for gs_attempt in 1 2 3; do
    # Give the entrypoint time to run SteamCMD (or fail)
    echo -e "  ${DIM}Checking game server (attempt ${gs_attempt}/3)...${NC}"
    sleep 10

    # Check if SteamCMD hit a fatal error
    if docker logs pz-game-server 2>&1 | grep -q "FATAL: SteamCMD failed"; then
        if [ "$gs_attempt" -lt 3 ]; then
            echo -e "  ${YELLOW}Game server: SteamCMD failed — restarting container...${NC}"
            docker restart pz-game-server >/dev/null 2>&1 || true
        else
            echo -e "  ${RED}Game server: SteamCMD failed after 3 container restarts.${NC}"
            echo -e "  ${DIM}  Check logs: docker logs pz-game-server${NC}"
        fi
        continue
    fi

    # Check if it's running or still downloading
    GS_STATE=$(docker inspect --format='{{.State.Status}}' pz-game-server 2>/dev/null || echo "unknown")
    if [ "$GS_STATE" = "running" ]; then
        GS_RUNNING=true
        break
    fi
done

if [ "$GS_RUNNING" = "true" ]; then
    echo -e "  ${GREEN}Game server: running (SteamCMD download may still be in progress)${NC}"
    echo -e "  ${DIM}  Monitor with: docker logs -f pz-game-server${NC}"
else
    echo -e "  ${YELLOW}Game server: not running${NC}"
    echo -e "  ${DIM}  Check logs: docker logs pz-game-server${NC}"
fi
echo ""

# ══════════════════════════════════════════════════════════════════════════════
# Item icons — download in background if catalog is available
# ══════════════════════════════════════════════════════════════════════════════
if docker exec pz-app test -f /lua-bridge/items_catalog.json 2>/dev/null; then
    echo -e "${DIM}Downloading item icons in background...${NC}"
    docker exec -d pz-app php artisan zomboid:download-item-icons --no-interaction \
        >> /dev/null 2>&1 || true
else
    echo -e "${DIM}Item icons: skipped (catalog not yet exported by game server)${NC}"
    echo -e "${DIM}  Run later: make exec CMD=\"php artisan zomboid:download-item-icons\"${NC}"
fi
