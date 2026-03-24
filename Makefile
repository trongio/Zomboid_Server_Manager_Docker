ARCH := $(shell uname -m)
ifeq ($(ARCH),aarch64)
    ARCH_FILE := docker-compose.arm64.yml
else
    ARCH_FILE := docker-compose.amd64.yml
endif

COMPOSE := docker compose -f docker-compose.yml -f $(ARCH_FILE)

.PHONY: up down build restart logs ps stop pull migrate test exec arch init setup db-check db-init db-reset db-backup db-restore nuke workshop-package

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
		(echo "Volume pz-postgres already exists — keeping existing data."; exit 0) || true
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

# ── Core commands ────────────────────────────────────────────────────
up: db-check
	$(COMPOSE) up -d --build

down:
	$(COMPOSE) down

nuke:
	@echo "WARNING: This will destroy ALL data (database, game saves, backups)."
	@echo "Type NUKE_ALL and press Enter to continue:"
	@read confirm; \
	if [ "$$confirm" != "NUKE_ALL" ]; then \
		echo "Cancelled."; \
		exit 1; \
	fi
	$(COMPOSE) down -v
	@docker volume rm pz-postgres 2>/dev/null || true

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
	if [ -z "$${LATEST}" ]; then \
		echo "No backups found in db-backups/"; \
	else \
		echo "Restoring from $$LATEST ..."; \
		docker exec -i pz-db psql -U zomboid -d zomboid < "$$LATEST"; \
		echo "Restored."; \
	fi

# ── Workshop ────────────────────────────────────────────────────────
workshop-package:
	bash scripts/workshop-package.sh
