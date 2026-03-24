-- Create test database for running Pest/PHPUnit tests.
-- Mounted into /docker-entrypoint-initdb.d/ so it runs on FIRST DB INIT only.
-- If you already have an existing postgres-data volume, run manually:
--   make exec-db CMD="psql -U zomboid -c 'CREATE DATABASE zomboid_test OWNER zomboid'"
-- Uses the same credentials as the main database.
SELECT 'CREATE DATABASE zomboid_test OWNER ' || current_user
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'zomboid_test')\gexec
