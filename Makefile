MAKEFLAGS += --no-print-directory

ARCH := $(shell uname -m)
ifeq ($(ARCH),aarch64)
	ARCH_FILE := docker-compose.arm64.yml
else
	ARCH_FILE := docker-compose.amd64.yml
endif

COMPOSE := docker compose -f docker-compose.yml -f $(ARCH_FILE)

PZ_GAME_PORT ?= 16261
PZ_DIRECT_PORT ?= 16262
APP_PORT ?= 8000
CADDY_HTTP_PORT ?= 80
CADDY_HTTPS_PORT ?= 443

FW_DISPATCH := bash scripts/firewall/dispatch.sh

.PHONY: up down build restart logs ps stop pull migrate test exec arch init setup db-check db-init db-reset db-backup db-restore nuke workshop-package update-version update \
	admin-expose admin-hide expose hide info

# ── First-run setup ──────────────────────────────────────────────────
# Interactive wizard: configures env, creates DB volume, starts services,
# and provisions the admin account. Safe to re-run (prompts before overwrite).
init:
	@bash scripts/setup.sh

setup: init

db-check:
	@docker volume inspect pz-postgres >/dev/null 2>&1 || \
		(echo "Creating Postgres volume pz-postgres..."; \
		docker volume create pz-postgres >/dev/null)

db-init:
	@docker volume inspect pz-postgres >/dev/null 2>&1 && \
		(echo "Volume pz-postgres already exists - keeping existing data."; exit 0) || true
	@echo "Creating Postgres volume pz-postgres (empty database)."
	@docker volume create pz-postgres >/dev/null
	@echo "Volume created. Run 'make up' to start services."

db-reset:
	@echo "WARNING: This will PERMANENTLY delete Postgres data volume pz-postgres."
	@echo "Type RESET_DB and press Enter to continue:"
	@read confirm; \
	if [ "$$confirm" != "RESET_DB" ]; then \
		echo "Cancelled."; \
		exit 1; \
	fi
	@$(COMPOSE) down
	@docker volume rm pz-postgres 2>/dev/null || true
	@docker volume create pz-postgres >/dev/null
	@echo "Postgres volume recreated. Run 'make up' to start with an empty DB."

# ── Informational output ────────────────────────────────────────────
info:
	@PUBLIC_IP=$$(curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true); \
	echo ""; \
	echo "╔══════════════════════════════════════════════╗"; \
	echo "║          Zomboid Manager — Status            ║"; \
	echo "╚══════════════════════════════════════════════╝"; \
	echo ""; \
	echo "  Local Admin:   http://localhost:$(APP_PORT)"; \
	if [ -f .firewall.conf ]; then \
		. ./.firewall.conf; \
		HTTPS_PORT="$${ADMIN_HTTPS_PORT:-443}"; \
		HTTP_PORT="$${ADMIN_HTTP_PORT:-80}"; \
		HOST="$${ADMIN_PUBLIC_HOST:-}"; \
		if [ -n "$$HOST" ] && [ "$$HOST" != "localhost" ]; then \
			if [ "$$HTTPS_PORT" = "443" ]; then \
				echo "  Public Admin:  https://$$HOST  (requires 'make admin-expose')"; \
			else \
				echo "  Public Admin:  https://$$HOST:$$HTTPS_PORT  (requires 'make admin-expose')"; \
			fi; \
		else \
			echo "  Public Admin:  not configured (run 'make init' to enable)"; \
		fi; \
		echo "  Caddy Ports:   $$HTTP_PORT (HTTP) / $$HTTPS_PORT (HTTPS)"; \
		echo "  Firewall:      $$FIREWALL_BACKEND"; \
	else \
		echo "  Public Admin:  not configured (run 'make init')"; \
		echo "  Firewall:      not configured"; \
	fi; \
	if [ -n "$$PUBLIC_IP" ]; then \
		echo "  Public IP:     $$PUBLIC_IP"; \
	else \
		echo "  Public IP:     unavailable"; \
	fi; \
	echo "  Game Ports:    $(PZ_GAME_PORT)/udp, $(PZ_DIRECT_PORT)/udp (closed by default)"; \
	echo ""; \
	echo "  Run 'make expose' to allow remote players."; \
	echo "  Run 'make admin-expose' to open public admin access."; \
	echo ""

# ── Firewall helpers ────────────────────────────────────────────────
# These targets dispatch to OS-specific scripts via .firewall.conf.
# Nothing here is permanent — all rules are runtime only.

