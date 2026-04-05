#!/usr/bin/env bash
set -euo pipefail
# ══════════════════════════════════════════════════════════════════════════════
# Firewall dispatch — reads .firewall.conf and calls the right backend script
# Usage: dispatch.sh <action>
#   action: game-open | game-close | admin-open | admin-close
# ══════════════════════════════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONF_FILE="$REPO_ROOT/.firewall.conf"

RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

ACTION="${1:-}"

if [ -z "$ACTION" ]; then
    echo -e "${RED}Usage: dispatch.sh <game-open|game-close|admin-open|admin-close>${NC}" >&2
    exit 1
fi

# ── Load config ───────────────────────────────────────────────────────────────
if [ ! -f "$CONF_FILE" ]; then
    echo -e "${RED}Error: .firewall.conf not found.${NC}" >&2
    echo -e "${YELLOW}Run 'make init' first to configure firewall settings.${NC}" >&2
    exit 1
fi

# Parse .firewall.conf as data (KEY=VALUE lines) instead of executing it
while IFS='=' read -r key value; do
    # Skip empty lines and comments
    case "$key" in
        ''|\#*) continue ;;
    esac

    case "$key" in
        FIREWALL_BACKEND|FIREWALL_OS|FIREWALL_ZONE|CADDY_ENABLED|ADMIN_PUBLIC_HOST|ADMIN_HTTP_PORT|ADMIN_HTTPS_PORT)
            # Trim trailing CR (for Windows-style line endings)
            value="${value%$'\r'}"
            # Trim leading and trailing whitespace
            value="${value#"${value%%[![:space:]]*}"}"
            value="${value%"${value##*[![:space:]]}"}"
            # Remove matching surrounding single or double quotes, if present
            if [[ ${#value} -ge 2 ]]; then
                if [[ ${value:0:1} == '"' && ${value: -1} == '"' ]] || \
                   [[ ${value:0:1} == "'" && ${value: -1} == "'" ]]; then
                    value="${value:1:-1}"
                fi
            fi
            # Assign value without evaluation
            printf -v "$key" '%s' "$value"
            ;;
        *)
            # Ignore unknown keys
            ;;
    esac
done < "$CONF_FILE"

BACKEND="${FIREWALL_BACKEND:-manual}"

# ── Validate action ──────────────────────────────────────────────────────────
case "$ACTION" in
    game-open|game-close|admin-open|admin-close) ;;
    *)
        echo -e "${RED}Unknown action: ${ACTION}${NC}" >&2
        echo -e "Valid actions: game-open, game-close, admin-open, admin-close" >&2
        exit 1
        ;;
esac

# ── For admin actions, verify Caddy is configured ────────────────────────────
if [[ "$ACTION" == admin-* ]]; then
    CADDY_ENABLED="${CADDY_ENABLED:-false}"
    if [ "$CADDY_ENABLED" != "true" ]; then
        echo -e "${RED}Error: Caddy is not configured.${NC}" >&2
        echo "Public admin access requires Caddy. Run 'make init' to set it up." >&2
        echo "The admin panel is still available locally at http://localhost:8000" >&2
        exit 1
    fi
fi

# ── Dispatch to backend script ───────────────────────────────────────────────
BACKEND_SCRIPT="$SCRIPT_DIR/$BACKEND/$ACTION.sh"

if [ ! -f "$BACKEND_SCRIPT" ]; then
    echo -e "${RED}Error: Backend script not found: scripts/firewall/$BACKEND/$ACTION.sh${NC}" >&2
    echo -e "${YELLOW}Falling back to manual mode.${NC}" >&2
    BACKEND_SCRIPT="$SCRIPT_DIR/manual/$ACTION.sh"
fi

if [ ! -f "$BACKEND_SCRIPT" ]; then
    echo -e "${RED}Error: No script found for action '$ACTION' on backend '$BACKEND'.${NC}" >&2
    exit 1
fi

# Export variables the backend scripts need
export FIREWALL_ZONE="${FIREWALL_ZONE:-}"
export PZ_GAME_PORT="${PZ_GAME_PORT:-16261}"
export PZ_DIRECT_PORT="${PZ_DIRECT_PORT:-16262}"
# Admin ports: prefer values from .firewall.conf, fall back to env, then defaults
export CADDY_HTTP_PORT="${ADMIN_HTTP_PORT:-${CADDY_HTTP_PORT:-80}}"
export CADDY_HTTPS_PORT="${ADMIN_HTTPS_PORT:-${CADDY_HTTPS_PORT:-443}}"

exec bash "$BACKEND_SCRIPT"
