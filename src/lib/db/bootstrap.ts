import type { Pool } from "pg";

/**
 * Idempotent metadata schema bootstrap for Postgres. Mirrors
 * src/lib/db/schema.ts. Every CREATE uses `IF NOT EXISTS`, so re-runs are
 * safe no-ops once the schema is in place.
 *
 * For non-trivial schema evolution, switch to drizzle-kit migrations.
 */
export async function bootstrap(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS roles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        is_system BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS role_permissions (
        role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        permission TEXT NOT NULL,
        PRIMARY KEY (role_id, permission)
      );

      CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        created_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS team_members (
        team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
        added_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (team_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS connections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT,
        encrypted_config TEXT NOT NULL,
        visibility TEXT NOT NULL DEFAULT 'private',
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL
      );

      -- Migrations for installs that pre-date Phase 2.5:
      ALTER TABLE connections ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'team';
      ALTER TABLE connections DROP CONSTRAINT IF EXISTS connections_name_key;
      ALTER TABLE connections DROP CONSTRAINT IF EXISTS connections_name_unique;

      CREATE TABLE IF NOT EXISTS team_connections (
        team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
        access_level TEXT,
        PRIMARY KEY (team_id, connection_id)
      );

      CREATE TABLE IF NOT EXISTS query_history (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
        statement TEXT NOT NULL,
        status TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        row_count INTEGER,
        error_message TEXT,
        ran_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS saved_queries (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        statement TEXT NOT NULL,
        visibility TEXT NOT NULL DEFAULT 'private',
        shared_with_team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS saved_queries_user_name
        ON saved_queries (user_id, connection_id, name);

      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        statement TEXT NOT NULL,
        cron_expression TEXT NOT NULL,
        email_to TEXT NOT NULL,
        email_subject TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        visibility TEXT NOT NULL DEFAULT 'private',
        shared_with_team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
        last_run_at TIMESTAMPTZ,
        last_run_status TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS schedule_runs (
        id TEXT PRIMARY KEY,
        schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
        ran_at TIMESTAMPTZ NOT NULL,
        status TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        row_count INTEGER,
        recipients TEXT,
        error_message TEXT,
        email_message_id TEXT
      );

      CREATE INDEX IF NOT EXISTS schedule_runs_by_schedule
        ON schedule_runs (schedule_id, ran_at DESC);

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        encrypted_value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS flows (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        definition TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        visibility TEXT NOT NULL DEFAULT 'private',
        shared_with_team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
        execution_mode TEXT NOT NULL DEFAULT 'parallel',
        max_concurrent_runs INTEGER NOT NULL DEFAULT 10,
        default_node_timeout_ms INTEGER NOT NULL DEFAULT 60000,
        webhook_secret TEXT,
        last_run_at TIMESTAMPTZ,
        last_run_status TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS flow_runs (
        id TEXT PRIMARY KEY,
        flow_id TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
        trigger_type TEXT NOT NULL,
        trigger_payload TEXT,
        status TEXT NOT NULL,
        started_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        started_at TIMESTAMPTZ NOT NULL,
        finished_at TIMESTAMPTZ,
        duration_ms INTEGER,
        error_message TEXT
      );

      CREATE INDEX IF NOT EXISTS flow_runs_by_flow
        ON flow_runs (flow_id, started_at DESC);

      CREATE TABLE IF NOT EXISTS flow_node_runs (
        id TEXT PRIMARY KEY,
        flow_run_id TEXT NOT NULL REFERENCES flow_runs(id) ON DELETE CASCADE,
        node_id TEXT NOT NULL,
        node_type TEXT NOT NULL,
        status TEXT NOT NULL,
        input TEXT,
        output TEXT,
        duration_ms INTEGER,
        error_message TEXT,
        started_at TIMESTAMPTZ NOT NULL
      );

      CREATE INDEX IF NOT EXISTS flow_node_runs_by_run
        ON flow_node_runs (flow_run_id, started_at);

      -- Add trigger_state to flows for poll-based triggers (S3, …). The
      -- column is JSON-shaped text; the runtime parses it. Idempotent ALTER
      -- so existing installs pick it up without a manual migration.
      ALTER TABLE flows ADD COLUMN IF NOT EXISTS trigger_state TEXT;

      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        target_type TEXT,
        target_id TEXT,
        details TEXT,
        at TIMESTAMPTZ NOT NULL
      );
    `);
  } finally {
    client.release();
  }
}
