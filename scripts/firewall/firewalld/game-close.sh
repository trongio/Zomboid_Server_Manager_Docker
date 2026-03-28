#!/usr/bin/env bash
set -euo pipefail
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SOURCE_DIR/_common.sh"

firewalld_check
fw_close "${PZ_GAME_PORT:-16261}" udp
fw_close "${PZ_DIRECT_PORT:-16262}" udp
echo "Closed game ports (firewalld, zone=$ZONE): ${PZ_GAME_PORT:-16261}/udp ${PZ_DIRECT_PORT:-16262}/udp"