# ── Core commands ────────────────────────────────────────────────────
# Default startup keeps the admin UI local-only and does not change firewall rules.
up: db-check
	$(COMPOSE) up -d --build

down:
	$(COMPOSE) down

VOLUMES := pz-postgres pz-app-vendor pz-app-node-modules pz-app-build \
	pz-server-files pz-data pz-redis pz-backups pz-lua-bridge pz-map-tiles \
	pz-caddy-data pz-caddy-config

nuke:
	@echo "WARNING: This will destroy ALL data (database, game saves, backups, config)."
	@echo "Type NUKE_ALL and press Enter to continue:"
	@read confirm; \
	if [ "$$confirm" != "NUKE_ALL" ]; then \
		echo "Cancelled."; \
		exit 1; \
	fi
	$(COMPOSE) down -v --remove-orphans
	@for vol in $(VOLUMES); do \
		docker volume rm $$vol 2>/dev/null || true; \
	done
	@REMAINING=$$(docker volume ls -q --filter name=pz- 2>/dev/null); \
	if [ -n "$$REMAINING" ]; then \
		echo "Removing leftover volumes: $$REMAINING"; \
		echo "$$REMAINING" | xargs docker volume rm 2>/dev/null || true; \
	fi
	@rm -f .env app/.env .firewall.conf
	@rm -f caddy/Caddyfile caddy/certs/cert.pem caddy/certs/key.pem
	@for dir in app/bootstrap/cache app/storage/logs app/storage/framework/cache app/storage/framework/sessions app/storage/framework/views; do \
		chown -R $$(id -u):$$(id -g) $$dir 2>/dev/null || sudo chown -R $$(id -u):$$(id -g) $$dir 2>/dev/null || true; \
	done
	@echo "Nuke complete. All volumes and config removed."

build:
	$(COMPOSE) build

restart:
	$(COMPOSE) restart

stop:
	$(COMPOSE) stop

logs:
	$(COMPOSE) logs -f

ps:
	$(COMPOSE) ps

pull:
	$(COMPOSE) pull

# ── Game firewall exposure ──────────────────────────────────────────
# Separate from up/down on purpose. Game ports only (UDP).
expose:
	@PZ_GAME_PORT=$(PZ_GAME_PORT) PZ_DIRECT_PORT=$(PZ_DIRECT_PORT) $(FW_DISPATCH) game-open
	@$(MAKE) info

hide:
	@PZ_GAME_PORT=$(PZ_GAME_PORT) PZ_DIRECT_PORT=$(PZ_DIRECT_PORT) $(FW_DISPATCH) game-close

# ── Admin UI exposure ───────────────────────────────────────────────
# Opens Caddy web ports in the firewall for public HTTPS access.
# Ports are read from .firewall.conf (set during 'make init').
# The app stays bound to 127.0.0.1:8000 — it is never exposed directly.
# Requires Caddy to be configured (run 'make init' first).
admin-expose:
	@if [ ! -f .firewall.conf ]; then echo "Error: run 'make init' first."; exit 1; fi
	@. ./.firewall.conf; \
	HTTP="$${ADMIN_HTTP_PORT:-80}"; \
	HTTPS="$${ADMIN_HTTPS_PORT:-443}"; \
	CADDY_HTTP_PORT=$$HTTP CADDY_HTTPS_PORT=$$HTTPS $(FW_DISPATCH) admin-open; \
	echo "Admin panel exposed via Caddy on ports $$HTTP/$$HTTPS"; \
	echo "Local:  http://localhost:$(APP_PORT)"; \
	HOST="$${ADMIN_PUBLIC_HOST:-}"; \
	if [ -n "$$HOST" ] && [ "$$HOST" != "localhost" ]; then \
		if [ "$$HTTPS" = "443" ]; then \
			echo "Public: https://$$HOST"; \
		else \
			echo "Public: https://$$HOST:$$HTTPS"; \
		fi; \
	fi

admin-hide:
	@if [ ! -f .firewall.conf ]; then echo "Error: run 'make init' first."; exit 1; fi
	@. ./.firewall.conf; \
	HTTP="$${ADMIN_HTTP_PORT:-80}"; \
	HTTPS="$${ADMIN_HTTPS_PORT:-443}"; \
	CADDY_HTTP_PORT=$$HTTP CADDY_HTTPS_PORT=$$HTTPS $(FW_DISPATCH) admin-close; \
	echo "Admin panel restricted to local access."; \
	echo "Local:  http://localhost:$(APP_PORT)"

