# Project Zomboid Server — Implementation Plan

**Version:** 2.0 | **Updated:** 2026-02-25
**Source:** PZ_Server_Requirements_v1.0.md

---

## Tech Stack Decisions

| Layer | Choice | Justification |
|---|---|---|
| Framework | **Laravel 12 (PHP 8.3)** | Full-stack: API + web dashboard in one codebase. Built-in queues, scheduler, auth, ORM |
| Database | **PostgreSQL 16** | Required by spec. Used for audit logs, users, future payments |
| ORM / Migrations | **Eloquent + Laravel Migrations** | Built-in, zero config, incremental migration strategy |
| RCON Client | **Custom PHP Source RCON** | Source RCON is a simple TCP protocol — ~100 lines of PHP. No external dependency needed |
| Background Jobs | **Laravel Queue (Redis driver)** | Built-in queue system with retries, failed job tracking. Redis also used for rate limiting and cache |
| Task Scheduling | **Laravel Scheduler** | Built-in cron replacement. Backup schedules, subscription checks, cleanup tasks |
| Game Server Image | **Renegade-Master/zomboid-dedicated-server** | Well-maintained, env var config, beta branch support, active community |
| Web Server | **Nginx + PHP-FPM** (in container) or **FrankenPHP** | Standard Laravel deployment. Caddy as reverse proxy in front |
| Reverse Proxy | **Caddy** | Auto TLS, zero-config HTTPS |
| Frontend | **React 19 + Inertia.js v2 + TypeScript** | Client-side SPA with server-side routing via Inertia. No separate API for frontend |
| UI Components | **shadcn/ui + Tailwind CSS v4** | Accessible, composable components. Dark mode, responsive out of the box |
| Route Generation | **Wayfinder** | TypeScript route generation from Laravel routes. Type-safe frontend routing |
| Web Auth | **Fortify** | Session-based auth with 2FA support. Login, register, password reset, email verification |
| API Auth | **Sanctum** | API token auth for external API consumers |
| Testing | **Pest PHP** | Modern, expressive testing. Built on PHPUnit. Laravel integration out of the box |
| Containerization | **Docker Compose v2** | Single-file orchestration as required |
| Docker Control | **Docker Engine API via HTTP** | Call Docker socket (`/var/run/docker.sock`) directly with Laravel HTTP client. No SDK needed |

### Project Structure

```
Zomboid/
├── docker-compose.yml
├── .env.example
├── .env                              # gitignored
├── app/
│   ├── Dockerfile
│   ├── composer.json
│   ├── artisan
│   ├── bootstrap/
│   │   └── app.php                   # Laravel bootstrap
│   ├── config/
│   │   ├── app.php
│   │   ├── database.php
│   │   ├── queue.php
│   │   ├── zomboid.php               # PZ-specific config (paths, RCON, server name)
│   │   └── ...
│   ├── routes/
│   │   ├── api.php                   # REST API routes
│   │   ├── web.php                   # Web dashboard routes (Inertia)
│   │   └── settings.php              # Settings routes
│   ├── app/
│   │   ├── Models/
│   │   │   └── AuditLog.php
│   │   ├── Http/
│   │   │   ├── Controllers/
│   │   │   │   ├── Api/
│   │   │   │   │   ├── ServerController.php
│   │   │   │   │   ├── ConfigController.php
│   │   │   │   │   ├── PlayerController.php
│   │   │   │   │   └── ModController.php
│   │   │   │   └── Settings/         # Settings controllers (Inertia)
│   │   │   ├── Middleware/
│   │   │   │   └── ApiKeyAuth.php
│   │   │   └── Requests/             # Form Request validation
│   │   │       ├── ServerRestartRequest.php
│   │   │       ├── ConfigUpdateRequest.php
│   │   │       └── ModAddRequest.php
│   │   ├── Services/
│   │   │   ├── RconClient.php        # Source RCON TCP client
│   │   │   ├── DockerManager.php     # Docker Engine API via HTTP
│   │   │   ├── ServerIniParser.php   # PZ server.ini read/write
│   │   │   ├── SandboxLuaParser.php  # SandboxVars.lua read/write
│   │   │   ├── ModManager.php        # Mod add/remove/reorder
│   │   │   └── AuditLogger.php       # Audit log service
│   │   ├── Jobs/                     # Queue jobs (Stage 2+)
│   │   ├── Console/
│   │   │   └── Commands/             # Artisan commands
│   │   └── Providers/
│   │       └── AppServiceProvider.php
│   ├── database/
│   │   ├── migrations/
│   │   │   └── 2026_02_25_000001_create_audit_logs_table.php
│   │   ├── factories/
│   │   └── seeders/
│   ├── tests/
│   │   ├── Pest.php
│   │   ├── Unit/
│   │   │   ├── RconClientTest.php
│   │   │   ├── ServerIniParserTest.php
│   │   │   └── SandboxLuaParserTest.php
│   │   └── Feature/
│   │       ├── ServerControlTest.php
│   │       ├── ConfigManagementTest.php
│   │       └── PlayerManagementTest.php
│   ├── resources/
│   │   ├── js/
│   │   │   ├── pages/                # React page components (Inertia)
│   │   │   ├── components/           # Reusable React components
│   │   │   │   └── ui/              # shadcn/ui components
│   │   │   ├── layouts/              # App and auth layouts
│   │   │   ├── hooks/                # Custom React hooks
│   │   │   ├── lib/                  # Utilities
│   │   │   └── types/                # TypeScript types
│   │   └── views/
│   │       └── app.blade.php         # Inertia root template
├── game-server/                      # PZ server config overrides
│   └── .gitkeep
└── backups/                          # Backup storage (Stage 2)
    └── .gitkeep
```

