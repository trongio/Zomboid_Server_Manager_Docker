#!/usr/bin/env bash
# Shared helpers for ufw backend scripts. Sourced, not executed.

# Verify ufw is available and sudo works non-interactively
ufw_check() {
    if ! command -v ufw &>/dev/null; then
        echo "Error: ufw not found. Install it or switch backend in .firewall.conf" >&2
        exit 1
    fi
    if ! sudo -n true 2>/dev/null; then
        echo "Error: sudo access required for ufw. Run with passwordless sudo or enter 'sudo -v' first." >&2
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

# Check if a ufw rule exists. Usage: ufw_has_rule 16261 udp
ufw_has_rule() {
    local port="$1" proto="$2"
    sudo -n ufw status | grep -q "${port}/${proto}" 2>/dev/null
}

# Add a rule if not present. Usage: ufw_open 16261 udp
ufw_open() {
    local port="$1" proto="$2"
    validate_port "$port"
    if ! ufw_has_rule "$port" "$proto"; then
        sudo -n ufw allow "${port}/${proto}" >/dev/null
    fi
}

# Delete a rule if present. Usage: ufw_close 16261 udp
ufw_close() {
    local port="$1" proto="$2"
    validate_port "$port"
    if ufw_has_rule "$port" "$proto"; then
        sudo -n ufw delete allow "${port}/${proto}" >/dev/null
    fi
}
