"use server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/lib/db/client";
import { requireUser } from "@/lib/session";
import { connectionAccess } from "@/lib/rbac";
import { isValidCron, refreshOne, unregister } from "@/lib/scheduler";
import { isValidEmail, parseRecipients } from "@/lib/email";
import { runSchedule } from "@/server/services/schedule-runner";

const Visibility = z.enum(["private", "team", "connection"]);

const BaseSchema = z
  .object({
    connectionId: z.string().min(1),
    name: z.string().min(1).max(120),
    description: z.string().max(2000).optional().nullable(),
    statement: z.string().min(1),
    cronExpression: z.string().min(1).max(120),
    emailTo: z.string().min(1).max(2000),
    emailSubject: z.string().max(200).optional().nullable(),
    visibility: Visibility.default("private"),
    sharedWithTeamId: z.string().optional().nullable(),
    isActive: z.boolean().optional().default(true),
  })
  .superRefine((v, ctx) => {
    if (!isValidCron(v.cronExpression)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cronExpression"], message: "Invalid cron expression" });
    }
    const emails = parseRecipients(v.emailTo);
    if (emails.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["emailTo"], message: "At least one recipient required" });
    } else if (emails.length > 20) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["emailTo"], message: "Up to 20 recipients" });
    } else {
      for (const e of emails) {
        if (!isValidEmail(e)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["emailTo"], message: `"${e}" is not a valid email` });
          break;
        }
      }
    }
    if (v.visibility === "team" && !v.sharedWithTeamId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sharedWithTeamId"], message: "Pick a team" });
    }
  });

export type ScheduleInput = z.infer<typeof BaseSchema>;

async function assertConnection(userId: string, connectionId: string) {
  const access = await connectionAccess(userId, connectionId);
  if (!access) throw new Error("You don't have access to this connection.");
}

async function assertTeamMember(userId: string, teamId: string, isSuperAdmin: boolean) {
  if (isSuperAdmin) return;
  const [row] = await db
    .select()
    .from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.userId, userId)));
  if (!row) throw new Error("You can only share with teams you belong to.");
}

export async function createSchedule(input: ScheduleInput) {
  const user = await requireUser();
  const data = BaseSchema.parse(input);
  await assertConnection(user.id, data.connectionId);
  if (data.visibility === "team" && data.sharedWithTeamId) {
    await assertTeamMember(user.id, data.sharedWithTeamId, user.isSuperAdmin);
  }
  const sharedWithTeamId = data.visibility === "team" ? data.sharedWithTeamId ?? null : null;
  const now = new Date();
  const [inserted] = await db
    .insert(schema.schedules)
    .values({
      userId: user.id,
      connectionId: data.connectionId,
      name: data.name,
      description: data.description ?? null,
      statement: data.statement,
      cronExpression: data.cronExpression,
      emailTo: parseRecipients(data.emailTo).join(", "),
      emailSubject: data.emailSubject ?? null,
      visibility: data.visibility,
      sharedWithTeamId,
      isActive: data.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  await refreshOne(inserted.id);
  revalidatePath("/automations");
  return inserted.id;
}

export async function updateSchedule(id: string, input: ScheduleInput) {
  const user = await requireUser();
  const [existing] = await db.select().from(schema.schedules).where(eq(schema.schedules.id, id));
  if (!existing) throw new Error("Schedule not found");
  if (existing.userId !== user.id && !user.isSuperAdmin) throw new Error("Only the owner can edit this schedule.");
  const data = BaseSchema.parse(input);
  if (data.visibility === "team" && data.sharedWithTeamId) {
    await assertTeamMember(user.id, data.sharedWithTeamId, user.isSuperAdmin);
  }
  const sharedWithTeamId = data.visibility === "team" ? data.sharedWithTeamId ?? null : null;
  await db
    .update(schema.schedules)
    .set({
      connectionId: data.connectionId,
      name: data.name,
      description: data.description ?? null,
      statement: data.statement,
      cronExpression: data.cronExpression,
      emailTo: parseRecipients(data.emailTo).join(", "),
      emailSubject: data.emailSubject ?? null,
      visibility: data.visibility,
      sharedWithTeamId,
      isActive: data.isActive ?? true,
      updatedAt: new Date(),
    })
    .where(eq(schema.schedules.id, id));
  await refreshOne(id);
  revalidatePath("/automations");
}

export async function setScheduleActive(id: string, active: boolean) {
  const user = await requireUser();
  const [existing] = await db.select().from(schema.schedules).where(eq(schema.schedules.id, id));
  if (!existing) throw new Error("Schedule not found");
  if (existing.userId !== user.id && !user.isSuperAdmin) throw new Error("Only the owner can change this.");
  await db
    .update(schema.schedules)
    .set({ isActive: active, updatedAt: new Date() })
    .where(eq(schema.schedules.id, id));
  if (active) await refreshOne(id);
  else unregister(id);
  revalidatePath("/automations");
}

export async function deleteSchedule(id: string) {
  const user = await requireUser();
  const [existing] = await db.select().from(schema.schedules).where(eq(schema.schedules.id, id));
  if (!existing) return;
  if (existing.userId !== user.id && !user.isSuperAdmin) throw new Error("Only the owner can delete this.");
  unregister(id);
  await db.delete(schema.schedules).where(eq(schema.schedules.id, id));
  revalidatePath("/automations");
}

export async function runScheduleNow(id: string) {
  const user = await requireUser();
  const [existing] = await db.select().from(schema.schedules).where(eq(schema.schedules.id, id));
  if (!existing) throw new Error("Schedule not found");
  if (existing.userId !== user.id && !user.isSuperAdmin) throw new Error("Only the owner can trigger this.");
  await runSchedule(id, { trigger: "manual" });
  revalidatePath("/automations");
}