---

## Phase 1 — Docker Infrastructure & Game Server

**Goal:** PZ server running in Docker, connectable by players, auto-restarts on crash.

### Tasks

| # | Task | Details | Verify |
|---|---|---|---|
| 1.1 | Create `.env.example` and `.env` | All config: server name, ports, RCON password, admin password, max players, RAM, Steam branch, mod IDs, API key, DB creds, Redis URL | `.env.example` exists, no secrets in it |
| 1.2 | Write `docker-compose.yml` — game server service | PZ container with volumes, ports, env vars, `restart: unless-stopped`, health check | `docker compose up game-server` starts without errors |
| 1.3 | Write `docker-compose.yml` — app service | Laravel container (Nginx+PHP-FPM or FrankenPHP), depends_on game-server, Docker socket mount, shared volumes for PZ data, internal network for RCON | `docker compose up app` starts without errors |
| 1.4 | Write `docker-compose.yml` — PostgreSQL service | Postgres container with persistent volume, health check | `docker compose up db` starts, psql connects |
| 1.5 | Write `docker-compose.yml` — Redis service | Redis container for queue, cache, rate limiting | `docker compose up redis` starts |
| 1.6 | Configure Docker networking | Internal network for RCON (not exposed), game ports exposed to host, app port exposed to host | RCON port unreachable from host, game ports reachable |
| 1.7 | Test full stack startup | `docker compose up -d`, PZ server initializes, generates config files, is joinable | Connect to server from PZ game client |

### Acceptance Criteria

- [ ] `docker compose up -d` brings up all 4 services (game-server, app, db, redis)
- [ ] PZ game server is reachable on ports 16261-16262/udp
- [ ] RCON port (27015) is only accessible within Docker network
- [ ] Game server auto-restarts if the process crashes
- [ ] Server generates config files on first boot (server.ini, SandboxVars.lua)
- [ ] PostgreSQL and Redis are accessible from the app container

---

## Phase 2 — Laravel Foundation & RCON Client

**Goal:** Laravel boots, connects to RCON, can execute commands against the live PZ server.

### Tasks

