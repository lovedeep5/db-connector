import type { DbType } from "@/lib/db/schema";

export type PostgresConfig = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
};

export type MySQLConfig = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
};

export type MongoConfig = {
  url: string;
  database: string;
};

export type OracleConfig = {
  connectString: string;
  user: string;
  password: string;
};

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
};

export type ConnectionConfig =
  | ({ type: "postgres" } & PostgresConfig)
  | ({ type: "mysql" } & MySQLConfig)
  | ({ type: "mongodb" } & MongoConfig)
  | ({ type: "oracle" } & OracleConfig)
  | ({ type: "smtp" } & SmtpConfig);

export type SchemaInfo = { name: string };

export type ObjectInfo = {
  schema: string;
  name: string;
  kind: "table" | "view" | "collection";
};

export type ColumnInfo = {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey?: boolean;
};

export type QueryRow = Record<string, unknown>;

export type QueryResult = {
  columns: string[];
  rows: QueryRow[];
  rowCount: number;
  /** For non-row-returning statements */
  affectedRows?: number;
  durationMs: number;
  /** True if the result was capped at `rowLimit` and more rows existed. */
  truncated?: boolean;
  /** Populated when the result rows trace back unambiguously to one table
   *  and the primary key is in the projection — i.e. it is safe to support
   *  inline edit / insert / delete in the UI. */
  editable?: EditableInfo;
};

export type EditableColumn = {
  /** Alias as it appears in the result rows */
  alias: string;
  /** Real column name in the source table */
  source: string;
  isPrimaryKey: boolean;
};

export type EditableInfo = {
  schema: string;
  table: string;
  columns: EditableColumn[];
};

export type RowOpResult = { affectedRows: number };

export type TestResult = { ok: boolean; message?: string; serverVersion?: string };

/** Per-query knobs. Server enforces hard caps regardless of UI choice. */
export type RunOptions = {
  readOnly?: boolean;
  /** Max rows to return (server-side hard cap, default 10 000, max 100 000). */
  rowLimit?: number;
  /** Statement timeout in milliseconds (default 60 000). */
  timeoutMs?: number;
};

export type StreamOptions = {
  readOnly?: boolean;
  /** Statement timeout in milliseconds (default 5 minutes for streaming). */
  timeoutMs?: number;
  /** Internal batch size hint for the driver. */
  batchSize?: number;
};

export interface DbDriver {
  readonly type: DbType;
  test(): Promise<TestResult>;
  listSchemas(): Promise<SchemaInfo[]>;
  listObjects(schema: string): Promise<ObjectInfo[]>;
  describe(schema: string, name: string): Promise<ColumnInfo[]>;
  runStatement(statement: string, opts?: RunOptions): Promise<QueryResult>;
  /** Yields one row at a time, server-side cursor / driver streaming. */
  streamStatement(statement: string, opts?: StreamOptions): AsyncIterable<QueryRow> & {
    /** Resolves to the column order observed on the wire (call once rows have started flowing). */
    columns?: () => string[];
  };
  fetchRows(schema: string, name: string, opts?: { limit?: number; offset?: number }): Promise<QueryResult>;
  insertRow(schema: string, name: string, row: QueryRow): Promise<RowOpResult>;
  updateRow(schema: string, name: string, where: QueryRow, set: QueryRow): Promise<RowOpResult>;
  deleteRow(schema: string, name: string, where: QueryRow): Promise<RowOpResult>;
  close(): Promise<void>;
}

export const DEFAULT_ROW_LIMIT = 10_000;
export const MAX_ROW_LIMIT = 100_000;
export const DEFAULT_TIMEOUT_MS = 60_000;
export const MAX_TIMEOUT_MS = 30 * 60_000; // 30 min hard ceiling
export const STREAM_DEFAULT_TIMEOUT_MS = 5 * 60_000;
export const STREAM_DEFAULT_BATCH = 1_000;

export function clampRowLimit(n?: number): number {
  if (!n || n <= 0) return DEFAULT_ROW_LIMIT;
  return Math.min(Math.floor(n), MAX_ROW_LIMIT);
}

export function clampTimeout(ms?: number): number {
  if (!ms || ms <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.floor(ms), MAX_TIMEOUT_MS);
}
