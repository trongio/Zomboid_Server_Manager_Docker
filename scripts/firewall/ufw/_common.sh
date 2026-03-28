#!/usr/bin/env bash
# Shared helpers for ufw backend scripts. Sourced, not executed.

# Verify ufw is available
ufw_check() {
    if ! command -v ufw &>/dev/null; then
        echo "Error: ufw not found. Install it or switch backend in .firewall.conf" >&2
        exit 1
    fi
}

# Check if a ufw rule exists. Usage: ufw_has_rule 16261 udp
ufw_has_rule() {
    local port="$1" proto="$2"
    sudo ufw status | grep -q "${port}/${proto}" 2>/dev/null
}

# Add a rule if not present. Usage: ufw_open 16261 udp
ufw_open() {
    local port="$1" proto="$2"
    if ! ufw_has_rule "$port" "$proto"; then
        sudo ufw allow "${port}/${proto}" >/dev/null
    fi
}

# Delete a rule if present. Usage: ufw_close 16261 udp
ufw_close() {
    local port="$1" proto="$2"
    if ufw_has_rule "$port" "$proto"; then
        sudo ufw delete allow "${port}/${proto}" >/dev/null
    fi
}
