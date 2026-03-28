# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Project Zomboid managed dedicated server for the Georgian gaming community. Dockerized PZ game server with a Laravel REST API for remote management (RCON bridge, config editing, mod management, player admin). Web dashboard via React + Inertia.js + shadcn/ui in the same app. Free-to-play launch with monetization architecture built in for later stages.

## Tech Stack

- **Framework:** Laravel 12 (PHP 8.3)
- **Frontend:** React 19 + Inertia.js v2 + TypeScript + Tailwind CSS v4 + shadcn/ui
- **Database:** PostgreSQL 16, Eloquent ORM, Laravel migrations
- **RCON:** Custom PHP Source RCON client (TCP socket, `ext-sockets`)
- **Queue/Cache:** Redis, Laravel Queue, Laravel Scheduler
- **Docker Control:** Docker Engine API via HTTP to Unix socket
- **Auth:** Fortify (web), API key middleware (API), Sanctum (tokens)
- **Testing:** Pest PHP 3
- **Routing:** Wayfinder (TypeScript route generation)
- **Payments (Stage 4):** Laravel Cashier (Stripe)
- **Containers:** Docker Compose v2 with multi-arch support (ARM64 + AMD64)

## Commands

```bash
# Full stack (auto-detects ARM64/AMD64)
make up
make down
make logs
make ps

# Migrations
make migrate
make exec CMD="php artisan migrate:rollback"

# Tests
make test
make exec CMD="php artisan test --filter=UnitTest"
make exec CMD="php artisan test --group=rcon"

# Queue & Scheduler
make exec CMD="php artisan queue:work --tries=3"
make exec CMD="php artisan schedule:run"

# API docs
make exec CMD="php artisan scribe:generate"

# Cache
make exec CMD="php artisan config:clear"

# Code formatting (Pint)
make exec CMD="vendor/bin/pint --dirty --format agent"

# Wayfinder route generation
make exec CMD="php artisan wayfinder:generate"

# Frontend build
make exec CMD="npm run build"

# Check detected architecture
make arch
```

**Important:** All PHP/artisan commands must run inside the Docker container via `make exec CMD="..."`. Never run them directly on the host.

## Architecture

### Docker Compose — Multi-Arch Setup

The stack uses compose overrides for automatic architecture detection:
- `docker-compose.yml` — base config (app, db, redis, networks, volumes, game-server skeleton)
- `docker-compose.arm64.yml` — ARM64 game server (`ghcr.io/joyfui/project-zomboid-server-docker-arm64`) with custom entrypoint + `configure-server.sh`
- `docker-compose.amd64.yml` — AMD64 game server (`renegademaster/zomboid-dedicated-server`) with native env var mapping
- `Makefile` — detects `uname -m` and selects the correct override automatically

### Services

Four Docker services:

1. **game-server** — PZ dedicated server (SteamCMD). Ports 16261-16262/udp exposed to host. RCON on 27015/tcp internal only. Image varies by architecture.
2. **app** — Laravel (PHP-FPM + Nginx). Mounts Docker socket for container lifecycle control. Mounts PZ data volumes for config/save file access. Connects to game server via RCON over internal Docker network.
3. **db** — PostgreSQL. Internal only.
4. **redis** — Queue driver, cache, rate limiting. Internal only.

### Integration Points

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
- Auth: API key in `X-API-Key` header for API endpoints. Fortify session auth for web dashboard. Sanctum for API tokens.
- **Atomic shop operations (deliver-then-debit):**
  - **Deposits:** Items removed from inventory → verified removed → wallet credited (items-first)
  - **Purchases:** RCON gives items to online player → wallet debited on confirmation. Lua queue as fallback for offline players.
  - RCON `additem` is the only reliable way to give items in PZ multiplayer (items appear and are fully usable). Lua `inventory:AddItem()` doesn't sync to clients.
  - `wallet_transaction_id` on `shop_purchases` is nullable — starts NULL, set when debit completes
  - `WalletService::getAvailableBalance()` subtracts pending purchase holds to prevent double-spending
  - If debit fails after delivery (rare race), items are rolled back via `removeItem` queue

## Security Conventions

