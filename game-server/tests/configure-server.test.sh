#!/usr/bin/env bash
#
# Tests for game-server/configure-server.sh setting precedence.
#
# Regression guard for issue #33: on the AMD64 (renegademaster) image the game
# settings arrive under bare env-var names (MAX_PLAYERS, ADMIN_PASSWORD, ...),
# while the ARM64 (joyfui) image uses PZ_* names. configure-server.sh runs last
# on boot and must honour BOTH names, otherwise it clobbers the value the AMD64
# image already applied (a user who picked 24 players silently ended up with 16).
#
# The script is run for real against a throwaway PZ_CONFIG_DIR / PZ_INSTALL_DIR
# so we exercise the actual expansions, not a re-implementation of them.
#
# Usage: bash game-server/tests/configure-server.test.sh   (exit 0 = all pass)

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIGURE="${SCRIPT_DIR}/../configure-server.sh"

pass=0
fail=0

seed_ini() {
    # Simulate the INI PZ generates on first boot (its own defaults).
    cat > "$1" <<'EOF'
DefaultPort=16261
UDPPort=16262
MaxPlayers=32
Public=false
RCONPassword=changeme
AdminPassword=admin
EOF
}

ini_get() {
    grep -m1 "^$2=" "$1" | sed "s/^$2=//"
}

# assert_setting <desc> <ini-key> <expected>
# Env vars for the script and an optional CONFIG_STATE (newline-separated
# key=val lines written to .config_state) are taken from the caller's env.
assert_setting() {
    local desc="$1" key="$2" expected="$3"
    local cfg install ini out rc actual

    cfg="$(mktemp -d)"
    install="$(mktemp -d)"
    mkdir -p "$cfg/Server"
    ini="$cfg/Server/ZomboidServer.ini"
    seed_ini "$ini"

    if [ -n "${CONFIG_STATE:-}" ]; then
        printf '%s\n' "$CONFIG_STATE" > "$cfg/.config_state"
    fi

    out="$(PZ_CONFIG_DIR="$cfg" PZ_INSTALL_DIR="$install" SERVER_NAME="ZomboidServer" \
        bash "$CONFIGURE" 2>&1)"
    rc=$?

    if [ "$rc" -ne 0 ]; then
        echo "FAIL: ${desc} — configure-server.sh exited ${rc}"
        echo "${out}" | sed 's/^/    /'
        fail=$((fail + 1))
        rm -rf "$cfg" "$install"
        return
    fi

    actual="$(ini_get "$ini" "$key")"
    if [ "$actual" = "$expected" ]; then
        echo "PASS: ${desc} (${key}=${actual})"
        pass=$((pass + 1))
    else
        echo "FAIL: ${desc} — expected ${key}=${expected}, got ${key}=${actual}"
        fail=$((fail + 1))
    fi

    rm -rf "$cfg" "$install"
}

echo "Running configure-server.sh precedence tests..."

# --- MaxPlayers (issue #33) ---------------------------------------------------
MAX_PLAYERS=24 \
    assert_setting "AMD64 MAX_PLAYERS is honoured when PZ_MAX_PLAYERS is unset" MaxPlayers 24

PZ_MAX_PLAYERS=20 \
    assert_setting "ARM64 PZ_MAX_PLAYERS is honoured" MaxPlayers 20

PZ_MAX_PLAYERS=20 MAX_PLAYERS=24 \
    assert_setting "PZ_MAX_PLAYERS wins over MAX_PLAYERS when both are set" MaxPlayers 20

CONFIG_STATE="MaxPlayers=50" MAX_PLAYERS=24 \
    assert_setting ".config_state (web UI) overrides env vars" MaxPlayers 50

assert_setting "falls back to default 16 when nothing is set" MaxPlayers 16

# --- Passwords (same both-names fix) -----------------------------------------
ADMIN_PASSWORD="s3cret-admin" \
    assert_setting "AMD64 ADMIN_PASSWORD is honoured when PZ_ADMIN_PASSWORD is unset" AdminPassword "s3cret-admin"

RCON_PASSWORD="rcon-pw" \
    assert_setting "AMD64 RCON_PASSWORD is honoured when PZ_RCON_PASSWORD is unset" RCONPassword "rcon-pw"

echo "----------------------------------------"
echo "Passed: ${pass}, Failed: ${fail}"
[ "$fail" -eq 0 ]
