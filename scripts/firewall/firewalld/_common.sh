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
    if ! sudo -n true 2>/dev/null; then
        echo "Error: sudo access required for firewall-cmd. Run with passwordless sudo or enter 'sudo -v' first." >&2
        exit 1
    fi
}

# Validate port number (must be numeric, 1-65535)
validate_port() {
    local port="$1"
    if ! [[ "$port" =~ ^[0-9]+$ ]] || [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
        echo "Error: invalid port number: $port" >&2
        exit 1
    fi
}

# Open a port if not already open. Usage: fw_open 16261 udp
fw_open() {
    local port="$1" proto="$2"
    validate_port "$port"
    if ! sudo -n firewall-cmd --zone="$ZONE" --query-port="${port}/${proto}" &>/dev/null; then
        sudo -n firewall-cmd --zone="$ZONE" --add-port="${port}/${proto}" >/dev/null
    fi
}

# Close a port if currently open. Usage: fw_close 16261 udp
fw_close() {
    local port="$1" proto="$2"
    validate_port "$port"
    if sudo -n firewall-cmd --zone="$ZONE" --query-port="${port}/${proto}" &>/dev/null; then
        sudo -n firewall-cmd --zone="$ZONE" --remove-port="${port}/${proto}" >/dev/null
    fi
}