# ── App commands ─────────────────────────────────────────────────────
migrate: db-backup
	$(COMPOSE) exec app php artisan migrate --force

test:
	@$(COMPOSE) exec -T db psql -U zomboid -tc "SELECT 1 FROM pg_database WHERE datname='zomboid_test'" | grep -q 1 \
		|| $(COMPOSE) exec -T db psql -U zomboid -c "CREATE DATABASE zomboid_test OWNER zomboid" 2>/dev/null || true
	$(COMPOSE) exec -e APP_ENV=testing -e APP_CONFIG_CACHE=/tmp/laravel-test-config.php -e DB_CONNECTION=pgsql -e DB_DATABASE=zomboid_test app php artisan test --compact

exec:
	$(COMPOSE) exec app $(CMD)

arch:
	@echo "Detected: $(ARCH) -> $(ARCH_FILE)"

# ── Database ─────────────────────────────────────────────────────────
db-backup:
	@mkdir -p db-backups
	@echo "Backing up database..."
	@docker exec pz-db pg_dump -U zomboid -d zomboid --no-owner \
		> db-backups/backup-$$(date +%Y%m%d-%H%M%S).sql 2>/dev/null \
		&& echo "Backup saved to db-backups/" \
		|| echo "No database to backup (first run?)"

db-restore:
	@LATEST=$$(ls -t db-backups/*.sql 2>/dev/null | head -1); \
	if [ -z "$$LATEST" ]; then \
		echo "No backups found in db-backups/"; \
	else \
		echo "Restoring from $$LATEST ..."; \
		docker exec -i pz-db psql -U zomboid -d zomboid < "$$LATEST"; \
		echo "Restored."; \
	fi

# ── Workshop ────────────────────────────────────────────────────────
workshop-package:
	bash scripts/workshop-package.sh

# ── Update from git ─────────────────────────────────────────────────
# Pulls the latest code, rebuilds, runs migrations, rebuilds frontend
# assets, and restarts game-server so it picks up entrypoint script
# changes. Refuses to run if the working tree is dirty.
update:
	@echo ""
	@echo "════════ Zomboid Manager — Update ════════"
	@echo ""
	@if ! git diff --quiet || ! git diff --cached --quiet; then \
		echo "Working tree has uncommitted changes to tracked files:"; \
		git status --short | grep -v '^??' || true; \
		echo ""; \
		echo "Commit or stash them, then run 'make update' again."; \
		exit 1; \
	fi
	@BRANCH=$$(git rev-parse --abbrev-ref HEAD); \
	echo "→ Pulling latest from origin/$$BRANCH ..."; \
	git fetch --tags origin "$$BRANCH" || (echo "git fetch failed."; exit 1); \
	BEFORE=$$(git rev-parse HEAD); \
	git pull --ff-only origin "$$BRANCH" || ( \
		echo ""; \
		echo "Cannot fast-forward (local has diverged). Resolve manually with:"; \
		echo "  git status"; \
		echo "  git log HEAD..origin/$$BRANCH --oneline"; \
		exit 1 ); \
	AFTER=$$(git rev-parse HEAD); \
	if [ "$$BEFORE" = "$$AFTER" ]; then \
		echo "  Already up to date."; \
	else \
		echo "  $$BEFORE → $$AFTER"; \
		echo ""; \
		echo "  New commits:"; \
		git log --oneline "$$BEFORE..$$AFTER" | sed 's/^/    /'; \
	fi
	@echo ""
	@echo "→ Rebuilding containers ..."
	$(COMPOSE) up -d --build
	@echo ""
	@echo "→ Waiting for app container ..."
	@for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do \
		if $(COMPOSE) exec -T app php -v >/dev/null 2>&1; then break; fi; \
		sleep 2; \
	done
	@echo "→ Installing PHP dependencies (composer.lock) ..."
	@$(COMPOSE) exec -T app composer install --no-interaction --no-progress --prefer-dist 2>&1 | tail -3 || true
	@echo ""
	@echo "→ Building frontend assets ..."
	@$(COMPOSE) exec -T app npm install --no-audit --no-fund --silent 2>&1 | tail -3 || true
	$(COMPOSE) exec -T app npm run build
	@echo ""
	@echo "→ Running database migrations ..."
	@$(COMPOSE) exec -T app php artisan migrate --force --no-interaction || echo "(migration skipped)"
	@echo ""
	@echo "→ Clearing application cache ..."
	@$(COMPOSE) exec -T app php artisan config:clear >/dev/null 2>&1 || true
	@$(COMPOSE) exec -T app php artisan route:clear >/dev/null 2>&1 || true
	@$(COMPOSE) exec -T app php artisan view:clear >/dev/null 2>&1 || true
	@echo ""
	@echo "→ Restarting game-server (picks up entrypoint script changes) ..."
	$(COMPOSE) restart game-server
	@echo ""
	@echo "════════ Update complete ════════"
	@echo ""
	@echo "Tail logs:           make logs"
	@echo "Game-server only:    docker logs -f pz-game-server"
	@echo ""

# ── Game version ────────────────────────────────────────────────────
# Updates game-version.conf with the current PZ version.
# This file is used by tests — it does NOT control which version SteamCMD downloads.
update-version:
	@echo "Current version:"
	@if [ -f game-version.conf ]; then \
		. ./game-version.conf; \
		echo "  $$PZ_VERSION"; \
		echo "  $$PZ_VERSION_FULL"; \
	else \
		echo "  (not set)"; \
	fi
	@echo ""
	@echo "Paste the full version string from the game"
	@echo "(e.g. 42.16.1 679520210a22497d1cb91ca6105ed544637604c6 2026-04-02 14:57:34 (ZB))"
	@echo ""
	@echo -n "> "; read FULL; \
	if [ -z "$$FULL" ]; then echo "Cancelled."; exit 1; fi; \
	VER=$$(echo "$$FULL" | grep -oE '^[0-9]+\.[0-9]+(\.[0-9]+)*'); \
	if [ -z "$$VER" ]; then echo "Error: could not parse version number."; exit 1; fi; \
	sed -i "s|^PZ_VERSION=.*|PZ_VERSION=$$VER|" game-version.conf; \
	sed -i "s|^PZ_VERSION_FULL=.*|PZ_VERSION_FULL=$$FULL|" game-version.conf; \
	echo ""; \
	echo "Updated game-version.conf:"; \
	echo "  PZ_VERSION=$$VER"; \
	echo "  PZ_VERSION_FULL=$$FULL"

help:
	@echo "Available targets:"
	@echo ""
	@echo "  Setup:"
	@echo "    init           - Interactive first-run setup wizard (detects OS & firewall)"
	@echo "    setup          - Alias for 'init'"
	@echo ""
	@echo "  Services:"
	@echo "    up             - Start services (admin UI local-only at localhost:8000)"
	@echo "    down           - Stop services"
	@echo "    build          - Build Docker images"
	@echo "    restart        - Restart services"
	@echo "    stop           - Stop services without removing containers"
	@echo "    logs           - Follow service logs"
	@echo "    ps             - List running containers"
	@echo "    pull           - Pull latest images"
	@echo ""
	@echo "  Firewall (auto-detects backend from .firewall.conf):"
	@echo "    expose         - Open game ports (UDP) in host firewall"
	@echo "    hide           - Close game ports (UDP) in host firewall"
	@echo "    admin-expose   - Open Caddy web ports for public admin HTTPS"
	@echo "    admin-hide     - Close Caddy web ports"
	@echo "                     (ports read from .firewall.conf, set during 'make init')"
	@echo ""
	@echo "  Database:"
	@echo "    db-check       - Check if DB volume exists, create if not"
	@echo "    db-init        - Create DB volume (empty) if it doesn't exist"
	@echo "    db-reset       - Reset DB volume (DANGER: deletes data)"
	@echo "    db-backup      - Backup database to db-backups/"
	@echo "    db-restore     - Restore latest backup from db-backups/"
	@echo ""
	@echo "  App:"
	@echo "    migrate        - Run database migrations"
	@echo "    test           - Run tests in the app container"
	@echo "    exec CMD=...   - Run a command in the app container"
	@echo ""
	@echo "  Other:"
	@echo "    info             - Show URLs, public IP, and firewall status"
	@echo "    arch             - Show detected CPU architecture"
	@echo "    update           - Pull latest code, rebuild, migrate, rebuild assets,"
	@echo "                       and restart game-server (refuses if working tree dirty)"
	@echo "    update-version   - Update game-version.conf after a PZ game update"
	@echo "    nuke             - Destroy ALL data and stop services (DANGER)"
	@echo ""
	@echo "  Supported firewall backends: firewalld (Fedora/RHEL), ufw (Ubuntu/Debian), manual"
	@echo "  See docs/firewall-*.md for per-OS documentation."
