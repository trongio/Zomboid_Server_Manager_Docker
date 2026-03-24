-- Create test database for running Pest/PHPUnit tests.
-- Mounted into /docker-entrypoint-initdb.d/ so it runs on first DB init only.
-- Uses the same credentials as the main database.
SELECT 'CREATE DATABASE zomboid_test OWNER ' || current_user
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'zomboid_test')\gexec
