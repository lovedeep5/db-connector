try { (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.(".env"); } catch { /* ok */ }

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./client";

await migrate(db, { migrationsFolder: "./drizzle" });
console.log("Migrations applied.");