| # | Task | Details | Verify |
|---|---|---|---|
| 2.1 | Initialize Laravel 12 project | `composer create-project laravel/laravel`, configure for API: install Sanctum, Scribe. Remove unused frontend scaffolding. | `php artisan serve` works |
| 2.2 | Create `config/zomboid.php` | Config file loading from env: RCON host/port/password, Docker socket path, PZ data paths, server container name, game server name | Config loads correctly from `.env` |
| 2.3 | Create `Services/RconClient.php` | Source RCON implementation: connect via TCP socket, authenticate, send command, read response, handle timeouts, reconnect on failure. Registered as singleton in service container. | Unit test: mock socket, verify protocol bytes |
| 2.4 | Create `Services/DockerManager.php` | HTTP client to Docker Engine API via Unix socket (`/var/run/docker.sock`). Methods: `startContainer()`, `stopContainer()`, `restartContainer()`, `getContainerStatus()`, `getContainerLogs()`. Registered as singleton. | Unit test: mock HTTP responses |
| 2.5 | Create `Http/Middleware/ApiKeyAuth.php` | Check `X-API-Key` header against `config('zomboid.api_key')`. Return 401 JSON on failure. Exclude public routes. Register in `bootstrap/app.php`. | Test: request without key → 401, with key → passes |
| 2.6 | Configure rate limiting | Use Laravel's built-in `RateLimiter` facade in `AppServiceProvider`. Define `api` limiter (60/min auth, 15/min public). | Test: exceed limit → 429 |
| 2.7 | Health check endpoint | `GET /api/health` — returns `{"status": "ok", "rcon": "connected|disconnected", "db": "connected|disconnected"}` | curl returns health JSON |
| 2.8 | Write `app/Dockerfile` | PHP 8.3 + extensions (pdo_pgsql, redis, sockets, pcntl), Composer install, Nginx or FrankenPHP, expose port 8000 | Docker build succeeds, container starts |
| 2.9 | Integration test: RCON against live server | Boot full stack, send `players` command via RCON, verify response | Command returns player list (or empty) |

### Acceptance Criteria

