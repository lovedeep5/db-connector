"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { requireSuperAdmin } from "@/lib/session";

const TeamSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
});

export async function createTeam(input: z.infer<typeof TeamSchema>) {
  await requireSuperAdmin();
  const data = TeamSchema.parse(input);
  const [existing] = await db.select().from(schema.teams).where(eq(schema.teams.name, data.name));
  if (existing) throw new Error("A team with this name already exists.");
  await db.insert(schema.teams).values({ name: data.name, description: data.description ?? null });
  revalidatePath("/teams");
}

export async function deleteTeam(teamId: string) {
  await requireSuperAdmin();
  await db.delete(schema.teams).where(eq(schema.teams.id, teamId));
  revalidatePath("/teams");
}

export async function addTeamMember(teamId: string, userId: string, roleId: string) {
  await requireSuperAdmin();
  const [existing] = await db
    .select()
    .from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.userId, userId)));
  if (existing) {
    await db
      .update(schema.teamMembers)
      .set({ roleId })
      .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.userId, userId)));
  } else {
    await db.insert(schema.teamMembers).values({ teamId, userId, roleId });
  }
  revalidatePath(`/teams/${teamId}`);
}

export async function removeTeamMember(teamId: string, userId: string) {
  await requireSuperAdmin();
  await db
    .delete(schema.teamMembers)
    .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.userId, userId)));
  revalidatePath(`/teams/${teamId}`);
}

export async function grantTeamConnection(
  teamId: string,
  connectionId: string,
  accessLevel: "read" | "write" | null
) {
  await requireSuperAdmin();
  const [existing] = await db
    .select()
    .from(schema.teamConnections)
    .where(and(eq(schema.teamConnections.teamId, teamId), eq(schema.teamConnections.connectionId, connectionId)));
  if (existing) {
    await db
      .update(schema.teamConnections)
      .set({ accessLevel })
      .where(and(eq(schema.teamConnections.teamId, teamId), eq(schema.teamConnections.connectionId, connectionId)));
  } else {
    await db.insert(schema.teamConnections).values({ teamId, connectionId, accessLevel });
  }
  revalidatePath(`/teams/${teamId}`);
}

export async function revokeTeamConnection(teamId: string, connectionId: string) {
  await requireSuperAdmin();
  await db
    .delete(schema.teamConnections)
    .where(and(eq(schema.teamConnections.teamId, teamId), eq(schema.teamConnections.connectionId, connectionId)));
  revalidatePath(`/teams/${teamId}`);
}