- **CSP with Vite nonces:** `SecurityHeaders` middleware generates a nonce per request via `Vite::useCspNonce()`. Inline scripts in Blade must use `nonce="{{ Vite::cspNonce() }}"`. `style-src 'unsafe-inline'` is required for Tailwind.
- **Rate limiting:** Three tiers — `admin` (60/min general), `admin-sensitive` (10/min for kick/ban/password/RCON/server control), `admin-destructive` (2/min for wipe). Sensitive routes stack both admin + admin-sensitive limiters.
- **Trusted proxies:** Restricted to RFC 1918 ranges (`127.0.0.1`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) in `bootstrap/app.php`. Update if deploying behind a cloud LB with public IPs.
- **Form Requests:** All admin controller methods must use Form Request classes — no inline `$request->validate()`. Omit `authorize()` method (defaults to `true`); routes are already behind `auth + admin` middleware.
- **Audit log filtering:** `AuditApiActions` middleware excludes sensitive fields via denylist (`password`, `api_key`, `token`, `secret`, `current_password`, `two_factor_*`). Add new sensitive fields to this list.
- **Entrypoint validation:** `app/docker/entrypoint.sh` fails fast if `DB_PASSWORD`, `PZ_RCON_PASSWORD`, `ADMIN_PASSWORD`, or `PZ_ADMIN_PASSWORD` are empty.
- **Health endpoint:** `/api/health` is public (returns `status` only), `/api/health/detailed` requires API key (returns rcon/db details).
- **Route patterns:** Defined in `AppServiceProvider::boot()` (not `bootstrap/app.php`). Patterns: `name` and `username` = `[a-zA-Z0-9_]{1,50}`.

## Implementation Phases

Detailed plan with acceptance criteria in `IMPLEMENTATION_PLAN.md`. Status tracked in the table at the bottom of that file.

**Stage 1 (MVP) — Phases 1–8:** Docker infra, Laravel + RCON, audit DB, server/config/player/mod API endpoints, Pest tests
**Stage 2 — Phases 9–12:** Backup/rollback (Laravel Queue + Scheduler), whitelist CRUD, schema expansion
**Stage 3 — Phases 13–15:** React/Inertia web dashboard
**Stage 4 — Phases 16–21:** User registration + PZ sync, config UX, Lua bridge mod, player map, inventory management, UX polish
**Final Stages:** Cashier subscriptions, item shop (monetization deferred to end)

## Package Versions

- php 8.3, laravel/framework v12, inertiajs/inertia-laravel v2, laravel/fortify v1
- laravel/wayfinder v0, laravel/pint v1, pestphp/pest v3, phpunit/phpunit v11
- @inertiajs/react v2, react v19, tailwindcss v4, eslint v9, prettier v3

## Laravel Conventions

### PHP
- Always use curly braces for control structures, even for single-line bodies
- Use PHP 8 constructor property promotion: `public function __construct(public GitHub $github) { }`
- Always use explicit return type declarations and type hints
- Enum keys should be TitleCase
- Prefer PHPDoc blocks over inline comments

### Database & Eloquent
- Prefer `Model::query()` over `DB::` facade
- Use eager loading to prevent N+1 query problems
- Use Eloquent API Resources for API responses
- When modifying a column in migration, include ALL previously defined attributes
- Casts should use `casts()` method on models (not `$casts` property)

### Controllers & Validation
- Create Form Request classes for validation (not inline in controllers)
- Use `php artisan make:` commands to create new files, pass `--no-interaction`
- Use environment variables only in config files — never `env()` directly outside config

### Testing (Pest)
- Create tests: `php artisan make:test --pest {name}`, `--unit` for unit tests
- Run tests: `php artisan test --compact` or `--filter=testName`
- Use factories for model creation in tests
- Do NOT delete tests without approval

### Code Formatting
- Run `make exec CMD="vendor/bin/pint --dirty --format agent"` after modifying PHP files

### Inertia.js v2
- Components live in `resources/js/pages`
- Use `Inertia::render()` for server-side routing
- v2 features: deferred props, infinite scroll, merging props, polling, prefetching
- When using deferred props, add skeleton/loading state

### Wayfinder
- Import from `@/actions/` (controllers) or `@/routes/` (named routes)
- Use `.form()` with `<Form>` component or `form.submit(store())` with useForm

### HTTP Method Spoofing
- `fetchAction` (in `resources/js/lib/fetch-action.ts`) sends PUT/PATCH/DELETE as POST with `X-HTTP-Method-Override` header
- Symfony/Laravel does NOT read `_method` from JSON request bodies — only from form-encoded POST data or query strings
- Always use `X-HTTP-Method-Override` header for method spoofing with JSON requests, never rely on `_method` in the JSON body alone

### General
- Follow existing code conventions — check sibling files for structure and naming
- Check for existing components to reuse before writing new ones
- Stick to existing directory structure; don't create new base folders without approval
- Do not change dependencies without approval
