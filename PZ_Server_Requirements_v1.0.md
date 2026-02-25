# Project Zomboid — Managed Dedicated Server

**Technical Requirements & Development Brief**
Version 1.1 | February 2026

---

## 1. Project Overview

Build a self-hosted, Docker-based Project Zomboid dedicated game server with a custom REST API for web-based management. The system should support subscriptions, an in-game item shop, whitelist access control, world backup/rollback, and full server administration.

The target audience is the Georgian gaming community. There are currently no known PZ servers in Georgia.

### 1.1 Goals

- Host a customizable PZ dedicated server (stable or unstable/B42 beta branch)
- Provide a REST API for all server management operations
- Enable monetization through subscriptions and microtransactions (future stage)
- Automate world backups with rollback capability
- Support Steam Workshop mods with server-side management
- Serve a web frontend for players and administrators (future stage)

### 1.2 Strategy

The server launches **free and open** to build a player base and community first. The architecture must be designed from day one to support monetization, but payment features are not implemented until the community is established. Stages are structured so each one delivers a usable product.

### 1.3 Target Architecture

| Component | Technology | Purpose |
|---|---|---|
| PZ Game Server | Docker (SteamCMD-based image) | Run the actual game server, handle player connections |
| REST API | FastAPI (Python) or Laravel | All management operations, RCON bridge, file ops, auth |
| Database | PostgreSQL | Users, subscriptions, shop transactions, whitelist, audit logs |
| Web Frontend | Vue.js or React SPA | Player portal, admin dashboard, shop interface |
| Payment Gateway | Stripe and/or PayPal | Subscription billing, one-time purchases via webhooks |

> **Important:** Even though payments and web frontend come in later stages, the API and database should be designed with these features in mind from the start. Don't paint yourself into a corner.

---

## 2. Infrastructure & Docker Setup

### 2.1 Game Server Container

Use an existing community Docker image as the base. Recommended: `meshi-team/project-zomboid-server` or `Danixu/project-zomboid-server-docker`. Both support environment variable configuration and beta branches.

| Requirement | Details |
|---|---|
| Base Image | SteamCMD-based, App ID 380870 |
| Beta Branch Support | `STEAMAPPBRANCH=unstable` for Build 42 multiplayer |
| Ports | 16261/udp (game), 16262/udp (direct connect), 27015/tcp (RCON) |
| Volumes | Persistent: server files, Zomboid data (saves/config/db/logs), workshop mods |
| Environment Config | SERVER_NAME, ADMIN_PASSWORD, MAX_PLAYERS, MAX_RAM, MOD_IDS, WORKSHOP_IDS |
| Auto-Update | SteamCMD update check on container start |
| RCON | Must be enabled with configurable password and port for API communication |

### 2.2 Docker Compose Structure

All services defined in a single `docker-compose.yml`. The API container needs access to the Docker socket (to restart the game server) and read access to server data volumes. Game server container should have `restart: unless-stopped` policy.

### 2.3 Networking & Security

- RCON port should NOT be exposed publicly — only accessible between containers on the Docker network
- API should be behind a reverse proxy (nginx/Caddy) with TLS termination
- API authentication via API keys for admin endpoints, JWT tokens for player-facing endpoints (later stages)
- Rate limiting on all public endpoints
- Docker socket access is privileged — the API container should have minimal additional permissions

---

## 3. REST API Specification

The API is the central control plane. It wraps RCON commands, file operations, database queries, and Docker management into a clean REST interface. All endpoints return JSON.

### 3.1 Authentication & Authorization

| Role | Access Level | Auth Method |
|---|---|---|
| Super Admin | Full access: all endpoints, server control, config changes | API Key + JWT |
| Admin/Moderator | Player management, kick/ban, view logs, send messages | JWT with role claim |
| Player (Subscriber) | View own profile, shop purchases, subscription status | JWT (issued after payment verification) |
| Public | Server status, ping, player count (read-only) | No auth required |

> Stages 1–2 only need API key auth. JWT and role-based access are added in Stage 3+.

### 3.2 API Endpoint Groups

