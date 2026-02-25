# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Project Zomboid managed dedicated server for the Georgian gaming community. Dockerized PZ game server with a Laravel REST API for remote management (RCON bridge, config editing, mod management, player admin). Web dashboard via Blade + Livewire in the same app. Free-to-play launch with monetization architecture built in for later stages.

## Tech Stack

- **Framework:** Laravel 12 (PHP 8.3)
- **Database:** PostgreSQL 16, Eloquent ORM, Laravel migrations
- **RCON:** Custom PHP Source RCON client (TCP socket, `ext-sockets`)
- **Queue/Cache:** Redis, Laravel Queue, Laravel Scheduler
- **Docker Control:** Docker Engine API via HTTP to Unix socket
- **Testing:** Pest PHP
- **API Docs:** Scribe (auto-generated from routes + Form Requests)
- **Web UI (Stage 3):** Blade + Livewire 3 + Tailwind CSS
- **Payments (Stage 4):** Laravel Cashier (Stripe)
- **Containers:** Docker Compose v2

## Commands

```bash
# Full stack
docker compose up -d
docker compose down

# Migrations
docker compose exec app php artisan migrate
docker compose exec app php artisan migrate:rollback

# Tests
docker compose exec app php artisan test                    # all tests
docker compose exec app php artisan test --filter=UnitTest  # single test
docker compose exec app php artisan test --group=rcon       # RCON integration tests (needs live server)

# Queue & Scheduler
docker compose exec app php artisan queue:work --tries=3
docker compose exec app php artisan schedule:run

# API docs
docker compose exec app php artisan scribe:generate

# Cache
docker compose exec app php artisan config:clear && php artisan cache:clear
```

## Architecture

Four Docker services in `docker-compose.yml`:

1. **game-server** — PZ dedicated server (SteamCMD image). Ports 16261-16262/udp exposed to host. RCON on 27015/tcp internal only.
2. **app** — Laravel (PHP-FPM + Nginx or FrankenPHP). Mounts Docker socket for container lifecycle control. Mounts PZ data volumes for config/save file access. Connects to game server via RCON over internal Docker network.
3. **db** — PostgreSQL. Internal only.
4. **redis** — Queue driver, cache, rate limiting. Internal only.

The Laravel app is the single control plane wrapping three integration points:
- **RCON** (`Services/RconClient.php`) — Source RCON TCP protocol. Player commands, broadcasts, saves. Singleton in service container.
- **Docker Engine API** (`Services/DockerManager.php`) — HTTP calls to `/var/run/docker.sock`. Start/stop/restart game server container.
- **File I/O** (`Services/ServerIniParser.php`, `Services/SandboxLuaParser.php`) — Read/write PZ config files mounted from game server volume.

## Key Design Constraints

- API must never crash when the game server is offline — return status, not 500s
- RCON port never exposed publicly, only on internal Docker network
- PZ uses **semicolons** (not commas) as list separators in server.ini (`Mods=`, `WorkshopItems=`, `Map=`)
- Config parsers must pass round-trip tests: read → write → read = identical output
- Every admin API action writes to the `audit_logs` table via `AuditLogger` service
- Mod management must keep `WorkshopItems=` and `Mods=` lines in sync (paired entries, semicolon-separated)
- PZ whitelist lives in a SQLite file (`serverPZ.db`), not PostgreSQL — API reads/writes it directly via separate DB connection
- Auth: API key in `X-API-Key` header for Stages 1-2. Sanctum session/token auth added in Stage 3+.

## Implementation Phases

Detailed plan with acceptance criteria in `IMPLEMENTATION_PLAN.md`. Status tracked in the table at the bottom of that file.

**Stage 1 (MVP) — Phases 1–8:** Docker infra, Laravel + RCON, audit DB, server/config/player/mod API endpoints, Pest tests
**Stage 2 — Phases 9–12:** Backup/rollback (Laravel Queue + Scheduler), whitelist CRUD, schema expansion
**Stage 3+ — Phases 13+:** Blade/Livewire web dashboard, Cashier subscriptions, item shop
