import oracledb from "oracledb";
import type {
  ColumnInfo,
  DbDriver,
  ObjectInfo,
  OracleConfig,
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
import { assertIdent, qualified, quoteIdent } from "./sql-utils";

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.fetchAsString = [oracledb.CLOB];

export class OracleDriver implements DbDriver {
  readonly type = "oracle" as const;
  private cfg: OracleConfig;
  private poolPromise: Promise<oracledb.Pool> | null = null;

  constructor(cfg: OracleConfig) { this.cfg = cfg; }

  private async getPool(): Promise<oracledb.Pool> {
    if (!this.poolPromise) {
      this.poolPromise = oracledb.createPool({
        user: this.cfg.user,
        password: this.cfg.password,
        connectString: this.cfg.connectString,
        poolMin: 0,
        poolMax: 5,
        poolIncrement: 1,
        queueTimeout: 8_000,
      });
    }
    return this.poolPromise;
  }

  private async withConn<T>(fn: (c: oracledb.Connection) => Promise<T>): Promise<T> {
    const pool = await this.getPool();
    const conn = await pool.getConnection();
    try { return await fn(conn); } finally { await conn.close(); }
  }

  async test(): Promise<TestResult> {
    try {
      return await this.withConn(async (c) => {
        const r = await c.execute<{ VERSION: string }>("select banner as version from v$version where rownum = 1");
        return { ok: true, serverVersion: r.rows?.[0]?.VERSION };
      });
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  async listSchemas(): Promise<SchemaInfo[]> {
    return this.withConn(async (c) => {
      const r = await c.execute<{ USERNAME: string }>(
        `select username from all_users order by username`
      );
      return (r.rows ?? []).map((row) => ({ name: row.USERNAME }));
    });
  }

  async listObjects(schema: string): Promise<ObjectInfo[]> {
    assertIdent(schema);
    return this.withConn(async (c) => {
      const r = await c.execute<{ OBJECT_NAME: string; OBJECT_TYPE: string }>(
        `select object_name, object_type from all_objects
         where owner = :s and object_type in ('TABLE','VIEW') order by object_name`,
        { s: schema }
      );
      return (r.rows ?? []).map((row) => ({
        schema,
        name: row.OBJECT_NAME,
        kind: row.OBJECT_TYPE === "VIEW" ? "view" : ("table" as const),
      }));
    });
  }

  async describe(schema: string, name: string): Promise<ColumnInfo[]> {
    assertIdent(schema); assertIdent(name);
    return this.withConn(async (c) => {
      const cols = await c.execute<{ COLUMN_NAME: string; DATA_TYPE: string; NULLABLE: string }>(
        `select column_name, data_type, nullable from all_tab_columns
         where owner = :s and table_name = :t order by column_id`,
        { s: schema, t: name }
      );
      const pks = await c.execute<{ COLUMN_NAME: string }>(
        `select acc.column_name from all_constraints ac
         join all_cons_columns acc on ac.constraint_name = acc.constraint_name and ac.owner = acc.owner
         where ac.owner = :s and ac.table_name = :t and ac.constraint_type = 'P'`,
        { s: schema, t: name }
      );
      const pkSet = new Set((pks.rows ?? []).map((r) => r.COLUMN_NAME));
      return (cols.rows ?? []).map((row) => ({
        name: row.COLUMN_NAME,
        dataType: row.DATA_TYPE,
        nullable: row.NULLABLE === "Y",
        isPrimaryKey: pkSet.has(row.COLUMN_NAME),
      }));
    });
  }

  /**
   * Oracle: `callTimeout` on the connection kills any roundtrip exceeding it.
   * `maxRows` on a SELECT caps the rows the server sends back (proper server-
   * side cap, no extra rows pulled). For non-SELECT, maxRows is ignored.
   */
  async runStatement(statement: string, opts?: RunOptions): Promise<QueryResult> {
    const timeoutMs = clampTimeout(opts?.timeoutMs);
    const rowLimit = clampRowLimit(opts?.rowLimit);
    const started = Date.now();
    return this.withConn(async (c) => {
      c.callTimeout = timeoutMs;
      const trimmed = statement.trim().replace(/;\s*$/, "");
      // Fetch one extra row to detect truncation.
      const res = await c.execute(trimmed, [], { autoCommit: !opts?.readOnly, maxRows: rowLimit + 1 });
      const columns = (res.metaData ?? []).map((m) => m.name);
      const rows = (res.rows ?? []) as QueryRow[];
      const truncated = rows.length > rowLimit;
      if (truncated) rows.length = rowLimit;
      return {
        columns,
        rows,
        rowCount: rows.length,
        affectedRows: typeof res.rowsAffected === "number" ? res.rowsAffected : undefined,
        durationMs: Date.now() - started,
        truncated,
      };
    });
  }

  streamStatement(statement: string, opts?: StreamOptions) {
    const timeoutMs = clampTimeout(opts?.timeoutMs ?? STREAM_DEFAULT_TIMEOUT_MS);
    const batchSize = opts?.batchSize ?? STREAM_DEFAULT_BATCH;
    const getPool = () => this.getPool();
    let columns: string[] = [];

    async function* gen(): AsyncGenerator<QueryRow, void, void> {
      const pool = await getPool();
      const conn = await pool.getConnection();
      conn.callTimeout = timeoutMs;
      try {
        const trimmed = statement.trim().replace(/;\s*$/, "");
        const result = await conn.execute(trimmed, [], { resultSet: true, fetchArraySize: batchSize });
        const rs = result.resultSet;
        if (!rs) return;
        columns = (result.metaData ?? []).map((m) => m.name);
        try {
          while (true) {
            const batch = (await rs.getRows(batchSize)) as QueryRow[];
            if (batch.length === 0) break;
            for (const row of batch) yield row;
          }
        } finally {
          await rs.close().catch(() => {});
        }
      } finally {
        await conn.close().catch(() => {});
      }
    }

    const iter = gen();
    return Object.assign(iter, { columns: () => columns });
  }

  async fetchRows(schema: string, name: string, opts?: { limit?: number; offset?: number }) {
    const limit = Math.min(opts?.limit ?? 200, 10_000);
    const offset = opts?.offset ?? 0;
    return this.runStatement(
      `select * from ${qualified(schema, name)} offset ${offset} rows fetch next ${limit} rows only`,
      { readOnly: true, rowLimit: limit + 1 }
    );
  }

  async insertRow(schema: string, name: string, row: QueryRow): Promise<RowOpResult> {
    const keys = Object.keys(row).map(assertIdent);
    if (keys.length === 0) throw new Error("No columns to insert");
    const cols = keys.map((k) => quoteIdent(k)).join(",");
    const placeholders = keys.map((_, i) => `:v${i}`).join(",");
    const binds: Record<string, unknown> = {};
    keys.forEach((k, i) => (binds[`v${i}`] = row[k]));
    return this.withConn(async (c) => {
      const res = await c.execute(
        `insert into ${qualified(schema, name)} (${cols}) values (${placeholders})`,
        binds as oracledb.BindParameters,
        { autoCommit: true }
      );
      return { affectedRows: res.rowsAffected ?? 0 };
    });
  }

  async updateRow(schema: string, name: string, where: QueryRow, set: QueryRow): Promise<RowOpResult> {
    const setKeys = Object.keys(set).map(assertIdent);
    const whereKeys = Object.keys(where).map(assertIdent);
    if (setKeys.length === 0 || whereKeys.length === 0) throw new Error("Invalid update");
    const setClause = setKeys.map((k, i) => `${quoteIdent(k)} = :s${i}`).join(", ");
    const whereClause = whereKeys.map((k, i) => `${quoteIdent(k)} = :w${i}`).join(" and ");
    const binds: Record<string, unknown> = {};
    setKeys.forEach((k, i) => (binds[`s${i}`] = set[k]));
    whereKeys.forEach((k, i) => (binds[`w${i}`] = where[k]));
    return this.withConn(async (c) => {
      const res = await c.execute(
        `update ${qualified(schema, name)} set ${setClause} where ${whereClause}`,
        binds as oracledb.BindParameters,
        { autoCommit: true }
      );
      return { affectedRows: res.rowsAffected ?? 0 };
    });
  }

  async deleteRow(schema: string, name: string, where: QueryRow): Promise<RowOpResult> {
    const whereKeys = Object.keys(where).map(assertIdent);
    if (whereKeys.length === 0) throw new Error("WHERE clause required");
    const whereClause = whereKeys.map((k, i) => `${quoteIdent(k)} = :w${i}`).join(" and ");
    const binds: Record<string, unknown> = {};
    whereKeys.forEach((k, i) => (binds[`w${i}`] = where[k]));
    return this.withConn(async (c) => {
      const res = await c.execute(
        `delete from ${qualified(schema, name)} where ${whereClause}`,
        binds as oracledb.BindParameters,
        { autoCommit: true }
      );
      return { affectedRows: res.rowsAffected ?? 0 };
    });
  }

  async close() {
    if (this.poolPromise) {
      const pool = await this.poolPromise;
      await pool.close(0);
      this.poolPromise = null;
    }
  }
}