- [ ] Laravel app boots inside Docker container
- [ ] `GET /api/health` returns status JSON
- [ ] RCON client connects to game server and executes `players` command
- [ ] RCON client handles game server being offline gracefully (returns error, doesn't crash)
- [ ] API key auth blocks unauthorized requests with 401
- [ ] Rate limiter returns 429 when threshold exceeded

---

## Phase 3 — Database & Audit Logging

**Goal:** PostgreSQL connected, migrations running, all admin API actions logged to audit_logs.

### Tasks

| # | Task | Details | Verify |
|---|---|---|---|
| 3.1 | Configure PostgreSQL connection | `.env` DB_CONNECTION=pgsql, verify Eloquent connects | `php artisan migrate` runs |
| 3.2 | Create `AuditLog` model + migration | Fields: id (UUID), actor (string), action (string), target (string nullable), details (jsonb nullable), ip_address (string nullable), created_at. Indexes on (action, created_at). | `php artisan migrate` creates table |
| 3.3 | Create `Services/AuditLogger.php` | `log(actor, action, target, details, ip)` — creates AuditLog record. Registered as singleton. Static helper `AuditLogger::record()` for convenience. | Unit test: creates record in DB |
| 3.4 | Create audit middleware | `AuditApiActions` middleware: after response, log admin endpoint calls (method, path, actor from API key, IP, request body summary). Applied to admin route group. | Every admin API call produces an audit_log row |
| 3.5 | `GET /api/audit` endpoint | Paginated audit log. Query params: `action`, `actor`, `from`, `to`, `per_page`. Admin only. Returns via API Resource. | Returns paginated audit entries |

### Acceptance Criteria

- [x] `php artisan migrate` runs without errors on fresh DB
- [x] `php artisan migrate:rollback` rolls back cleanly
- [x] Audit log records created for every admin API call
- [x] Audit log stores: who did what, to what target, with what details, from what IP, when
- [x] `GET /api/audit` returns paginated audit log entries (admin only)

---

## Phase 4 — Server Control Endpoints

**Goal:** Full server lifecycle management via API — start, stop, restart, save, broadcast, status, logs.

### Tasks

| # | Task | Details | Verify |
|---|---|---|---|
| 4.1 | `GET /api/server/status` | DockerManager for container state + RconClient `players` for count + parse server.ini for version/map. Returns: `{online, player_count, players, uptime, version, map, max_players}`. **Public endpoint** (no auth, no audit). | curl returns correct JSON when server is up AND when server is down |
| 4.2 | `POST /api/server/start` | DockerManager `startContainer()`. Return error if already running. Audit log. | Start stopped container, verify it starts |
| 4.3 | `POST /api/server/stop` | RCON `save` → wait 5s → RCON `quit` → DockerManager `stopContainer(timeout: 30)`. Audit log. | Server saves world and shuts down cleanly |
| 4.4 | `POST /api/server/restart` | Accept optional `{countdown, message}` via FormRequest. If countdown: broadcast warning, dispatch delayed restart job. Otherwise immediate save+restart. Audit log. | Restart with countdown, verify server comes back online |
| 4.5 | `POST /api/server/save` | RCON `save`. Return success/failure. Audit log. | Save triggers, world files updated on disk |
| 4.6 | `POST /api/server/broadcast` | Accept `{message}` via FormRequest. RCON `servermsg`. Audit log. | Message appears in-game for connected players |
| 4.7 | `GET /api/server/logs` | DockerManager `getContainerLogs(tail, since)`. Query params: `tail` (int), `since` (timestamp). Return as array of log lines. | Returns last N lines of server output |

### Acceptance Criteria

- [x] All 7 endpoints return correct JSON responses
- [x] `/api/server/status` works without auth and returns accurate data
- [x] `/api/server/status` returns `{"online": false, ...}` when server is down (no 500 error)
- [x] Stop performs graceful save before shutdown
- [x] Restart with countdown broadcasts warning message then restarts
- [x] Every admin endpoint creates an audit_log entry
- [x] All endpoints handle "server offline" case without crashing

---

## Phase 5 — Configuration Management Endpoints

**Goal:** Read and modify server.ini and SandboxVars.lua via API without SSH access.

### Tasks

| # | Task | Details | Verify |
|---|---|---|---|
| 5.1 | Create `Services/ServerIniParser.php` | Read PZ `server.ini` → associative array. Write array → `server.ini`. Handle PZ-specific format (semicolon-separated lists for Mods/WorkshopItems/Map, `=` key-value). Preserve comments and ordering. | Round-trip test: read → write → read produces identical output |
| 5.2 | Create `Services/SandboxLuaParser.php` | Read `SandboxVars.lua` → nested array. Write nested array → valid Lua. Handle nested `SandboxVars = { ... }` structure with typed values (int, float, bool, string). Handle sub-tables like `ZombieLore`. | Round-trip test: read → write → read produces identical output |
| 5.3 | `GET /api/config/server` | Parse server.ini, return as JSON | Returns all server.ini fields as key-value pairs |
| 5.4 | `PATCH /api/config/server` | Accept partial JSON via FormRequest with validation. Update only specified fields. Return `{updated_fields, restart_required: true}`. Audit log with before/after values. | Update MaxPlayers, verify file changed on disk |
| 5.5 | `GET /api/config/sandbox` | Parse SandboxVars.lua, return as nested JSON | Returns all sandbox variables |
| 5.6 | `PATCH /api/config/sandbox` | Accept partial nested JSON via FormRequest. Update sandbox vars. Return `{updated_fields, restart_required: true}`. Audit log with before/after values. | Update ZombieLore.Speed, verify file changed on disk |

### Acceptance Criteria

- [x] INI parser handles PZ's semicolon-separated list format (Mods=, WorkshopItems=, Map=)
- [x] Lua parser handles nested SandboxVars structure including ZombieLore sub-table
- [x] Config reads return valid JSON matching actual file contents
- [x] Config patches update only specified fields, leave others untouched
- [x] All config changes are audit-logged with before/after values
- [x] Response indicates `restart_required: true` when server needs restart

---

## Phase 6 — Player Management Endpoints

**Goal:** Full player admin via API — list, kick, ban, set access levels, teleport, give items.

### Tasks

| # | Task | Details | Verify |
|---|---|---|---|
| 6.1 | `GET /api/players` | RCON `players` → parse into structured array: `[{name, steam_id, access_level}]`. Handle empty server. | Returns player list, empty array when nobody online |
| 6.2 | `GET /api/players/{name}` | RCON commands to get player details. Return 404 if not found. | Returns player details for connected player |
| 6.3 | `POST /api/players/{name}/kick` | Accept `{reason?}`. RCON `kickuser`. Audit log. | Player disconnected |
| 6.4 | `POST /api/players/{name}/ban` | Accept `{reason?, ip_ban?}`. RCON `banuser` (+ `banid` if IP). Audit log. | Player banned |
| 6.5 | `DELETE /api/players/{name}/ban` | RCON `unbanuser`. Audit log. | Player unbanned |
| 6.6 | `POST /api/players/{name}/setaccess` | Accept `{level}` via FormRequest with enum validation. RCON `setaccesslevel`. Audit log. | Access level changed |
| 6.7 | `POST /api/players/{name}/teleport` | Accept `{x, y, z?}` OR `{target_player}`. RCON `teleport` or `teleportto`. Audit log. | Player teleported |
| 6.8 | `POST /api/players/{name}/additem` | Accept `{item_id, count?}`. RCON `additem`. Audit log. | Item in player inventory |
| 6.9 | `POST /api/players/{name}/addxp` | Accept `{skill, amount}`. RCON `addxp`. Audit log. | XP increased |
| 6.10 | `POST /api/players/{name}/godmode` | RCON `godmod` (toggles). Audit log. | Godmode toggled |

### Acceptance Criteria

- [x] Player list returns accurate data matching connected players
- [x] All RCON player commands execute and return confirmation
- [x] Kick/ban include reason in server-side logs
- [x] All player actions are audit-logged
- [x] Endpoints return appropriate errors when player is not online
- [x] `additem` with valid PZ item IDs works (tested with `Base.Axe`)

---

## Phase 7 — Mod Management Endpoints

**Goal:** Add, remove, and list Steam Workshop mods via API.

### Tasks

| # | Task | Details | Verify |
|---|---|---|---|
| 7.1 | Create `Services/ModManager.php` | Parse `Mods=` and `WorkshopItems=` from server.ini (semicolon-separated). Maintain paired list: each mod has (workshop_id, mod_id). Add/remove/reorder. Handle `Map=` for map mods. Uses `ServerIniParser` under the hood. | Unit test: add, remove, reorder operations |
| 7.2 | `GET /api/config/mods` | Return `[{workshop_id, mod_id, position}]` parsed from server.ini | Returns accurate mod list |
| 7.3 | `POST /api/config/mods` | Accept `{workshop_id, mod_id, map_folder?}` via FormRequest. Add to both ini lines. Return `{added, restart_required}`. Audit log. | Mod added, fields in sync |
| 7.4 | `DELETE /api/config/mods/{workshop_id}` | Remove from both lines + `Map=` if present. Return `{removed, restart_required}`. Audit log. | Mod removed, both fields updated |
| 7.5 | `PUT /api/config/mods/order` | Accept full ordered list. Replace both lines. Audit log. | Order matches submitted list |

### Acceptance Criteria

- [x] Mods added appear in both `WorkshopItems=` and `Mods=` with semicolons
- [x] Mods removed are cleaned from both lines
- [x] Mod order can be rearranged for dependency management
- [x] Map mods update the `Map=` field correctly
- [x] After mod changes + restart, mods are downloaded/loaded
- [x] All mod changes are audit-logged

---

## Phase 8 — API Documentation, Testing & MVP Delivery

**Goal:** Complete MVP — tests pass, API docs complete, deployment ready.

### Tasks

| # | Task | Details | Verify |
|---|---|---|---|
| 8.1 | Write unit tests (Pest) | ServerIniParser (round-trip), SandboxLuaParser (round-trip), ModManager (add/remove/reorder), RconClient (mocked), AuditLogger | `php artisan test --filter=Unit` — all pass |
| 8.2 | Write feature tests (Pest) | Full API tests against test database: server, config, player, mod endpoints. Auth checks (401 without key, 200 with). Rate limit check. | `php artisan test --filter=Feature` — all pass |
| 8.3 | Finalize `.env.example` | Document every env var with comments | File covers all config |
| 8.4 | Write `README.md` | Prerequisites, .env config, `docker compose up`, API key setup, connecting to server, API usage examples | Follow README from scratch → running server |
| 8.5 | Generate API docs with Scribe | Install Scribe, annotate controllers, `php artisan scribe:generate`. Verify all endpoints documented with request/response examples. | `/docs` serves complete API documentation |
| 8.6 | End-to-end smoke test | Fresh `docker compose up`, connect PZ client, use every API endpoint, verify audit log | All features work on clean deployment |

### Acceptance Criteria (MVP Complete)

- [ ] **Players can connect and play on the server**
- [ ] **Admin can fully manage the server without SSH — only via API**
- [ ] **Mods can be added/removed and server restarted via API**
- [ ] **Server auto-restarts on crash**
- [ ] All unit tests pass
- [ ] All feature tests pass
- [ ] Scribe API docs are complete and accurate
- [ ] README allows fresh deployment from zero
- [ ] Audit log captures every admin action

---

## Phase 9 — Backup System (Stage 2 Start)

**Goal:** Automated and manual backups with retention policies.

### Tasks

| # | Task | Details | Verify |
|---|---|---|---|
| 9.1 | Add queue worker to docker-compose | Laravel queue worker container (same image, `php artisan queue:work`). Redis already available from Phase 1. | Queue worker starts, processes test job |
| 9.2 | Create `Backup` model + migration | Fields: id (UUID), filename, path, size_bytes, type (enum: manual/scheduled/daily/pre_rollback/pre_update), notes (nullable), created_at | `php artisan migrate` creates table |
| 9.3 | Create `Services/BackupManager.php` | `createBackup(type, notes?)`: RCON save → wait 5s → tar.gz save dir + ini + sandbox + db files → store → record in DB → cleanup per retention. `deleteBackup(id)`: remove file + record. `cleanupRetention(type, keep)`. | Unit test: mocked filesystem, verify logic |
| 9.4 | Create `Jobs/CreateBackupJob.php` | Dispatchable job wrapping `BackupManager::createBackup()`. Used by scheduler and manual trigger. | Job processes successfully |
| 9.5 | `POST /api/backups` | Dispatch `CreateBackupJob` synchronously (manual). Return backup metadata. Audit log. | Creates backup, returns JSON |
| 9.6 | `GET /api/backups` | List all backups. Query params: `type`, `per_page`. Sort by created_at desc. Paginated via API Resource. | Returns paginated list |
| 9.7 | `DELETE /api/backups/{id}` | Delete file + record. Audit log. | File and record removed |
| 9.8 | `GET /api/backups/schedule` | Return current schedule config from `config/zomboid.php` or DB settings. | Returns schedule JSON |
| 9.9 | `PUT /api/backups/schedule` | Update schedule in DB/config. Audit log. | Schedule updated |
| 9.10 | Register scheduled tasks | In `routes/console.php`: hourly `CreateBackupJob` dispatch, daily snapshot dispatch. Both use retention from config. | `php artisan schedule:list` shows backup tasks |

### Acceptance Criteria

- [ ] Manual backup creates valid tar.gz of save directory + config files
- [ ] Backup metadata recorded in PostgreSQL
- [ ] Scheduled backups run automatically (hourly and daily)
- [ ] Retention policy enforced: old backups auto-deleted
- [ ] Backups can be listed, inspected, and deleted via API

---

## Phase 10 — Rollback System

**Goal:** Restore server to any previous backup state with safety backup.

### Tasks

| # | Task | Details | Verify |
|---|---|---|---|
| 10.1 | `POST /api/backups/{id}/rollback` | Accept `{confirm: true}` via FormRequest. Steps: create pre-rollback backup → stop server → extract backup over save dir → start server → audit log. Return result. | Rollback to backup, server comes back with old save |
| 10.2 | Pre-rollback safety backup | `BackupManager::createBackup('pre_rollback')` before any rollback. Retention: keep last 5. | Backup exists after every rollback |
| 10.3 | Rollback validation | Verify backup record exists, file exists on disk, file is valid tar.gz. Return 404/422 on failure. | Invalid/corrupted backup → clear error |

### Acceptance Criteria

- [ ] Rollback stops server, replaces save, restarts server
- [ ] Pre-rollback backup always created before rollback
- [ ] Server comes back online with the rolled-back world state
- [ ] Rollback to non-existent or corrupted backup returns clear error
- [ ] Entire rollback process is audit-logged

---

## Phase 11 — PostgreSQL Schema Expansion & Whitelist

**Goal:** Users table, whitelist sync table, whitelist CRUD against PZ's SQLite db.

### Tasks

| # | Task | Details | Verify |
|---|---|---|---|
| 11.1 | Create `User` model + migration | Fields: id (UUID), steam_id (unique nullable), username (unique), email (unique nullable), password (nullable), role (enum: super_admin/admin/moderator/player), timestamps. Designed for future Sanctum JWT auth. | Migration runs |
| 11.2 | Create `WhitelistEntry` model + migration | Fields: id (UUID), user_id (FK nullable), pz_username, pz_password_hash, synced_at (nullable), active (bool default true), timestamps. | Migration runs |
| 11.3 | Create `Services/WhitelistManager.php` | Read/write PZ's `serverPZ.db` SQLite database (separate SQLite connection in `config/database.php`). Methods: `list()`, `add(username, password)`, `remove(username)`, `exists(username)`, `syncWithPostgres()`. | Unit test: CRUD on test SQLite DB |
| 11.4 | `GET /api/whitelist` | List all whitelisted users from PZ SQLite DB. | Returns entries |
| 11.5 | `POST /api/whitelist` | Accept `{username, password}` via FormRequest. Add to SQLite + record in PostgreSQL. Audit log. | User added, can auth in PZ |
| 11.6 | `DELETE /api/whitelist/{username}` | Remove from SQLite. Mark inactive in PG. Audit log. | User removed |
| 11.7 | `GET /api/whitelist/{username}/status` | Check SQLite. Return `{whitelisted: bool}`. | Correct status |
| 11.8 | `POST /api/whitelist/sync` | Sync PG whitelist_entries with SQLite state. Report discrepancies. Audit log. | Sync completes, mismatches reported |

### Acceptance Criteria

- [ ] Users table supports future JWT/subscription needs
- [ ] Whitelist CRUD operates on PZ's actual SQLite database
- [ ] Adding user → can join when `Open=false`
- [ ] Removing user → denied entry
- [ ] Whitelist sync detects PG/SQLite mismatches
- [ ] All operations are audit-logged

---

## Phase 12 — Stage 2 Testing & Delivery

**Goal:** Complete Stage 2 — backups, rollbacks, whitelist all tested and documented.

### Tasks

| # | Task | Details | Verify |
|---|---|---|---|
| 12.1 | Unit tests for backup system | Backup creation (mocked filesystem), retention cleanup, schedule config | Tests pass |
| 12.2 | Unit tests for whitelist | SQLite CRUD, sync logic | Tests pass |
| 12.3 | Feature tests | Full backup→rollback cycle via API, whitelist add→check→remove cycle | Tests pass |
| 12.4 | Update README | Backup schedule config, whitelist management, new env vars | Docs match features |
| 12.5 | Update Scribe API docs | All new endpoints documented with examples | `php artisan scribe:generate` completes |
| 12.6 | End-to-end test | Backup → play → rollback → verify old state. Whitelist: add → set Open=false → verify access control. | All features verified |

### Acceptance Criteria (Stage 2 Complete)

- [ ] **Backups run on schedule without manual intervention**
- [ ] **Admin can list, create, rollback, delete backups via API**
- [ ] **Pre-rollback safety backup is always created automatically**
- [ ] **Whitelist API works — can add/remove users**
- [ ] All new tests pass
- [ ] Documentation updated

---

## Future Phases (Outlined, Not Detailed)

### Phase 13–15: Web Dashboard (Stage 3)

- React + Inertia pages for all dashboard views (same Laravel app, no separate SPA)
- Public server status page (no auth, Inertia polling for live updates)
- Admin login via Fortify session auth (already scaffolded by starter kit)
- Admin dashboard: player management, config editor, mod manager, backup/rollback UI
- RCON console in browser (React component with polling or SSE)
- Live log streaming (React component with polling)
- shadcn/ui components for all dashboard UI
- Caddy reverse proxy with auto-TLS
- Tailwind CSS v4, responsive design for mobile admin

### Phase 16–18: Subscriptions (Stage 4)

- Laravel Cashier (Stripe) for subscription management
- Player registration with Fortify session auth
- Subscription lifecycle (Cashier handles most of this)
- Auto whitelist sync via Cashier webhook events
- Player portal (React + Inertia pages)
- Admin subscription management page
- Scheduled command for periodic sub status checks

### Phase 19–21: Item Shop (Stage 5)

- Shop item CRUD (Eloquent models + admin React/Inertia UI)
- Player shop page with categories (React + Inertia)
- Stripe payment intents for one-time purchases
- `DeliverItemJob` with retry logic (Laravel Queue with backoff)
- Transaction history
- Admin transaction/delivery management
- Optional PayPal integration

---

## Technical Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **PZ RCON protocol quirks** | Commands may fail silently or return unexpected formats | Build RCON response parser with extensive tests; log raw responses; test every command against live server |
| **PZ server.ini format breaks on parse** | Config parser corrupts file | Round-trip tests (read→write→read = identical); backup ini before any write |
| **SandboxVars.lua nested Lua parsing** | Complex nested structure, non-standard format | Regex-based parser for PZ's specific Lua style (not full Lua AST); round-trip tests |
| **Docker socket security** | App container has root-level Docker access | API key auth, rate limiting, audit logging; never expose Docker socket externally |
| **PZ SQLite DB locking** | Concurrent access from PZ server + API | WAL mode, short transactions, retry on lock; read-only when server is running where possible |
| **Game server OOM / crash loops** | Restart policy causes infinite loop | Docker restart with max-retries; health check with cooldown; API monitors restart count |
| **Backup disk space** | Backups fill disk | Retention policies enforced automatically; disk usage in status endpoint |

---

## Testing Strategy

| Level | What | Tool | When |
|---|---|---|---|
| **Unit** | Config parsers, mod manager, RCON client (mocked), audit service, backup retention | Pest (Unit) | Every commit |
| **Feature** | API endpoints against test DB, auth middleware, rate limiting | Pest (Feature) with RefreshDatabase | Every commit |
| **RCON Integration** | Real RCON commands against live server | Pest (marked `@group rcon`, manual trigger) | Before phase delivery |
| **End-to-End** | Full docker-compose stack, connect game client, use all API endpoints | Manual + scripted curl | Before stage delivery |

### Test Database

- `phpunit.xml` configured with SQLite `:memory:` for fast unit/feature tests
- Separate PostgreSQL database for integration tests if needed
- Each test uses `RefreshDatabase` or `DatabaseTransactions` trait

---

## Deployment

### Initial Setup (Single VPS)

```bash
# 1. Clone repo
git clone <repo> && cd Zomboid

# 2. Configure
cp .env.example .env
# Edit .env with actual values

# 3. Launch
docker compose up -d

# 4. Run migrations
docker compose exec app php artisan migrate

# 5. Verify
curl http://localhost:8000/api/server/status
```

### Updates

```bash
git pull
docker compose build app
docker compose up -d app
docker compose exec app php artisan migrate
```

### Useful Artisan Commands

```bash
# Queue worker (runs in separate container, but for debugging)
php artisan queue:work --tries=3

# Run scheduler manually
php artisan schedule:run

# Clear caches
php artisan config:clear && php artisan cache:clear

# Generate API docs
php artisan scribe:generate
```

### CI/CD (GitHub Actions)

- **On push to main:** Run `php artisan test` (unit + feature)
- **On tag:** Build Docker image, push to registry (optional)
- No auto-deploy to production — manual `docker compose up -d` on VPS

---

## Current Status

| Phase | Status | Notes |
|---|---|---|
| Phase 1 — Docker Infrastructure | DONE | docker-compose.yml, .env.example, networking verified |
| Phase 2 — Laravel + RCON | DONE | React/Inertia starter kit, RconClient, DockerManager, ApiKeyAuth, health endpoint |
| Phase 3 — Database + Audit | DONE | AuditLog model+migration, AuditLogger service, AuditApiActions middleware, GET /api/audit endpoint, 13 tests |
| Phase 4 — Server Control | DONE | 7 endpoints, RestartGameServer job, graceful stop, countdown restart, 22 tests |
| Phase 5 — Config Management | DONE | ServerIniParser, SandboxLuaParser, 4 config endpoints, round-trip tests, 27 tests |
| Phase 6 — Player Management | DONE | 10 endpoints, kick/ban/unban/setaccess/teleport/additem/addxp/godmode, 22 tests |
| Phase 7 — Mod Management | DONE | ModManager service, add/remove/reorder endpoints, paired list sync, 11 tests |
| Phase 8 — MVP Testing & Docs | NOT STARTED | |
| Phase 9 — Backup System | NOT STARTED | |
| Phase 10 — Rollback System | NOT STARTED | |
| Phase 11 — Whitelist + Schema | NOT STARTED | |
| Phase 12 — Stage 2 Delivery | NOT STARTED | |
