import mysql, {
  type Pool,
  type PoolConnection,
  type RowDataPacket,
  type ResultSetHeader,
  type FieldPacket,
} from "mysql2/promise";
import type {
  ColumnInfo,
  DbDriver,
  EditableInfo,
  MySQLConfig,
  ObjectInfo,
  QueryResult,
  QueryRow,
  RowOpResult,
  RunOptions,
  SchemaInfo,
  StreamOptions,
  TestResult,
} from "./types";
import {
  clampRowLimit,
  clampTimeout,
  STREAM_DEFAULT_BATCH,
  STREAM_DEFAULT_TIMEOUT_MS,
} from "./types";
import { assertIdent, isSingleReadOnly, qualified, quoteIdent } from "./sql-utils";

export class MySQLDriver implements DbDriver {
  readonly type = "mysql" as const;
  private pool: Pool;

  constructor(cfg: MySQLConfig) {
    this.pool = mysql.createPool({
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      user: cfg.user,
      password: cfg.password,
      ssl: cfg.ssl ? {} : undefined,
      waitForConnections: true,
      connectionLimit: 5,
      connectTimeout: 8_000,
      multipleStatements: false,
      dateStrings: true,
    });
  }

  private quote(name: string) { return quoteIdent(name, "`"); }
  private q(schema: string, name: string) { return qualified(schema, name, "`"); }

  async test(): Promise<TestResult> {
    try {
      const [rows] = await this.pool.query<RowDataPacket[]>("select version() as version");
      return { ok: true, serverVersion: rows[0]?.version as string };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  async listSchemas(): Promise<SchemaInfo[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "select schema_name from information_schema.schemata order by schema_name"
    );
    return rows.map((r) => ({ name: r.schema_name as string }));
  }

  async listObjects(schema: string): Promise<ObjectInfo[]> {
    assertIdent(schema);
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `select table_name, table_type from information_schema.tables where table_schema = ? order by table_name`,
      [schema]
    );
    return rows.map((r) => ({
      schema,
      name: r.table_name as string,
      kind: (r.table_type as string) === "VIEW" ? "view" : "table",
    }));
  }

  async describe(schema: string, name: string): Promise<ColumnInfo[]> {
    assertIdent(schema); assertIdent(name);
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `select column_name, data_type, is_nullable, column_key
       from information_schema.columns
       where table_schema = ? and table_name = ?
       order by ordinal_position`,
      [schema, name]
    );
    return rows.map((c) => ({
      name: c.column_name as string,
      dataType: c.data_type as string,
      nullable: (c.is_nullable as string) === "YES",
      isPrimaryKey: (c.column_key as string) === "PRI",
    }));
  }

  /**
   * Run with timeout (`MAX_EXECUTION_TIME` for SELECTs) and a hard row cap.
   * For SELECT-shaped statements we use the streaming cursor so we never
   * buffer more than `rowLimit` rows on the Node side.
   */
  async runStatement(statement: string, opts?: RunOptions): Promise<QueryResult> {
    const timeoutMs = clampTimeout(opts?.timeoutMs);
    const rowLimit = clampRowLimit(opts?.rowLimit);
    const started = Date.now();
    const readOnly = !!opts?.readOnly;
    const cursorable = isSingleReadOnly(statement);
    const conn = await this.pool.getConnection();

    try {
      if (readOnly) await conn.query("SET SESSION TRANSACTION READ ONLY");
      // MAX_EXECUTION_TIME is in ms and only affects SELECTs.
      await conn.query(`SET SESSION MAX_EXECUTION_TIME = ${timeoutMs}`);

      if (cursorable) {
        return await streamSelectWithCap(conn, statement, rowLimit, started);
      }
      // Non-SELECT: race the query with a kill timer.
      return await runWithKillTimer(conn, statement, timeoutMs, started);
    } finally {
      if (readOnly) await conn.query("SET SESSION TRANSACTION READ WRITE").catch(() => {});
      conn.release();
    }
  }

  streamStatement(statement: string, opts?: StreamOptions) {
    const timeoutMs = clampTimeout(opts?.timeoutMs ?? STREAM_DEFAULT_TIMEOUT_MS);
    const batchSize = opts?.batchSize ?? STREAM_DEFAULT_BATCH;
    const pool = this.pool;
    let columns: string[] = [];

    async function* gen(): AsyncGenerator<QueryRow, void, void> {
      const conn = await pool.getConnection();
      try {
        if (opts?.readOnly) await conn.query("SET SESSION TRANSACTION READ ONLY");
        await conn.query(`SET SESSION MAX_EXECUTION_TIME = ${timeoutMs}`);
        // mysql2 streaming: the raw connection's query() returns an emitter with stream().
        // The promise wrapper exposes the underlying connection via `.connection`.
        const raw = (conn as unknown as { connection: import("mysql2").Connection }).connection;
        const stream = raw.query(statement).stream({ highWaterMark: batchSize });
        for await (const row of stream as AsyncIterable<RowDataPacket>) {
          if (columns.length === 0) columns = Object.keys(row);
          yield row as QueryRow;
        }
      } finally {
        if (opts?.readOnly) await conn.query("SET SESSION TRANSACTION READ WRITE").catch(() => {});
        conn.release();
      }
    }

    const iter = gen();
    return Object.assign(iter, { columns: () => columns });
  }

  async fetchRows(schema: string, name: string, opts?: { limit?: number; offset?: number }) {
    const limit = Math.min(opts?.limit ?? 200, 10_000);
    const offset = opts?.offset ?? 0;
    return this.runStatement(
      `select * from ${this.q(schema, name)} limit ${limit} offset ${offset}`,
      { readOnly: true, rowLimit: limit + 1 }
    );
  }

  async insertRow(schema: string, name: string, row: QueryRow): Promise<RowOpResult> {
    const keys = Object.keys(row).map(assertIdent);
    if (keys.length === 0) throw new Error("No columns to insert");
    const cols = keys.map((k) => this.quote(k)).join(",");
    const placeholders = keys.map(() => "?").join(",");
    const values = keys.map((k) => row[k]);
    const [res] = await this.pool.query(`insert into ${this.q(schema, name)} (${cols}) values (${placeholders})`, values);
    return { affectedRows: (res as ResultSetHeader).affectedRows };
  }

  async updateRow(schema: string, name: string, where: QueryRow, set: QueryRow): Promise<RowOpResult> {
    const setKeys = Object.keys(set).map(assertIdent);
    const whereKeys = Object.keys(where).map(assertIdent);
    if (setKeys.length === 0 || whereKeys.length === 0) throw new Error("Invalid update");
    const setClause = setKeys.map((k) => `${this.quote(k)} = ?`).join(", ");
    const whereClause = whereKeys.map((k) => `${this.quote(k)} = ?`).join(" and ");
    const values = [...setKeys.map((k) => set[k]), ...whereKeys.map((k) => where[k])];
    const [res] = await this.pool.query(`update ${this.q(schema, name)} set ${setClause} where ${whereClause}`, values);
    return { affectedRows: (res as ResultSetHeader).affectedRows };
  }

  async deleteRow(schema: string, name: string, where: QueryRow): Promise<RowOpResult> {
    const whereKeys = Object.keys(where).map(assertIdent);
    if (whereKeys.length === 0) throw new Error("WHERE clause required");
    const whereClause = whereKeys.map((k) => `${this.quote(k)} = ?`).join(" and ");
    const values = whereKeys.map((k) => where[k]);
    const [res] = await this.pool.query(`delete from ${this.q(schema, name)} where ${whereClause}`, values);
    return { affectedRows: (res as ResultSetHeader).affectedRows };
  }

  async close() { await this.pool.end(); }
}

