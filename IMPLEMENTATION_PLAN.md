# Project Zomboid Server — Implementation Plan

**Version:** 1.0 | **Created:** 2026-02-25
**Source:** PZ_Server_Requirements_v1.0.md

---

## Tech Stack Decisions

| Layer | Choice | Justification |
|---|---|---|
| REST API | **FastAPI (Python 3.12)** | Async-native, auto OpenAPI/Swagger, excellent for RCON socket work, Pydantic validation |
| Database | **PostgreSQL 16** | Required by spec. Used for audit logs, users, future payments |
| ORM / Migrations | **SQLAlchemy 2.0 + Alembic** | Mature async support, type-safe models, incremental migration strategy |
| RCON Client | **rcon.py** (`rcon` PyPI package) | Pure Python, async-compatible, Source RCON protocol (PZ uses this) |
| Background Jobs | **APScheduler** (Phase 1), **Celery + Redis** (Phase 2+) | APScheduler avoids Redis dependency for MVP; Celery added when scheduled backups arrive |
| Game Server Image | **Renegade-Master/zomboid-dedicated-server** | Well-maintained, env var config, beta branch support, active community |
| Reverse Proxy | **Caddy** | Auto TLS, zero-config HTTPS, simpler than nginx+certbot |
| Frontend (Phase 3) | **Vue 3 + Vite + Tailwind** | Deferred — not needed until Phase 3 |
| Containerization | **Docker Compose v2** | Single-file orchestration as required |

### Project Structure

```
Zomboid/
├── docker-compose.yml
├── .env.example
├── .env                          # gitignored
├── api/
│   ├── Dockerfile
│   ├── pyproject.toml
│   ├── alembic.ini
│   ├── alembic/
│   │   └── versions/
│   ├── app/
│   │   ├── main.py               # FastAPI app factory
│   │   ├── config.py             # Settings via pydantic-settings
│   │   ├── dependencies.py       # Shared deps (db session, auth, rcon client)
│   │   ├── models/               # SQLAlchemy models
│   │   │   ├── __init__.py
│   │   │   └── audit_log.py
│   │   ├── schemas/              # Pydantic request/response schemas
│   │   │   ├── __init__.py
│   │   │   ├── server.py
│   │   │   ├── config.py
│   │   │   ├── players.py
│   │   │   └── mods.py
│   │   ├── routers/              # API route handlers
│   │   │   ├── __init__.py
│   │   │   ├── server.py
│   │   │   ├── config.py
│   │   │   ├── players.py
│   │   │   └── mods.py
│   │   ├── services/             # Business logic
│   │   │   ├── __init__.py
│   │   │   ├── rcon_client.py    # RCON connection management
│   │   │   ├── docker_manager.py # Docker container control
│   │   │   ├── config_parser.py  # INI/Lua file read/write
│   │   │   ├── mod_manager.py    # Mod add/remove/reorder
│   │   │   └── audit.py          # Audit logging service
│   │   └── middleware/
│   │       ├── __init__.py
│   │       ├── auth.py           # API key validation
│   │       └── rate_limit.py     # Rate limiting
│   └── tests/
│       ├── conftest.py
│       ├── test_rcon_client.py
│       ├── test_config_parser.py
│       ├── test_server_routes.py
│       └── test_player_routes.py
├── game-server/                  # PZ server config overrides (mounted into container)
│   └── .gitkeep
├── backups/                      # Backup storage (Phase 2)
│   └── .gitkeep
└── frontend/                     # Vue 3 app (Phase 3)
    └── .gitkeep
```

---

## Phase 1 — Docker Infrastructure & Game Server

**Goal:** PZ server running in Docker, connectable by players, auto-restarts on crash.

### Tasks

