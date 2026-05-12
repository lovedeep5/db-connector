import { Pool, type FieldDef, type PoolClient } from "pg";
import type {
  ColumnInfo,
  DbDriver,
  EditableInfo,
  ObjectInfo,
  PostgresConfig,
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

export class PostgresDriver implements DbDriver {
  readonly type = "postgres" as const;
  private pool: Pool;

  constructor(cfg: PostgresConfig) {
    this.pool = new Pool({
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      user: cfg.user,
      password: cfg.password,
      ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 8_000,
    });
  }

  private async withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { return await fn(client); } finally { client.release(); }
  }

  async test(): Promise<TestResult> {
    try {
      const res = await this.pool.query<{ version: string }>("select version() as version");
      return { ok: true, serverVersion: res.rows[0]?.version };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  async listSchemas(): Promise<SchemaInfo[]> {
    const { rows } = await this.pool.query<{ schema_name: string }>(
      `select schema_name from information_schema.schemata
       where schema_name not in ('pg_catalog','information_schema','pg_toast')
       order by schema_name`
    );
    return rows.map((r) => ({ name: r.schema_name }));
  }

  async listObjects(schema: string): Promise<ObjectInfo[]> {
    assertIdent(schema);
    const { rows } = await this.pool.query<{ table_name: string; table_type: string }>(
      `select table_name, table_type from information_schema.tables
       where table_schema = $1 order by table_name`,
      [schema]
    );
    return rows.map((r) => ({
      schema,
      name: r.table_name,
      kind: r.table_type === "VIEW" ? "view" : "table",
    }));
  }

  async describe(schema: string, name: string): Promise<ColumnInfo[]> {
    assertIdent(schema); assertIdent(name);
    const cols = await this.pool.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `select column_name, data_type, is_nullable
       from information_schema.columns
       where table_schema = $1 and table_name = $2
       order by ordinal_position`,
      [schema, name]
    );
    const pks = await this.pool.query<{ column_name: string }>(
      `select kcu.column_name
       from information_schema.table_constraints tc
       join information_schema.key_column_usage kcu
         on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
       where tc.table_schema = $1 and tc.table_name = $2 and tc.constraint_type = 'PRIMARY KEY'`,
      [schema, name]
    );
    const pkSet = new Set(pks.rows.map((p) => p.column_name));
    return cols.rows.map((c) => ({
      name: c.column_name,
      dataType: c.data_type,
      nullable: c.is_nullable === "YES",
      isPrimaryKey: pkSet.has(c.column_name),
    }));
  }

  /**
   * Run a statement with a hard row cap and statement timeout.
   *
   * For a single read-only statement we wrap it in a server-side cursor so we
   * stop fetching once the cap is reached — the database does not materialize
   * the full result and our process does not buffer rows beyond `rowLimit`.
   * For write or multi-statement input we run directly with a session
   * `statement_timeout` and rely on the statement itself to be bounded.
   */
  async runStatement(statement: string, opts?: RunOptions): Promise<QueryResult> {
    const timeoutMs = clampTimeout(opts?.timeoutMs);
    const rowLimit = clampRowLimit(opts?.rowLimit);
    const started = Date.now();
    const wrapWithCursor = isSingleReadOnly(statement);

    return this.withClient(async (c) => {
      if (wrapWithCursor) {
        await c.query(opts?.readOnly ? "BEGIN READ ONLY" : "BEGIN");
        try {
          await c.query(`SET LOCAL statement_timeout = ${timeoutMs}`);
          await c.query(`DECLARE __dbc_cur NO SCROLL CURSOR FOR ${stripTrailingSemicolons(statement)}`);
          const res = await c.query(`FETCH FORWARD ${rowLimit} FROM __dbc_cur`);
          const peek = await c.query(`FETCH FORWARD 1 FROM __dbc_cur`);
          await c.query("CLOSE __dbc_cur");
          await c.query("COMMIT");
          const columns = res.fields?.map((f) => f.name) ?? [];
          const editable = await detectEditable(c, res.fields ?? []);
          return {
            columns,
            rows: res.rows as QueryRow[],
            rowCount: res.rows.length,
            durationMs: Date.now() - started,
            truncated: (peek.rowCount ?? 0) > 0,
            editable,
          };
        } catch (err) {
          await c.query("ROLLBACK").catch(() => {});
          throw err;
        }
      }

      // Non-cursor path: writes or multi-statement scripts.
      if (opts?.readOnly) {
        // Defense in depth: enforce server-side read-only too.
        await c.query("BEGIN READ ONLY");
      }
      try {
        await c.query(`SET LOCAL statement_timeout = ${timeoutMs}`).catch(async () => {
          // SET LOCAL requires a transaction; start one if we are not already in one.
          await c.query("BEGIN");
          await c.query(`SET LOCAL statement_timeout = ${timeoutMs}`);
        });
        const res = await c.query(statement);
        if (opts?.readOnly) await c.query("COMMIT");
        else await c.query("COMMIT").catch(() => { /* not in tx */ });
        const columns = res.fields?.map((f) => f.name) ?? [];
        const rows = (res.rows ?? []) as QueryRow[];
        const editable = await detectEditable(c, res.fields ?? []);
        return {
          columns,
          rows,
          rowCount: rows.length,
          affectedRows: res.rowCount ?? undefined,
          durationMs: Date.now() - started,
          truncated: false,
          editable,
        };
      } catch (err) {
        if (opts?.readOnly) await c.query("ROLLBACK").catch(() => {});
        throw err;
      }
    });
  }

  streamStatement(statement: string, opts?: StreamOptions) {
    const timeoutMs = clampTimeout(opts?.timeoutMs ?? STREAM_DEFAULT_TIMEOUT_MS);
    const batchSize = opts?.batchSize ?? STREAM_DEFAULT_BATCH;
    const pool = this.pool;
    let columns: string[] = [];

    async function* gen(): AsyncGenerator<QueryRow, void, void> {
      const client = await pool.connect();
      try {
        await client.query(opts?.readOnly ? "BEGIN READ ONLY" : "BEGIN");
        await client.query(`SET LOCAL statement_timeout = ${timeoutMs}`);
        await client.query(`DECLARE __dbc_stream NO SCROLL CURSOR FOR ${stripTrailingSemicolons(statement)}`);
        while (true) {
          const res = await client.query(`FETCH FORWARD ${batchSize} FROM __dbc_stream`);
          if (columns.length === 0) columns = res.fields?.map((f) => f.name) ?? [];
          if (res.rows.length === 0) break;
          for (const r of res.rows) yield r as QueryRow;
        }
        await client.query("CLOSE __dbc_stream");
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    }

    const iter = gen();
    return Object.assign(iter, { columns: () => columns });
  }

  async fetchRows(schema: string, name: string, opts?: { limit?: number; offset?: number }) {
    const limit = Math.min(opts?.limit ?? 200, 10_000);
    const offset = opts?.offset ?? 0;
    return this.runStatement(
      `select * from ${qualified(schema, name)} limit ${limit} offset ${offset}`,
      { readOnly: true, rowLimit: limit + 1 }
    );
  }

  async insertRow(schema: string, name: string, row: QueryRow): Promise<RowOpResult> {
    const keys = Object.keys(row).map(assertIdent);
    if (keys.length === 0) throw new Error("No columns to insert");
    const cols = keys.map((k) => quoteIdent(k)).join(",");
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(",");
    const values = keys.map((k) => row[k]);
    const res = await this.pool.query(
      `insert into ${qualified(schema, name)} (${cols}) values (${placeholders})`,
      values
    );
    return { affectedRows: res.rowCount ?? 0 };
  }

  async updateRow(schema: string, name: string, where: QueryRow, set: QueryRow): Promise<RowOpResult> {
    const setKeys = Object.keys(set).map(assertIdent);
    const whereKeys = Object.keys(where).map(assertIdent);
    if (setKeys.length === 0) throw new Error("No columns to update");
    if (whereKeys.length === 0) throw new Error("WHERE clause required");
    const setClause = setKeys.map((k, i) => `${quoteIdent(k)} = $${i + 1}`).join(", ");
    const whereClause = whereKeys.map((k, i) => `${quoteIdent(k)} = $${setKeys.length + i + 1}`).join(" and ");
    const values = [...setKeys.map((k) => set[k]), ...whereKeys.map((k) => where[k])];
    const res = await this.pool.query(
      `update ${qualified(schema, name)} set ${setClause} where ${whereClause}`,
      values
    );
    return { affectedRows: res.rowCount ?? 0 };
  }

  async deleteRow(schema: string, name: string, where: QueryRow): Promise<RowOpResult> {
    const whereKeys = Object.keys(where).map(assertIdent);
    if (whereKeys.length === 0) throw new Error("WHERE clause required");
    const whereClause = whereKeys.map((k, i) => `${quoteIdent(k)} = $${i + 1}`).join(" and ");
    const values = whereKeys.map((k) => where[k]);
    const res = await this.pool.query(
      `delete from ${qualified(schema, name)} where ${whereClause}`,
      values
    );
    return { affectedRows: res.rowCount ?? 0 };
  }

  async close() { await this.pool.end(); }
}

function stripTrailingSemicolons(sql: string): string {
  return sql.replace(/;\s*$/g, "");
}

/**
 * Returns editable metadata iff every output column maps back to a real
 * column in the SAME table, and that table has a primary key fully present
 * in the projection. Otherwise the result is treated as read-only.
 *
 * Postgres returns a `tableID` (oid) and `columnID` (attnum) per field on
 * the wire — 0 means the value came from an expression, function, or join
 * column, none of which we can safely round-trip.
 */
async function detectEditable(client: PoolClient, fields: FieldDef[]): Promise<EditableInfo | undefined> {
  if (fields.length === 0) return undefined;
  const tableIds = new Set(fields.map((f) => f.tableID));
  if (tableIds.size !== 1) return undefined;
  const tableID = fields[0].tableID;
  if (!tableID || fields.some((f) => f.columnID === 0)) return undefined;

  const meta = await client.query<{ schema: string; table: string }>(
    `select n.nspname as schema, c.relname as "table"
     from pg_class c join pg_namespace n on c.relnamespace = n.oid
     where c.oid = $1`,
    [tableID]
  );
  if (meta.rows.length === 0) return undefined;
  const { schema, table } = meta.rows[0];

  const pks = await client.query<{ attnum: number }>(
    `select unnest(i.indkey) as attnum
     from pg_index i where i.indrelid = $1 and i.indisprimary`,
    [tableID]
  );
  if (pks.rows.length === 0) return undefined;
  const pkAttnums = new Set(pks.rows.map((r) => Number(r.attnum)));

  const attnums = [...new Set(fields.map((f) => f.columnID))];
  const attrs = await client.query<{ attnum: number; attname: string }>(
    `select attnum, attname from pg_attribute
     where attrelid = $1 and attnum = any($2::int[])`,
    [tableID, attnums]
  );
  const attMap = new Map(attrs.rows.map((r) => [Number(r.attnum), r.attname]));

  const columns = fields.map((f) => ({
    alias: f.name,
    source: attMap.get(f.columnID) ?? f.name,
    isPrimaryKey: pkAttnums.has(f.columnID),
  }));

  // Require every PK column to be in the projection so we can build a WHERE.
  const projectedPks = new Set(columns.filter((c) => c.isPrimaryKey).map((c) => c.source));
  for (const att of pkAttnums) {
    const name = attMap.get(att);
    if (!name || !projectedPks.has(name)) return undefined;
  }

  return { schema, table, columns };
}
