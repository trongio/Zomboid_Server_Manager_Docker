#!/usr/bin/env bash
set -euo pipefail

HTTP="${CADDY_HTTP_PORT:-80}"
HTTPS="${CADDY_HTTPS_PORT:-443}"

echo "[manual] Close these TCP ports in your firewall:"
echo "  ${HTTP}/tcp (HTTP)  ${HTTPS}/tcp (HTTPS)"
echo ""
echo "The admin panel remains available locally at http://localhost:8000."
echo "See docs/firewall-manual.md for details."
