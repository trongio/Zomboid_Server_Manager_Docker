#!/usr/bin/env bash
set -euo pipefail

GAME="${PZ_GAME_PORT:-16261}"
DIRECT="${PZ_DIRECT_PORT:-16262}"

echo "[manual] Open these UDP ports in your firewall to allow players:"
echo "  ${GAME}/udp  ${DIRECT}/udp"
echo ""
echo "Examples:"
echo "  iptables:  sudo iptables -A INPUT -p udp --dport ${GAME} -j ACCEPT"
echo "  nftables:  sudo nft add rule inet filter input udp dport { ${GAME}, ${DIRECT} } accept"
echo ""
echo "After opening the firewall, also forward these ports on your router"
echo "for internet players. See docs/firewall-manual.md for details."
