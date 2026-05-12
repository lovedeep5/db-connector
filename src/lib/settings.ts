import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { decryptJSON, encryptJSON } from "@/lib/crypto";

/** Known setting keys (single source of truth for the rest of the app). */
export const SETTING_KEYS = {
  EMAIL: "email_config",
} as const;

export type EmailConfig = {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
};

export async function getSetting<T>(key: string): Promise<T | null> {
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, key));
  if (!row) return null;
  try {
    return decryptJSON<T>(row.encryptedValue);
  } catch {
    return null;
  }
}

export async function setSetting<T>(key: string, value: T, updatedBy: string | null = null): Promise<void> {
  const encryptedValue = encryptJSON(value);
  const [existing] = await db
    .select({ key: schema.settings.key })
    .from(schema.settings)
    .where(eq(schema.settings.key, key));
  if (existing) {
    await db
      .update(schema.settings)
      .set({ encryptedValue, updatedAt: new Date(), updatedBy })
      .where(eq(schema.settings.key, key));
  } else {
    await db.insert(schema.settings).values({
      key,
      encryptedValue,
      updatedAt: new Date(),
      updatedBy,
    });
  }
}

export async function deleteSetting(key: string): Promise<void> {
  await db.delete(schema.settings).where(eq(schema.settings.key, key));
}

export async function getEmailConfig(): Promise<EmailConfig | null> {
  return getSetting<EmailConfig>(SETTING_KEYS.EMAIL);
}

export async function setEmailConfig(cfg: EmailConfig, updatedBy: string | null = null): Promise<void> {
  await setSetting(SETTING_KEYS.EMAIL, cfg, updatedBy);
}

/**
 * Email-config record without the password, safe to return to the client.
 */
export async function getEmailConfigPublic() {
  const cfg = await getEmailConfig();
  if (!cfg) return null;
  return {
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    user: cfg.user ?? "",
    hasPassword: !!cfg.password,
    from: cfg.from,
  };
}