#### 3.2.1 Server Control — *Stage 1*

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/server/status` | Server status: online/offline, player count, uptime, version, current map |
| POST | `/api/server/start` | Start the game server container |
| POST | `/api/server/stop` | Graceful stop: RCON save command, then container stop |
| POST | `/api/server/restart` | Save + restart with optional countdown message to players |
| POST | `/api/server/save` | Trigger immediate world save via RCON |
| POST | `/api/server/broadcast` | Send a server-wide message to all connected players |
| GET | `/api/server/logs` | Stream or paginate server console logs |

#### 3.2.2 Configuration Management — *Stage 1*

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/config/server` | Read current server.ini as JSON |
| PATCH | `/api/config/server` | Update specific server.ini fields (requires restart) |
| GET | `/api/config/sandbox` | Read SandboxVars.lua as JSON |
| PATCH | `/api/config/sandbox` | Update sandbox variables (zombie pop, loot, day length, etc.) |
| GET | `/api/config/mods` | List currently installed mods with Workshop IDs and Mod IDs |
| POST | `/api/config/mods` | Add mod(s) by Workshop ID, updates ini, triggers download on restart |
| DELETE | `/api/config/mods/{id}` | Remove a mod from the server configuration |

#### 3.2.3 Player & Admin Management — *Stage 1*

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/players` | List all connected players |
| GET | `/api/players/{name}` | Player details: Steam ID, access level, connection time, position |
| POST | `/api/players/{name}/kick` | Kick player with optional reason message |
| POST | `/api/players/{name}/ban` | Ban player by username or Steam ID |
| DELETE | `/api/players/{name}/ban` | Unban player |
| POST | `/api/players/{name}/setaccess` | Set access level: admin, moderator, overseer, gm, observer, none |
| POST | `/api/players/{name}/teleport` | Teleport player to coordinates or another player |
| POST | `/api/players/{name}/additem` | Give item to player (also used by shop fulfillment later) |
| POST | `/api/players/{name}/addxp` | Add XP to a player skill |
| POST | `/api/players/{name}/godmode` | Toggle godmode for a player |

#### 3.2.4 Whitelist Management — *Stage 2*

PZ whitelist is stored in a SQLite database file (`serverPZ.db`) inside the server data directory. The API must read/write to this database directly. When `Open=false` in server config, only whitelisted users can join.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/whitelist` | List all whitelisted users |
| POST | `/api/whitelist` | Add user to whitelist (username + password). Used by subscription flow later |
| DELETE | `/api/whitelist/{username}` | Remove user from whitelist |
| POST | `/api/whitelist/sync` | Sync whitelist with active subscriptions from DB (cron-compatible) |
| GET | `/api/whitelist/{username}/status` | Check if a user is currently whitelisted |

> In Stage 2, whitelist is managed manually by admin. In Stage 4, it auto-syncs with subscriptions.

#### 3.2.5 Backup & Rollback — *Stage 2*

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/backups` | List all available backups with timestamps and sizes |
| POST | `/api/backups` | Create manual backup: RCON save, then tar+gzip the save directory |
| POST | `/api/backups/{id}/rollback` | Rollback: stop server, replace save with backup, restart server |
| DELETE | `/api/backups/{id}` | Delete a specific backup |
| GET | `/api/backups/schedule` | View current backup schedule |
| PUT | `/api/backups/schedule` | Configure backup frequency and retention policy |

#### 3.2.6 Subscription Management — *Stage 4*

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/subscriptions` | List all subscriptions and their statuses |
| GET | `/api/subscriptions/{user_id}` | Subscription details for a specific user |
| POST | `/api/subscriptions/webhook` | Stripe webhook: handle subscription created/renewed/cancelled/failed |
| POST | `/api/subscriptions/check` | Cron endpoint: check expired subs, remove from whitelist |

