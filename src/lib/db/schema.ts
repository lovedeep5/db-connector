import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const ts = (col: string) =>
  timestamp(col, { withTimezone: true, mode: "date" }).notNull().$defaultFn(() => new Date());

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  isSuperAdmin: boolean("is_super_admin").notNull().default(false),
  createdAt: ts("created_at"),
});

export const roles = pgTable("roles", {
  id: id(),
  name: text("name").notNull().unique(),
  description: text("description"),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: ts("created_at"),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: text("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
    permission: text("permission").notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.roleId, t.permission] }) })
);

export const teams = pgTable("teams", {
  id: id(),
  name: text("name").notNull().unique(),
  description: text("description"),
  createdAt: ts("created_at"),
});

export const teamMembers = pgTable(
  "team_members",
  {
    teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    roleId: text("role_id").notNull().references(() => roles.id, { onDelete: "restrict" }),
    addedAt: ts("added_at"),
  },
  (t) => ({ pk: primaryKey({ columns: [t.teamId, t.userId] }) })
);

export const connections = pgTable("connections", {
  id: id(),
  /** Display name. No DB-level uniqueness — personal + shared can collide and that's fine. */
  name: text("name").notNull(),
  type: text("type", { enum: ["postgres", "mysql", "mongodb", "oracle", "smtp"] }).notNull(),
  description: text("description"),
  encryptedConfig: text("encrypted_config").notNull(),
  /**
   * - private: only the creator (createdBy) can see/use it.
   * - team: existing model, access granted via team_connections rows.
   * - everyone: any signed-in user can read it.
   */
  visibility: text("visibility", { enum: ["private", "team", "everyone"] }).notNull().default("private"),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: ts("created_at"),
});

export const teamConnections = pgTable(
  "team_connections",
  {
    teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    connectionId: text("connection_id").notNull().references(() => connections.id, { onDelete: "cascade" }),
    /** Override the team role for this specific connection. If null, falls back to teamMembers.roleId */
    accessLevel: text("access_level", { enum: ["read", "write"] }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.teamId, t.connectionId] }) })
);

export const queryHistory = pgTable("query_history", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  connectionId: text("connection_id").notNull().references(() => connections.id, { onDelete: "cascade" }),
  statement: text("statement").notNull(),
  status: text("status", { enum: ["success", "error"] }).notNull(),
  durationMs: integer("duration_ms").notNull(),
  rowCount: integer("row_count"),
  errorMessage: text("error_message"),
  ranAt: ts("ran_at"),
});

export const savedQueries = pgTable(
  "saved_queries",
  {
    id: id(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    connectionId: text("connection_id").notNull().references(() => connections.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    statement: text("statement").notNull(),
    /** Who can see this query: 'private' (owner only), 'team' (owner + members of sharedWithTeamId), 'connection' (anyone with access to the connection). */
    visibility: text("visibility", { enum: ["private", "team", "connection"] }).notNull().default("private"),
    sharedWithTeamId: text("shared_with_team_id").references(() => teams.id, { onDelete: "set null" }),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => ({ uniqByUser: uniqueIndex("saved_queries_user_name").on(t.userId, t.connectionId, t.name) })
);

export const schedules = pgTable("schedules", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  connectionId: text("connection_id").notNull().references(() => connections.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  statement: text("statement").notNull(),
  cronExpression: text("cron_expression").notNull(),
  /** Comma-separated email addresses */
  emailTo: text("email_to").notNull(),
  emailSubject: text("email_subject"),
  isActive: boolean("is_active").notNull().default(true),
  visibility: text("visibility", { enum: ["private", "team", "connection"] }).notNull().default("private"),
  sharedWithTeamId: text("shared_with_team_id").references(() => teams.id, { onDelete: "set null" }),
  lastRunAt: timestamp("last_run_at", { withTimezone: true, mode: "date" }),
  lastRunStatus: text("last_run_status", { enum: ["success", "error", "skipped"] }),
  createdAt: ts("created_at"),
  updatedAt: ts("updated_at"),
});

export const scheduleRuns = pgTable("schedule_runs", {
  id: id(),
  scheduleId: text("schedule_id").notNull().references(() => schedules.id, { onDelete: "cascade" }),
  ranAt: ts("ran_at"),
  status: text("status", { enum: ["success", "error", "skipped"] }).notNull(),
  durationMs: integer("duration_ms").notNull(),
  rowCount: integer("row_count"),
  recipients: text("recipients"),
  errorMessage: text("error_message"),
  emailMessageId: text("email_message_id"),
});

/**
 * App-wide configuration. One row per key. `encrypted_value` is always an
 * AES-256-GCM ciphertext (via crypto.encryptJSON), so the table holds
 * secrets and non-secrets alike — encryption is uniform.
 */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  encryptedValue: text("encrypted_value").notNull(),
  updatedAt: ts("updated_at"),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
});

// ───────────────────────── Flow automations ─────────────────────────

export const flows = pgTable("flows", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  /** Full DAG definition: { trigger, nodes[], edges[] }. JSON string. */
  definition: text("definition").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  visibility: text("visibility", { enum: ["private", "team", "everyone"] }).notNull().default("private"),
  sharedWithTeamId: text("shared_with_team_id").references(() => teams.id, { onDelete: "set null" }),
  /** sequential = one run at a time; parallel = up to maxConcurrentRuns at once. */
  executionMode: text("execution_mode", { enum: ["sequential", "parallel"] }).notNull().default("parallel"),
  maxConcurrentRuns: integer("max_concurrent_runs").notNull().default(10),
  /** Per-node default timeout in ms. Individual nodes can override. */
  defaultNodeTimeoutMs: integer("default_node_timeout_ms").notNull().default(60_000),
  /** Generated when the flow has a webhook trigger; used to sign incoming requests. */
  webhookSecret: text("webhook_secret"),
  lastRunAt: timestamp("last_run_at", { withTimezone: true, mode: "date" }),
  lastRunStatus: text("last_run_status", { enum: ["success", "error", "skipped", "cancelled"] }),
  createdAt: ts("created_at"),
  updatedAt: ts("updated_at"),
});

