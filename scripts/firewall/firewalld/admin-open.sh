#!/usr/bin/env bash
set -euo pipefail
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SOURCE_DIR/_common.sh"

firewalld_check
fw_open "${CADDY_HTTP_PORT:-80}" tcp
fw_open "${CADDY_HTTPS_PORT:-443}" tcp
echo "Opened web ports (firewalld, zone=$ZONE): ${CADDY_HTTP_PORT:-80}/tcp ${CADDY_HTTPS_PORT:-443}/tcp"
