import { db, schema } from "@/lib/db/client";
import { connectionAccess, loadEffectivePermissions, can } from "@/lib/rbac";
import { getDriverForConnection } from "@/lib/drivers/factory";
import { isReadOnly } from "@/lib/drivers/sql-utils";
import type { Permission } from "@/lib/db/schema";
import type { QueryResult, QueryRow, RunOptions, StreamOptions } from "@/lib/drivers/types";

export type AccessContext = { userId: string };

async function checkPermission(userId: string, p: Permission) {
  const perms = await loadEffectivePermissions(userId);
  if (!can(perms, p)) throw new Error("Forbidden");
}

export async function listSchemas(ctx: AccessContext, connectionId: string) {
  const access = await connectionAccess(ctx.userId, connectionId);
  if (!access) throw new Error("Forbidden");
  const driver = await getDriverForConnection(connectionId);
  return driver.listSchemas();
}

export async function listObjects(ctx: AccessContext, connectionId: string, schemaName: string) {
  const access = await connectionAccess(ctx.userId, connectionId);
  if (!access) throw new Error("Forbidden");
  const driver = await getDriverForConnection(connectionId);
  return driver.listObjects(schemaName);
}

export async function describeObject(
  ctx: AccessContext,
  connectionId: string,
  schemaName: string,
  name: string
) {
  const access = await connectionAccess(ctx.userId, connectionId);
  if (!access) throw new Error("Forbidden");
  const driver = await getDriverForConnection(connectionId);
  return driver.describe(schemaName, name);
}

export async function runQuery(
  ctx: AccessContext,
  connectionId: string,
  statement: string,
  opts?: Pick<RunOptions, "rowLimit" | "timeoutMs">
): Promise<QueryResult> {
  await checkPermission(ctx.userId, "query:run");
  const access = await connectionAccess(ctx.userId, connectionId);
  if (!access) throw new Error("Forbidden");

  const driver = await getDriverForConnection(connectionId);
  const readOnly = access === "read";
  if (readOnly && driver.type !== "mongodb" && !isReadOnly(statement)) {
    throw new Error(
      "You have read-only access on this connection. Only SELECT/SHOW/EXPLAIN are allowed."
    );
  }

  let result: QueryResult;
  let status: "success" | "error" = "success";
  let errMsg: string | null = null;
  try {
    result = await driver.runStatement(statement, { ...opts, readOnly });
  } catch (e) {
    status = "error";
    errMsg = (e as Error).message;
    await db.insert(schema.queryHistory).values({
      userId: ctx.userId,
      connectionId,
      statement,
      status,
      durationMs: 0,
      errorMessage: errMsg,
    });
    throw e;
  }
  await db.insert(schema.queryHistory).values({
    userId: ctx.userId,
    connectionId,
    statement,
    status,
    durationMs: result.durationMs,
    rowCount: result.rowCount,
    errorMessage: null,
  });
  return result;
}

export async function streamQuery(
  ctx: AccessContext,
  connectionId: string,
  statement: string,
  opts?: StreamOptions
) {
  await checkPermission(ctx.userId, "data:export");
  const access = await connectionAccess(ctx.userId, connectionId);
  if (!access) throw new Error("Forbidden");
  const driver = await getDriverForConnection(connectionId);
  const readOnly = access === "read";
  if (readOnly && driver.type !== "mongodb" && !isReadOnly(statement)) {
    throw new Error("Read-only export must use a SELECT-style statement.");
  }
  return driver.streamStatement(statement, { ...opts, readOnly: true });
}

export async function fetchRows(
  ctx: AccessContext,
  connectionId: string,
  schemaName: string,
  name: string,
  opts?: { limit?: number; offset?: number }
) {
  const access = await connectionAccess(ctx.userId, connectionId);
  if (!access) throw new Error("Forbidden");
  const driver = await getDriverForConnection(connectionId);
  return driver.fetchRows(schemaName, name, opts);
}

export async function insertRow(
  ctx: AccessContext,
  connectionId: string,
  schemaName: string,
  name: string,
  row: QueryRow
) {
  const access = await connectionAccess(ctx.userId, connectionId);
  if (access !== "write") throw new Error("Read-only access");
  await checkPermission(ctx.userId, "data:edit");
  const driver = await getDriverForConnection(connectionId);
  return driver.insertRow(schemaName, name, row);
}

export async function updateRow(
  ctx: AccessContext,
  connectionId: string,
  schemaName: string,
  name: string,
  where: QueryRow,
  set: QueryRow
) {
  const access = await connectionAccess(ctx.userId, connectionId);
  if (access !== "write") throw new Error("Read-only access");
  await checkPermission(ctx.userId, "data:edit");
  const driver = await getDriverForConnection(connectionId);
  return driver.updateRow(schemaName, name, where, set);
}

export async function deleteRow(
  ctx: AccessContext,
  connectionId: string,
  schemaName: string,
  name: string,
  where: QueryRow
) {
  const access = await connectionAccess(ctx.userId, connectionId);
  if (access !== "write") throw new Error("Read-only access");
  await checkPermission(ctx.userId, "data:edit");
  const driver = await getDriverForConnection(connectionId);
  return driver.deleteRow(schemaName, name, where);
}