async function streamSelectWithCap(
  conn: PoolConnection,
  statement: string,
  rowLimit: number,
  started: number
): Promise<QueryResult> {
  const raw = (conn as unknown as { connection: import("mysql2").Connection }).connection;
  const query = raw.query(statement);
  let capturedFields: FieldPacket[] = [];
  // mysql2 emits 'fields' before any rows on the underlying Query object.
  (query as unknown as { on: (e: string, cb: (f: FieldPacket[]) => void) => void }).on(
    "fields",
    (f) => { capturedFields = f; }
  );
  const stream = query.stream({ highWaterMark: 256 });
  const rows: QueryRow[] = [];
  let truncated = false;
  let columns: string[] = [];
  for await (const row of stream as AsyncIterable<RowDataPacket>) {
    if (columns.length === 0) columns = Object.keys(row);
    if (rows.length >= rowLimit) {
      truncated = true;
      (stream as unknown as { destroy?: () => void }).destroy?.();
      break;
    }
    rows.push(row as QueryRow);
  }
  return {
    columns,
    rows,
    rowCount: rows.length,
    durationMs: Date.now() - started,
    truncated,
    editable: detectEditableMysql(capturedFields),
  };
}

/** mysql2 sets bit 2 of `flags` when the column is part of the source table's PK. */
const MYSQL_PRIMARY_KEY_FLAG = 2;

type MySQLField = FieldPacket & {
  db?: string;
  orgTable?: string;
  orgName?: string;
  flags?: number;
};

function detectEditableMysql(fields: FieldPacket[]): EditableInfo | undefined {
  if (!fields || fields.length === 0) return undefined;
  const ff = fields as MySQLField[];
  const dbs = new Set(ff.map((f) => f.db ?? "").filter(Boolean));
  const tables = new Set(ff.map((f) => f.orgTable ?? "").filter(Boolean));
  if (dbs.size !== 1 || tables.size !== 1) return undefined;
  if (ff.some((f) => !f.orgName)) return undefined;

  const schema = [...dbs][0];
  const table = [...tables][0];
  const columns = ff.map((f) => ({
    alias: f.name as string,
    source: f.orgName as string,
    isPrimaryKey: ((f.flags ?? 0) & MYSQL_PRIMARY_KEY_FLAG) !== 0,
  }));
  if (!columns.some((c) => c.isPrimaryKey)) return undefined;
  return { schema, table, columns };
}

async function runWithKillTimer(
  conn: PoolConnection,
  statement: string,
  timeoutMs: number,
  started: number
): Promise<QueryResult> {
  const raw = (conn as unknown as { connection: import("mysql2").Connection & { threadId?: number } }).connection;
  const threadId = raw.threadId;
  let killed = false;
  const killer = setTimeout(async () => {
    killed = true;
    try { await conn.query(`KILL QUERY ${threadId}`); } catch { /* ignore */ }
  }, timeoutMs + 1000);
  try {
    const [result, fields] = await conn.query(statement);
    if (Array.isArray(result)) {
      const rs = result as RowDataPacket[];
      const fieldArr = (fields as FieldPacket[] | undefined) ?? [];
      const cols = fieldArr.map((f) => f.name).filter(Boolean) || Object.keys(rs[0] ?? {});
      return {
        columns: cols,
        rows: rs as QueryRow[],
        rowCount: rs.length,
        durationMs: Date.now() - started,
        truncated: false,
        editable: detectEditableMysql(fieldArr),
      };
    }
    const r = result as ResultSetHeader;
    return {
      columns: [],
      rows: [],
      rowCount: 0,
      affectedRows: r.affectedRows,
      durationMs: Date.now() - started,
      truncated: false,
    };
  } catch (err) {
    if (killed) throw new Error(`Statement timed out after ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(killer);
  }
}