| # | Task | Details | Verify |
|---|---|---|---|
| 1.1 | Create `.env.example` and `.env` | All config: server name, ports, RCON password, admin password, max players, RAM, Steam branch, mod IDs, API key | `.env.example` exists, no secrets in it |
| 1.2 | Write `docker-compose.yml` — game server service | PZ container with volumes, ports, env vars, `restart: unless-stopped`, health check | `docker compose up game-server` starts without errors |
| 1.3 | Write `docker-compose.yml` — API service | FastAPI container, depends_on game-server, Docker socket mount, shared volumes for PZ data, internal network for RCON | `docker compose up api` starts without errors |
| 1.4 | Write `docker-compose.yml` — PostgreSQL service | Postgres container with persistent volume, health check | `docker compose up db` starts, psql connects |
| 1.5 | Configure Docker networking | Internal network for RCON (not exposed), game ports exposed to host, API port exposed to host | RCON port unreachable from host, game ports reachable |
| 1.6 | Test full stack startup | `docker compose up -d`, PZ server initializes, generates config files, is joinable | Connect to server from PZ game client |

### Acceptance Criteria

- [ ] `docker compose up -d` brings up all 3 services (game-server, api, db)
- [ ] PZ game server is reachable on ports 16261-16262/udp
- [ ] RCON port (27015) is only accessible within Docker network
- [ ] Game server auto-restarts if the process crashes
- [ ] Server generates config files on first boot (server.ini, SandboxVars.lua)
- [ ] PostgreSQL is accessible from the API container

---

## Phase 2 — FastAPI Foundation & RCON Client

**Goal:** API boots, connects to RCON, can execute commands against the live PZ server.

### Tasks

| # | Task | Details | Verify |
|---|---|---|---|
| 2.1 | Initialize Python project | `pyproject.toml` with FastAPI, uvicorn, SQLAlchemy, alembic, rcon, docker, pydantic-settings, httpx | `pip install -e .` succeeds |
| 2.2 | Create `app/config.py` | Pydantic Settings class loading from env: DB URL, RCON host/port/password, API key, Docker socket path, PZ data paths | Settings load correctly from `.env` |
| 2.3 | Create `app/main.py` | FastAPI app factory with lifespan (startup/shutdown), CORS, OpenAPI metadata | `GET /docs` returns Swagger UI |
| 2.4 | Create `app/services/rcon_client.py` | Singleton RCON manager: connect, disconnect, reconnect on failure, execute command with timeout, connection health check | Unit test: mock RCON, verify command/response |
| 2.5 | Create `app/services/docker_manager.py` | Docker SDK client: start/stop/restart container by name, get container status/logs, health check | Unit test: mock Docker client |
| 2.6 | Create `app/middleware/auth.py` | API key auth dependency: check `X-API-Key` header against configured key, skip for public endpoints | Test: request without key → 401, with key → passes |
| 2.7 | Create `app/middleware/rate_limit.py` | Simple in-memory rate limiter (SlowAPI or custom) for public endpoints | Test: exceed limit → 429 |
| 2.8 | Write `api/Dockerfile` | Python 3.12 slim, install deps, run uvicorn, expose port 8000 | Docker build succeeds, container starts |
| 2.9 | Integration test: RCON against live server | Boot full stack, send `players` command via RCON, verify response | Command returns player list (or empty) |

### Acceptance Criteria

