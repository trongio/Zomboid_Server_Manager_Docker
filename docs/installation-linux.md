# Linux Installation

## Requirements

You need a Linux server (Ubuntu, Debian, Fedora, etc.) with at least **4 GB RAM** (8 GB recommended). Works on both **x86_64** (AMD/Intel) and **ARM64** (Oracle Cloud free tier, Raspberry Pi 5, AWS Graviton, etc.) — architecture is auto-detected.

Install these before you begin:

| # | Dependency | Notes |
|---|-----------|-------|
| 1 | **Git** | Pre-installed on most distros. [Install](https://git-scm.com/downloads/linux) |
| 2 | **Docker Engine** | NOT Docker Desktop. [Install](https://docs.docker.com/engine/install/) |
| 3 | **Docker Compose v2** | Bundled with Docker Engine via official install script |
| 4 | **Make** | Usually pre-installed |
| 5 | **OpenSSL** | Pre-installed on virtually all Linux distros |
| 6 | **curl** | Pre-installed on most distros |

### Quick Docker install (Ubuntu/Debian)

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out and back in after this
```

### Verify Docker Compose

```bash
docker compose version
```

### Install Make (if missing)

```bash
# Ubuntu/Debian
sudo apt install make

# Fedora/RHEL
sudo dnf install make
```

## Step 1 — Clone the repo

```bash
git clone https://github.com/YOUR_ORG/zomboid-manager.git
cd zomboid-manager
```

## Step 2 — Run the setup wizard

```bash
make init
```

This interactive wizard will:
- Ask you for server settings (name, password, max players, RAM)
- Create an admin account for the web dashboard
- Configure HTTPS (domain or self-signed certificate)
- Auto-detect your firewall (ufw / firewalld / manual)
- Generate all `.env` config files
- Create the database volume
- Build and start all Docker containers
- Run database migrations
- Provision your admin account

Just follow the prompts — sensible defaults are provided for everything. Passwords are auto-generated if you press Enter.

## Step 3 — Open game ports

By default the game server ports are **closed**. To let players connect:

```bash
make expose
```

This opens UDP ports 16261-16262 in your firewall. To close them again:

```bash
make hide
```

## Step 4 — Access the admin panel

**Local access** (always available):
```
http://localhost:8000
```

**Remote/public access** via HTTPS:
```bash
make admin-expose
```

Log in with the admin credentials you set during setup.

## Step 5 — Connect in-game

In Project Zomboid:
1. Click **Join** from the main menu
2. Enter your server's public IP and port `16261`
3. Enter the server password (if you set one)

To find your server's public IP:
```bash
make info
```
