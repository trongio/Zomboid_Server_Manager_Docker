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

.PHONY: up down build restart logs ps stop pull migrate test exec arch init setup db-check db-init db-reset db-backup db-restore nuke workshop-package \
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
	@PUBLIC_IP=$$(curl -4 -fsS https://api.ipify.org 2>/dev/null || true); \
	echo "Admin URL: http://localhost:$(APP_PORT)"; \
	if [ -n "$$PUBLIC_IP" ]; then \
		echo "Public IP: $$PUBLIC_IP"; \
	else \
		echo "Public IP: unavailable"; \
	fi; \
	if [ -f .firewall.conf ]; then \
		. ./.firewall.conf; \
		echo "Firewall backend: $$FIREWALL_BACKEND"; \
	else \
		echo "Firewall: not configured (run 'make init')"; \
	fi; \
	echo "Game ports are closed by default. Run 'make expose' to allow remote players."

# ── Firewall helpers ────────────────────────────────────────────────
# These targets dispatch to OS-specific scripts via .firewall.conf.
# Nothing here is permanent — all rules are runtime only.

# ── Core commands ────────────────────────────────────────────────────
# Default startup keeps the admin UI local-only and does not change firewall rules.
up: db-check
	APP_BIND_IP=127.0.0.1 VITE_BIND_IP=127.0.0.1 $(COMPOSE) up -d --build
	@$(MAKE) info

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
# Opens Caddy web ports (80/443) in the firewall for public HTTPS access.
# The app stays bound to 127.0.0.1:8000 — it is never exposed directly.
# Requires Caddy to be configured (run 'make init' first).
admin-expose:
	@CADDY_HTTP_PORT=$(CADDY_HTTP_PORT) CADDY_HTTPS_PORT=$(CADDY_HTTPS_PORT) $(FW_DISPATCH) admin-open
	@echo "Admin panel exposed via Caddy on ports $(CADDY_HTTP_PORT)/$(CADDY_HTTPS_PORT)"
	@echo "Local:  http://localhost:$(APP_PORT)"
	@echo "Public: https://$$(curl -4 -fsS https://api.ipify.org 2>/dev/null || echo '<see-your-caddy-config>')"

admin-hide:
	@CADDY_HTTP_PORT=$(CADDY_HTTP_PORT) CADDY_HTTPS_PORT=$(CADDY_HTTPS_PORT) $(FW_DISPATCH) admin-close
	@echo "Admin panel restricted to local access."
	@echo "Local:  http://localhost:$(APP_PORT)"

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
	@echo "    admin-expose   - Open Caddy web ports (80/443) for public admin HTTPS"
	@echo "    admin-hide     - Close Caddy web ports (80/443)"
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
	@echo "    info           - Show URLs, public IP, and firewall status"
	@echo "    arch           - Show detected CPU architecture"
	@echo "    nuke           - Destroy ALL data and stop services (DANGER)"
	@echo ""
	@echo "  Supported firewall backends: firewalld (Fedora/RHEL), ufw (Ubuntu/Debian), manual"
	@echo "  See docs/firewall-*.md for per-OS documentation."