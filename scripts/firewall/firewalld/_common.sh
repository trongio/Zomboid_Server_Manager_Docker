#!/usr/bin/env bash
# Shared helpers for firewalld backend scripts. Sourced, not executed.

ZONE="${FIREWALL_ZONE:-public}"

# Verify firewall-cmd is available and firewalld is running
firewalld_check() {
    if ! command -v firewall-cmd &>/dev/null; then
        echo "Error: firewall-cmd not found. Install firewalld or switch backend in .firewall.conf" >&2
        exit 1
    fi
    if ! systemctl is-active firewalld &>/dev/null 2>&1; then
        echo "Error: firewalld is not running. Start it: sudo systemctl start firewalld" >&2
        exit 1
    fi
}

# Open a port if not already open. Usage: fw_open 16261 udp
fw_open() {
    local port="$1" proto="$2"
    if ! sudo firewall-cmd --zone="$ZONE" --query-port="${port}/${proto}" &>/dev/null; then
        sudo firewall-cmd --zone="$ZONE" --add-port="${port}/${proto}" >/dev/null
    fi
}

# Close a port if currently open. Usage: fw_close 16261 udp
fw_close() {
    local port="$1" proto="$2"
    if sudo firewall-cmd --zone="$ZONE" --query-port="${port}/${proto}" &>/dev/null; then
        sudo firewall-cmd --zone="$ZONE" --remove-port="${port}/${proto}" >/dev/null
    fi
}