- [ ] `GET /docs` serves interactive Swagger UI
- [ ] `GET /health` returns `{"status": "ok"}` (API health check)
- [ ] RCON client connects to game server and executes `players` command
- [ ] RCON client handles game server being offline gracefully (returns error, doesn't crash)
- [ ] API key auth blocks unauthorized requests with 401
- [ ] Rate limiter returns 429 when threshold exceeded

---

## Phase 3 — Database & Audit Logging

**Goal:** PostgreSQL connected, migrations running, all API actions logged to audit_log.

### Tasks

| # | Task | Details | Verify |
|---|---|---|---|
| 3.1 | Create SQLAlchemy async engine setup | `app/dependencies.py` — async session factory, `get_db` dependency | Session creates and closes correctly |
| 3.2 | Create `models/audit_log.py` | AuditLog model: id (UUID), actor (str), action (str), target (str), details (JSONB), ip_address (str), created_at (timestamptz) | Model maps to table correctly |
| 3.3 | Initialize Alembic | `alembic init`, configure for async, point at models | `alembic revision --autogenerate` creates migration |
| 3.4 | Create initial migration | `audit_log` table with indexes on (action, created_at) | `alembic upgrade head` creates table in Postgres |
| 3.5 | Create `services/audit.py` | `log_action(actor, action, target, details, ip)` — writes to audit_log table | Unit test: creates record in DB |
| 3.6 | Add audit middleware/dependency | FastAPI dependency that auto-logs admin endpoint calls (method, path, actor, IP) | Every admin API call produces an audit_log row |

### Acceptance Criteria

- [ ] `alembic upgrade head` runs without errors on fresh DB
- [ ] `alembic downgrade -1` rolls back cleanly
- [ ] Audit log records created for every admin API call
- [ ] Audit log stores: who did what, to what target, with what details, from what IP, when
- [ ] `GET /api/audit` returns paginated audit log entries (admin only)

---

## Phase 4 — Server Control Endpoints

**Goal:** Full server lifecycle management via API — start, stop, restart, save, broadcast, status, logs.

### Tasks

| # | Task | Details | Verify |
|---|---|---|---|
| 4.1 | `GET /api/server/status` | Query Docker for container state + RCON `players` for count + parse server.ini for version/map. Returns: `{online, player_count, players, uptime, version, map, max_players}`. **Public endpoint** (no auth). | curl returns correct JSON when server is up AND when server is down |
| 4.2 | `POST /api/server/start` | Docker SDK `container.start()`. Return error if already running. Audit log. | Start stopped container, verify it starts |
| 4.3 | `POST /api/server/stop` | RCON `save` → wait 5s → RCON `quit` → Docker `container.stop(timeout=30)`. Audit log. | Server saves world and shuts down cleanly |
| 4.4 | `POST /api/server/restart` | Accept optional `{countdown: int, message: str}`. If countdown: broadcast warning message, wait, then save+restart. Audit log. | Restart with countdown, verify server comes back online |
| 4.5 | `POST /api/server/save` | RCON `save`. Return success/failure. Audit log. | Save triggers, world files updated on disk |
| 4.6 | `POST /api/server/broadcast` | Accept `{message: str}`. RCON `servermsg`. Audit log. | Message appears in-game for connected players |
| 4.7 | `GET /api/server/logs` | Read Docker container logs with `tail` and `since` query params. Return as array of log lines. Paginated. | Returns last N lines of server output |

### Acceptance Criteria

- [ ] All 7 endpoints return correct JSON responses
- [ ] `/api/server/status` works without auth and returns accurate data
- [ ] `/api/server/status` returns `{"online": false, ...}` when server is down (no 500 error)
- [ ] Stop performs graceful save before shutdown
- [ ] Restart with countdown broadcasts warning message then restarts
- [ ] Every admin endpoint creates an audit_log entry
- [ ] All endpoints handle "server offline" case without crashing

---

## Phase 5 — Configuration Management Endpoints

**Goal:** Read and modify server.ini and SandboxVars.lua via API without SSH access.

### Tasks

| # | Task | Details | Verify |
|---|---|---|---|
| 5.1 | Create `services/config_parser.py` — INI parser | Read PZ `server.ini` → dict. Write dict → `server.ini`. Handle PZ-specific format (semicolon-separated lists, `=` key-value). Preserve comments and ordering. | Round-trip test: read → write → read produces identical output |
| 5.2 | Create `services/config_parser.py` — Lua parser | Read `SandboxVars.lua` → nested dict. Write nested dict → valid Lua. Handle nested `SandboxVars = { ... }` structure with typed values (int, float, bool, string). | Round-trip test: read → write → read produces identical output |
| 5.3 | `GET /api/config/server` | Parse server.ini, return as JSON object | Returns all server.ini fields as key-value pairs |
| 5.4 | `PATCH /api/config/server` | Accept partial JSON, update only specified fields in server.ini. Validate known field names. Return `{updated_fields, restart_required: true}`. Audit log. | Update MaxPlayers, verify file changed on disk |
| 5.5 | `GET /api/config/sandbox` | Parse SandboxVars.lua, return as nested JSON | Returns all sandbox variables |
| 5.6 | `PATCH /api/config/sandbox` | Accept partial nested JSON, update sandbox vars. Return `{updated_fields, restart_required: true}`. Audit log. | Update ZombieLore.Speed, verify file changed on disk |

### Acceptance Criteria

- [ ] INI parser handles PZ's semicolon-separated list format (Mods=, WorkshopItems=, Map=)
- [ ] Lua parser handles nested SandboxVars structure including ZombieLore sub-table
- [ ] Config reads return valid JSON matching actual file contents
- [ ] Config patches update only specified fields, leave others untouched
- [ ] All config changes are audit-logged with before/after values
- [ ] Response indicates `restart_required: true` when server needs restart for changes to take effect

---

## Phase 6 — Player Management Endpoints

**Goal:** Full player admin via API — list, kick, ban, set access levels, teleport, give items.

### Tasks

| # | Task | Details | Verify |
|---|---|---|---|
| 6.1 | `GET /api/players` | RCON `players` command → parse response into structured list: `[{name, steam_id, access_level}]`. Handle empty server. | Returns player list, empty array when nobody online |
| 6.2 | `GET /api/players/{name}` | RCON commands to get player details. Parse available info. Return 404 if player not found. | Returns player details for connected player |
| 6.3 | `POST /api/players/{name}/kick` | Accept `{reason?: str}`. RCON `kickuser {name} -r "{reason}"`. Audit log. | Player disconnected from server |
| 6.4 | `POST /api/players/{name}/ban` | Accept `{reason?: str, ip_ban?: bool}`. RCON `banuser {name}` (and `banid` if IP ban). Audit log. | Player banned, cannot rejoin |
| 6.5 | `DELETE /api/players/{name}/ban` | RCON `unbanuser {name}`. Audit log. | Player can rejoin server |
| 6.6 | `POST /api/players/{name}/setaccess` | Accept `{level: "admin"|"moderator"|"overseer"|"gm"|"observer"|"none"}`. RCON `setaccesslevel {name} {level}`. Audit log. | Player access level changed |
| 6.7 | `POST /api/players/{name}/teleport` | Accept `{x: int, y: int, z?: int}` OR `{target_player: str}`. RCON `teleport {name} {x},{y},{z}` or `teleportto {name} {target}`. Audit log. | Player teleported |
| 6.8 | `POST /api/players/{name}/additem` | Accept `{item_id: str, count?: int}`. RCON `additem {name} {item_id} {count}`. Audit log. | Item appears in player inventory |
| 6.9 | `POST /api/players/{name}/addxp` | Accept `{skill: str, amount: int}`. RCON `addxp {name} {skill}={amount}`. Validate skill names. Audit log. | Player XP increased |
| 6.10 | `POST /api/players/{name}/godmode` | RCON `godmod {name}` (toggles). Audit log. | Godmode toggled for player |

### Acceptance Criteria

- [ ] Player list returns accurate data matching connected players
- [ ] All RCON player commands execute successfully and return confirmation
- [ ] Kick/ban include reason in server-side logs
- [ ] All player actions are audit-logged with player name and action details
- [ ] Endpoints return appropriate errors when player is not online (where applicable)
- [ ] `additem` with valid PZ item IDs works (tested with e.g. `Base.Axe`)

---

## Phase 7 — Mod Management Endpoints

**Goal:** Add, remove, and list Steam Workshop mods via API. Server restart triggered when needed.

### Tasks

| # | Task | Details | Verify |
|---|---|---|---|
| 7.1 | Create `services/mod_manager.py` | Parse `Mods=` and `WorkshopItems=` from server.ini (semicolon-separated). Maintain paired list: each mod has (workshop_id, mod_id). Add/remove/reorder operations. Handle `Map=` for map mods. | Unit test: add, remove, reorder operations on parsed mod lists |
| 7.2 | `GET /api/config/mods` | Return `[{workshop_id, mod_id, position}]` parsed from current server.ini | Returns accurate mod list |
| 7.3 | `POST /api/config/mods` | Accept `{workshop_id: str, mod_id: str, map_folder?: str}`. Add to both `WorkshopItems=` and `Mods=` lines (semicolon-separated). If `map_folder` provided, add to `Map=`. Return `{added: true, restart_required: true}`. Audit log. | Mod added to ini, fields in sync |
| 7.4 | `DELETE /api/config/mods/{workshop_id}` | Remove from both `WorkshopItems=` and `Mods=`. Remove from `Map=` if present. Return `{removed: true, restart_required: true}`. Audit log. | Mod removed from ini, both fields updated |
| 7.5 | `PUT /api/config/mods/order` | Accept `[{workshop_id, mod_id}]` — full ordered list. Replace both `Mods=` and `WorkshopItems=` with new order. For dependency management. Audit log. | Mod order in ini matches submitted order |

### Acceptance Criteria

- [ ] Mods added via API appear in both `WorkshopItems=` and `Mods=` lines with semicolons
- [ ] Mods removed via API are cleaned from both lines
- [ ] Mod order can be rearranged for dependency management
- [ ] Map mods update the `Map=` field correctly
- [ ] After mod changes, server restart results in mods being downloaded/loaded
- [ ] All mod changes are audit-logged

---

## Phase 8 — Documentation, Testing & MVP Delivery

**Goal:** Complete MVP polish — tests pass, docs complete, deployment ready.

### Tasks

| # | Task | Details | Verify |
|---|---|---|---|
| 8.1 | Write unit tests | Config parser (INI + Lua round-trip), mod manager (add/remove/reorder), RCON client (mocked), audit logging | `pytest` — all pass, coverage ≥ 80% on services/ |
| 8.2 | Write integration tests | Full API tests against test database: server endpoints, config endpoints, player endpoints, mod endpoints. Auth checks. | `pytest` — all pass |
| 8.3 | Finalize `.env.example` | Document every env var with comments | File exists, covers all config |
| 8.4 | Write `README.md` | Setup instructions: prerequisites, .env config, `docker compose up`, API key setup, connecting to server | Can follow README from scratch to running server |
| 8.5 | Verify OpenAPI spec | Ensure `/docs` is complete with all endpoints, request/response schemas, auth requirements | Swagger UI shows all endpoints with schemas |
| 8.6 | End-to-end smoke test | Fresh `docker compose up`, connect PZ client, use every API endpoint, verify audit log | All features work on clean deployment |

### Acceptance Criteria (MVP Complete)

- [ ] **Players can connect and play on the server**
- [ ] **Admin can fully manage the server without SSH — only via API**
- [ ] **Mods can be added/removed and server restarted via API**
- [ ] **Server auto-restarts on crash**
- [ ] All unit tests pass with ≥ 80% coverage on services/
- [ ] All integration tests pass
- [ ] OpenAPI/Swagger docs are complete and accurate
- [ ] README allows fresh deployment from zero
- [ ] Audit log captures every admin action

---

## Phase 9 — Backup System (Stage 2 Start)

**Goal:** Automated and manual backups with retention policies.

### Tasks

| # | Task | Details | Verify |
|---|---|---|---|
| 9.1 | Add Redis + Celery to docker-compose | Redis container, Celery worker in API container (or separate). Beat scheduler for periodic tasks. | Celery worker starts, processes test task |
| 9.2 | Create `models/backup.py` | Backup model: id (UUID), filename, path, size_bytes, backup_type (manual/scheduled/pre_rollback/pre_update), notes, created_at | Migration creates table |
| 9.3 | Alembic migration for backups table | Add `backups` table | `alembic upgrade head` succeeds |
| 9.4 | Create `services/backup_manager.py` | `create_backup()`: RCON save → wait 5s → tar.gz save dir + ini + sandbox + db files → store → record in DB → cleanup old backups. Configurable retention per type. | Backup file created, DB record exists, old backups cleaned |
| 9.5 | `POST /api/backups` | Manual backup trigger. Returns backup metadata. Audit log. | Creates backup, returns JSON with id/filename/size |
| 9.6 | `GET /api/backups` | List all backups. Query params: `type`, `limit`, `offset`. Sort by created_at desc. | Returns paginated backup list |
| 9.7 | `DELETE /api/backups/{id}` | Delete backup file + DB record. Audit log. | File removed, record removed |
| 9.8 | `GET /api/backups/schedule` | Return current schedule config (from settings/DB). | Returns schedule JSON |
| 9.9 | `PUT /api/backups/schedule` | Update schedule: hourly interval, daily time, retention counts per type. Restart Celery Beat to apply. Audit log. | Schedule updated, next backup runs at new interval |
| 9.10 | Celery Beat scheduled tasks | Hourly backup task, daily snapshot task. Both respect retention policy. | Backups appear on schedule |

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
| 10.1 | `POST /api/backups/{id}/rollback` | Accept `{confirm: true}` (require explicit confirmation). Steps: create pre-rollback backup → stop server → extract backup over save dir → start server → audit log. Return rollback result. | Rollback to backup, server comes back with old save |
| 10.2 | Pre-rollback safety backup | Automatic backup of current state before any rollback. Tagged as `pre_rollback` type. | Pre-rollback backup exists after every rollback |
| 10.3 | Rollback validation | Verify backup file exists and is valid tar.gz before proceeding. Verify backup was for same server name. | Invalid backup ID → 404, corrupted file → error |

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
| 11.1 | Create `models/user.py` | User model: id (UUID), steam_id (unique, nullable), username (unique), email (unique, nullable), password_hash (nullable), role (enum: super_admin/admin/moderator/player), created_at, updated_at. Design for future JWT auth. | Model maps correctly |
| 11.2 | Create `models/whitelist_sync.py` | WhitelistSync model: id (UUID), user_id (FK nullable), pz_username, pz_password_hash, synced_at, active (bool). Links optional user to PZ whitelist entry. | Model maps correctly |
| 11.3 | Alembic migration | Add `users` and `whitelist_sync` tables. Add indexes. | `alembic upgrade head` succeeds |
| 11.4 | Create `services/whitelist_manager.py` | Read/write PZ's `serverPZ.db` SQLite database. List whitelisted users. Add user (username + password → hashed). Remove user. The PZ server uses this DB for `Open=false` mode. | Unit test: CRUD operations on test SQLite DB |
| 11.5 | `GET /api/whitelist` | List all whitelisted users from PZ SQLite DB. | Returns whitelist entries |
| 11.6 | `POST /api/whitelist` | Accept `{username: str, password: str}`. Add to PZ SQLite DB. Optionally link to PostgreSQL user record. Audit log. | User added, can authenticate in PZ |
| 11.7 | `DELETE /api/whitelist/{username}` | Remove from PZ SQLite DB. Mark inactive in whitelist_sync. Audit log. | User removed from whitelist |
| 11.8 | `GET /api/whitelist/{username}/status` | Check if user exists in PZ SQLite DB. Return `{whitelisted: bool}`. | Correct status returned |
| 11.9 | `POST /api/whitelist/sync` | Sync PG whitelist_sync table with actual PZ SQLite DB state. Report discrepancies. (Later used with subscriptions.) Audit log. | Sync completes, discrepancies reported |

### Acceptance Criteria

- [ ] Users table created with fields supporting future JWT/subscription needs
- [ ] Whitelist CRUD operates on PZ's actual SQLite database
- [ ] Adding user to whitelist → that user can join when server is in `Open=false` mode
- [ ] Removing user → they are denied entry
- [ ] Whitelist sync detects and reports PG/SQLite mismatches
- [ ] All whitelist operations are audit-logged

---

## Phase 12 — Stage 2 Testing & Delivery

**Goal:** Complete Stage 2 — backups, rollbacks, whitelist all tested and documented.

### Tasks

| # | Task | Details | Verify |
|---|---|---|---|
| 12.1 | Unit tests for backup system | Backup creation (mocked tar), retention cleanup, schedule config | Tests pass |
| 12.2 | Unit tests for whitelist | SQLite CRUD, sync logic | Tests pass |
| 12.3 | Integration tests | Full backup→rollback cycle via API, whitelist add→check→remove cycle | Tests pass |
| 12.4 | Update README | Backup schedule configuration, whitelist management, new env vars | Docs match features |
| 12.5 | Update OpenAPI spec | All new endpoints documented | Swagger UI complete |
| 12.6 | End-to-end test | Full cycle: backup → play → rollback → verify old state restored. Whitelist: add user → set Open=false → verify only whitelisted user can join. | All features verified |

### Acceptance Criteria (Stage 2 Complete)

- [ ] **Backups run on schedule without manual intervention**
- [ ] **Admin can list, create, rollback, delete backups via API**
- [ ] **Pre-rollback safety backup is always created automatically**
- [ ] **Whitelist API works — can add/remove users**
- [ ] All new tests pass
- [ ] Documentation updated

---

## Future Phases (Outlined, Not Detailed)

### Phase 13–15: Web Frontend (Stage 3)

- Vue 3 + Vite + Tailwind project setup
- Public server status page (no auth)
- Admin login with JWT auth (add to API)
- Admin dashboard: player management, config editor, mod manager, backup/rollback UI
- RCON console in browser (WebSocket endpoint on API)
- Live log streaming (WebSocket)
- Caddy reverse proxy with auto-TLS
- Responsive design for mobile admin

### Phase 16–18: Subscriptions (Stage 4)

- Stripe integration with webhook handlers
- Player registration + JWT auth
- Subscription lifecycle management
- Auto whitelist sync on subscription events
- Player portal (subscription status, PZ credentials)
- Admin subscription management page
- Celery cron for periodic sub status checks

### Phase 19–21: Item Shop (Stage 5)

- Shop item CRUD (admin)
- Player shop page with categories
- Stripe payment intents for one-time purchases
- Delivery queue with retry logic (Celery)
- Transaction history
- Admin transaction/delivery management
- Optional PayPal integration

---

## Technical Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **PZ RCON protocol quirks** | Commands may fail silently or return unexpected formats | Build RCON response parser with extensive tests; log raw responses for debugging; test every command against live server |
| **PZ server.ini format breaks on parse** | Config parser corrupts file | Round-trip tests (read→write→read = identical); backup ini before any write; validate parse output |
| **SandboxVars.lua nested Lua parsing** | Complex nested structure, non-standard format | Use regex-based parser for PZ's specific Lua style (not full Lua AST); keep it simple; round-trip tests |
| **Docker socket security** | API container has root-level Docker access | Minimal permissions, API key auth, rate limiting, audit logging; never expose Docker socket externally |
| **PZ SQLite DB locking** | Concurrent access from PZ server + API | Use WAL mode, short transactions, retry on lock; consider reading only when server is stopped for writes |
| **Game server OOM / crash loops** | Restart policy causes infinite crash loop | Docker restart with max-retries; health check with cooldown; API monitors container restart count |
| **Backup disk space** | Backups fill disk | Retention policies enforced automatically; monitor disk usage in status endpoint; configurable max backup count |

---

## Testing Strategy

| Level | What | Tool | When |
|---|---|---|---|
| **Unit** | Config parsers, mod manager, audit service, backup retention logic | pytest + pytest-asyncio | Every PR / before merge |
| **Integration** | API endpoints against test DB, auth middleware, rate limiting | pytest + httpx (TestClient) | Every PR / before merge |
| **RCON Integration** | Real RCON commands against live test server | pytest (marked slow, manual trigger) | Before phase delivery |
| **End-to-End** | Full docker-compose stack, connect game client, use all API endpoints | Manual + scripted curl tests | Before stage delivery |

### Test Database

- Use a separate PostgreSQL database for tests (test container or `_test` suffix)
- Alembic migrations run before test suite
- Each test gets a fresh transaction (rolled back after test)

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

# 4. Verify
curl http://localhost:8000/api/server/status
```

### Updates

```bash
git pull
docker compose build api
docker compose up -d api
```

### CI/CD (GitHub Actions)

- **On push to main:** Run linting (ruff) + unit tests + integration tests
- **On tag:** Build Docker image, push to registry (optional)
- No auto-deploy to production — manual `docker compose up -d` on VPS

---

## Current Status

| Phase | Status | Notes |
|---|---|---|
| Phase 1 — Docker Infrastructure | NOT STARTED | |
| Phase 2 — FastAPI + RCON | NOT STARTED | |
| Phase 3 — Database + Audit | NOT STARTED | |
| Phase 4 — Server Control | NOT STARTED | |
| Phase 5 — Config Management | NOT STARTED | |
| Phase 6 — Player Management | NOT STARTED | |
| Phase 7 — Mod Management | NOT STARTED | |
| Phase 8 — MVP Testing & Docs | NOT STARTED | |
| Phase 9 — Backup System | NOT STARTED | |
| Phase 10 — Rollback System | NOT STARTED | |
| Phase 11 — Whitelist + Schema | NOT STARTED | |
| Phase 12 — Stage 2 Delivery | NOT STARTED | |
