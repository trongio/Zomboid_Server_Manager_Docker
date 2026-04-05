#!/usr/bin/env bash
set -euo pipefail

HTTP="${CADDY_HTTP_PORT:-80}"
HTTPS="${CADDY_HTTPS_PORT:-443}"

echo "[manual] Open these TCP ports in your firewall for public admin access:"
echo "  ${HTTP}/tcp (HTTP)  ${HTTPS}/tcp (HTTPS)"
echo ""
echo "Traffic goes through Caddy — port 8000 stays local-only."
echo ""
echo "Examples:"
echo "  iptables:  sudo iptables -A INPUT -p tcp --dport ${HTTP} -j ACCEPT"
echo "  iptables:  sudo iptables -A INPUT -p tcp --dport ${HTTPS} -j ACCEPT"
echo ""
echo "See docs/firewall-manual.md for details."
