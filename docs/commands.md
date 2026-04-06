# Command Reference

All commands are available via `make` (Linux) or `.\make.ps1` (Windows PowerShell).

## Setup

| Linux | Windows | Description |
|-------|---------|-------------|
| `make init` | `.\make.ps1 init` | Interactive first-run setup wizard |
| `make setup` | `.\make.ps1 setup` | Alias for `init` |

## Services

| Linux | Windows | Description |
|-------|---------|-------------|
| `make up` | `.\make.ps1 up` | Start all services |
| `make down` | `.\make.ps1 down` | Stop all services |
| `make build` | `.\make.ps1 build` | Build Docker images |
| `make restart` | `.\make.ps1 restart` | Restart all services |
| `make stop` | `.\make.ps1 stop` | Stop without removing containers |
| `make logs` | `.\make.ps1 logs` | Follow service logs |
| `make ps` | `.\make.ps1 ps` | List running containers |
| `make pull` | `.\make.ps1 pull` | Pull latest images |

## Firewall

| Linux | Windows | Description |
|-------|---------|-------------|
| `make expose` | `.\make.ps1 expose` | Open game ports (UDP 16261-16262) |
| `make hide` | `.\make.ps1 hide` | Close game ports |
| `make admin-expose` | `.\make.ps1 admin-expose` | Open admin HTTPS ports |
| `make admin-hide` | `.\make.ps1 admin-hide` | Close admin HTTPS ports |

Linux auto-detects the firewall backend (firewalld, ufw, or manual). Windows uses Windows Firewall via `netsh`.

## Database

| Linux | Windows | Description |
|-------|---------|-------------|
| `make db-check` | `.\make.ps1 db-check` | Check/create DB volume |
| `make db-init` | `.\make.ps1 db-init` | Create empty DB volume |
| `make db-reset` | `.\make.ps1 db-reset` | Reset DB volume (**danger**) |
| `make db-backup` | `.\make.ps1 db-backup` | Backup database to `db-backups/` |
| `make db-restore` | `.\make.ps1 db-restore` | Restore latest backup |

## App

| Linux | Windows | Description |
|-------|---------|-------------|
| `make migrate` | `.\make.ps1 migrate` | Run database migrations |
| `make test` | `.\make.ps1 test` | Run the test suite |
| `make exec CMD="..."` | `.\make.ps1 exec "..."` | Run command in app container |

### Common exec examples

```bash
# Code formatting
make exec CMD="vendor/bin/pint --dirty --format agent"

# Generate routes
make exec CMD="php artisan wayfinder:generate"

# Frontend build
make exec CMD="npm run build"

# Clear cache
make exec CMD="php artisan config:clear"
```

## Other

| Linux | Windows | Description |
|-------|---------|-------------|
| `make info` | `.\make.ps1 info` | Show URLs, public IP, and firewall status |
| `make arch` | `.\make.ps1 arch` | Show detected CPU architecture |
| `make update-version` | `.\make.ps1 update-version` | Update `game-version.conf` after a PZ game update |
| `make nuke` | `.\make.ps1 nuke` | Destroy ALL data and stop services (**danger**) |
| `make help` | `.\make.ps1 help` | Show all available commands |
