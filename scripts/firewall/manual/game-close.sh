#!/usr/bin/env bash
set -euo pipefail

GAME="${PZ_GAME_PORT:-16261}"
DIRECT="${PZ_DIRECT_PORT:-16262}"

echo "[manual] Close these UDP ports in your firewall:"
echo "  ${GAME}/udp  ${DIRECT}/udp"
echo ""
echo "Examples:"
echo "  iptables:  sudo iptables -D INPUT -p udp --dport ${GAME} -j ACCEPT"
echo "  ufw:       sudo ufw delete allow ${GAME}/udp"
echo ""
echo "See docs/firewall-manual.md for details."
