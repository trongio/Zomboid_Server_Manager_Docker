MAKEFLAGS += --no-print-directory

ARCH := $(shell uname -m)
ifeq ($(ARCH),aarch64)
	ARCH_FILE := docker-compose.arm64.yml
else
	ARCH_FILE := docker-compose.amd64.yml
endif

COMPOSE := docker compose -f docker-compose.yml -f $(ARCH_FILE)

FW_ZONE ?= FedoraWorkstation
PZ_GAME_PORT ?= 16261
PZ_DIRECT_PORT ?= 16262
APP_PORT ?= 8000

.PHONY: up down build restart logs ps stop pull migrate test exec arch init setup db-check db-init db-reset db-backup db-restore nuke workshop-package \
	fw-game-open fw-game-close fw-admin-open fw-admin-close admin-expose admin-hide expose hide info

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
	echo "Game ports are closed in firewalld by default. Run 'make expose' to allow remote players."

# ── Firewall helpers ────────────────────────────────────────────────
# These targets change runtime firewalld rules only. Nothing here is permanent.

fw-game-open:
	@sudo firewall-cmd --zone=$(FW_ZONE) --query-port=$(PZ_GAME_PORT)/udp >/dev/null || \
		sudo firewall-cmd --zone=$(FW_ZONE) --add-port=$(PZ_GAME_PORT)/udp
	@sudo firewall-cmd --zone=$(FW_ZONE) --query-port=$(PZ_DIRECT_PORT)/udp >/dev/null || \
		sudo firewall-cmd --zone=$(FW_ZONE) --add-port=$(PZ_DIRECT_PORT)/udp
	@echo "Opened game ports in firewalld runtime: $(PZ_GAME_PORT)/udp $(PZ_DIRECT_PORT)/udp"
	@$(MAKE) info

fw-game-close:
	@sudo firewall-cmd --zone=$(FW_ZONE) --query-port=$(PZ_GAME_PORT)/udp >/dev/null && \
		sudo firewall-cmd --zone=$(FW_ZONE) --remove-port=$(PZ_GAME_PORT)/udp || true
	@sudo firewall-cmd --zone=$(FW_ZONE) --query-port=$(PZ_DIRECT_PORT)/udp >/dev/null && \
		sudo firewall-cmd --zone=$(FW_ZONE) --remove-port=$(PZ_DIRECT_PORT)/udp || true
	@echo "Closed game ports in firewalld runtime: $(PZ_GAME_PORT)/udp $(PZ_DIRECT_PORT)/udp"

fw-admin-open:
	@sudo firewall-cmd --zone=$(FW_ZONE) --query-port=$(APP_PORT)/tcp >/dev/null || \
		sudo firewall-cmd --zone=$(FW_ZONE) --add-port=$(APP_PORT)/tcp
	@echo "Opened admin port in firewalld runtime: $(APP_PORT)/tcp"

fw-admin-close:
	@sudo firewall-cmd --zone=$(FW_ZONE) --query-port=$(APP_PORT)/tcp >/dev/null && \
		sudo firewall-cmd --zone=$(FW_ZONE) --remove-port=$(APP_PORT)/tcp || true
	@echo "Closed admin port in firewalld runtime: $(APP_PORT)/tcp"

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
	@rm -f .env app/.env
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
# Separate from up/down on purpose.
expose:
	@$(MAKE) fw-game-open

hide:
	@$(MAKE) fw-game-close

# ── Admin UI exposure ───────────────────────────────────────────────
# Separate on purpose. These do not affect the game ports.
admin-expose:
	APP_BIND_IP=0.0.0.0 VITE_BIND_IP=127.0.0.1 $(COMPOSE) up -d --force-recreate app
	@$(MAKE) fw-admin-open
	@echo "Admin URL: http://localhost:$(APP_PORT)"
	@echo "Remote admin URL: http://$$(curl -4 -fsS https://api.ipify.org 2>/dev/null || echo '<public-ip-unavailable>'):$(APP_PORT)"

admin-hide:
	@$(MAKE) fw-admin-close
	APP_BIND_IP=127.0.0.1 VITE_BIND_IP=127.0.0.1 $(COMPOSE) up -d --force-recreate app
	@echo "Admin URL: http://localhost:$(APP_PORT)"

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
	@echo "  init           - Interactive first-run setup wizard"
	@echo "  setup          - Alias for 'init'"
	@echo "  db-check       - Check if DB volume exists, create if not"
	@echo "  db-init        - Create DB volume (empty) if it doesn't exist"
	@echo "  db-reset       - Reset DB volume (DANGER: deletes data)"
	@echo "  up             - Start services (admin UI local-only by default)"
	@echo "  down           - Stop services"
	@echo "  nuke           - Destroy ALL data and stop services (DANGER)"
	@echo "  build          - Build Docker images"
	@echo "  restart        - Restart services"
	@echo "  stop           - Stop services without removing containers"
	@echo "  logs           - Follow service logs"
	@echo "  ps             - List running containers"
	@echo "  pull           - Pull latest images"
	@echo "  expose         - Open game ports in firewall (runtime only)"
	@echo "  hide           - Close game ports in firewall (runtime only)"
	@echo "  admin-expose   - Make admin UI accessible remotely (opens port)"
	@echo "  admin-hide     - Restrict admin UI to localhost (closes port)"
	@echo "  migrate        - Run database migrations"
	@echo "  test           - Run tests in the app container"