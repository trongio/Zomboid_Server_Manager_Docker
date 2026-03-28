#!/usr/bin/env bash
set -euo pipefail
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SOURCE_DIR/_common.sh"

ufw_check
ufw_close "${CADDY_HTTP_PORT:-80}" tcp
ufw_close "${CADDY_HTTPS_PORT:-443}" tcp
echo "Closed web ports (ufw): ${CADDY_HTTP_PORT:-80}/tcp ${CADDY_HTTPS_PORT:-443}/tcp"