#### 3.2.7 Shop & Transactions — *Stage 5*

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/shop/items` | List all purchasable items with prices and descriptions |
| POST | `/api/shop/items` | Admin: create/update shop item listing |
| POST | `/api/shop/purchase` | Player initiates purchase, creates payment intent via Stripe/PayPal |
| POST | `/api/shop/webhook` | Stripe/PayPal webhook receiver: on payment success, queue item delivery |
| POST | `/api/shop/deliver/{txn_id}` | Fulfill pending delivery: RCON additem to player |
| GET | `/api/shop/history/{player}` | Purchase history for a player |

---

## 4. Database Schema (PostgreSQL)

Design with all stages in mind from the start. Only create tables needed for the current stage, but ensure the schema can extend without breaking changes.

### 4.1 Core Tables

| Table | Key Fields | Stage |
|---|---|---|
| `users` | id, steam_id, username, email, password_hash, role, created_at | 2 |
| `subscriptions` | id, user_id, stripe_sub_id, plan, status, current_period_start, current_period_end | 4 |
| `whitelist_sync` | id, user_id, pz_username, pz_password_hash, synced_at, active | 2 |
| `shop_items` | id, name, description, pz_item_id, price_cents, currency, active, category | 5 |
| `transactions` | id, user_id, shop_item_id, amount, currency, payment_provider, payment_id, status, delivered_at | 5 |
| `delivery_queue` | id, transaction_id, player_name, pz_command, status, attempts, last_attempt_at | 5 |
| `backups` | id, filename, path, size_bytes, created_at, type (manual/scheduled), notes | 2 |
| `audit_log` | id, user_id, action, target, details_json, ip_address, created_at | 1 |

### 4.2 Key Relationships & Logic

- When a subscription is created or renewed → automatically add user to whitelist (Stage 4)
- When a subscription expires or is cancelled → remove user from whitelist (Stage 4)
- Shop item delivery should be retry-safe: if player is offline, queue and retry on connect (Stage 5)
- All admin actions (kick, ban, config changes, rollbacks) must be logged to `audit_log` (from Stage 1)
- Transaction status flow: `pending → paid → delivering → delivered` (or `failed`)

---

## 5. Backup & Rollback System — *Stage 2*

### 5.1 Backup Strategy

| Type | Frequency | Retention |
|---|---|---|
| Scheduled (auto) | Every 1 hour (configurable) | Keep last 24 hourly backups |
| Daily snapshot | Once per day at low-traffic time | Keep last 7 daily backups |
| Manual (API trigger) | On demand via admin API | Keep indefinitely until manually deleted |
| Pre-rollback | Automatically before any rollback | Keep last 5 |
| Pre-update | Before server version update | Keep last 3 |

### 5.2 Backup Process

1. Send RCON `save` command to ensure world is flushed to disk
2. Wait 5–10 seconds for save to complete
3. Create tar.gz of the entire `Zomboid/Saves/Multiplayer/{ServerName}/` directory
4. Also include the server `.ini`, `SandboxVars.lua`, and db files in the backup
5. Store with timestamp filename: `backup_{server}_{YYYYMMDD_HHmmss}.tar.gz`
6. Record metadata in the `backups` database table
7. Clean up old backups according to retention policy

### 5.3 Rollback Process

1. Admin selects a backup via API, confirmation required
2. System creates a pre-rollback backup of current state
3. Stop the game server container
4. Replace save directory contents with the selected backup
5. Restart the game server container
6. Log the rollback action in `audit_log`
7. Notify connected players (if possible) before shutdown

### 5.4 Storage

Local storage by default. Optionally support S3-compatible storage (for offsite backups) via configurable storage backend. Backup compression is required.

---

## 6. Mod Management

PZ mods require two identifiers: a numeric Workshop ID (for download) and a text Mod ID (for loading). Both must be in sync in the server.ini file. The server auto-downloads workshop items on start. Clients are prompted to download missing mods when connecting.

### 6.1 API Mod Operations

- **Add mod:** accept Workshop ID, auto-resolve Mod ID if possible (or require manual input), update ini, flag restart needed
- **Remove mod:** remove from both `WorkshopItems=` and `Mods=` lines, flag restart needed
- **Reorder mods:** dependencies must load first in the `Mods=` line
- **Validate mods:** check if Workshop IDs are valid Steam items (optional)
- **Force update:** trigger SteamCMD `workshop_download_item` for specific mods
- **Store mod metadata in DB:** name, Workshop ID, Mod ID, description, added_by, added_at

### 6.2 Important Notes

- Use **semicolons** as separators in the ini file, never commas
- Dependency/load order matters: if Mod A depends on B and C, B and C must appear first in `Mods=`
- Heavy mod packs increase RAM requirements significantly — expose RAM config via API
- Map mods require additional `Map=` field configuration
- After mod changes, the server **must** be restarted

---

## 7. Subscription & Payment System — *Stages 4–5*

> Not implemented until community is established. Architecture should support it from the start.

### 7.1 Subscription Flow

1. Player visits web portal and selects a subscription plan
2. Frontend redirects to Stripe Checkout (or embedded payment form)
3. Stripe processes payment and sends webhook to `/api/subscriptions/webhook`
4. API creates/updates subscription record, generates PZ credentials, adds to whitelist
5. Player receives PZ username and password via email or web portal
6. Player joins the game server using those credentials
7. On subscription expiry/cancellation, webhook triggers whitelist removal

### 7.2 Shop Purchase Flow

1. Authenticated player browses shop on web portal
2. Player selects item and clicks purchase, frontend creates payment intent via API
3. Player completes payment via Stripe/PayPal
4. Webhook confirms payment, API adds entry to `delivery_queue`
5. Background worker checks if player is online, executes RCON `additem` command
6. If player is offline, retry on next connection (poll player list or use log events)
7. Transaction marked as delivered, player notified

### 7.3 Payment Requirements

- Support both Stripe and PayPal (Stripe primary, PayPal secondary)
- All prices stored in cents/minor units to avoid floating point issues
- Webhook signature verification is mandatory
- Idempotent webhook handling (same event processed only once)
- Support for GEL (Georgian Lari) and USD currencies
- Refund handling: on refund webhook, update transaction status

---

## 8. Web Frontend — *Stages 3–5*

### 8.1 Public / Player Pages

| Page | Features |
|---|---|
| Landing / Server Status | Live player count, server status, current map, mod list, uptime |
| Subscription Plans | Plan comparison, pricing, subscribe button (Stage 4) |
| Player Dashboard | Subscription status, PZ credentials, purchase history |
| Item Shop | Browse items by category, purchase flow, delivery status (Stage 5) |
| Server Rules / Info | Static content pages for server rules, mod descriptions, community links |

### 8.2 Admin Dashboard

| Page | Features |
|---|---|
| Overview | Server status, player count graph, recent activity, disk/RAM usage |
| Player Management | Online players list, kick/ban controls, access levels, search |
| Server Config | Edit server.ini and sandbox settings via form UI, restart button |
| Mod Manager | Add/remove/reorder mods, search Workshop, dependency warnings |
| Whitelist | View/add/remove players, sync status with subscriptions |
| Backups | List backups with sizes/dates, create backup, rollback with confirmation |
| Shop Management | CRUD shop items, view transactions, manually deliver items (Stage 5) |
| Subscriptions | View all subs, filter by status, manual override (Stage 4) |
| Logs & Audit | Server console logs (live stream), audit log of all admin actions |
| RCON Console | Direct RCON command input for advanced operations |

---

## 9. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Hosting | Self-hosted on Ubuntu 22.04/24.04 VPS. Minimum: 4 CPU cores, 8GB RAM, 100GB SSD |
| Performance | API response time < 200ms for reads. RCON commands < 1s round-trip |
| Availability | Game server auto-restart on crash (Docker restart policy). API handles game server outages gracefully |
| Security | All secrets in .env files or Docker secrets, never in code. TLS on all public endpoints. RCON password never exposed to clients |
| Logging | Structured JSON logging for the API. Separate log files for game server, API, and background workers |
| Monitoring | Health check endpoints for both API and game server. Optional: Prometheus metrics |
| Scalability | Single server initially. Design API to support multiple game server instances in the future |
| Documentation | OpenAPI/Swagger spec auto-generated. README with setup instructions. `.env.example` file |
| Testing | Unit tests for critical business logic (subscription sync, payment webhooks, backup). Integration tests for RCON |
| CI/CD | Docker-based build. GitHub Actions or similar for automated testing and deployment |

---

## 10. Recommended Technology Stack

The developer may propose alternatives with justification.

| Layer | Recommended | Alternatives |
|---|---|---|
| Game Server Image | meshi-team/project-zomboid-server | Danixu or Renegade-Master images |
| REST API | FastAPI (Python 3.11+) | Laravel (PHP) if team prefers |
| RCON Client | Python rcon library or gorcon/rcon-cli | Custom TCP socket implementation |
| Database | PostgreSQL 15+ | MySQL 8+ acceptable |
| ORM / Migrations | SQLAlchemy + Alembic (Python) or Eloquent (Laravel) | Prisma, Drizzle if using Node |
| Background Jobs | Celery + Redis (Python) or Laravel Queues | Simple cron + DB polling for MVP |
| Frontend | Vue 3 + Vite | React, Nuxt 3 |
| Reverse Proxy | Caddy (auto TLS) | Nginx + Certbot |
| Payment | Stripe (primary) | Add PayPal as secondary |
| Container Orchestration | Docker Compose | Kubernetes if scaling later |

---

## 11. Delivery Stages

Each stage delivers a fully usable product. The server is **free and open** from Stage 1. Monetization is not introduced until Stage 4, after community is built.

---

### Stage 1 — Free Playable Server + Admin API (MVP)

**Goal:** A running PZ server that players can join for free, with API-based admin management for the owner.

**Server is open to all. No whitelist, no payments. Just a good server.**

**Deliverables:**

1. Docker Compose with PZ server container (stable + unstable/B42 branch support)
2. REST API with server start/stop/restart/status/save/broadcast endpoints
3. RCON integration for player management (kick, ban, teleport, additem, addxp, godmode)
4. Config management API (read/write server.ini and SandboxVars.lua)
5. Mod management via API (add/remove/reorder Workshop IDs, restart server)
6. API key authentication for admin endpoints
7. Public status endpoint (no auth): online/offline, player count, mod list
8. Audit log table + logging of all admin actions
9. Basic deployment scripts and documentation

**Acceptance criteria:**
- Players can connect and play on the server
- Admin can fully manage the server without SSH — only via API
- Mods can be added/removed and server restarted via API
- Server auto-restarts on crash

---

### Stage 2 — Backups, Rollbacks & Whitelist Infrastructure

**Goal:** Data safety and the infrastructure for access control (whitelist not enforced yet, but API is ready).

**Deliverables:**

1. Automated backup system with configurable schedule (hourly/daily) and retention policy
2. Manual backup trigger via API
3. Rollback via API: select backup → auto pre-rollback backup → stop → replace → restart
4. PostgreSQL setup with `users`, `whitelist_sync`, `backups`, `audit_log` tables
5. Whitelist CRUD API (read/write PZ SQLite db)
6. Whitelist sync endpoint (for future subscription integration)
7. Backup storage management (local, configurable path, retention cleanup)

**Acceptance criteria:**
- Backups run on schedule without manual intervention
- Admin can list backups, create manual backup, rollback to any backup via API
- Pre-rollback safety backup is always created automatically
- Whitelist API works (can add/remove users) even though server remains open

---

### Stage 3 — Web Frontend (Admin Dashboard + Public Status)

**Goal:** Browser-based management for admin. Public-facing server info page for players.

**Server is still free. This stage replaces raw API calls with a proper UI.**

**Deliverables:**

1. Public status page: server online/offline, player count, map, mod list, uptime
2. Admin dashboard with authentication (login page)
3. Admin pages: player management, server config editor, mod manager, backup/rollback, RCON console
4. Live server log streaming in browser
5. Audit log viewer
6. Responsive design (usable on mobile for quick admin tasks)
7. Reverse proxy setup with TLS (Caddy or nginx)

**Acceptance criteria:**
- Admin can do everything from Stage 1–2 via the web UI instead of raw API calls
- Public status page is accessible without login
- RCON console works in browser for ad-hoc commands

---

### Stage 4 — Subscriptions & Paid Whitelist

**Goal:** Monetization via subscriptions. Server transitions from open to whitelist-gated (or stays open with premium perks — decide at this point).

**Deliverables:**

1. Stripe integration: subscription plans, Checkout flow, webhook handling
2. Player registration system with JWT authentication
3. Subscription lifecycle: create → active → renewed → cancelled → expired
4. Auto whitelist sync: active subscription → add to whitelist, expired → remove
5. Player portal: subscription status, PZ credentials, renewal date
6. Subscription management admin page: view all, filter, manual override (extend/cancel)
7. Email or in-portal notification for subscription events
8. Cron job for periodic subscription status check and whitelist sync
9. Database tables: `subscriptions`, extended `users` table

**Acceptance criteria:**
- Player can subscribe via web, receive PZ credentials, and join the server
- Expired subscription automatically removes whitelist access
- Webhook handling is idempotent (duplicate events don't cause issues)
- Admin can manually extend or cancel subscriptions

---

### Stage 5 — Item Shop & Microtransactions

**Goal:** In-game item shop where players can purchase items delivered via RCON.

**Deliverables:**

1. Shop item catalog: admin CRUD (name, PZ item ID, price, category, description)
2. Player-facing shop page with categories and search
3. Purchase flow with Stripe payment intents (one-time payments)
4. Delivery queue: on payment confirmation, queue RCON `additem` command
5. Retry logic: if player is offline, retry delivery when they connect (poll player list)
6. Transaction history for players and admins
7. Admin page: manage shop items, view transactions, manual delivery, refund handling
8. Database tables: `shop_items`, `transactions`, `delivery_queue`
9. Optional: PayPal as secondary payment method

**Acceptance criteria:**
- Player can browse shop, purchase an item, and receive it in-game
- If player is offline at purchase time, item is delivered on next login
- Admin can see all transactions and manually trigger delivery
- Failed deliveries are retried automatically with a max attempt limit

---

### Stage 6 (Future) — Advanced Features

Not scoped in detail, but keep in mind for architecture decisions:

- Multiple server instances (different maps/settings) managed from one API
- Discord bot integration (server status, player count, admin commands via Discord)
- Player statistics and leaderboards (parse PZ logs/save files)
- Scheduled server events (announcements, restarts, weather changes)
- Server voting system (map changes, mod additions)
- In-game currency system (earned by playing, spent in shop alongside real money)
- Referral/invite system for community growth

---

## 12. Prompt for Developer

> **Below is the brief to hand directly to the developer. Attach this entire document as context.**

---

I need you to create a development plan for a Project Zomboid managed dedicated server system. The full requirements document is attached.

**Summary:**

We are building a self-hosted, Dockerized Project Zomboid game server targeting the Georgian gaming community. The system has four components: (1) a PZ dedicated server running in Docker with SteamCMD, supporting both stable and unstable/B42 beta branches and Steam Workshop mods, (2) a REST API (FastAPI or Laravel) that wraps RCON commands, file operations, and Docker management for full remote control, (3) a PostgreSQL database for users, subscriptions, shop transactions, whitelist sync, and audit logging, and (4) a web frontend (Vue or React) with a player portal and admin dashboard.

**Important context:** The server launches free and open to build community first. Monetization (subscriptions, shop) comes in later stages. But the architecture must support it from day one — don't make decisions now that block payment features later.

**Staged delivery:**

- **Stage 1 (MVP):** Free playable server + admin REST API (RCON, config, mods, player management)
- **Stage 2:** Automated backups/rollbacks + whitelist API infrastructure
- **Stage 3:** Web frontend (admin dashboard + public server status page)
- **Stage 4:** Stripe subscriptions + paid whitelist access
- **Stage 5:** In-game item shop with delivery queue

**Please produce a development plan that includes:**

1. Your proposed tech stack with justification for any changes from the recommendations in the doc
2. A database schema design with migration strategy (design for all stages, implement incrementally)
3. A task breakdown for each stage with effort estimates (hours or days)
4. Identification of technical risks and mitigation strategies
5. Your approach to RCON integration and the item delivery retry system
6. A testing strategy
7. Deployment/DevOps plan including CI/CD
8. Any questions or concerns about the requirements before starting

**Constraints:**

- Must run on a single Ubuntu VPS (4+ cores, 8+ GB RAM)
- All services in Docker Compose
- API must handle game server outages gracefully (don't crash if PZ is down)
- All admin actions must be audit-logged
- Payment webhook handling must be idempotent
- Targeting Stage 1 delivery within 2–3 weeks of start
