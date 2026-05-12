import { MongoClient, type Db, ObjectId, type AbstractCursor } from "mongodb";
import type {
  ColumnInfo,
  DbDriver,
  MongoConfig,
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

type MongoStatement =
  | { collection: string; operation: "find"; filter?: Record<string, unknown>; projection?: Record<string, 0 | 1>; sort?: Record<string, 1 | -1>; limit?: number; skip?: number }
  | { collection: string; operation: "aggregate"; pipeline: Record<string, unknown>[] }
  | { collection: string; operation: "count"; filter?: Record<string, unknown> }
  | { collection: string; operation: "distinct"; field: string; filter?: Record<string, unknown> };

export class MongoDriver implements DbDriver {
  readonly type = "mongodb" as const;
  private client: MongoClient;
  private dbName: string;

  constructor(cfg: MongoConfig) {
    this.client = new MongoClient(cfg.url, { serverSelectionTimeoutMS: 8_000 });
    this.dbName = cfg.database;
  }

  private async getDb(): Promise<Db> {
    await this.client.connect();
    return this.client.db(this.dbName);
  }

  async test(): Promise<TestResult> {
    try {
      const db = await this.getDb();
      const info = await db.admin().serverStatus();
      return { ok: true, serverVersion: info.version };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  async listSchemas(): Promise<SchemaInfo[]> {
    return [{ name: this.dbName }];
  }

  async listObjects(schema: string): Promise<ObjectInfo[]> {
    const db = await this.getDb();
    const cols = await db.listCollections({}, { nameOnly: true }).toArray();
    return cols.map((c) => ({ schema, name: c.name, kind: "collection" as const }));
  }

  async describe(_schema: string, name: string): Promise<ColumnInfo[]> {
    const db = await this.getDb();
    const sample = await db.collection(name).findOne({});
    if (!sample) return [];
    const fields = new Map<string, string>();
    for (const [k, v] of Object.entries(sample)) {
      fields.set(k, this.typeOf(v));
    }
    return [...fields.entries()].map(([k, t]) => ({
      name: k,
      dataType: t,
      nullable: true,
      isPrimaryKey: k === "_id",
    }));
  }

  private typeOf(v: unknown): string {
    if (v === null) return "null";
    if (Array.isArray(v)) return "array";
    if (v instanceof Date) return "date";
    if (v instanceof ObjectId) return "objectId";
    return typeof v;
  }

  private parseStatement(statement: string): MongoStatement {
    try {
      return JSON.parse(statement) as MongoStatement;
    } catch {
      throw new Error("Statement must be valid JSON describing a MongoDB operation.");
    }
  }

  private openCursor(db: Db, parsed: MongoStatement, opts?: { rowLimit?: number; timeoutMs?: number }):
    | { kind: "cursor"; cursor: AbstractCursor; truncatable: boolean }
    | { kind: "scalar"; rows: QueryRow[] }
  {
    const col = db.collection(parsed.collection);
    const maxTimeMS = opts?.timeoutMs;
    switch (parsed.operation) {
      case "find": {
        const cursor = col
          .find(parsed.filter ?? {}, { projection: parsed.projection, sort: parsed.sort })
          .skip(parsed.skip ?? 0);
        if (parsed.limit !== undefined) cursor.limit(Math.min(parsed.limit, opts?.rowLimit ?? parsed.limit));
        else if (opts?.rowLimit) cursor.limit(opts.rowLimit + 1);
        if (maxTimeMS) cursor.maxTimeMS(maxTimeMS);
        return { kind: "cursor", cursor, truncatable: parsed.limit === undefined };
      }
      case "aggregate": {
        const pipeline = parsed.pipeline.slice();
        if (opts?.rowLimit) pipeline.push({ $limit: opts.rowLimit + 1 });
        const cursor = col.aggregate(pipeline, maxTimeMS ? { maxTimeMS } : undefined);
        return { kind: "cursor", cursor, truncatable: true };
      }
      case "count": {
        // count_documents is awaited separately by caller
        return { kind: "scalar", rows: [] };
      }
      case "distinct": {
        return { kind: "scalar", rows: [] };
      }
      default:
        throw new Error("Unsupported MongoDB operation.");
    }
  }

  async runStatement(statement: string, opts?: RunOptions): Promise<QueryResult> {
    const timeoutMs = clampTimeout(opts?.timeoutMs);
    const rowLimit = clampRowLimit(opts?.rowLimit);
    const started = Date.now();
    const parsed = this.parseStatement(statement);
    const db = await this.getDb();
    const col = db.collection(parsed.collection);

    let rows: QueryRow[] = [];
    let truncated = false;

    if (parsed.operation === "count") {
      const n = await col.countDocuments(parsed.filter ?? {}, { maxTimeMS: timeoutMs });
      rows = [{ count: n }];
    } else if (parsed.operation === "distinct") {
      const values = await col.distinct(parsed.field, parsed.filter ?? {}, { maxTimeMS: timeoutMs });
      rows = values.slice(0, rowLimit).map((v) => ({ value: v }));
      truncated = values.length > rowLimit;
    } else {
      const opened = this.openCursor(db, parsed, { rowLimit, timeoutMs });
      if (opened.kind === "cursor") {
        try {
          for await (const doc of opened.cursor as AsyncIterable<QueryRow>) {
            if (rows.length >= rowLimit) {
              truncated = true;
              break;
            }
            rows.push(doc);
          }
        } finally {
          await opened.cursor.close().catch(() => {});
        }
      }
    }

    const columns = rows.length > 0 ? Array.from(new Set(rows.flatMap((r) => Object.keys(r)))) : [];
    return {
      columns,
      rows,
      rowCount: rows.length,
      durationMs: Date.now() - started,
      truncated,
    };
  }

  streamStatement(statement: string, opts?: StreamOptions) {
    const timeoutMs = clampTimeout(opts?.timeoutMs ?? STREAM_DEFAULT_TIMEOUT_MS);
    const batchSize = opts?.batchSize ?? STREAM_DEFAULT_BATCH;
    const parsed = this.parseStatement(statement);
    const getDb = () => this.getDb();
    let columns: string[] = [];

    async function* gen(): AsyncGenerator<QueryRow, void, void> {
      const db = await getDb();
      const col = db.collection(parsed.collection);
      let cursor: AbstractCursor | null = null;
      try {
        if (parsed.operation === "find") {
          const c = col
            .find(parsed.filter ?? {}, { projection: parsed.projection, sort: parsed.sort })
            .skip(parsed.skip ?? 0)
            .batchSize(batchSize);
          if (parsed.limit !== undefined) c.limit(parsed.limit);
          c.maxTimeMS(timeoutMs);
          cursor = c;
        } else if (parsed.operation === "aggregate") {
          cursor = col.aggregate(parsed.pipeline, { maxTimeMS: timeoutMs, batchSize });
        } else {
          throw new Error("Streaming export only supports find and aggregate.");
        }
        for await (const doc of cursor as AsyncIterable<QueryRow>) {
          if (columns.length === 0) columns = Object.keys(doc);
          yield doc;
        }
      } finally {
        await cursor?.close().catch(() => {});
      }
    }

    const iter = gen();
    return Object.assign(iter, { columns: () => columns });
  }

  async fetchRows(_schema: string, name: string, opts?: { limit?: number; offset?: number }) {
    const started = Date.now();
    const db = await this.getDb();
    const rows = (await db
      .collection(name)
      .find({})
      .skip(opts?.offset ?? 0)
      .limit(Math.min(opts?.limit ?? 200, 10_000))
      .toArray()) as QueryRow[];
    const columns = rows.length > 0 ? Array.from(new Set(rows.flatMap((r) => Object.keys(r)))) : [];
    return { columns, rows, rowCount: rows.length, durationMs: Date.now() - started, truncated: false };
  }

  private normalizeId(row: QueryRow): QueryRow {
    if (row._id && typeof row._id === "string" && /^[a-f0-9]{24}$/i.test(row._id)) {
      return { ...row, _id: new ObjectId(row._id) };
    }
    return row;
  }

  async insertRow(_schema: string, name: string, row: QueryRow): Promise<RowOpResult> {
    const db = await this.getDb();
    const res = await db.collection(name).insertOne(this.normalizeId(row));
    return { affectedRows: res.acknowledged ? 1 : 0 };
  }

  async updateRow(_schema: string, name: string, where: QueryRow, set: QueryRow): Promise<RowOpResult> {
    const db = await this.getDb();
    const res = await db.collection(name).updateOne(this.normalizeId(where), { $set: set });
    return { affectedRows: res.modifiedCount };
  }

  async deleteRow(_schema: string, name: string, where: QueryRow): Promise<RowOpResult> {
    const db = await this.getDb();
    const res = await db.collection(name).deleteOne(this.normalizeId(where));
    return { affectedRows: res.deletedCount };
  }

  async close() { await this.client.close(); }
}
