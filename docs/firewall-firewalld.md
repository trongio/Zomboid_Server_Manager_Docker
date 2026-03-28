# Firewall Configuration — firewalld (Fedora / RHEL / CentOS)

This guide covers firewall management for Project Zomboid servers running on **Fedora**, **RHEL**, **CentOS**, or any distribution using **firewalld**.

## How It Works

`make init` detects firewalld and saves the configuration to `.firewall.conf`. The `make expose` / `make hide` / `make admin-expose` / `make admin-hide` commands then use `firewall-cmd` to manage ports automatically.

All rules are **runtime only** (non-permanent). They are lost on reboot or `firewall-cmd --reload`. This is intentional — run `make expose` after rebooting to re-open ports.

## Access Levels

### 1. Local-Only (Default)

After `make up`, the admin panel is available at `http://localhost:8000`. No firewall changes are needed. The game server is running but not reachable from outside the machine.

### 2. Game Ports Open (LAN / Internet)

```bash
make expose    # Opens 16261/udp + 16262/udp (runtime)
make hide      # Closes them
```

This lets players on your **local network** connect. For **internet** players, you also need to forward these ports on your router (see below).

### 3. Public Admin Panel

```bash
make admin-expose   # Opens 80/tcp + 443/tcp for Caddy (runtime)
make admin-hide     # Closes them
```

This opens the Caddy reverse proxy ports so remote users can access the admin panel over HTTPS. The app container stays bound to `127.0.0.1:8000` — port 8000 is **never** exposed directly.

**Requires Caddy to be configured** — run `make init` and choose a domain or IP during setup.

## Manual Commands

If you prefer to manage firewalld manually:

```bash
# Check current zone
firewall-cmd --get-default-zone

# Open game ports (runtime)
sudo firewall-cmd --zone=FedoraWorkstation --add-port=16261/udp
sudo firewall-cmd --zone=FedoraWorkstation --add-port=16262/udp

# Close game ports (runtime)
sudo firewall-cmd --zone=FedoraWorkstation --remove-port=16261/udp
sudo firewall-cmd --zone=FedoraWorkstation --remove-port=16262/udp

# Open Caddy web ports (runtime)
sudo firewall-cmd --zone=FedoraWorkstation --add-port=80/tcp
sudo firewall-cmd --zone=FedoraWorkstation --add-port=443/tcp

# Check what's open
sudo firewall-cmd --zone=FedoraWorkstation --list-ports

# Make rules permanent (optional — survives reboot)
sudo firewall-cmd --runtime-to-permanent
```

Replace `FedoraWorkstation` with your zone (shown in `.firewall.conf` or `firewall-cmd --get-default-zone`).

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

## Verifying

```bash
# Check if game ports are open in firewalld
sudo firewall-cmd --zone=FedoraWorkstation --query-port=16261/udp
sudo firewall-cmd --zone=FedoraWorkstation --query-port=16262/udp

# Test from another machine
nc -zuv <server-ip> 16261
```