export const flowRuns = pgTable("flow_runs", {
  id: id(),
  flowId: text("flow_id").notNull().references(() => flows.id, { onDelete: "cascade" }),
  triggerType: text("trigger_type", { enum: ["schedule", "manual", "webhook"] }).notNull(),
  triggerPayload: text("trigger_payload"),
  status: text("status", { enum: ["pending", "running", "success", "error", "cancelled"] }).notNull(),
  startedBy: text("started_by").references(() => users.id, { onDelete: "set null" }),
  startedAt: ts("started_at"),
  finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
  durationMs: integer("duration_ms"),
  errorMessage: text("error_message"),
});

export const flowNodeRuns = pgTable("flow_node_runs", {
  id: id(),
  flowRunId: text("flow_run_id").notNull().references(() => flowRuns.id, { onDelete: "cascade" }),
  /** node id within the flow's DAG (not a DB id). */
  nodeId: text("node_id").notNull(),
  nodeType: text("node_type").notNull(),
  status: text("status", { enum: ["pending", "running", "success", "error", "skipped"] }).notNull(),
  input: text("input"),
  output: text("output"),
  durationMs: integer("duration_ms"),
  errorMessage: text("error_message"),
  startedAt: ts("started_at"),
});

export const auditLog = pgTable("audit_log", {
  id: id(),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  details: text("details"),
  at: ts("at"),
});

// ───────────────────────── relations ─────────────────────────
export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(teamMembers),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  permissions: many(rolePermissions),
  memberships: many(teamMembers),
}));

export const teamsRelations = relations(teams, ({ many }) => ({
  members: many(teamMembers),
  connections: many(teamConnections),
}));

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  team: one(teams, { fields: [teamMembers.teamId], references: [teams.id] }),
  user: one(users, { fields: [teamMembers.userId], references: [users.id] }),
  role: one(roles, { fields: [teamMembers.roleId], references: [roles.id] }),
}));

export const connectionsRelations = relations(connections, ({ many }) => ({
  teams: many(teamConnections),
}));

export const teamConnectionsRelations = relations(teamConnections, ({ one }) => ({
  team: one(teams, { fields: [teamConnections.teamId], references: [teams.id] }),
  connection: one(connections, { fields: [teamConnections.connectionId], references: [connections.id] }),
}));

export type DbType = "postgres" | "mysql" | "mongodb" | "oracle";
export type AccessLevel = "read" | "write";

export const PERMISSIONS = [
  "manage:users",
  "manage:roles",
  "manage:teams",
  "manage:connections",
  "connection:read",
  "connection:write",
  "query:run",
  "data:export",
  "data:edit",
] as const;

export type Permission = (typeof PERMISSIONS)[number];
