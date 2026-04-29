-- opendesk Postgres init script
-- Runs once on first container start, when the data directory is empty.
-- Sets up extensions and the application role used by Drizzle/Hono.
--
-- NOTE: We intentionally do NOT pre-create the logical replication slot here.
-- zero-cache (Phase 2+) will create and own its own slot on first run.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "unaccent";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Application role used by Drizzle (and read by Hono).
-- The bootstrap superuser is the postgres image's default role
-- (POSTGRES_USER=opendesk in docker-compose.yml). The app role is separate
-- so we can later strip it of replication / superuser privileges.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'opendesk_app') THEN
    CREATE ROLE opendesk_app WITH LOGIN PASSWORD 'opendesk_app';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE opendesk TO opendesk_app;
GRANT USAGE, CREATE ON SCHEMA public TO opendesk_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO opendesk_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO opendesk_app;
