# Firewall Configuration — ufw (Ubuntu / Debian)

This guide covers firewall management for Project Zomboid servers running on **Ubuntu**, **Debian**, or any distribution using **ufw** (Uncomplicated Firewall).

## How It Works

`make init` detects ufw and saves the configuration to `.firewall.conf`. The `make expose` / `make hide` / `make admin-expose` / `make admin-hide` commands then use `ufw` to manage ports automatically.

> **Note:** Unlike firewalld, ufw rules are persistent by default — they survive reboots. The `make hide` / `make admin-hide` commands delete the rules.

## Access Levels

### 1. Local-Only (Default)

After `make up`, the admin panel is available at `http://localhost:8000`. No firewall changes are needed. The game server is running but not reachable from outside the machine (assuming ufw is enabled with a default-deny incoming policy).

### 2. Game Ports Open (LAN / Internet)

```bash
make expose    # Allows 16261/udp + 16262/udp
make hide      # Removes the allow rules
```

This lets players on your **local network** connect. For **internet** players, you also need to forward these ports on your router (see below).

### 3. Public Admin Panel

```bash
make admin-expose   # Allows 80/tcp + 443/tcp for Caddy
make admin-hide     # Removes the allow rules
```

This opens the Caddy reverse proxy ports so remote users can access the admin panel over HTTPS. The app container stays bound to `127.0.0.1:8000` — port 8000 is **never** exposed directly.

**Requires Caddy to be configured** — run `make init` and choose a domain or IP during setup.

## Prerequisites

Ensure ufw is enabled:

```bash
sudo ufw status
# If inactive:
sudo ufw enable
```

Default policy should deny incoming traffic:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
```

## Manual Commands

If you prefer to manage ufw manually:

```bash
# Open game ports
sudo ufw allow 16261/udp
sudo ufw allow 16262/udp

# Close game ports
sudo ufw delete allow 16261/udp
sudo ufw delete allow 16262/udp

# Open Caddy web ports
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Close Caddy web ports
sudo ufw delete allow 80/tcp
sudo ufw delete allow 443/tcp

# Check status
sudo ufw status verbose
```

## Router Port Forwarding

> **Important:** Opening firewall ports and router port forwarding are two separate steps.
> The firewall controls what traffic the *server itself* accepts.
> Your router controls what traffic reaches the server *from the internet*.
> Players on your local network only need the firewall opened. Internet players need both.

**This project does not automate router configuration.** To let internet players connect, you must configure your router separately:

1. Find your server's **local IP** (e.g., `192.168.1.100` from `ip addr`)
2. Log into your router's admin panel
3. Forward these ports to your server's local IP:
   - `16261/UDP` — Game port
   - `16262/UDP` — Direct connection port
   - `80/TCP` + `443/TCP` — Only if you want public admin access

## Docker and ufw

Docker manages its own iptables rules for container port mappings. Ports defined in `docker-compose.yml` with `0.0.0.0:` binding are accessible regardless of ufw rules. The game server ports (`16261-16262/udp`) are bound to all interfaces by Docker.

ufw rules control access at the host level **before** Docker's NAT rules. If ufw's default incoming policy is `deny`, Docker-published ports may still be accessible depending on your iptables chain order.

If you need stricter control, consider using `DOCKER_IPTABLES=false` in `/etc/docker/daemon.json` and managing all rules through ufw. See the [Docker documentation](https://docs.docker.com/network/iptables/) for details.

## Verifying

```bash
# Check ufw rules
sudo ufw status numbered

# Test from another machine
nc -zuv <server-ip> 16261
```
