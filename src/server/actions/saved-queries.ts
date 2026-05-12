"use server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/lib/db/client";
import { requireUser } from "@/lib/session";
import { connectionAccess } from "@/lib/rbac";

const Visibility = z.enum(["private", "team", "connection"]);

const SaveSchema = z
  .object({
    connectionId: z.string().min(1),
    name: z.string().min(1).max(120),
    description: z.string().max(2000).optional().nullable(),
    statement: z.string().min(1),
    visibility: Visibility.default("private"),
    sharedWithTeamId: z.string().optional().nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.visibility === "team" && !v.sharedWithTeamId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sharedWithTeamId"],
        message: "Pick a team when sharing with one.",
      });
    }
  });

export type SaveQueryInput = z.infer<typeof SaveSchema>;

async function assertConnectionAccess(userId: string, connectionId: string) {
  const access = await connectionAccess(userId, connectionId);
  if (!access) throw new Error("You don't have access to this connection.");
}

async function assertTeamMembership(userId: string, teamId: string, isSuperAdmin: boolean) {
  if (isSuperAdmin) return;
  const [row] = await db
    .select()
    .from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.userId, userId)));
  if (!row) throw new Error("You can only share with teams you belong to.");
}

export async function saveQuery(input: SaveQueryInput) {
  const user = await requireUser();
  const data = SaveSchema.parse(input);
  await assertConnectionAccess(user.id, data.connectionId);
  if (data.visibility === "team" && data.sharedWithTeamId) {
    await assertTeamMembership(user.id, data.sharedWithTeamId, user.isSuperAdmin);
  }
  const sharedWithTeamId = data.visibility === "team" ? data.sharedWithTeamId ?? null : null;

  const [existing] = await db
    .select()
    .from(schema.savedQueries)
    .where(
      and(
        eq(schema.savedQueries.userId, user.id),
        eq(schema.savedQueries.connectionId, data.connectionId),
        eq(schema.savedQueries.name, data.name)
      )
    );

  const now = new Date();
  if (existing) {
    await db
      .update(schema.savedQueries)
      .set({
        description: data.description ?? null,
        statement: data.statement,
        visibility: data.visibility,
        sharedWithTeamId,
        updatedAt: now,
      })
      .where(eq(schema.savedQueries.id, existing.id));
    revalidatePath("/query");
    return existing.id;
  }
  const [inserted] = await db
    .insert(schema.savedQueries)
    .values({
      userId: user.id,
      connectionId: data.connectionId,
      name: data.name,
      description: data.description ?? null,
      statement: data.statement,
      visibility: data.visibility,
      sharedWithTeamId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  revalidatePath("/query");
  return inserted.id;
}

export async function updateSavedQuery(
  id: string,
  input: Omit<SaveQueryInput, "connectionId">
) {
  const user = await requireUser();
  const [existing] = await db
    .select()
    .from(schema.savedQueries)
    .where(eq(schema.savedQueries.id, id));
  if (!existing) throw new Error("Query not found");
  if (existing.userId !== user.id && !user.isSuperAdmin) {
    throw new Error("Only the owner can edit this query.");
  }
  const data = SaveSchema.parse({ ...input, connectionId: existing.connectionId });
  if (data.visibility === "team" && data.sharedWithTeamId) {
    await assertTeamMembership(user.id, data.sharedWithTeamId, user.isSuperAdmin);
  }
  const sharedWithTeamId = data.visibility === "team" ? data.sharedWithTeamId ?? null : null;

  await db
    .update(schema.savedQueries)
    .set({
      name: data.name,
      description: data.description ?? null,
      statement: data.statement,
      visibility: data.visibility,
      sharedWithTeamId,
      updatedAt: new Date(),
    })
    .where(eq(schema.savedQueries.id, id));
  revalidatePath("/query");
}

export async function deleteSavedQuery(id: string) {
  const user = await requireUser();
  const [existing] = await db
    .select()
    .from(schema.savedQueries)
    .where(eq(schema.savedQueries.id, id));
  if (!existing) return;
  if (existing.userId !== user.id && !user.isSuperAdmin) {
    throw new Error("Only the owner can delete this query.");
  }
  await db.delete(schema.savedQueries).where(eq(schema.savedQueries.id, id));
  revalidatePath("/query");
}
